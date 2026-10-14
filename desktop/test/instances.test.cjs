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
