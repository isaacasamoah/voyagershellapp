const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { promisify } = require('node:util');
const { screen } = require('electron');
const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({
  avatarWin,
  panelWin,
  setExpanded,
  inventory,
  stateDir,
  rpc,
  refresh,
  getState,
}) => {
  const observations = [];
  const owned = [];
  const pointer = spawn('python3', [path.join(__dirname, 'native-pointer.py')], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const replies = createInterface({ input: pointer.stdout });
  const save = (verdict, error) =>
    fs.writeFile(
      path.join(stateDir, 'visibility-proof.json'),
      JSON.stringify({ verdict, error, candidate: getState().candidate, observations }, null, 2),
    );
  const input = (value) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Pointer acknowledgement timed out')), 4000);
      replies.once('line', (line) => {
        clearTimeout(timer);
        const reply = JSON.parse(line);
        reply.error ? reject(Error(reply.error)) : resolve();
      });
      pointer.stdin.write(JSON.stringify(value) + '\n');
    });
  const wait = async (read, accept, message) => {
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      const value = await read();
      if (accept(value)) return value;
      await delay(50);
    }
    throw Error(message);
  };
  const positions = async () => {
    const windows = await inventory();
    return Object.fromEntries(
      [
        ['panel', panelWin],
        ['avatar', avatarWin],
      ].map(([name, w]) => [
        name,
        windows.find((n) => n.id === w.getNativeWindowHandle().readUInt32LE()),
      ]),
    );
  };
  const same = (a, b) =>
    ['panel', 'avatar'].every(
      (name) =>
        a[name]?.visible && ['x', 'y'].every((key) => Math.abs(a[name][key] - b[name][key]) <= 2),
    );
  try {
    await save('running');
    const area = (screen.getAllDisplays().find((d) => !d.internal) || screen.getPrimaryDisplay())
      .workArea;
    for (const [index, trigger] of ['minimised', 'closed'].entries()) {
      const nativeId = 'return-position-' + index;
      const created = await rpc(
        'create',
        'shell',
        nativeId,
        'Recovery position ' + trigger,
        stateDir,
        '--terminal',
        process.env.VOYAGER_PROOF_TERMINAL || 'xterm',
      );
      const id = created.session_id;
      owned.push(id);
      await refresh();
      const record = getState().records.find((r) => r.nativeId === nativeId);
      const target = getState().windows.find((w) => w.pid === record?.pid);
      assert(target, 'Native test terminal is mapped');
      const point = screen.dipToScreenPoint({
        x: area.x + Math.round(area.width * 0.55),
        y: area.y + 100,
      });
      await exec('xdotool', [
        'windowmove',
        String(target.id),
        String(point.x),
        String(point.y),
        'windowsize',
        String(target.id),
        '1000',
        '650',
        'windowactivate',
        '--sync',
        String(target.id),
      ]);
      await setExpanded(true, { x: area.x + 148 + index * 60, y: area.y + 94 + index * 35 });
      panelWin.show();
      avatarWin.showInactive();
      await delay(400);
      await refresh();
      const before = await positions();
      assert(before.panel?.visible && before.avatar?.visible);
      const original = await rpc('attach-info', id);
      const avatar = avatarWin.getBounds();
      await input(['move', avatar.x + avatar.width / 2, avatar.y + avatar.height / 2, 1]);
      await input(['button', true]);
      await delay(400);
      const nativeTarget = (await inventory()).find((w) => w.id === target.id);
      const destination = screen.screenToDipPoint({
        x: nativeTarget.x + nativeTarget.width / 2,
        y: nativeTarget.y + nativeTarget.height / 2,
      });
      await input(['move', destination.x, destination.y, 1]);
      await wait(
        async () => getState().dragging?.candidate,
        (s) => s?.state === 'ready',
        'Drag did not find eligible target',
      );
      await input(['button', false]);
      await wait(
        async () => getState(),
        (s) => s.binding?.session.id === id && s.dockAttempts.at(-1)?.state === 'placed',
        'Drop did not complete',
      );
      const docked = await positions();
      assert(!same(docked, before), 'Dock must move avatar away from its floating position');
      await exec('xdotool', [
        trigger === 'minimised' ? 'windowminimize' : 'windowclose',
        String(target.id),
      ]);
      await wait(
        async () => getState(),
        (s) => !s.binding && s.expanded,
        'Target loss did not recover',
      );
      const after = await wait(
        positions,
        (p) => same(p, before),
        'Recovery did not restore pre-dock native positions',
      );
      await delay(850);
      assert(same(await positions(), before), 'Refresh moved recovered controls');
      const current = await rpc('attach-info', id);
      assert.equal(current.pid, original.pid);
      const row = (await rpc('list')).find((r) => r.id === id);
      assert.equal(row.worker_state, 'running');
      assert.equal(row.capture, 'connected');
      observations.push({
        trigger,
        id,
        pid: current.pid,
        before,
        docked,
        after,
        capture: row.capture,
      });
      await rpc('remove', id, '--stop');
      owned.splice(owned.indexOf(id), 1);
    }
    await save('pass');
  } catch (error) {
    await save('rework', error.stack);
    throw error;
  } finally {
    pointer.stdin.end();
    replies.close();
    for (const id of owned) await rpc('remove', id, '--stop');
  }
};
