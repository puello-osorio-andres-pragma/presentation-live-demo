import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createSimulation, SimulationError } from '../src/simulation.mjs';
import { createMasker } from '../src/masker.mjs';

const DPI = '2547896510101';
const JOURNEY_ID = '7f0c2f4e-1111-4b2a-9c3d-000000000001';
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SECRETS = { signingSecret: 'secret', jwePublicKey: publicKey.export({ type: 'spki', format: 'pem' }), jweKid: 'kid-1' };
const TRANSACTION = { productId: 'PIS-DEMO', amount: '150.00', currency: 'GTQ', merchantKey: 'mk', merchantName: 'Comercio', tppRedirectUrl: 'https://tpp/retorno' };

function fakeGateway(overrides = {}) {
  const calls = [];
  const statuses = overrides.statuses ?? ['DESKTOP_WAITING_SCAN', 'WAITING_USER_REVIEW', 'CONTEXT_ENRICHING', 'COMPLETED_PLACEHOLDER'];
  let statusIndex = 0;
  const routes = [
    ['POST /api/bff/v1/auth/handoff', () => ({ handoffToken: 'a'.repeat(64) })],
    ['POST /api/bff/v1/auth/init', () => ({ token: 'desktop-obst' })],
    ['POST /api/bff/v1/pis-journey/start?deviceType=DESKTOP', () => ({ journeyId: JOURNEY_ID, status: 'DESKTOP_WAITING_SCAN' })],
    ['GET /api/bff/v1/pis-journey/transfer', () => ({ qrImage: 'iVBORw0', qrContentType: 'image/png', redirectUrl: `https://front/m?j=${JOURNEY_ID}&t=transfer%2Dtoken&c=x` })],
    ['POST /api/bff/v1/auth/resume', (body) => ({ obst: body.resumeToken === 'transfer-token' ? 'mobile-obst' : 'auth-obst', journeyId: JOURNEY_ID })],
    ['POST /api/bff/v1/pis-journey/start?deviceType=MOBILE', () => ({ journeyId: JOURNEY_ID, status: 'WAITING_USER_REVIEW' })],
    [`GET /api/bff/v1/pis-journey/${JOURNEY_ID}/status`, () => ({ journeyId: JOURNEY_ID, status: statuses[Math.min(statusIndex++, statuses.length - 1)] })],
    [`GET /api/bff/v1/pis-journey/${JOURNEY_ID}/resume`, () => ({ transactionSummary: { amount: 150, merchantName: 'Comercio' }, contextStatus: 'ENRICHED', dpiPrefilled: DPI })],
    [`POST /api/bff/v1/pis-journey/${JOURNEY_ID}/auth/verify`, () => ({ authenticated: overrides.authenticated ?? true })],
    [`POST /api/bff/v1/pis-journey/${JOURNEY_ID}/auth`, () => ({ facephiUrl: 'https://biometrics/op', resumeToken: 'auth-resume' })],
    [`GET /api/bff/v1/pis-journey/${JOURNEY_ID}/payments`, () => ({ accounts: [{ accountId: '3010123456', productName: 'Ahorro', productType: 'SAVINGS', maskedNumber: '******3456', availableBalance: 900, currency: 'GTQ', hasSufficientBalance: true }] })],
    [`POST /api/bff/v1/pis-journey/${JOURNEY_ID}/payments/accept`, () => ({ transactionReference: 'TRX-1', sequenceReference: 77 })],
    [`POST /api/bff/v1/pis-journey/${JOURNEY_ID}/payments/reject`, () => ({ journeyId: JOURNEY_ID, status: 'PAYMENT_REJECTED' })],
  ];
  return {
    calls,
    async call(request) {
      calls.push(request);
      const key = `${request.method} ${request.path}`;
      const failure = overrides.fail?.[key];
      if (failure) return { status: failure, body: { code: 'ERR', dpi: DPI }, ms: 5 };
      const route = routes.find(([prefix]) => key.startsWith(prefix));
      return { status: 200, body: route ? route[1](request.body ?? {}) : {}, ms: 5 };
    },
  };
}

function buildSimulation(gateway, extra = {}) {
  return createSimulation({
    gateway,
    masker: createMasker({ secrets: [DPI, 'secret'] }),
    secrets: SECRETS,
    dpi: DPI,
    operationId: 'op-fixed',
    transaction: TRANSACTION,
    clock: () => new Date('2026-11-25T15:30:00.123Z'),
    wait: async () => {},
    pollTimeoutMs: 1000,
    ...extra,
  });
}

