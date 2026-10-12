const { test } = require('node:test');
const assert = require('node:assert/strict');
const { instanceCreator } = require('../src/instances.cjs');
test('a failed open retries the same registration and preserves the chosen kind', async () => {
  const calls = [];
  let failed = false;
  const create = instanceCreator(async (...args) => {
    calls.push(args);
    if (args[0] === 'create') return { state: 'running', session_id: 'shell-one' };
    if (!failed) {
      failed = true;
      throw Error('Ghostty unavailable');
    }
    return { state: 'opening' };
  });
  const input = { kind: 'shell', name: 'Workbench', cwd: '/project' };
  await assert.rejects(create(input), /reopen the same instance/);
  assert.deepEqual(await create(input), { session: 'shell-one' });
  assert.deepEqual(calls[0], calls[2]);
  assert.equal(calls[0][1], 'shell');
  assert.deepEqual(calls[1], ['open', 'shell-one', 'ghostty']);
});
test('double clicks and unsupported choices do not create duplicate instances', async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const create = instanceCreator(async (op) => (op === 'create' ? pending : {}));
  const first = create({ kind: 'codex', name: 'Lead', cwd: '/project' });
  await assert.rejects(create({ kind: 'codex', name: 'Lead', cwd: '/project' }), /already/);
  finish({ state: 'running', session_id: 'one' });
  await first;
  await assert.rejects(create({ kind: 'unknown', name: 'No', cwd: '/project' }), /type/);
  await assert.rejects(create({ kind: 'shell', name: 'No', cwd: 'relative' }), /absolute/);
});
