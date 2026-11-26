import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogsService, LogsError } from '../src/logs-service.mjs';
import { createMasker } from '../src/masker.mjs';

const GROUPS = [
  { key: 'journey', label: 'PIS Journey', name: '/aws/ecs/journey' },
  { key: 'token-issuer', label: 'Token Issuer', name: '/aws/lambda/token' },
];
const QUERIES = [
  { key: 'trace', label: 'Traza', description: 'd', groups: ['journey'], query: 'filter correlationId = "{{correlationId}}"' },
  { key: 'errors', label: 'Errores', description: 'd', groups: ['journey', 'token-issuer'], query: 'stats count(*)' },
];

class FakeCommand {
  constructor(input) {
    this.input = input;
    this.type = this.constructor.name;
  }
}
class FilterLogEventsCommand extends FakeCommand {}
class StartQueryCommand extends FakeCommand {}
class GetQueryResultsCommand extends FakeCommand {}
const commands = { FilterLogEventsCommand, StartQueryCommand, GetQueryResultsCommand };

function service(handler) {
  const sent = [];
  const client = { send: async (command) => { sent.push(command); return handler(command); } };
  const logs = createLogsService({ client, commands, masker: createMasker({ secrets: [] }), groups: GROUPS, queries: QUERIES, wait: async () => {} });
  return { logs, sent };
}

test('tailMergesGroupsParsesJsonAndMasks', async () => {
  const { logs, sent } = service((command) => {
    if (command.input.logGroupName === '/aws/ecs/journey') {
      return { events: [
        { eventId: '2', timestamp: 2000, message: '{"level":"WARN","message":"dpi 2547896510101","correlationId":"c-1"}' },
        { eventId: '3', timestamp: 2500, message: '{"level":"DEBUG","message":"inbound request path=/actuator/health"}' },
      ] };
    }
    return { events: [
      { eventId: '1', timestamp: 1000, message: '{"level":"INFO","message":"Token issued","code":"OBST-OK-ISSUED","metadata":{"correlationId":"c-1"}}' },
      { eventId: '4', timestamp: 3000, message: 'REPORT RequestId: x Duration: 3 ms' },
      { eventId: '5', timestamp: 3500, message: '2026-11-25 ERROR plain text line' },
      { eventId: '6', timestamp: 3600, message: '{not json' },
    ] };
  });

  const out = await logs.tail({ sinceMs: 900 });

  assert.deepEqual(out.events.map((e) => e.id), ['1', '2', '5', '6']);
  assert.equal(out.events[0].code, 'OBST-OK-ISSUED');
  assert.equal(out.events[0].correlationId, 'c-1');
  assert.equal(out.events[1].text, 'dpi 25*********01');
  assert.equal(out.events[2].level, 'ERROR');
  assert.equal(out.events[3].level, 'INFO');
  assert.equal(out.nextSince, 3601);
  assert.equal(sent[0].input.filterPattern, '-"actuator" -"ELB-HealthChecker"');
});

test('tailUsesCorrelationOrTextAsFilterPattern', async () => {
  const { logs, sent } = service(() => ({}));

  const out = await logs.tail({ groupKeys: ['journey'], sinceMs: 10, correlationId: 'abc-123' });
  await logs.tail({ groupKeys: ['journey'], sinceMs: 10, text: 'acc"ept', hideNoise: false });
  await logs.tail({ groupKeys: ['journey'], sinceMs: 10, hideNoise: false });

  assert.equal(sent[0].input.filterPattern, '"abc-123" -"actuator" -"ELB-HealthChecker"');
  assert.equal(sent[1].input.filterPattern, '"accept"');
  assert.equal(sent[2].input.filterPattern, undefined);
  assert.equal(out.nextSince, 10);
});

