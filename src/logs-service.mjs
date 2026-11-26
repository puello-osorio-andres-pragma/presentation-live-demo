const MAX_EVENTS = 300;
const PAGE_LIMIT = 200;
const MAX_PAGES = 5;
const NOISE_EXCLUSION = '-"actuator" -"ELB-HealthChecker"';
const QUERY_POLL_MS = 1000;
const QUERY_MAX_POLLS = 60;
const FINISHED_QUERY = new Set(['Complete', 'Failed', 'Cancelled', 'Timeout']);
const NOISE = [/\/actuator\/health/, /ELB-HealthChecker/, /^(START|END|REPORT|INIT_START|INIT_REPORT) /];
const LEVEL_IN_TEXT = /\b(ERROR|WARN|INFO|DEBUG|TRACE)\b/;
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

export class LogsError extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.name = 'LogsError';
    this.httpStatus = httpStatus;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseJson(message) {
  if (!message.trimStart().startsWith('{')) return null;
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
}

function describe(message) {
  const json = parseJson(message);
  if (!json) {
    return { level: LEVEL_IN_TEXT.exec(message)?.[1] ?? 'INFO', text: message.trim(), code: null, correlationId: null };
  }
  return {
    level: String(json.level ?? json.logLevel ?? 'INFO').toUpperCase(),
    text: String(json.message ?? json.msg ?? message),
    code: json.code ?? json.operation ?? null,
    correlationId: json.correlationId ?? json.metadata?.correlationId ?? null,
  };
}

export function createLogsService({ client, commands, masker, groups, queries, wait = sleep }) {
  const groupByKey = new Map(groups.map((g) => [g.key, g]));

  function resolveGroups(keys) {
    const selected = (keys?.length ? keys : groups.map((g) => g.key)).map((k) => groupByKey.get(k)).filter(Boolean);
    if (selected.length === 0) throw new LogsError('Ningún log group válido', 400);
    return selected;
  }

  function filterPatternFor({ correlationId, text, hideNoise }) {
    if (correlationId && !SAFE_ID.test(correlationId)) throw new LogsError('correlationId inválido', 400);
    const term = correlationId ?? (text ?? '').replace(/["\\]/g, '').trim();
    const parts = [term ? `"${term}"` : null, hideNoise ? NOISE_EXCLUSION : null].filter(Boolean);
    return parts.length ? parts.join(' ') : undefined;
  }

  async function readGroup(group, sinceMs, filterPattern) {
    try {
      const events = [];
      let nextToken;
      for (let page = 0; page < MAX_PAGES && events.length < PAGE_LIMIT; page++) {
        const out = await client.send(new commands.FilterLogEventsCommand({ logGroupName: group.name, startTime: sinceMs, filterPattern, limit: PAGE_LIMIT, nextToken }));
        events.push(...(out.events ?? []));
        nextToken = out.nextToken;
        if (!nextToken) break;
      }
      return { events: events.map((e) => ({ ...e, group })), error: null };
    } catch (error) {
      return { events: [], error: { group: group.label, message: masker.text(error.name ?? error.message) } };
    }
  }

  async function tail({ groupKeys, sinceMs, correlationId, text, hideNoise = true }) {
    const filterPattern = filterPatternFor({ correlationId, text, hideNoise });
    const results = await Promise.all(resolveGroups(groupKeys).map((g) => readGroup(g, sinceMs, filterPattern)));
    const events = results
      .flatMap((r) => r.events)
      .filter((e) => !hideNoise || !NOISE.some((pattern) => pattern.test(e.message ?? '')))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-MAX_EVENTS)
      .map((e) => {
        const info = describe(e.message ?? '');
        return {
          id: e.eventId,
          timestamp: e.timestamp,
          group: e.group.key,
          service: e.group.label,
          level: info.level,
          code: info.code,
          correlationId: info.correlationId,
          text: masker.text(info.text),
          raw: masker.text(e.message ?? ''),
        };
      });
    const newest = events.reduce((max, e) => Math.max(max, e.timestamp), sinceMs - 1);
    return { events, nextSince: newest + 1, errors: results.map((r) => r.error).filter(Boolean) };
  }

  function buildQuery(key, correlationId) {
    const definition = queries.find((q) => q.key === key);
    if (!definition) throw new LogsError('Consulta desconocida', 400);
    const needsCorrelation = definition.query.includes('{{correlationId}}');
    if (needsCorrelation && !(correlationId && SAFE_ID.test(correlationId))) {
      throw new LogsError('Esta consulta necesita un correlationId válido', 400);
    }
    return { definition, queryString: definition.query.replaceAll('{{correlationId}}', correlationId ?? '') };
  }

  async function insights({ key, correlationId, minutes = 60, endMs = Date.now() }) {
    const { definition, queryString } = buildQuery(key, correlationId);
    const logGroupNames = resolveGroups(definition.groups).map((g) => g.name);
    const started = await client.send(new commands.StartQueryCommand({
      logGroupNames,
      startTime: Math.floor((endMs - minutes * 60000) / 1000),
      endTime: Math.floor(endMs / 1000),
      queryString,
      limit: MAX_EVENTS,
    }));
    for (let poll = 0; poll < QUERY_MAX_POLLS; poll++) {
      const out = await client.send(new commands.GetQueryResultsCommand({ queryId: started.queryId }));
      if (FINISHED_QUERY.has(out.status)) {
        const rows = (out.results ?? []).map((row) => Object.fromEntries(
          row.filter((f) => f.field !== '@ptr').map((f) => [f.field, masker.text(f.value)]),
        ));
        const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        return { status: out.status, queryString, columns, rows, statistics: out.statistics ?? null };
      }
      await wait(QUERY_POLL_MS);
    }
    throw new LogsError('La consulta de Logs Insights no terminó en 60 s', 504);
  }

  return { tail, insights, groups: groups.map(({ key, label }) => ({ key, label })), queries: queries.map(({ key, label, description, query }) => ({ key, label, description, query })) };
}
