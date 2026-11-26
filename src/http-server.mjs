import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

const MAX_BODY_BYTES = 64 * 1024;
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Cuerpo demasiado grande'), { httpStatus: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON inválido'), { httpStatus: 400 });
  }
}

const listParam = (value) => (value ? value.split(',').map((v) => v.trim()).filter(Boolean) : undefined);

export function createRequestHandler({ simulation, logs, health, publicDir }) {
  const routes = [
    ['GET', /^\/api\/health$/, async () => health()],
    ['GET', /^\/api\/logs\/meta$/, async () => ({ groups: logs.groups, queries: logs.queries })],
    ['GET', /^\/api\/logs\/tail$/, async ({ url }) => logs.tail({
      groupKeys: listParam(url.searchParams.get('groups')),
      sinceMs: Number(url.searchParams.get('since')) || Date.now() - 5 * 60000,
      correlationId: url.searchParams.get('correlationId') || undefined,
      text: url.searchParams.get('text') || undefined,
      hideNoise: url.searchParams.get('noise') !== '1',
    })],
    ['POST', /^\/api\/logs\/insights$/, async ({ body }) => logs.insights({ key: body.key, correlationId: body.correlationId, minutes: Number(body.minutes) || 60 })],
    ['POST', /^\/api\/sim$/, async () => simulation.start()],
    ['GET', /^\/api\/sim\/([\w-]+)$/, async ({ match }) => simulation.get(match[1])],
    ['POST', /^\/api\/sim\/([\w-]+)\/scan$/, async ({ match }) => simulation.scan(match[1])],
    ['POST', /^\/api\/sim\/([\w-]+)\/auth$/, async ({ match }) => simulation.authenticate(match[1])],
    ['POST', /^\/api\/sim\/([\w-]+)\/biometrics$/, async ({ match }) => simulation.confirmBiometrics(match[1])],
    ['POST', /^\/api\/sim\/([\w-]+)\/accept$/, async ({ match, body }) => simulation.accept(match[1], Number(body.accountIndex))],
    ['POST', /^\/api\/sim\/([\w-]+)\/reject$/, async ({ match }) => simulation.reject(match[1])],
    ['POST', /^\/api\/sim\/([\w-]+)\/retry$/, async ({ match }) => simulation.retry(match[1])],
  ];

  async function serveStatic(res, pathname) {
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const extension = relative.slice(relative.lastIndexOf('.'));
    const target = normalize(join(publicDir, relative));
    if (!target.startsWith(normalize(publicDir)) || !CONTENT_TYPES[extension]) {
      sendJson(res, 404, { message: 'No encontrado' });
      return;
    }
    try {
      const content = await readFile(target);
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extension], 'Cache-Control': 'no-store' });
      res.end(content);
    } catch {
      sendJson(res, 404, { message: 'No encontrado' });
    }
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      for (const [method, pattern, action] of routes) {
        const match = pattern.exec(url.pathname);
        if (match && req.method === method) {
          const body = method === 'POST' ? await readJson(req) : {};
          sendJson(res, 200, await action({ url, match, body }));
          return;
        }
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        await serveStatic(res, url.pathname);
        return;
      }
      sendJson(res, 404, { message: 'Ruta no encontrada' });
    } catch (error) {
      const status = error.httpStatus ?? 500;
      sendJson(res, status, { message: status === 500 ? 'Error interno del servidor de la presentación' : error.message });
    }
  };
}
