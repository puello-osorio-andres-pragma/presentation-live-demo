import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGatewayClient } from '../src/gateway-client.mjs';
import { loadDemoSecrets } from '../src/aws-secrets.mjs';
import { isValidDpi, promptHidden } from '../src/prompt-dpi.mjs';

function fakeFetch(status, text) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return { status, text: async () => text };
  };
  return { impl, calls };
}

const clientWith = (fetchImpl) => createGatewayClient({
  baseUrl: 'https://gw/dev',
  apiKey: 'key',
  origin: 'https://front.example.com',
  merchantKey: 'mk',
  externalCustomerId: 'cust',
  fetchImpl,
  now: (() => { let t = 0; return () => (t += 10); })(),
});

test('gatewayCallSendsGovernanceHeadersTokenAndJsonBody', async () => {
  const fake = fakeFetch(200, '{"ok":true}');

  const out = await clientWith(fake.impl).call({ method: 'POST', path: '/x', correlationId: 'c-1', token: 'obst', body: { a: 1 }, headers: { 'X-Idempotency-Key': 'i-1' } });

  const { url, options } = fake.calls[0];
  assert.equal(url, 'https://gw/dev/x');
  assert.equal(options.headers.Authorization, 'Bearer obst');
  assert.equal(options.headers['X-Correlation-Id'], 'c-1');
  assert.equal(options.headers['X-Idempotency-Key'], 'i-1');
  assert.equal(options.headers['x-api-key'], 'key');
  assert.equal(options.headers.Origin, 'https://front.example.com');
  assert.match(options.headers['X-Request-Id'], /^[0-9a-f-]{36}$/);
  assert.equal(options.body, '{"a":1}');
  assert.deepEqual(out, { status: 200, body: { ok: true }, ms: 10 });
});

test('gatewayCallHandlesEmptyAndNonJsonBodies', async () => {
  const empty = await clientWith(fakeFetch(204, '').impl).call({ method: 'GET', path: '/y', correlationId: 'c' });
  const text = fakeFetch(502, 'Bad Gateway');
  const plain = await clientWith(text.impl).call({ method: 'GET', path: '/y', correlationId: 'c' });

  assert.equal(empty.body, null);
  assert.equal(plain.body, 'Bad Gateway');
  assert.equal(text.calls[0].options.headers.Authorization, undefined);
  assert.equal(text.calls[0].options.body, undefined);
});

test('loadDemoSecretsReadsSsmAndApiKey', async () => {
  const ssmInputs = [];
  const ssm = { send: async (command) => { ssmInputs.push(command.input); return { Parameter: { Value: `v:${command.input.Name}` } }; } };
  const apiGateway = { send: async (command) => ({ value: `key:${command.input.apiKey}:${command.input.includeValue}` }) };

  const secrets = await loadDemoSecrets({ ssm, apiGateway, names: { signingSecret: '/s', jwePublicKey: '/p', jweKid: '/k' }, apiKeyId: 'abc' });

  assert.deepEqual(secrets, { signingSecret: 'v:/s', jwePublicKey: 'v:/p', jweKid: 'v:/k', apiKey: 'key:abc:true' });
  assert.equal(ssmInputs.find((i) => i.Name === '/s').WithDecryption, true);
  assert.equal(ssmInputs.find((i) => i.Name === '/p').WithDecryption, false);
});

test('isValidDpiAcceptsOnlyThirteenDigits', () => {
  assert.equal(isValidDpi('2547896510101'), true);
  assert.equal(isValidDpi('254789651010'), false);
  assert.equal(isValidDpi(undefined), false);
});

function fakeTty() {
  const input = new EventEmitter();
  input.isTTY = true;
  input.modes = [];
  input.setRawMode = (mode) => input.modes.push(mode);
  input.resume = () => {};
  input.pause = () => {};
  input.setEncoding = () => {};
  const written = [];
  const output = { write: (text) => written.push(text) };
  return { input, output, written };
}

test('promptHiddenEchoesAsterisksAndSupportsBackspace', async () => {
  const { input, output, written } = fakeTty();

  const pending = promptHidden('DPI: ', { input, output });
  input.emit('data', '12x');
  input.emit('data', '\u007f');
  input.emit('data', '\b\b');
  input.emit('data', '\u007f');
  input.emit('data', '34\r');

  assert.equal(await pending, '34');
  assert.equal(written[0], 'DPI: ');
  assert.ok(!written.join('').includes('34'));
  assert.deepEqual(input.modes, [true, false]);
});

test('promptHiddenRejectsOnCtrlCAndWithoutTty', async () => {
  const { input, output } = fakeTty();
  const pending = promptHidden('DPI: ', { input, output });
  input.emit('data', '\u0003');

  await assert.rejects(pending, /Cancelado/);
  await assert.rejects(promptHidden('DPI: ', { input: { isTTY: false }, output }), /DEMO_DPI/);
});
