import { randomUUID } from 'node:crypto';

const REQUEST_TIMEOUT_MS = 30000;

async function readBody(response) {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function createGatewayClient({ baseUrl, apiKey, origin, merchantKey, externalCustomerId, fetchImpl = fetch, now = () => performance.now() }) {
  async function call({ method, path, correlationId, token, body, headers = {} }) {
    const requestHeaders = {
      'Content-Type': 'application/json',
      Origin: origin,
      'x-api-key': apiKey,
      'X-Correlation-Id': correlationId,
      'X-Request-Id': randomUUID(),
      'X-Merchant-Id': merchantKey,
      'X-ExternalCustomer-Id': externalCustomerId,
      ...headers,
    };
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    const started = now();
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const responseBody = await readBody(response);
    return { status: response.status, body: responseBody, ms: Math.round(now() - started) };
  }

  return { call };
}
