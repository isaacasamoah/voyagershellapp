const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveWindow, registeredSession, resumeThread, windowAt } = require('../src/binding.cjs');
const { identifyTerminal } = require('../src/binding.cjs');
const nativeId = '12345678-1234-1234-1234-123456789abc';
const server = '/private/codex.sock';
const record = {
  pid: 10,
  start: '100',
  executable: '/usr/bin/ghostty',
  server,
  nativeId,
  external: true,
  frontend: {
    pid: 11,
    start: '110',
    executable: '/native/codex',
    argv: ['codex', '--remote', `unix://${server}`, 'resume', nativeId],
  },
};
const a = { id: 1, pid: 10, visible: true, title: 'same', x: 0, y: 0, width: 200, height: 200 };
const b = { ...a, id: 2, pid: 20, x: 250 };
const identities = new Map([
  [10, record],
  [11, record.frontend],
]);
function resolve(w, windows = [a, b], processes = identities, records = [record]) {
  return resolveWindow(w, windows, records, processes);
}
test('identify before registration; title and cwd never establish membership', () => {
  const target = resolve(a);
  assert.equal(target.record.nativeId, nativeId);
  assert.equal(registeredSession(target.record, []), undefined);
  assert.match(resolve(b).error, /identify/);
  assert.equal(
    registeredSession(record, [{ server: '/other', native_thread_id: nativeId }]),
    undefined,
  );
  const registration = { id: 'one', server, native_thread_id: nativeId };
  assert.equal(registeredSession(record, [registration]), registration);
});
test('only an explicit native endpoint and fixed UUID resume target qualify', () => {
  assert.equal(resumeThread(record.frontend.argv, server), nativeId);
  assert.equal(resumeThread([...record.frontend.argv, '--no-alt-screen'], server), nativeId);
  assert.equal(resumeThread(record.frontend.argv, '/other'), null);
  for (const args of [
    ['codex', 'resume', nativeId],
    ['codex', '--remote', `unix://${server}`, 'resume', '--last'],
    [...record.frontend.argv, 'an extra prompt'],
    ['codex', '--remote', `unix://${server}`, 'resume', 'friendly-name'],
  ])
    assert.equal(resumeThread(args, server), null);
});
test('extra windows, duplicate clients, PID reuse and changed arguments refuse docking', () => {
  assert.match(resolve(a, [a, { ...b, pid: 10 }]).error, /separate terminal window/);
  assert.match(resolve(a, [a, b], identities, [record, record]).error, /identify/);
  for (const changes of [
    [
      [10, { ...record, start: 'reused' }],
      [11, record.frontend],
    ],
    [[10, record]],
    [
      [10, record],
      [11, { ...record.frontend, executable: '/other/program' }],
    ],
    [
      [10, record],
      [11, { ...record.frontend, argv: ['codex', 'resume', 'different'] }],
    ],
  ])
    assert.match(resolve(a, [a, b], new Map(changes)).error, /terminal has changed/);
  assert.match(resolve({ ...a, visible: false }).error, /unavailable/);
});
test('hit testing chooses the frontmost visible window, never a covered terminal', () => {
  assert.equal(windowAt([a, { ...b, x: 0 }], { x: 50, y: 50 }).id, 2);
  assert.equal(windowAt([a, { ...b, x: 0 }], { x: 50, y: 50 }, [2]).id, 1);
  const panel = { ...a, id: 3, pid: 999 };
  const avatar = { ...panel, id: 4 };
  assert.equal(windowAt([a, panel, avatar], { x: 50, y: 50 }, [4]).id, panel.id);
});

test('minimising preserves a verified attachment but cannot become a new docking target', () => {
  const hidden = { ...a, visible: false };
  assert.match(resolveWindow(hidden, [hidden], [record], identities).error, /unavailable/);
  assert.equal(
    resolveWindow(hidden, [hidden], [record], identities, false).record.nativeId,
    nativeId,
  );
  assert.match(resolveWindow(hidden, [hidden], [record], new Map(), false).error, /changed/);
});

test('xterm identification preserves exact native arguments and rejects ambiguous clients', async () => {
  const terminal = { ...record, executable: '/usr/bin/xterm' };
  const endpoint = {
    server,
    executable: record.frontend.executable,
    viewers: ['/usr/bin/ghostty', '/usr/bin/xterm'],
  };
  const snapshot = { terminal, children: [record.frontend] };
  assert.equal((await identifyTerminal(10, endpoint, snapshot))?.nativeId, nativeId);
  assert.equal(await identifyTerminal(10, { ...endpoint, server: '/other' }, snapshot), null);
  assert.equal(
    await identifyTerminal(10, endpoint, {
      ...snapshot,
      children: [record.frontend, record.frontend],
    }),
    null,
  );
  assert.equal(
    await identifyTerminal(10, endpoint, {
      ...snapshot,
      terminal: { ...terminal, executable: '/tmp/xterm' },
    }),
    null,
  );
});
