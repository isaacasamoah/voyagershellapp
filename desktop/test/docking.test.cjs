const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const sourcePath = path.resolve(__dirname, '../src/main.cjs');

function desktop(
  connect = async () => {
    throw Error('Unexpected control attachment');
  },
) {
  const nativeRequire = createRequire(sourcePath);
  const context = vm.createContext({
    require(name) {
      if (name === './control.cjs')
        return {
          connectControl: connect,
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
    globalThis.window = { id: 1, pid: 10, visible: true, x:0,y:0,width:400,height:400 };
    globalThis.record = {
      pid: 10, start: '100', executable: '/usr/bin/xterm', external: true,
      nativeId: 'thread', server: '/server',
      frontend: { pid: 11, start: '110', executable: '/codex', argv: ['codex'] },
    };
    globalThis.rows = [];
    serviceError = null;
    avatarWin = { isDestroyed:()=>false, showInactive() { calls.push('visible'); }, webContents: { send(name) { calls.push(name); } } };
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

function managedDesktop() {
  let close;
  const connection = { attachment: { generation: 'accepted' }, close() {} };
  const app = desktop(async (_state, _request, onClose) => {
    close = onClose;
    return connection;
  });
  app.run(`
    record.external = false;
    rows = [{id:'managed',server:'/server',native_thread_id:'thread',ownership:'managed',worker_state:'running',capture:'connected'}];
    globalThis.releases = [];
    releaseControl = async c => releases.push(c.attachment.generation);
  `);
  return { ...app, disconnect: () => close() };
}

test('accepted control with failed placement restores controls without a sound', async () => {
  const app = managedDesktop();
  app.run("placeAboveTerminal = async () => ({state:'failed',reason:'Target covered'});");
  assert.equal(await app.run('dock(1)'), false);
  assert.equal(app.run('binding'), null);
  assert.equal(app.context.calls.includes('dock-sound'), false);
  assert.ok(app.context.calls.includes('visible'));
  assert.deepEqual(Array.from(app.context.releases), ['accepted']);
});

test('a superseded placement does not report success', async () => {
  const app = managedDesktop();
  app.run("placeAboveTerminal = async () => ({state:'superseded'});");
  assert.equal(await app.run('dock(1)'), false);
  assert.equal(app.context.calls.includes('dock-sound'), false);
});

test('one visible placement produces one success sound', async () => {
  const app = managedDesktop();
  app.run("placeAboveTerminal = async () => ({state:'placed'});");
  assert.equal(await app.run('dock(1)'), true);
  assert.equal(app.context.calls.filter((c) => c === 'dock-sound').length, 1);
});

test('invalidating an in-flight placement releases its attachment', async () => {
  const app = managedDesktop();
  app.run(
    'globalThis.finishPlacement=null;placeAboveTerminal=()=>new Promise(r=>{finishPlacement=r;});',
  );
  const pending = app.run('dock(1)');
  while (!app.run('finishPlacement')) await new Promise((r) => setImmediate(r));
  app.run("dockGeneration++;finishPlacement({state:'superseded'});");
  assert.equal(await pending, false);
  assert.equal(app.run('binding'), null);
  assert.deepEqual(Array.from(app.context.releases), ['accepted']);
  assert.equal(app.context.calls.includes('dock-sound'), false);
});

test('control disconnect during placement restores the floating controls', async () => {
  const app = managedDesktop();
  app.run(
    'globalThis.finishPlacement=null;placeAboveTerminal=()=>new Promise(r=>{finishPlacement=r;});',
  );
  const pending = app.run('dock(1)');
  while (!app.run('finishPlacement')) await new Promise((r) => setImmediate(r));
  app.disconnect();
  app.run("finishPlacement({state:'placed'});");
  assert.equal(await pending, false);
  assert.equal(app.run('binding'), null);
  assert.ok(app.context.calls.includes('visible'));
  assert.equal(app.context.calls.includes('dock-sound'), false);
});

test('an old control acknowledgement cannot select or attach after invalidation', async () => {
  let accept;
  const app = desktop(() => new Promise((r) => (accept = r)));
  app.run(
    `record.external=false;rows=[{id:'managed',server:'/server',native_thread_id:'thread',ownership:'managed',worker_state:'running',capture:'connected'}];globalThis.releases=[];releaseControl=async c=>releases.push(c.attachment.generation);`,
  );
  const pending = app.run('dock(1)');
  while (!accept) await new Promise((r) => setImmediate(r));
  app.run('dockGeneration++;');
  accept({ attachment: { generation: 'old' }, close() {} });
  assert.equal(await pending, false);
  assert.equal(app.run('binding'), null);
  assert.equal(app.run('selected'), null);
  assert.deepEqual(Array.from(app.context.releases), ['old']);
  assert.equal(app.context.calls.includes('dock-sound'), false);
});

async function dockedRefresh() {
  const app = managedDesktop();
  app.run(`
    placeAboveTerminal = async () => ({state:'placed'});
    fleets.read = async () => ({});
    rpc = async action => action === 'status' ? {control: controlConnection?.attachment} : rows;
    presentationReady = true;
    creating = 1;
    resizePanel = () => {};
    placePanel = () => {};
  `);
  assert.equal(await app.run('dock(1)'), true);
  app.context.calls.length = 0;
  return app;
}

test('a covered docked target restores controls and releases only its attachment', async () => {
  const app = await dockedRefresh();
  app.run("placeAboveTerminal = async () => ({state:'failed',reason:'Target covered'});");
  await app.run('refresh()');
  assert.equal(app.run('binding'), null);
  assert.deepEqual(Array.from(app.context.releases), ['accepted']);
  assert.ok(app.context.calls.includes('visible'));
  assert.ok(app.context.calls.includes('panel'));
  assert.equal(app.context.calls.includes('dock-sound'), false);
});

test('a hidden docked target recovers without trying to place again', async () => {
  const app = await dockedRefresh();
  app.run(
    "window.visible=false;placeAboveTerminal=async()=>{throw Error('Must not place hidden target');};",
  );
  await app.run('refresh()');
  assert.equal(app.run('binding'), null);
  assert.match(app.run('dockError'), /unavailable/);
  assert.ok(app.context.calls.includes('visible'));
});

test('a late refresh placement failure cannot release a newer attachment', async () => {
  const app = await dockedRefresh();
  app.run('globalThis.finish=null;placeAboveTerminal=()=>new Promise(r=>{finish=r;});');
  const pending = app.run('refresh()');
  while (!app.run('finish')) await new Promise((r) => setImmediate(r));
  app.run(
    "dockGeneration++;binding={...binding,session:{id:'new'}};controlConnection={attachment:{generation:'new'}};finish({state:'failed',reason:'Old target covered'});",
  );
  await pending;
  assert.equal(app.run('binding.session.id'), 'new');
  assert.equal(app.context.releases.length, 0);
});

test('a display change cancels control and places recovery controls on an available display', async () => {
  const app = await dockedRefresh();
  app.run(`avatarPosition=()=>({x:9000,y:9000});placeAvatar=(x,y)=>calls.push('clamp:'+x+','+y);`);
  await app.run('recoverDisplay()');
  assert.equal(app.run('binding'), null);
  assert.ok(app.context.calls.includes('clamp:9000,9000'));
  assert.ok(app.context.calls.includes('visible'));
  assert.ok(app.context.calls.includes('panel'));
});
