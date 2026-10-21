const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { supervisors } = require('../src/ui/authority.js');
const { authorityActions } = require('../src/authority.cjs');
const sessions = [
  { id: 'admiral', kind: 'codex', rank: 'admiral' },
  { id: 'commodore', kind: 'codex', rank: 'commodore' },
  { id: 'captain', kind: 'codex', rank: 'captain' },
  { id: 'crew', kind: 'codex', rank: 'crew' },
  { id: 'removed-captain', kind: 'codex', rank: 'captain', removed_ms: 1 },
  { id: 'shell', kind: 'shell', rank: null },
];
test('supervisor choices include only adjacent registered ranks and exclude self', () => {
  for (const [rank, expected] of [
    ['admiral', []],
    ['commodore', ['admiral']],
    ['captain', ['commodore']],
    ['crew', ['captain']],
  ]) {
    assert.deepEqual(
      supervisors(sessions, 'codex', rank).map((s) => s.id),
      expected,
    );
  }
  assert.deepEqual(
    supervisors(sessions, 'shell', null).map((s) => s.id),
    ['admiral', 'commodore', 'captain'],
  );
  assert.deepEqual(supervisors(sessions, 'codex', 'crew', 'captain'), []);
});
test('authority IPC operations preserve request IDs through the service', async () => {
  const calls = [];
  const actions = authorityActions(
    async (...args) => calls.push(args),
    () => sessions,
  );
  await actions.rank('crew', 'captain', 'rank-one');
  await actions.supervise('crew', 'captain', 'assign-one');
  await actions.supervise('crew', null, 'clear-one');
  assert.deepEqual(calls, [
    ['rank', 'crew', 'captain', '--request-id', 'rank-one'],
    ['supervise', 'crew', 'captain', '--request-id', 'assign-one'],
    ['supervise', 'crew', 'none', '--request-id', 'clear-one'],
  ]);
});
test('bad renderer input and removed targets never reach the service', () => {
  let calls = 0;
  const actions = authorityActions(
    () => calls++,
    () => sessions,
  );
  assert.throws(() => actions.rank('crew', 'owner', 'request'), /rank/);
  assert.throws(() => actions.rank('removed-captain', 'crew', 'request'), /registered/);
  assert.throws(() => actions.supervise('crew', {}, 'request'), /supervisor/);
  assert.throws(() => actions.supervise('crew', null, ''), /request/);
  assert.equal(calls, 0);
});
test('authority service rejection propagates without presenting a local state change', async () => {
  const actions = authorityActions(
    async () => {
      throw Error('Assignments would be invalid.');
    },
    () => sessions,
  );
  await assert.rejects(actions.rank('captain', 'crew', 'same-request'), /Assignments/);
  assert.equal(sessions.find((s) => s.id === 'captain').rank, 'captain');
});
test('preload exposes explicit authority actions with no generic RPC escape hatch', async () => {
  let api;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/preload.cjs'), 'utf8'), {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name, value) => {
          api = value;
        },
      },
      ipcRenderer: {
        invoke: (...args) => {
          calls.push(args);
        },
        on() {},
      },
    }),
  });
  api.rankInstance('crew', 'captain', 'rank');
  api.superviseInstance('crew', null, 'assign');
  api.stopService();
  assert.deepEqual(calls, [
    ['rank-instance', 'crew', 'captain', 'rank'],
    ['supervise-instance', 'crew', null, 'assign'],
    ['stop-service'],
  ]);
  assert.equal(api.rpc, undefined);
});