test('startRunsHandoffInitStartStatusAndTransfer', async () => {
  const gateway = fakeGateway();
  const sim = buildSimulation(gateway);

  const view = await sim.start();

  assert.equal(view.phase, 'waiting-scan');
  assert.equal(view.journeyId, JOURNEY_ID);
  assert.equal(view.desktopQr, 'data:image/png;base64,iVBORw0');
  assert.deepEqual(view.steps.map((s) => s.status), [200, 200, 200, 200, 200]);
  assert.equal(gateway.calls[0].body.signature.length, 64);
  assert.equal(gateway.calls[0].body.date, '2026-11-25T15:30:00Z');
  assert.equal(gateway.calls[2].token, 'desktop-obst');
  assert.equal(gateway.calls[2].body.documentJwe.split('.').length, 5);
  assert.ok(gateway.calls.every((c) => c.correlationId === view.correlationId));
  assert.equal(view.steps[4].response.qrImage, '[imagen QR]');
});

test('fullFlowReachesCompletedAndMasksSensitiveData', async () => {
  const gateway = fakeGateway();
  const sim = buildSimulation(gateway);
  const { id } = await sim.start();

  const scanned = await sim.scan(id);
  assert.equal(scanned.phase, 'ready-auth');
  assert.equal(scanned.summary.contextStatus, 'ENRICHED');

  const auth = await sim.authenticate(id);
  assert.equal(auth.phase, 'waiting-biometrics');
  assert.equal(auth.facephiUrl, 'https://biometrics/op');
  const authCall = gateway.calls.find((c) => c.path.endsWith('/auth'));
  assert.equal(authCall.headers['X-Customer-Id'], DPI);
  assert.equal(authCall.token, 'mobile-obst');

  const decision = await sim.confirmBiometrics(id);
  assert.equal(decision.phase, 'payment-decision');
  assert.equal(decision.accounts[0].maskedNumber, '******3456');
  const verifyCall = gateway.calls.find((c) => c.path.endsWith('/auth/verify'));
  assert.equal(verifyCall.body.verificationToken, 'op-fixed');
  assert.equal(verifyCall.token, 'auth-obst');

  const done = await sim.accept(id, 0);
  assert.equal(done.phase, 'completed');
  assert.equal(gateway.calls.find((c) => c.path.endsWith('/payments/accept')).body.debitAccountId, '3010123456');
  assert.ok(!JSON.stringify(done.steps).includes(DPI));
});

test('rejectEndsInRejectedPhase', async () => {
  const sim = buildSimulation(fakeGateway());
  const { id } = await sim.start();
  await sim.scan(id);
  await sim.authenticate(id);
  await sim.confirmBiometrics(id);

  const view = await sim.reject(id);

  assert.equal(view.phase, 'rejected');
  assert.equal(view.payment.status, 'PAYMENT_REJECTED');
});

test('scanStopsWhenClientIsNotEligible', async () => {
  const sim = buildSimulation(fakeGateway({ statuses: ['DESKTOP_WAITING_SCAN', 'WAITING_USER_REVIEW', 'CLIENT_NOT_ELIGIBLE'] }));
  const { id } = await sim.start();

  const view = await sim.scan(id);

  assert.equal(view.phase, 'not-eligible');
  assert.equal(view.state, 'CLIENT_NOT_ELIGIBLE');
});

test('scanFailsWhenPsuNeverAnswers', async () => {
  let fakeNow = 0;
  const sim = buildSimulation(fakeGateway({ statuses: ['DESKTOP_WAITING_SCAN', 'WAITING_USER_REVIEW'] }), {
    clock: () => new Date(1764084600000 + (fakeNow += 400)),
  });
  const { id } = await sim.start();

  const view = await sim.scan(id);

  assert.equal(view.phase, 'failed');
  assert.match(view.error.body, /PSU no respondió/);
});

test('pollingErrorFailsTheScan', async () => {
  const gateway = fakeGateway();
  const sim = buildSimulation(gateway);
  const { id } = await sim.start();
  const original = gateway.call;
  gateway.call = async (request) => (request.path.endsWith('/status') ? { status: 503, body: { code: 'DOWN' }, ms: 1 } : original(request));

  const view = await sim.scan(id);

  assert.equal(view.phase, 'failed');
  assert.equal(view.error.status, 503);
});

test('gatewayErrorStopsFlowWithMaskedError', async () => {
  const sim = buildSimulation(fakeGateway({ fail: { 'POST /api/bff/v1/auth/handoff': 403 } }));

  const view = await sim.start();

  assert.equal(view.phase, 'failed');
  assert.equal(view.error.status, 403);
  assert.equal(view.error.body.dpi, '25*********01');
});

