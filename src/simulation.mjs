import { randomUUID } from 'node:crypto';
import { signTransaction } from './merchant-signature.mjs';
import { buildDocumentJwe } from './document-jwe.mjs';

const AUTH = '/api/bff/v1/auth';
const JOURNEY = '/api/bff/v1/pis-journey';
const WAITING_PSU_STATES = new Set(['WAITING_USER_REVIEW', 'DESKTOP_WAITING_SCAN', 'INITIATED']);
const RETRYABLE_PHASES = new Set(['waiting-scan', 'ready-auth', 'waiting-biometrics', 'payment-decision']);

export class SimulationError extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.name = 'SimulationError';
    this.httpStatus = httpStatus;
  }
}

class StepFailedError extends Error {}

const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resumeTokenFrom(redirectUrl) {
  const match = /[?&#]t=([^&#]+)/.exec(redirectUrl ?? '');
  return match ? decodeURIComponent(match[1]) : null;
}

function qrDataUrl(qrImage, contentType) {
  if (!qrImage) return null;
  return qrImage.startsWith('data:') ? qrImage : `data:${contentType ?? 'image/png'};base64,${qrImage}`;
}

function withoutImages(body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && 'qrImage' in body) {
    return { ...body, qrImage: '[imagen QR]' };
  }
  return body;
}

