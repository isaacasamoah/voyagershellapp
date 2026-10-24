const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { createInterface } = require('node:readline');
const { promisify } = require('node:util');
const { screen, app } = require('electron');
const { windowAt } = require('../src/binding.cjs');
const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({
  avatarWin,
  panelWin,
  candidateWin,
  rpc,
  refresh,
  inventory,
  undock,
  setExpanded,
  getState,
  stateDir,
}) => {
  const observations = [];
  const cleanup = [];
  const file = path.join(stateDir, 'docking-proof.json');
  const save = (verdict, error) =>
    fs.writeFile(
      file,
      JSON.stringify(
        {
          verdict,
          error,
          observations,
          cleanup,
          limits: [
            'GNOME/XWayland with native pointer events and disposable native windows. The external Codex fixture submits one setup turn. No voice test. Sound counts observe IPC requests, not audible output. This is D01 evidence only.',
          ],
        },
        null,
        2,
      ),
    );
  const pointer = spawn('python3', [path.join(__dirname, 'native-pointer.py')], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const replies = createInterface({ input: pointer.stdout });
  const viewer = process.env.VOYAGER_PROOF_TERMINAL || 'xterm';
  assert(['xterm', 'ghostty'].includes(viewer));
  const suppliedExternalPid = Number(process.env.VOYAGER_PROOF_EXTERNAL_PID || 0);
  const externalThread = process.env.VOYAGER_PROOF_EXTERNAL_THREAD;
  const kind = process.env.VOYAGER_PROOF_KIND || 'shell';
  assert(['shell', 'codex'].includes(kind));
  const external = suppliedExternalPid
    ? null
    : spawn(
        viewer,
        viewer === 'xterm'
          ? ['-title', 'Voyager disposable external', '-e', '/usr/bin/sleep', '180']
          : [
              '--gtk-single-instance=false',
              '--title=Voyager disposable external',
              '-e',
              '/usr/bin/sleep',
              '180',
            ],
        { stdio: 'ignore', env: { ...process.env, GDK_BACKEND: 'x11' } },
      );
  const externalPid = suppliedExternalPid || external.pid;
  let vessel;
  let stopped = false;
  let failure;
  const rendererErrors = [];
  for (const win of [avatarWin, panelWin, candidateWin])
    win.webContents.on('console-message', (_event, level, message) => {
      if (level === 3) rendererErrors.push(message);
    });
  const input = (value) =>
    new Promise((resolve, reject) => {
      const receive = (line) => {
        clearTimeout(timer);
        const reply = JSON.parse(line);
        reply.error ? reject(Error(reply.error)) : resolve();
      };
      const timer = setTimeout(() => {
        replies.removeListener('line', receive);
        reject(Error('Pointer did not acknowledge'));
      }, 4000);
      replies.once('line', receive);
      pointer.stdin.write(`${JSON.stringify(value)}\n`);
    });
  const move = async (point) => {
    await input(['move', point.x, point.y, 1]);
    observations.push({
      label: 'cursor-move',
      requested: point,
      actual: screen.getCursorScreenPoint(),
    });
    await wait(
      () => screen.getCursorScreenPoint(),
      (cursor) => Math.abs(cursor.x - point.x) < 3 && Math.abs(cursor.y - point.y) < 3,
      'Native cursor did not reach the requested point',
    );
  };
  const wait = async (read, accept, label) => {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      const value = await read();
      if (accept(value)) return value;
      await delay(50);
    }
    throw Error(label);
  };
  const capture = async (label, win) =>
    fs.writeFile(
      path.join(stateDir, `${label}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
  const hover = async (window) => {
    undock();
    await setExpanded(false);
    await exec('xdotool', ['windowmove', String(window.id), '400', '300'], { timeout: 3000 });
    await exec('xdotool', ['windowactivate', '--sync', String(window.id)], { timeout: 3000 });
    await refresh();
    window = (await inventory()).find((w) => w.id === window.id && w.visible);
    assert(window, 'Target must remain visible after activation');
    const point = screen.screenToDipPoint({
      x: window.x + window.width / 2,
      y: window.y + window.height / 2,
    });
    avatarWin.setPosition(Math.round(point.x - 220), Math.round(point.y - 60));
    avatarWin.showInactive();
    avatarWin.moveTop();
    await delay(150);
    const a = avatarWin.getBounds();
    await move({ x: a.x + a.width / 2, y: a.y + a.height / 2 });
    observations.push({
      label: 'before-press',
      bounds: a,
      cursor: screen.getCursorScreenPoint(),
      avatar: await avatarWin.webContents.executeJavaScript(
        `(()=>{const r=document.getElementById('avatar').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
      ),
    });
    await input(['button', true]);
    await wait(() => getState().dragging, Boolean, 'Native press did not begin drag');
    await move(point);
    const result = await wait(
      () => getState().dragging?.candidate,
      (c) => c && c.window.id === window.id && c.state !== 'checking',
      'Hover did not resolve',
    );
    await delay(80);
    observations.push({
      label: 'hover',
      window: window.id,
      state: result.state,
      reason: result.reason,
      cue: await candidateWin.webContents.executeJavaScript(
        `({state:document.body.dataset.state,reason:document.getElementById('reason').textContent})`,
      ),
    });
    const cue = observations.at(-1).cue;
    assert.equal(cue.state, result.state);
    assert.equal(cue.reason, result.reason);
    return result;
  };
  const released = async (label, expected) => {
    const point = screen.dipToScreenPoint(screen.getCursorScreenPoint());
    const excluded = [avatarWin, candidateWin].map((w) => w.getNativeWindowHandle().readUInt32LE());
    observations.push({
      label: 'before-release',
      candidate: getState().dragging?.candidate?.window.id,
      target: windowAt(await inventory(), point, excluded)?.id,
      point,
    });
    await input(['button', false]);
    await wait(
      () => getState(),
      (s) =>
        !s.dragging && (expected === 'ready' ? s.binding : s.dockError && panelWin.isVisible()),
      'Drop did not settle',
    );
    await delay(100);
    const s = getState();
    const status = await rpc('status');
    observations.push({
      label,
      docked: s.binding?.session.id || null,
      reason: s.dockError,
      visible: avatarWin.isVisible(),
      panel: panelWin.isVisible(),
      control: status.control,
      soundRequests: await avatarWin.webContents.executeJavaScript('window.dockingProofSounds'),
    });
    if (expected !== 'ready') {
      assert(avatarWin.isVisible());
      assert.equal(s.binding, null);
      assert.equal(status.control, null);
      assert(s.dockError);
    }
    if (panelWin.isVisible()) await capture(label, panelWin);
    else if (avatarWin.isVisible()) await capture(label, avatarWin);
    await save('running');
  };
  try {
    observations.push({ label: 'displays', displays: screen.getAllDisplays() });
    await save('running');
    await avatarWin.webContents.executeJavaScript(
      `window.dockingProofSounds=[];window.voyager.onDockSound(value=>window.dockingProofSounds.push(value));`,
    );
    const before = await rpc('list', '--include-removed');
    const externalWindow = await wait(
      inventory,
      (list) => list.some((w) => w.pid === externalPid && w.visible),
      'External viewer did not open',
    );
    if (externalThread) {
      const record = await wait(
        async () => {
          await refresh();
          return getState().records.find(
            (r) => r.pid === externalPid && r.nativeId === externalThread && r.external,
          );
        },
        Boolean,
        'Independent Codex viewer must be identifiable',
      );
      observations.push({ label: 'independent-codex', record });
    }
    const refusal = await hover(externalWindow.find((w) => w.pid === externalPid));
    assert.equal(refusal.state, 'refused');
    if (externalThread) assert.match(refusal.reason, /external/i);
    await capture('external-hover', candidateWin);
    await released('external-refused', 'refused');
    const afterExternal = await rpc('list', '--include-removed');
    assert.deepEqual(afterExternal, before);
    observations.push({ label: 'external-registration-unchanged', before, after: afterExternal });
    assert.deepEqual(
      await avatarWin.webContents.executeJavaScript('window.dockingProofSounds'),
      [],
    );
    const created = await rpc(
      'create',
      kind,
      'd01-create',
      'D01 disposable managed',
      stateDir,
      '--terminal',
      viewer,
    );
    vessel = created.session_id;
    assert.equal(created.state, 'completed');
    assert(vessel);
    const record = await wait(
      async () => {
        await refresh();
        return getState().records.find((r) => !r.external);
      },
      Boolean,
      'Managed viewer must be identifiable',
    );
    const target = (await inventory()).find((w) => w.pid === record.pid);
    const eligible = await hover(target);
    assert.equal(eligible.state, 'ready');
    await move({ x: 1, y: 1 });
    await wait(
      () => getState().dragging?.candidate,
      (c) => c?.outside && c.state === 'refused',
      'Leaving the target must invalidate its cue',
    );
    assert.equal(candidateWin.isVisible(), false);
    const returnedTarget = (await inventory()).find((w) => w.id === target.id);
    await move(
      screen.screenToDipPoint({
        x: returnedTarget.x + returnedTarget.width / 2,
        y: returnedTarget.y + returnedTarget.height / 2,
      }),
    );
    await wait(
      () => getState().dragging?.candidate,
      (c) => c?.state === 'ready' && c.window.id === target.id,
      'Returning must recheck the same target',
    );
    assert(candidateWin.isVisible());
    const returnedCue = await candidateWin.webContents.executeJavaScript(
      `({state:document.body.dataset.state,reason:document.getElementById('reason').textContent})`,
    );
    assert.equal(returnedCue.state, 'ready');
    assert.equal(returnedCue.reason, 'Release to dock');
    observations.push({
      label: 'hover-reentry',
      cue: returnedCue,
      visible: candidateWin.isVisible(),
    });

    await capture('managed-hover', candidateWin);
    await released('managed-accepted', 'ready');
    assert.equal(getState().binding.session.id, vessel);
    undock();
    await wait(
      () => rpc('status'),
      (s) => s.control === null,
      'Control did not release',
    );
    assert.equal((await hover(target)).state, 'ready');
    const soundsBefore = await avatarWin.webContents.executeJavaScript(
      'window.dockingProofSounds.length',
    );
    const receipt = await rpc('stop-instance', vessel, '--request-id', 'd01-stop');
    observations.push({ label: 'owned-stop', receipt });
    assert.equal(receipt.state, 'completed');
    stopped = true;
    await released('stopped-after-hover', 'refused');
    assert.equal(
      await avatarWin.webContents.executeJavaScript('window.dockingProofSounds.length'),
      soundsBefore,
    );
    assert.equal((await rpc('list', '--include-removed')).length, before.length + 1);
    assert.deepEqual(rendererErrors, []);
    observations.push({ label: 'renderer-errors', errors: rendererErrors, viewer });
  } catch (error) {
    observations.push({
      label: 'failure-state',
      records: getState().records,
      service: await rpc('status').catch(() => null),
      connection: await rpc('connection-info').catch(() => null),
    });
    failure = error;
  } finally {
    await input(['button', false]).catch(() => {});
    pointer.stdin.end();
    undock();
    if (vessel && !stopped) {
      try {
        cleanup.push(await rpc('stop-instance', vessel, '--request-id', 'd01-cleanup'));
        stopped = true;
      } catch (error) {
        cleanup.push({ error: error.message });
        failure ||= error;
      }
    }
    if (external?.exitCode === null) external.kill('SIGTERM');
    await delay(200);
    cleanup.push({
      externalExit: external?.exitCode,
      externalSignal: external?.signalCode,
      externalOwnedByParent: Boolean(suppliedExternalPid),
      managedStopped: stopped,
    });
    await save(failure ? 'rework' : 'pass', failure?.message);
  }
  if (failure) throw failure;
  app.quit();
};
