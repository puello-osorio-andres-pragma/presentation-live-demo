import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestHandler } from '../src/http-server.mjs';

const calls = [];
let server;
let baseUrl;

const record = (name, result) => async (...args) => { calls.push([name, ...args]); return result; };

before(async () => {
  const publicDir = await mkdtemp(join(tmpdir(), 'presentacion-'));
  await writeFile(join(publicDir, 'index.html'), '<title>Deck</title>');
  const handler = createRequestHandler({
    publicDir,
    health: async () => ({ ok: true }),
    logs: {
      groups: [{ key: 'journey', label: 'PIS Journey' }],
      queries: [{ key: 'trace' }],
      tail: record('tail', { events: [] }),
      insights: async (input) => {
        if (input.key === 'bad') throw Object.assign(new Error('Consulta desconocida'), { httpStatus: 400 });
        if (input.key === 'boom') throw new Error('secret detail');
        calls.push(['insights', input]);
        return { rows: [] };
      },
    },
    simulation: {
      start: record('start', { id: 's1' }),
      get: record('get', { id: 's1' }),
      scan: record('scan', { phase: 'ready-auth' }),
      authenticate: record('auth', { phase: 'waiting-biometrics' }),
      confirmBiometrics: record('biometrics', { phase: 'payment-decision' }),
      accept: record('accept', { phase: 'completed' }),
      reject: record('reject', { phase: 'rejected' }),
      retry: record('retry', { phase: 'waiting-scan' }),
    },
  });
  server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

test('servesIndexAndRejectsUnknownStatic', async () => {
  const index = await fetch(`${baseUrl}/`);
  assert.equal(index.status, 200);
  assert.equal(await index.text(), '<title>Deck</title>');
  assert.equal((await fetch(`${baseUrl}/missing.html`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/secret.env`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/nope`)).status, 404);
});

test('healthAndMetaRespondJson', async () => {
  assert.deepEqual(await (await fetch(`${baseUrl}/api/health`)).json(), { ok: true });
  const meta = await (await fetch(`${baseUrl}/api/logs/meta`)).json();
  assert.equal(meta.groups[0].key, 'journey');
});

test('tailParsesQueryParameters', async () => {
  await fetch(`${baseUrl}/api/logs/tail?groups=journey,psu&since=123&correlationId=c-1&text=x&noise=1`);
  await fetch(`${baseUrl}/api/logs/tail`);

  const [first, second] = calls.filter((c) => c[0] === 'tail').map((c) => c[1]);
  assert.deepEqual(first, { groupKeys: ['journey', 'psu'], sinceMs: 123, correlationId: 'c-1', text: 'x', hideNoise: false });
  assert.equal(second.groupKeys, undefined);
  assert.equal(second.hideNoise, true);
  assert.ok(second.sinceMs > 0);
});

test('insightsMapsErrorsToStatusCodes', async () => {
  assert.equal((await post('/api/logs/insights', { key: 'trace', correlationId: 'c', minutes: '15' })).status, 200);
  assert.deepEqual(calls.find((c) => c[0] === 'insights')[1], { key: 'trace', correlationId: 'c', minutes: 15 });
  const bad = await post('/api/logs/insights', { key: 'bad' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).message, 'Consulta desconocida');
  const boom = await post('/api/logs/insights', { key: 'boom' });
  assert.equal(boom.status, 500);
  assert.doesNotMatch((await boom.json()).message, /secret/);
});

test('simulationRoutesDelegate', async () => {
  assert.equal((await (await post('/api/sim')).json()).id, 's1');
  assert.equal((await (await fetch(`${baseUrl}/api/sim/s1`)).json()).id, 's1');
  assert.equal((await (await post('/api/sim/s1/scan')).json()).phase, 'ready-auth');
  assert.equal((await (await post('/api/sim/s1/auth')).json()).phase, 'waiting-biometrics');
  assert.equal((await (await post('/api/sim/s1/biometrics')).json()).phase, 'payment-decision');
  assert.equal((await (await post('/api/sim/s1/accept', { accountIndex: 1 })).json()).phase, 'completed');
  assert.equal((await (await post('/api/sim/s1/reject')).json()).phase, 'rejected');
  assert.equal((await (await post('/api/sim/s1/retry')).json()).phase, 'waiting-scan');
  assert.deepEqual(calls.find((c) => c[0] === 'accept').slice(1), ['s1', 1]);
});

test('invalidJsonAndOversizedBodiesAreRejected', async () => {
  const invalid = await fetch(`${baseUrl}/api/sim/s1/accept`, { method: 'POST', body: '{nope' });
  assert.equal(invalid.status, 400);
  const huge = await fetch(`${baseUrl}/api/sim/s1/accept`, { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(70000) }) });
  assert.equal(huge.status, 413);
});
