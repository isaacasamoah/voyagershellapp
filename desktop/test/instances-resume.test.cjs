const { test } = require('node:test');
const assert = require('node:assert/strict');
const { instanceResumer, instanceOpener } = require('../src/instances.cjs');
const receipt = (request, action = 'resume-instance', changes = {}) => ({
  request_id: request,
  session_id: 'saved',
  action,
  state: 'completed',
  runtime_generation: 2,
  ...changes,
});

test('lost replies and concurrent clicks share one Resume and one viewer Open', async () => {
  const calls = [];
  let lists = 0;
  const resume = instanceResumer(async (...args) => {
    calls.push(args);
    if (args[0] === 'list')
      return [
        {
          id: 'saved',
          resume: { state: 'eligible' },
          lifecycle: {
            runtime: ++lists === 1 ? 'stopped' : 'running',
            runtime_generation: lists === 1 ? 1 : 2,
          },
        },
      ];
    if (args[0] === 'resume-instance' || args[0] === 'open') throw Error('Lost reply');
    return receipt(args[1], args[1] === 'chosen-once' ? 'resume-instance' : 'open');
  });
  const input = { id: 'saved', generation: 1, terminal: 'xterm', request: 'chosen-once' };
  const results = await Promise.all([resume(input), resume(input)]);
  assert.ok(results.every((result) => result.opened));
  assert.equal(calls.filter((c) => c[0] === 'resume-instance').length, 1);
  assert.deepEqual(
    calls.find((c) => c[0] === 'operation'),
    ['operation', 'chosen-once'],
  );
  assert.equal(calls.filter((c) => c[0] === 'open').length, 1);
});

test('a completed Resume cannot Open a stopped or different current runtime', async () => {
  for (const observed of [
    { runtime: 'stopped', runtime_generation: 2 },
    { runtime: 'running', runtime_generation: 3 },
  ]) {
    let lists = 0,
      opens = 0;
    const resume = instanceResumer(async (op) => {
      if (op === 'list')
        return [
          {
            id: 'saved',
            resume: { state: 'eligible' },
            lifecycle: ++lists === 1 ? { runtime: 'stopped', runtime_generation: 1 } : observed,
          },
        ];
      if (op === 'open') opens++;
      return receipt('stale');
    });
    await assert.rejects(
      resume({ id: 'saved', generation: 1, terminal: 'xterm', request: 'stale' }),
      /current runtime/,
    );
    assert.equal(opens, 0);
  }
});

test('a known failed viewer leaves Resume complete and permits a separate Open', async () => {
  const calls = [];
  const resume = instanceResumer(async (...args) => {
    calls.push(args);
    if (args[0] === 'list')
      return [
        {
          id: 'saved',
          resume: { state: 'eligible' },
          lifecycle: { runtime: 'running', runtime_generation: 2 },
        },
      ];
    if (args[0] === 'open') throw Error('Viewer missing');
    if (args[0] === 'operation')
      return receipt(args[1], 'open', { state: 'partial', runtime: 'running' });
    return receipt('open-fails');
  });
  const result = await resume({
    id: 'saved',
    generation: 1,
    terminal: 'ghostty',
    request: 'open-fails',
  });
  assert.match(result.error, /Conversation resumed.*terminal/);
  assert.equal(result.runtime_generation, 2);
  assert.equal(result.open_request_id, null);
  assert.equal(calls.filter((c) => c[0] === 'resume-instance').length, 1);
});

test('an unconfirmed Resume is inspected again without another submitted identifier', async () => {
  const calls = [];
  const resume = instanceResumer(async (...args) => {
    calls.push(args);
    if (args[0] === 'list') return [{ id: 'saved', resume: { state: 'eligible' } }];
    throw Error('Service unavailable');
  });
  const input = { id: 'saved', generation: 1, terminal: 'xterm', request: 'original' };
  await assert.rejects(resume(input), /No retry was sent/);
  await assert.rejects(resume({ ...input, request: 'another' }), /No retry was sent/);
  assert.equal(calls.filter((c) => c[0] === 'resume-instance').length, 1);
  assert.deepEqual(
    calls.filter((c) => c[0] === 'operation').map((c) => c[1]),
    ['original', 'original'],
  );
});

test('a saved Resume result must belong to this request, action and agent', async () => {
  for (const changes of [{ session_id: 'other' }, { request_id: 'other' }, { action: 'open' }]) {
    let opens = 0;
    const resume = instanceResumer(async (op) => {
      if (op === 'list') return [{ id: 'saved', resume: { state: 'eligible' } }];
      if (op === 'resume-instance') throw Error('request_conflict: existing action');
      if (op === 'open') opens++;
      return receipt('occupied', 'resume-instance', changes);
    });
    await assert.rejects(
      resume({ id: 'saved', generation: 1, terminal: 'xterm', request: 'occupied' }),
      /result does not belong/,
    );
    assert.equal(opens, 0);
  }
});

test('a mismatched Open result remains unconfirmed under its original identifier', async () => {
  const resume = instanceResumer(async (op, ...args) => {
    if (op === 'list')
      return [
        {
          id: 'saved',
          resume: { state: 'eligible' },
          lifecycle: { runtime: 'running', runtime_generation: 2 },
        },
      ];
    if (op === 'resume-instance') return receipt('resume');
    if (op === 'open') throw Error('Lost Open reply');
    return receipt(args[0], 'open', { session_id: 'other' });
  });
  const result = await resume({ id: 'saved', generation: 1, terminal: 'xterm', request: 'resume' });
  assert.equal(result.opened, undefined);
  assert.ok(result.open_request_id);
  assert.match(result.error, /terminal result is unconfirmed/);
});

test('completed Open remains successful when arranging its window fails', async () => {
  const open = instanceOpener(
    async () => receipt('open', 'open'),
    async () => {},
    async () => {
      throw Error('Window size adjusted');
    },
  );
  const result = await open('saved', 'xterm', 'open');
  assert.equal(result.state, 'completed');
  assert.equal(result.error, undefined);
  assert.match(result.warning, /Terminal opened.*could not be arranged/);
});
