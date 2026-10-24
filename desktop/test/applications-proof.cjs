const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { screen, BrowserWindow } = require('electron');
const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({
  avatarWin,
  panelWin,
  rpc,
  inventory,
  dock,
  getState,
  setExpanded,
  stateDir,
  vessel,
  target,
  input,
  observations,
}) => {
  const candidate = getState().candidate;
  const keyboard = process.env.VOYAGER_PROOF_KEYBOARD === '1';
  const triggerKeyboard = () => exec('xdotool', ['key', 'ctrl+alt+v'], { timeout: 3000 });
  const title = 'Voyager Dock Trial ' + process.pid;
  const name = `voyager-dock-trial-${process.pid}.desktop`;
  const directory = path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'),
    'applications',
  );
  const launcher = path.join(directory, name);
  const quote = (value) => '"' + value.replace(/[\\"`$]/g, '\\$&') + '"';
  const args = [
    candidate.app,
    '--ozone-platform=x11',
    ...(candidate.packaged ? [] : [path.resolve(__dirname, '..')]),
    '--expanded',
    '--from-applications',
  ];
  const desktop = `[Desktop Entry]\nType=Application\nName=${title}\nExec=${['/usr/bin/env', 'VOYAGER_STATE=' + stateDir, ...args].map(quote).join(' ')}\nTerminal=false\nCategories=Development;\n`;
  const initial = await rpc('attach-info', vessel);
  const cover = new BrowserWindow({
    width: 300,
    height: 300,
    show: false,
    frame: false,
    backgroundColor: '#20242c',
    webPreferences: { sandbox: true },
  });
  const wait = async (read, accept, message) => {
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      const value = await read();
      if (accept(value)) return value;
      await delay(40);
    }
    throw Error(message);
  };
  const key = async (code) => {
    await input(['key', code, true]);
    await input(['key', code, false]);
  };
  const overview = async () =>
    (
      await exec('gdbus', [
        'call',
        '--session',
        '--dest',
        'org.gnome.Shell',
        '--object-path',
        '/org/gnome/Shell',
        '--method',
        'org.freedesktop.DBus.Properties.Get',
        'org.gnome.Shell',
        'OverviewActive',
      ])
    ).stdout.includes('true');
  let selection = 0;
  const nativeLaunch = async () => {
    selection++;
    if (keyboard) {
      const prior = getState().recoveryAttempts.at(-1)?.generation;
      const started = performance.now();
      await triggerKeyboard();
      return { started, prior };
    }
    if (!keyboard && (await overview()))
      await exec('gdbus', [
        'call',
        '--session',
        '--dest',
        'org.gnome.Shell',
        '--object-path',
        '/org/gnome/Shell',
        '--method',
        'org.freedesktop.DBus.Properties.Set',
        'org.gnome.Shell',
        'OverviewActive',
        '<false>',
      ]);
    await input(['key', 65515, true]);
    await key(97);
    await input(['key', 65515, false]);
    await wait(overview, Boolean, 'Applications grid did not open');
    const command = path.join(stateDir, `applications-select-${selection}.json`);
    const screenshot = path.join(stateDir, `applications-grid-${selection}.png`);
    const display = screen.getPrimaryDisplay();
    const capture = async () => {
      await delay(700);
      await exec(
        'python3',
        [path.join(__dirname, 'native-capture.py'), JSON.stringify(display.bounds), screenshot],
        { timeout: 20000 },
      );
      await fs.writeFile(
        path.join(stateDir, 'applications-selection.json'),
        JSON.stringify({ title, selection, command, screenshot, display: display.bounds }),
      );
    };
    await capture();
    const deadline = performance.now() + 90000;
    while (performance.now() < deadline) {
      const request = await fs
        .readFile(command, 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      if (!request) {
        await delay(100);
        continue;
      }
      await fs.unlink(command);
      if (request.key) {
        assert([65366, 65365, 65367, 65360].includes(request.key));
        await key(request.key);
        await capture();
        continue;
      }
      assert(request.click && Number.isFinite(request.click.x) && Number.isFinite(request.click.y));
      assert(await overview(), 'Applications grid closed before selection');
      await input(['move', request.click.x, request.click.y, 1]);
      const prior = getState().recoveryAttempts.at(-1)?.generation;
      const started = performance.now();
      await input(['button', true]);
      await input(['button', false]);
      observations.push({
        label: 'native-applications-selection',
        title,
        selection,
        point: request.click,
        screenshot,
      });
      return { started, prior, display: screen.getDisplayNearestPoint(request.click).workArea };
    }
    throw Error('Applications grid selection was not supplied');
  };
  const recovered = async ({ started, prior, display }, label) => {
    const state = await wait(
      async () => {
        const stack = await inventory();
        const avatar = stack.find((w) => w.id === avatarWin.getNativeWindowHandle().readUInt32LE());
        const panel = stack.find((w) => w.id === panelWin.getNativeWindowHandle().readUInt32LE());
        return {
          binding: getState().binding,
          recovered: getState().recoveryAttempts.at(-1),
          avatar,
          panel,
        };
      },
      (s) =>
        s.recovered?.state === 'presented' &&
        s.recovered.generation !== prior &&
        !s.binding &&
        s.avatar?.visible &&
        s.panel?.visible &&
        avatarWin.isVisible() &&
        panelWin.isVisible(),
      'Applications did not recover both controls',
    );
    const elapsed_ms = performance.now() - started;
    if (display) {
      const position = screen.screenToDipPoint({ x: state.panel.x, y: state.panel.y });
      assert(
        position.x >= display.x &&
          position.y >= display.y &&
          position.x < display.x + display.width &&
          position.y < display.y + display.height,
        'Applications recovered on the wrong display',
      );
    }
    await delay(850);
    assert.equal(getState().binding, null);
    assert(panelWin.isVisible());
    assert(avatarWin.isVisible());
    assert.equal((await rpc('attach-info', vessel)).pid, initial.pid);
    const row = (await rpc('list')).find((s) => s.id === vessel);
    assert.equal(row.worker_state, 'running');
    assert.equal(row.capture, 'connected');
    observations.push({
      label,
      elapsed_ms,
      candidate,
      vessel,
      pid: initial.pid,
      avatar: state.avatar,
      panel: state.panel,
    });
  };
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(launcher, desktop, { flag: 'wx' });
  try {
    await exec('desktop-file-validate', [launcher]);
    const check = await exec('python3', [
      '-c',
      'from gi.repository import Gio;import sys;app=Gio.DesktopAppInfo.new_from_filename(sys.argv[1]);assert app and app.should_show();print(app.get_name())',
      launcher,
    ]);
    assert.equal(check.stdout.trim(), title);
    await delay(3000);
    await setExpanded(false);
    await exec('xdotool', ['windowactivate', '--sync', String(target)], { timeout: 3000 });
    assert(await dock(target));
    await recovered(await nativeLaunch(), 'applications-while-docked');
    await setExpanded(false);
    const nativeTarget = (await inventory()).find((w) => w.id === target);
    const point = screen.screenToDipPoint({
      x: Math.round(nativeTarget.x + nativeTarget.width / 2),
      y: Math.round(nativeTarget.y + nativeTarget.height * 0.76),
    });
    cover.setPosition(Math.round(point.x - 150), Math.round(point.y - 150));
    cover.show();
    await delay(150);
    assert.equal(await dock(target), false);
    const failed = getState().dockAttempts.at(-1);
    assert(failed.acceptedAt);
    assert.equal(failed.state, 'failed');
    cover.hide();
    await recovered(await nativeLaunch(), 'applications-after-failed-placement');
    for (let i = 0; i < (keyboard ? 2 : 20); i++) {
      await setExpanded(false);
      await exec('xdotool', ['windowactivate', '--sync', String(target)], { timeout: 3000 });
      assert(await dock(target));
      const prior = getState().recoveryAttempts.at(-1)?.generation;
      const started = performance.now();
      if (keyboard) await triggerKeyboard();
      else await exec('gtk-launch', [name], { timeout: 5000 });
      await recovered({ started, prior }, `applications-timing-${i + 1}`);
    }
    const trials = observations.filter((o) => o.label?.startsWith('applications-timing-'));
    assert.equal(trials.length, keyboard ? 2 : 20);
    assert(trials.filter((t) => t.elapsed_ms <= 1000).length >= (keyboard ? 2 : 19));
    observations.push({
      label: 'recovery-input',
      method: keyboard ? 'native Ctrl+Alt+V' : 'GNOME Applications and gtk-launch',
    });
  } catch (error) {
    observations.push({
      label: 'applications-failure-state',
      error: error.message,
      recoveries: getState().recoveryAttempts,
      binding: getState().binding?.window?.id,
      windows: (await inventory()).filter((window) => window.pid === process.pid),
    });
    throw error;
  } finally {
    if (!keyboard && (await overview()))
      await exec('gdbus', [
        'call',
        '--session',
        '--dest',
        'org.gnome.Shell',
        '--object-path',
        '/org/gnome/Shell',
        '--method',
        'org.freedesktop.DBus.Properties.Set',
        'org.gnome.Shell',
        'OverviewActive',
        '<false>',
      ]);
    cover.destroy();
    await fs.unlink(launcher);
  }
};