export function createSimulation({
  gateway,
  masker,
  secrets,
  dpi,
  operationId,
  transaction,
  clock = () => new Date(),
  wait = sleep,
  pollIntervalMs = 2000,
  pollTimeoutMs = 45000,
}) {
  const sessions = new Map();

  async function step(session, { title, method, path, token, body, headers }) {
    const result = await gateway.call({ method, path, token, body, headers, correlationId: session.correlationId });
    const trace = {
      title,
      method,
      path,
      status: result.status,
      ms: result.ms,
      request: masker.value(body ?? null),
      response: masker.value(withoutImages(result.body)),
    };
    session.steps.push(trace);
    if (result.status >= 400) {
      session.phase = 'failed';
      session.error = { step: title, status: result.status, body: trace.response };
      throw new StepFailedError(title);
    }
    return result.body ?? {};
  }

  function requireSession(id, phase) {
    const session = sessions.get(id);
    if (!session) throw new SimulationError('La simulación no existe', 404);
    if (session.busy) throw new SimulationError('La simulación está ejecutando otro paso', 409);
    if (session.phase !== phase) throw new SimulationError(`El paso no aplica en la fase ${session.phase}`, 409);
    return session;
  }

  async function run(session, action) {
    session.busy = true;
    session.retryPhase = session.phase;
    try {
      await action();
    } catch (error) {
      if (!(error instanceof StepFailedError)) {
        session.phase = 'failed';
        session.error = { step: 'servidor', status: 0, body: masker.text(error.message) };
      }
    } finally {
      session.busy = false;
    }
    return view(session);
  }

  function view(session) {
    return {
      id: session.id,
      correlationId: session.correlationId,
      journeyId: session.journeyId,
      phase: session.phase,
      retryPhase: session.phase === 'failed' ? session.retryPhase : null,
      state: session.state,
      desktopQr: session.phase === 'waiting-scan' ? session.desktopQr : null,
      facephiUrl: session.phase === 'waiting-biometrics' ? session.facephiUrl : null,
      summary: session.summary,
      accounts: session.accounts.map((account, index) => ({
        index,
        productName: account.productName,
        productType: account.productType,
        maskedNumber: masker.text(account.maskedNumber),
        availableBalance: account.availableBalance,
        currency: account.currency,
        hasSufficientBalance: account.hasSufficientBalance,
      })),
      payment: session.payment,
      steps: session.steps,
      error: session.error,
    };
  }

  async function refreshStatus(session, token, title = 'Estado del journey') {
    const status = await step(session, { title, method: 'GET', path: `${JOURNEY}/${session.journeyId}/status`, token });
    session.state = status.status;
    return status;
  }

  async function start() {
    const session = {
      id: randomUUID(),
      correlationId: randomUUID(),
      phase: 'starting',
      steps: [],
      accounts: [],
      busy: false,
    };
    sessions.set(session.id, session);
    const tx = {
      ...transaction,
      transactionReference: `DEMO-${clock().getTime()}`,
      date: isoSeconds(clock()),
    };
    return run(session, async () => {
      const { productId, transactionReference, amount, currency, date, merchantKey, merchantName, tppRedirectUrl } = tx;
      const handoff = await step(session, {
        title: 'Handoff firmado por el comercio',
        method: 'POST',
        path: `${AUTH}/handoff`,
        body: { merchantKey, productId, transactionReference, amount, currency, date, signature: signTransaction(tx, secrets.signingSecret) },
      });
      const init = await step(session, { title: 'Init: OBST del escritorio', method: 'POST', path: `${AUTH}/init`, body: { handoffToken: handoff.handoffToken } });
      session.desktopToken = init.token;
      const started = await step(session, {
        title: 'Start DESKTOP con el DPI en JWE',
        method: 'POST',
        path: `${JOURNEY}/start?deviceType=DESKTOP`,
        token: session.desktopToken,
        headers: { 'X-Idempotency-Key': randomUUID() },
        body: {
          documentJwe: buildDocumentJwe({ publicKeyPem: secrets.jwePublicKey, kid: secrets.jweKid, documentNumber: dpi }),
          productId, transactionReference, amount, currency, date, merchantKey, merchantName, tppRedirectUrl,
        },
      });
      session.journeyId = started.journeyId;
      session.state = started.status;
      await refreshStatus(session, session.desktopToken);
      const transfer = await step(session, {
        title: 'QR de transferencia al celular',
        method: 'GET',
        path: `${JOURNEY}/transfer?journeyId=${encodeURIComponent(session.journeyId)}`,
        token: session.desktopToken,
      });
      session.desktopQr = qrDataUrl(transfer.qrImage, transfer.qrContentType);
      session.transferToken = resumeTokenFrom(transfer.redirectUrl);
      session.phase = 'waiting-scan';
    });
  }

  async function waitForPsu(session) {
    const deadline = clock().getTime() + pollTimeoutMs;
    let lastState = null;
    while (clock().getTime() <= deadline) {
      const result = await gateway.call({ method: 'GET', path: `${JOURNEY}/${session.journeyId}/status`, token: session.mobileToken, correlationId: session.correlationId });
      const state = result.body?.status;
      if (result.status >= 400 || state !== lastState || !WAITING_PSU_STATES.has(state)) {
        session.steps.push({ title: 'Polling de estado', method: 'GET', path: `${JOURNEY}/${session.journeyId}/status`, status: result.status, ms: result.ms, request: null, response: masker.value(result.body) });
      }
      if (result.status >= 400) {
        session.phase = 'failed';
        session.error = { step: 'Polling de estado', status: result.status, body: masker.value(result.body) };
        throw new StepFailedError('polling');
      }
      session.state = state;
      lastState = state;
      if (!WAITING_PSU_STATES.has(state)) return state;
      await wait(pollIntervalMs);
    }
    session.phase = 'failed';
    session.error = { step: 'Enriquecimiento del PSU', status: 0, body: `El PSU no respondió en ${pollTimeoutMs / 1000} s` };
    throw new StepFailedError('psu-timeout');
  }

  async function scan(id) {
    const session = requireSession(id, 'waiting-scan');
    return run(session, async () => {
      if (!session.mobileToken) {
        const resumed = await step(session, { title: 'Celular: canje del token del QR', method: 'POST', path: `${AUTH}/resume`, body: { resumeToken: session.transferToken } });
        session.mobileToken = resumed.obst ?? resumed.token;
      }
      if (!session.mobileClaimed) {
        const started = await step(session, {
          title: 'Start MOBILE: el celular reclama el journey',
          method: 'POST',
          path: `${JOURNEY}/start?deviceType=MOBILE`,
          token: session.mobileToken,
          headers: { 'X-Idempotency-Key': randomUUID() },
          body: { journeyId: session.journeyId },
        });
        session.mobileClaimed = true;
        session.state = started.status;
      }
      const state = await waitForPsu(session);
      if (state === 'CLIENT_NOT_ELIGIBLE') {
        session.phase = 'not-eligible';
        return;
      }
      const resume = await step(session, { title: 'Resumen de la transacción', method: 'GET', path: `${JOURNEY}/${session.journeyId}/resume`, token: session.mobileToken });
      session.summary = masker.value({ ...resume.transactionSummary, contextStatus: resume.contextStatus });
      session.phase = 'ready-auth';
    });
  }

  async function authenticate(id) {
    const session = requireSession(id, 'ready-auth');
    return run(session, async () => {
      const auth = await step(session, {
        title: 'Inicio de biometría',
        method: 'POST',
        path: `${JOURNEY}/${session.journeyId}/auth`,
        token: session.mobileToken,
        headers: { 'X-Customer-Id': dpi, 'X-Idempotency-Key': randomUUID(), 'X-Transaction-Date-Time': clock().toISOString() },
        body: { dpi },
      });
      session.facephiUrl = auth.facephiUrl;
      session.authResumeToken = auth.resumeToken;
      session.state = 'AUTH_INITIATED';
      session.phase = 'waiting-biometrics';
    });
  }

  async function confirmBiometrics(id) {
    const session = requireSession(id, 'waiting-biometrics');
    return run(session, async () => {
      if (!session.authToken) {
        const resumed = await step(session, { title: 'Retorno de la biometría: canje del resumeToken', method: 'POST', path: `${AUTH}/resume`, body: { resumeToken: session.authResumeToken } });
        session.authToken = resumed.obst ?? resumed.token;
      }
      const verify = await step(session, {
        title: 'Verify de la biometría',
        method: 'POST',
        path: `${JOURNEY}/${session.journeyId}/auth/verify`,
        token: session.authToken,
        headers: { 'X-Customer-Id': dpi },
        body: { verificationToken: operationId },
      });
      if (!verify.authenticated) {
        session.phase = 'failed';
        session.error = { step: 'Verify de la biometría', status: 200, body: 'authenticated=false' };
        return;
      }
      session.state = 'AUTHENTICATED';
      const screen = await step(session, {
        title: 'Pantalla de pago',
        method: 'GET',
        path: `${JOURNEY}/${session.journeyId}/payments`,
        token: session.authToken,
        headers: { 'X-Customer-Id': dpi },
      });
      session.accounts = screen.accounts ?? [];
      session.state = 'WAITING_PAYMENT_DECISION';
      session.phase = 'payment-decision';
    });
  }

  async function accept(id, accountIndex) {
    const session = requireSession(id, 'payment-decision');
    const account = session.accounts[accountIndex];
    if (!account) throw new SimulationError('La cuenta elegida no existe', 400);
    return run(session, async () => {
      const result = await step(session, {
        title: 'Aceptar pago: débito en Core',
        method: 'POST',
        path: `${JOURNEY}/${session.journeyId}/payments/accept`,
        token: session.authToken,
        headers: { 'X-Idempotency-Key': randomUUID() },
        body: { debitAccountId: account.accountId },
      });
      session.payment = masker.value(result);
      await refreshStatus(session, session.authToken, 'Estado final');
      session.phase = 'completed';
    });
  }

  async function reject(id) {
    const session = requireSession(id, 'payment-decision');
    return run(session, async () => {
      const result = await step(session, {
        title: 'Rechazar pago',
        method: 'POST',
        path: `${JOURNEY}/${session.journeyId}/payments/reject`,
        token: session.authToken,
        headers: { 'X-Customer-Id': dpi },
      });
      session.payment = masker.value(result);
      await refreshStatus(session, session.authToken, 'Estado final');
      session.phase = 'rejected';
    });
  }

  function retry(id) {
    const session = requireSession(id, 'failed');
    if (!RETRYABLE_PHASES.has(session.retryPhase)) {
      throw new SimulationError('Ese paso no se puede reintentar: inicia un journey nuevo', 409);
    }
    session.phase = session.retryPhase;
    session.error = null;
    return view(session);
  }

  function get(id) {
    const session = sessions.get(id);
    if (!session) throw new SimulationError('La simulación no existe', 404);
    return view(session);
  }

  return { start, scan, authenticate, confirmBiometrics, accept, reject, retry, get };
}