test('unexpectedErrorIsReportedAsServerFailure', async () => {
  const sim = buildSimulation({ call: async () => { throw new Error(`timeout ${DPI}`); } });

  const view = await sim.start();

  assert.equal(view.phase, 'failed');
  assert.equal(view.error.body, 'timeout 25*********01');
});

test('verifyNotAuthenticatedFailsTheFlow', async () => {
  const sim = buildSimulation(fakeGateway({ authenticated: false }));
  const { id } = await sim.start();
  await sim.scan(id);
  await sim.authenticate(id);

  const view = await sim.confirmBiometrics(id);

  assert.equal(view.phase, 'failed');
});

test('actionsOutOfPhaseOrUnknownSessionAreRejected', async () => {
  const sim = buildSimulation(fakeGateway());
  const { id } = await sim.start();

  await assert.rejects(() => sim.authenticate(id), (e) => e instanceof SimulationError && e.httpStatus === 409);
  assert.throws(() => sim.get('nope'), (e) => e.httpStatus === 404);
  await assert.rejects(() => sim.scan('nope'), (e) => e.httpStatus === 404);
  assert.equal(sim.get(id).phase, 'waiting-scan');
});

test('acceptWithUnknownAccountIsRejected', async () => {
  const sim = buildSimulation(fakeGateway());
  const { id } = await sim.start();
  await sim.scan(id);
  await sim.authenticate(id);
  await sim.confirmBiometrics(id);

  await assert.rejects(() => sim.accept(id, 9), (e) => e.httpStatus === 400);
});

test('concurrentActionIsRejectedWhileBusy', async () => {
  const gateway = fakeGateway();
  const sim = buildSimulation(gateway);
  const { id } = await sim.start();
  let release;
  const original = gateway.call;
  gateway.call = (request) => new Promise((resolve) => { release = () => resolve(original(request)); });

  const running = sim.scan(id);
  await assert.rejects(() => sim.scan(id), (e) => e.httpStatus === 409);
  gateway.call = original;
  release();
  await running;
});

test('retryAfterPsuTimeoutOnlyPollsAgain', async () => {
  let fakeNow = 0;
  const gateway = fakeGateway({ statuses: ['DESKTOP_WAITING_SCAN', 'WAITING_USER_REVIEW'] });
  const sim = buildSimulation(gateway, { clock: () => new Date(1764084600000 + (fakeNow += 400)) });
  const { id } = await sim.start();
  const failed = await sim.scan(id);
  assert.equal(failed.phase, 'failed');

  const restored = sim.retry(id);
  assert.equal(restored.phase, 'waiting-scan');
  assert.equal(restored.error, null);
  const callsBefore = gateway.calls.length;
  await sim.scan(id);

  const retried = gateway.calls.slice(callsBefore);
  assert.ok(retried.every((c) => c.path.endsWith('/status')));
});

test('retryAfterVerifyFailureSkipsTheConsumedResumeToken', async () => {
  const gateway = fakeGateway({ fail: { [`POST /api/bff/v1/pis-journey/${JOURNEY_ID}/auth/verify`]: 401 } });
  const sim = buildSimulation(gateway);
  const { id } = await sim.start();
  await sim.scan(id);
  await sim.authenticate(id);
  assert.equal((await sim.confirmBiometrics(id)).phase, 'failed');

  sim.retry(id);
  const callsBefore = gateway.calls.length;
  await sim.confirmBiometrics(id);

  assert.ok(!gateway.calls.slice(callsBefore).some((c) => c.path.endsWith('/auth/resume')));
});

test('retryRejectsFailedStartAndNonFailedSessions', async () => {
  const sim = buildSimulation(fakeGateway({ fail: { 'POST /api/bff/v1/auth/handoff': 403 } }));
  const { id } = await sim.start();

  assert.throws(() => sim.retry(id), (e) => e.httpStatus === 409 && /journey nuevo/.test(e.message));
  const ok = buildSimulation(fakeGateway());
  const started = await ok.start();
  assert.throws(() => ok.retry(started.id), (e) => e.httpStatus === 409);
});

test('transferWithoutImageOrTokenKeepsNulls', async () => {
  const gateway = fakeGateway();
  const original = gateway.call;
  gateway.call = async (request) => (request.path.includes('/transfer') ? { status: 200, body: { qrImage: 'data:image/png;base64,AAA', redirectUrl: 'https://front/m' }, ms: 1 } : original(request));
  const sim = buildSimulation(gateway);

  const view = await sim.start();

  assert.equal(view.desktopQr, 'data:image/png;base64,AAA');
  gateway.call = async (request) => (request.path.includes('/transfer') ? { status: 200, body: null, ms: 1 } : original(request));
  const second = await buildSimulation(gateway).start();
  assert.equal(second.desktopQr, null);
});
