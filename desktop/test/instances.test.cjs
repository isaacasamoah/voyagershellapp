const { test } = require('node:test');
const assert = require('node:assert/strict');
const { instanceCreator } = require('../src/instances.cjs');
test('repair a failed native open without creating or dispatching again', async () => {
  const calls = [];
  const create = instanceCreator(async (...args) => {
    calls.push(args);
    if (args[0] === 'create') throw Error('Terminal did not open');
    if (args[0] === 'operation') return { state: 'partial', session_id: 'shell-one' };
    return { state: 'completed', session_id: 'shell-one' };
  });
  const input = { kind: 'shell', name: 'Workbench', cwd: '/project' };
  await assert.rejects(create(input), /reopen the same instance/);
  assert.deepEqual(await create(input), { session: 'shell-one' });
  assert.equal(calls.filter((c) => c[0] === 'create').length, 1);
  assert.deepEqual(calls[2].slice(0, 4), ['open', 'shell-one', 'ghostty', '--request-id']);
});
test('double clicks and unsupported choices do not create duplicate instances', async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const create = instanceCreator(async () => pending);
  const first = create({ kind: 'codex', name: 'Lead', cwd: '/project' });
  await assert.rejects(create({ kind: 'codex', name: 'Lead', cwd: '/project' }), /already/);
  finish({ state: 'completed', session_id: 'one' });
  await first;
  await assert.rejects(create({ kind: 'unknown', name: 'No', cwd: '/project' }), /type/);
  await assert.rejects(create({ kind: 'shell', name: 'No', cwd: 'relative' }), /absolute/);
});
test('a lost reply keeps its request identity and never starts an untracked replacement', async () => {
  const ids = [];
  let calls = 0;
  const create = instanceCreator(async (op, ...args) => {
    if (op === 'operation') throw Error('Service unavailable');
    ids.push(args[1]);
    if (calls++ === 0) throw Error('Lost reply');
    return { state: 'completed', session_id: 'same-instance' };
  });
  const input = { kind: 'codex', name: 'Lead', cwd: '/project' };
  await assert.rejects(create(input), /Lost reply/);
  assert.deepEqual(await create(input), { session: 'same-instance' });
  assert.equal(ids[0], ids[1]);
});
test('Codex always defaults to Crew while Bash has no rank', async () => {
  const calls = [];
  const create = instanceCreator(async (...args) => {
    calls.push(args);
    return { state: 'completed', session_id: 'created' };
  });
  await create({ kind: 'codex', name: 'First', cwd: '/project', rank: 'admiral' });
  await create({ kind: 'codex', name: 'Next', cwd: '/project' });
  await create({ kind: 'shell', name: 'Shell', cwd: '/project', rank: 'captain' });
  assert.deepEqual(calls[0].slice(5), ['--rank', 'admiral']);
  assert.deepEqual(calls[1].slice(5), ['--rank', 'crew']);
  assert.deepEqual(calls[2].slice(5), []);
});
test('invalid rank refuses before a service call', async () => {
  let calls = 0;
  const create = instanceCreator(async () => calls++);
  await assert.rejects(
    create({ kind: 'codex', name: 'Wrong', cwd: '/project', rank: 'owner' }),
    /rank/,
  );
  assert.equal(calls, 0);
});
test('creation retry identity includes rank and assignment', async () => {
  const calls = [];
  const create = instanceCreator(async (...args) => {
    if (args[0] === 'operation') throw Error('Unavailable');
    calls.push(args);
    throw Error('Lost reply');
  });
  const input = { kind: 'codex', name: 'Worker', cwd: '/project' };
  await assert.rejects(create(input));
  await assert.rejects(create(input));
  await assert.rejects(create({ ...input, rank: 'captain' }));
  await assert.rejects(create({ ...input, rank: 'captain', supervisor: 'commodore' }));
  assert.equal(calls[0][2], calls[1][2]);
  assert.notEqual(calls[1][2], calls[2][2]);
  assert.notEqual(calls[2][2], calls[3][2]);
  assert.deepEqual(calls[3].slice(5), ['--rank', 'captain', '--supervisor', 'commodore']);
});
test('fleet assignment failure retries the same runtime, including a changed destination', async () => {
  const calls = [];
  const create = instanceCreator(async (...args) => {
    calls.push(args);
    if (args[0] === 'fleets') return { fleets: [{ id: 'a' }, { id: 'b' }] };
    if (args[0] === 'move-vessel' && args[2] === 'a') throw Error('Fleet changed');
    return { state: 'completed', session_id: 'one' };
  });
  const input = { kind: 'codex', name: 'Writer', cwd: '/project', fleet: 'a' };
  await assert.rejects(create(input), /same vessel/);
  assert.deepEqual(await create({ ...input, fleet: 'b' }), { session: 'one' });
  assert.equal(calls.filter((c) => c[0] === 'create').length, 1);
  assert.deepEqual(
    calls.filter((c) => c[0] === 'move-vessel'),
    [
      ['move-vessel', 'one', 'a'],
      ['move-vessel', 'one', 'b'],
    ],
  );
});
test('a missing fleet fails before a runtime starts', async () => {
  const calls = [];
  const create = instanceCreator(async (...args) => {
    calls.push(args);
    return { fleets: [] };
  });
  await assert.rejects(
    create({ kind: 'shell', name: 'Shell', cwd: '/project', fleet: 'gone' }),
    /existing fleet/,
  );
  assert.deepEqual(calls, [['fleets']]);
});

