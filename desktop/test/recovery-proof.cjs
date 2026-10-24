const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { promisify } = require('node:util');
const { BrowserWindow, screen } = require('electron');
const exec = promisify(execFile);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
exports.run = async ({
  avatarWin,
  panelWin,
  rpc,
  refresh,
  inventory,
  dock,
  undock,
  setExpanded,
  getState,
  stateDir,
  id,
  windowFor,
  voice,
  observations,
}) => {
  const initial = await rpc('attach-info', id);
  const cover = new BrowserWindow({
    width: 500,
    height: 500,
    show: false,
    frame: false,
    backgroundColor: '#20242c',
    webPreferences: { sandbox: true },
  });
  const originalDesktop = (await exec('xdotool', ['get_desktop'])).stdout.trim();
  const wait = async (read, accept, message) => {
    const until = performance.now() + 10000;
    while (performance.now() < until) {
      const value = await read();
      if (accept(value)) return value;
      await delay(50);
    }
    throw Error(message);
  };
  const recover = async (name, act, restore = async () => {}) => {
    console.log('Recovery proof: ' + name);
    const target = await windowFor(id);
    await exec('xdotool', ['windowactivate', '--sync', String(target.id)], { timeout: 3000 });
    await setExpanded(false);
    await delay(120);
    await refresh();
    assert(await dock(target.id), JSON.stringify(getState().dockAttempts.at(-1)));
    await voice(id);
    const started = performance.now();
    try {
      await act(target);
      await wait(
        async () => {
          await refresh();
          return getState();
        },
        (s) => !s.binding,
        'Target loss did not release attachment: ' + name,
      );
      const { avatar, panel } = await wait(
        async () => {
          const stack = await inventory();
          return {
            avatar: stack.find((w) => w.id === avatarWin.getNativeWindowHandle().readUInt32LE()),
            panel: stack.find((w) => w.id === panelWin.getNativeWindowHandle().readUInt32LE()),
          };
        },
        (v) =>
          v.avatar?.visible && v.panel?.visible && avatarWin.isVisible() && panelWin.isVisible(),
        'Recovered controls did not become natively visible',
      );
      const recoveredAt = performance.now();
      await delay(850);
      await refresh();
      assert.equal(getState().binding, null);
      assert(avatarWin.isVisible());
      const after = await rpc('attach-info', id);
      assert.equal(after.pid, initial.pid);
      const row = (await rpc('list')).find((s) => s.id === id);
      assert.equal(row.worker_state, 'running');
      assert.equal(row.capture, 'connected');
      await wait(
        () => rpc('status'),
        (s) => !s.control && s.voice.target === 'none' && s.conversation.voice === 'off',
        'Voice did not release after recovery',
      );
      observations.push({
        action: 'target-recovery',
        trigger: name,
        elapsed_ms: recoveredAt - started,
        id,
        pid: after.pid,
        capture: row.capture,
        avatar,
        panel,
      });
      await fs.writeFile(
        path.join(stateDir, `recovery-${name}.png`),
        (await panelWin.webContents.capturePage()).toPNG(),
      );
    } finally {
      await restore();
      cover.hide();
      undock();
    }
    return target;
  };
  try {
    await recover('covered', async (target) => {
      const point = screen.screenToDipPoint({
        x: Math.round(target.x + target.width / 2),
        y: Math.round(target.y + target.height * 0.76),
      });
      cover.setBounds({ x: point.x - 150, y: point.y - 150, width: 300, height: 300 });
      cover.show();
    });
    const target = await recover('minimised', (target) =>
      exec('xdotool', ['windowminimize', String(target.id)]),
    );
    await exec('xdotool', ['windowactivate', '--sync', String(target.id)], { timeout: 3000 });
    const internal = screen.getAllDisplays().find((d) => d.internal);
    assert(internal, 'Workspace trial requires an internal display');
    const point = screen.dipToScreenPoint({
      x: internal.bounds.x + 160,
      y: internal.bounds.y + 160,
    });
    await exec('xdotool', [
      'windowmove',
      String(target.id),
      String(point.x),
      String(point.y),
      'windowsize',
      String(target.id),
      '1100',
      '650',
    ]);
    await delay(300);
    await recover(
      'workspace',
      () => exec('xdotool', ['set_desktop', String(Number(originalDesktop) + 1)]),
      () => exec('xdotool', ['set_desktop', originalDesktop]),
    );
    for (const mode of ['arrangement', 'scale']) {
      let child;
      let finished;
      const receipt = path.join(stateDir, `display-${mode}.json`);
      await recover(
        mode,
        async () => {
          child = spawn(
            'python3',
            [path.join(__dirname, 'native-display-trial.py'), mode, receipt],
            { stdio: ['pipe', 'pipe', 'inherit'] },
          );
          finished = once(child, 'exit');
          const lines = createInterface({ input: child.stdout });
          const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(7000) });
          assert.equal(JSON.parse(line).applied, true);
          lines.close();
        },
        async () => {
          if (child) {
            child.stdin.end();
            const [code] = await finished;
            assert.equal(code, 0);
          }
        },
      );
      observations.push({
        action: 'display-restored',
        mode,
        receipt: JSON.parse(await fs.readFile(receipt, 'utf8')),
      });
    }
    await recover('closed', (target) => exec('xdotool', ['windowclose', String(target.id)]));
  } finally {
    await exec('xdotool', ['set_desktop', originalDesktop]);
    cover.destroy();
    undock();
  }
};
