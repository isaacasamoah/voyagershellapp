const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const sourcePath = path.resolve(__dirname, '../src/main.cjs');

function desktop() {
  const nativeRequire = createRequire(sourcePath);
  const context = vm.createContext({
    require(name) {
      if (name === './control.cjs')
        return {
          connectControl: async () => {
            throw Error('Unexpected control attachment');
          },
        };
      if (name !== 'electron') return nativeRequire(name);
      return {
        app: {
          commandLine: { appendSwitch() {} },
          disableHardwareAcceleration() {},
          setName() {},
          setDesktopName() {},
          setPath() {},
          requestSingleInstanceLock: () => true,
          whenReady: () => ({ then() {} }),
          on() {},
        },
      };
    },
    Buffer,
    __dirname: path.dirname(sourcePath),
    process,
    console,
    performance,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
  vm.runInContext(
    `
    globalThis.calls = [];
    globalThis.window = { id: 1, pid: 10, visible: true };
    globalThis.record = {
      pid: 10, start: '100', executable: '/usr/bin/xterm', external: true,
      nativeId: 'thread', server: '/server',
      frontend: { pid: 11, start: '110', executable: '/codex', argv: ['codex'] },
    };
    globalThis.rows = [];
    serviceError = null;
    avatarWin = { showInactive() { calls.push('visible'); }, webContents: { send(name) { calls.push(name); } } };
    inventory = async () => [window];
    discoverTerminals = async () => (records = [record]);
    identities = async () => new Map([[10, record], [record.frontend.pid, record.frontend]]);
    rpc = async (action) => { calls.push(action); return rows; };
    sendState = () => {};
    setExpanded = async () => { calls.push('panel'); };
    placeAboveTerminal = async () => {};
    follow = () => {};
    setSeated = () => {};
  `,
    context,
  );
  return { context, run: (code) => vm.runInContext(code, context) };
}

test('the drop path refuses an external client without registration or a success sound', async () => {
  const app = desktop();
  assert.equal(await app.run('dock(1)'), false);
  assert.equal(app.context.calls.includes('register'), false);
  assert.equal(app.context.calls.includes('dock-sound'), false);
  assert.ok(app.context.calls.includes('visible'));
  assert.match(app.run('dockError'), /External|external/);
});

test('a client replaced after hover is refused by the actual drop path', async () => {
  const app = desktop();
  app.run(`
    record.external = false;
    rows = [{ id: 'managed', server: '/server', native_thread_id: 'thread',
      ownership: 'managed', worker_state: 'running', capture: 'connected' }];
    globalThis.expected = { window, record, session: rows[0] };
    record = { ...record, frontend: { ...record.frontend, pid: 12, start: '120' } };
  `);
  assert.equal(await app.run('dock(1, expected)'), false);
  assert.equal(app.context.calls.includes('dock-sound'), false);
  assert.ok(app.context.calls.includes('visible'));
  assert.match(app.run('dockError'), /changed/);
});

test('hover stays checking until verification and ignores a result from an abandoned drag', async () => {
  const app = desktop();
  app.run(`
    panelWin = { getNativeWindowHandle: () => Buffer.from([99, 0, 0, 0]) };
    candidateWin = { hide() {} };
    showDockCandidate = (target, result) => calls.push(result.state);
    globalThis.finish = null;
    checkDockTarget = () => new Promise(resolve => { finish = resolve; });
    dragging = {};
    previewDock(window);
  `);
  assert.equal(app.run('dragging.candidate.state'), 'checking');
  app.run("dragging = null; finish({ state: 'ready', reason: 'Release to dock' });");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(Array.from(app.context.calls), ['checking']);
});

test('a stopped target and unavailable service leave visible controls and a reason', async () => {
  for (const setup of [
    "serviceError = 'Service disconnected';",
    `record.external = false;
    rows = [{ id: 'managed', server: '/server', native_thread_id: 'thread', ownership: 'managed', worker_state: 'stopped', capture: 'disconnected' }];`,
  ]) {
    const app = desktop();
    app.run(setup);
    assert.equal(await app.run('dock(1)'), false);
    assert.ok(app.context.calls.includes('visible'));
    assert.ok(app.context.calls.includes('panel'));
    assert.ok(app.run('dockError'));
    assert.equal(app.context.calls.includes('dock-sound'), false);
  }
});

test('losing the hovered window retains a refusal for the later drop', () => {
  const app = desktop();
  app.run(`
    panelWin = { getNativeWindowHandle: () => Buffer.from([99, 0, 0, 0]) };
    candidateWin = { hide() {} };
    dragging = { candidate: { window, state: 'ready', reason: 'Release to dock' } };
    previewDock(null);
  `);
  assert.equal(app.run('dragging.candidate?.state'), 'refused');
  assert.match(app.run('dragging.candidate.reason'), /unavailable|changed/);
});

test('returning to the same terminal rechecks and restores its hover cue', async () => {
  const app = desktop();
  app.run(`
    panelWin = { getNativeWindowHandle: () => Buffer.from([99, 0, 0, 0]) };
    candidateWin = { hide() { calls.push('hidden'); } };
    showDockCandidate = (target, result) => calls.push(result.state);
    checkDockTarget = async () => ({state: 'ready', reason: 'Release to dock'});
    dragging = {};
    previewDock(window);
  `);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.run('dragging.candidate.state'), 'ready');
  app.run('previewDock(null); previewDock(window);');
  assert.equal(app.run('dragging.candidate.state'), 'checking');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.run('dragging.candidate.state'), 'ready');
  assert.deepEqual(Array.from(app.context.calls), [
    'checking',
    'ready',
    'hidden',
    'checking',
    'ready',
  ]);
});

test('a late check from before leaving cannot replace the re-entry result', async () => {
  const app = desktop();
  app.run(`
    panelWin = { getNativeWindowHandle: () => Buffer.from([99, 0, 0, 0]) };
    candidateWin = { hide() {} };
    showDockCandidate = (target, result) => calls.push(result.reason);
    globalThis.pending = [];
    checkDockTarget = () => new Promise(resolve => pending.push(resolve));
    dragging = {};
    previewDock(window);
    previewDock(null);
    previewDock(window);
    pending[1]({state: 'refused', reason: 'Current target stopped'});
  `);
  await new Promise((resolve) => setImmediate(resolve));
  app.run("pending[0]({state: 'ready', reason: 'Old target ready'});");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.run('dragging.candidate.state'), 'refused');
  assert.equal(app.run('dragging.candidate.reason'), 'Current target stopped');
  assert.equal(app.context.calls.includes('Old target ready'), false);
});