test('choosing xterm after a failed viewer open preserves the created runtime', async () => {
  const calls = [];
  const create = instanceCreator(async (...args) => {
    calls.push(args);
    if (args[0] === 'create') throw Error('Viewer unavailable');
    if (args[0] === 'operation') return { state: 'partial', session_id: 'retained' };
    return { state: 'completed', session_id: 'retained' };
  });
  const input = { kind: 'shell', name: 'Workbench', cwd: '/project', terminal: 'ghostty' };
  await assert.rejects(create(input), /same instance/);
  assert.deepEqual(await create({ ...input, terminal: 'xterm' }), { session: 'retained' });
  assert.equal(calls.filter((c) => c[0] === 'create').length, 1);
  assert.deepEqual(calls[2].slice(0, 3), ['open', 'retained', 'xterm']);
});

test('a viewer choice cannot replace an unacknowledged creation', async () => {
  let attempts = 0;
  const create = instanceCreator(async (op) => {
    if (op === 'create') attempts++;
    throw Error('Lost reply');
  });
  const input = { kind: 'shell', name: 'Workbench', cwd: '/project', terminal: 'ghostty' };
  await assert.rejects(create(input));
  await assert.rejects(create({ ...input, terminal: 'xterm' }), /outcome|original/i);
  assert.equal(attempts, 1);
});

test('saved history retains the global cursor while returning only the selected agent', async () => {
  const { historyReader } = require('../src/instances.cjs');
  const calls = [];
  const read = historyReader(async (...args) => {
    calls.push(args);
    return {
      cursor: 100,
      events: [{ session_id: 'other' }, { session_id: 'chosen', type: 'capture.gap' }],
    };
  });
  assert.deepEqual(await read('chosen', 25), {
    cursor: 100,
    events: [{ session_id: 'chosen', type: 'capture.gap' }],
  });
  assert.deepEqual(calls, [['events', '25']]);
  await assert.rejects(read('chosen', -1), /history position/);
  assert.equal(calls.length, 1);
});

test('a lost Resume reply and double click share one request and one viewer open', async () => {
  const calls = [];
  const row = {
    id: 'saved',
    resume: { state: 'eligible' },
    lifecycle: { runtime: 'running', runtime_generation: 2 },
  };
  const resume = require('../src/instances.cjs').instanceResumer(async (...args) => {
    calls.push(args);
    if (args[0] === 'list') return [row];
    if (args[0] === 'resume-instance' || args[0] === 'open') throw Error('Lost reply');
    if (args[0] === 'operation') return { state: 'completed', runtime_generation: 2 };
    return { state: 'completed' };
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

test('an earlier completed Resume cannot open a stopped or different runtime', async () => {
  let opens = 0;
  const resume = require('../src/instances.cjs').instanceResumer(async (op) => {
    if (op === 'list')
      return [
        {
          id: 'saved',
          resume: { state: 'eligible' },
          lifecycle: { runtime: 'stopped', runtime_generation: 2 },
        },
      ];
    if (op === 'open') opens++;
    return { state: 'completed', runtime_generation: 2 };
  });
  await assert.rejects(
    resume({ id: 'saved', generation: 1, terminal: 'xterm', request: 'stale' }),
    /current runtime/,
  );
  assert.equal(opens, 0);
});

test('a failed viewer leaves Resume complete and a later Open remains separate', async () => {
  const calls = [];
  const resume = require('../src/instances.cjs').instanceResumer(async (...args) => {
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
    if (args[0] === 'operation') return { state: 'partial', runtime: 'running' };
    return { state: 'completed', runtime_generation: 2 };
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

test('an unconfirmed Resume is inspected again without submitting another identifier', async () => {
  const calls = [];
  const resume = require('../src/instances.cjs').instanceResumer(async (...args) => {
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
