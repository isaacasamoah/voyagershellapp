const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveWindow, windowAt } = require('../src/binding.cjs');
const session = {
  id: 'one',
  native_thread_id: 'thread-one',
  capture: 'connected',
  worker_state: 'running',
};
const record = {
  pid: 10,
  start: '100',
  executable: '/usr/bin/ghostty',
  frontend: {
    pid: 11,
    start: '110',
    executable: '/native/codex',
    argv: ['codex', 'resume', 'thread-one'],
  },
  sessionId: 'one',
  nativeId: 'thread-one',
};
const a = { id: 1, pid: 10, visible: true, title: 'same', x: 0, y: 0, width: 200, height: 200 };
const b = { ...a, id: 2, pid: 20, x: 250 };
const identities = new Map([
  [10, record],
  [11, record.frontend],
]);
function resolve(w, windows = [a, b], sessions = [session], processes = identities) {
  return resolveWindow(w, windows, [record], sessions, processes);
}
test('identical titles do not bind an unrelated terminal', () => {
  assert.equal(resolve(a).session.id, 'one');
  assert.match(resolve(b).error, /Can’t connect to this terminal yet/);
  assert.equal(windowAt([a, b], { x: 300, y: 50 }, 999).id, 2);
});
test('extra windows, PID reuse, exited frontend and disconnected capture refuse docking', () => {
  assert.match(resolve(a, [a, { ...b, pid: 10 }]).error, /separate terminal window/);
  assert.match(
    resolve(
      a,
      [a, b],
      [session],
      new Map([
        [10, { ...record, start: 'reused' }],
        [11, record.frontend],
      ]),
    ).error,
    /terminal has changed/,
  );
  assert.match(
    resolve(a, [a, b], [session], new Map([[10, record]])).error,
    /terminal has changed/,
  );
  assert.match(
    resolve(
      a,
      [a, b],
      [session],
      new Map([
        [10, record],
        [11, { ...record.frontend, executable: '/unrelated/program' }],
      ]),
    ).error,
    /terminal has changed/,
  );
  assert.match(resolve(a, [a, b], [{ ...session, capture: 'disconnected' }]).error, /disconnected/);
  assert.match(resolve({ ...a, visible: false }).error, /terminal is unavailable/);
});
test('frontmost visible window wins hit testing, never a covered terminal', () => {
  assert.equal(windowAt([a, { ...b, x: 0 }], { x: 50, y: 50 }, 999).id, 2);
  assert.equal(windowAt([a, { ...b, x: 0 }], { x: 50, y: 50 }, 20).id, 1);
});