test('tailFollowsNextTokenUpToPageLimit', async () => {
  let page = 0;
  const { logs, sent } = service(() => {
    page += 1;
    if (page === 1) return { events: [], nextToken: 't1' };
    if (page === 2) return { events: [{ eventId: 'a', timestamp: 50, message: 'x' }], nextToken: 't2' };
    return { events: [{ eventId: 'b', timestamp: 60, message: 'y' }] };
  });

  const out = await logs.tail({ groupKeys: ['journey'], sinceMs: 1 });

  assert.deepEqual(out.events.map((e) => e.id), ['a', 'b']);
  assert.deepEqual(sent.map((c) => c.input.nextToken), [undefined, 't1', 't2']);
});

test('tailKeepsNoiseWhenAskedAndReportsGroupErrors', async () => {
  const { logs } = service((command) => {
    if (command.input.logGroupName === '/aws/lambda/token') {
      const error = new Error('denied');
      error.name = 'AccessDeniedException';
      throw error;
    }
    return { events: [{ eventId: '9', timestamp: 5, message: 'GET /actuator/health' }] };
  });

  const out = await logs.tail({ sinceMs: 1, hideNoise: false });

  assert.equal(out.events.length, 1);
  assert.deepEqual(out.errors, [{ group: 'Token Issuer', message: 'AccessDeniedException' }]);
});

test('tailRejectsInvalidInput', async () => {
  const { logs } = service(() => ({}));

  await assert.rejects(() => logs.tail({ groupKeys: ['nope'], sinceMs: 1 }), LogsError);
  await assert.rejects(() => logs.tail({ sinceMs: 1, correlationId: 'bad id"' }), (e) => e.httpStatus === 400);
});

test('insightsRunsQueryUntilCompleteAndMasksRows', async () => {
  let polls = 0;
  const { logs, sent } = service((command) => {
    if (command.type === 'StartQueryCommand') return { queryId: 'q-1' };
    polls += 1;
    if (polls < 2) return { status: 'Running' };
    return { status: 'Complete', results: [[{ field: '@ptr', value: 'x' }, { field: 'message', value: 'cuenta 3010123456' }]], statistics: { recordsScanned: 10 } };
  });

  const out = await logs.insights({ key: 'trace', correlationId: 'c-9', minutes: 30, endMs: 1764084600000 });

  assert.equal(out.status, 'Complete');
  assert.deepEqual(out.columns, ['message']);
  assert.deepEqual(out.rows, [{ message: 'cuenta ******3456' }]);
  assert.equal(sent[0].input.queryString, 'filter correlationId = "c-9"');
  assert.equal(sent[0].input.endTime - sent[0].input.startTime, 1800);
  assert.deepEqual(sent[0].input.logGroupNames, ['/aws/ecs/journey']);
});

test('insightsWithoutCorrelationPlaceholderNeedsNoId', async () => {
  const { logs } = service((command) => (command.type === 'StartQueryCommand' ? { queryId: 'q' } : { status: 'Failed' }));

  const out = await logs.insights({ key: 'errors' });

  assert.equal(out.status, 'Failed');
  assert.deepEqual(out.rows, []);
  assert.equal(out.statistics, null);
});

test('insightsValidatesKeyCorrelationAndTimeout', async () => {
  const { logs } = service((command) => (command.type === 'StartQueryCommand' ? { queryId: 'q' } : { status: 'Running' }));

  await assert.rejects(() => logs.insights({ key: 'nope' }), (e) => e.httpStatus === 400);
  await assert.rejects(() => logs.insights({ key: 'trace' }), (e) => e.httpStatus === 400);
  await assert.rejects(() => logs.insights({ key: 'errors' }), (e) => e.httpStatus === 504);
});

test('serviceExposesGroupsAndQueriesWithoutInternals', () => {
  const { logs } = service(() => ({}));

  assert.deepEqual(logs.groups, [{ key: 'journey', label: 'PIS Journey' }, { key: 'token-issuer', label: 'Token Issuer' }]);
  assert.equal(logs.queries[0].groups, undefined);
});
