const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { screen, app } = require('electron');
const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.run = async ({
  avatarWin,
  panelWin,
  rpc,
  refresh,
  inventory,
  getState,
  park,
  setExpanded,
  stateDir,
}) => {
  const x11Pointer = process.env.VOYAGER_PROOF_POINTER === 'x11';
  const evidence = {
    surface: `native ${x11Pointer ? 'X11' : 'Mutter'} avatar gestures; verified PTY input; stock Ghostty, Bash and unmodified Codex`,
    steps: [],
  };
  const file = path.join(stateDir, 'adoption-proof.json');
  const display = screen.getAllDisplays().find((d) => !d.internal) || screen.getPrimaryDisplay();
  const home = { x: display.bounds.x + display.bounds.width - 240, y: display.bounds.y + 80 };
  const placeAvatar = () => avatarWin.setPosition(home.x, home.y);
  const capture = async (name, window) => {
    await exec('import', ['-window', String(window), path.join(stateDir, name + '.png')], {
      timeout: 5000,
    });
    if (process.env.VOYAGER_PROOF_MONITOR)
      await exec('python3', [
        path.join(__dirname, '../../experiments/desktop_capture.py'),
        process.env.VOYAGER_PROOF_MONITOR,
        path.join(stateDir, name + '-desktop.png'),
      ]);
  };

  const save = async () => fs.writeFile(file, JSON.stringify(evidence, null, 2));
  const wait = async (read, match, label, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = await read();
      if (match(value)) return value;
      await delay(100);
    }
    throw Error(label);
  };
  const pointer = x11Pointer
    ? null
    : spawn('python3', [path.join(__dirname, '../../experiments/native_pointer.py')], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
  const lines = pointer && require('node:readline').createInterface({ input: pointer.stdout });
  const move = (args) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Native pointer did not respond')), 4000);
      lines.once('line', (line) => {
        clearTimeout(timeout);
        const response = JSON.parse(line);
        response.error ? reject(Error(response.error)) : resolve(response);
      });
      pointer.stdin.write(JSON.stringify(args) + '\n');
    });
  const scale = screen.getPrimaryDisplay().scaleFactor;
  assert(
    screen.getAllDisplays().every((d) => d.scaleFactor === scale),
    'Pointer proof requires uniform display scale',
  );
  const owned = new Map();
  let inputWindow;
  const input = async (text) => {
    assert(owned.has(inputWindow), 'Input requires an owned experiment window');
    await exec('python3', [
      path.join(__dirname, '../../experiments/native_input.py'),
      String(inputWindow),
      String(owned.get(inputWindow)),
      Buffer.from(text).toString('base64'),
    ]);
  };
  const xt = (...args) =>
    args[0] === 'mousemove'
      ? x11Pointer
        ? exec('xdotool', args.map(String))
        : move(['move', Number(args[1]), Number(args[2]), scale])
      : args[0] === 'mousedown' || args[0] === 'mouseup'
        ? x11Pointer
          ? exec('xdotool', args.map(String))
          : move(['button', args[0] === 'mousedown'])
        : args[0] === 'type'
          ? input(args.at(-1))
          : args[0] === 'key'
            ? input(args[1] === 'ctrl+c' ? '\x03' : '\r')
            : exec('xdotool', args.map(String), { timeout: 3000 });
  const activate = async (id) => {
    inputWindow = id;
    await exec('xdotool', ['windowactivate', String(id)], { timeout: 3000 });
    await wait(
      async () => (await exec('xprop', ['-id', String(id), '_NET_WM_STATE'])).stdout,
      (text) => text.includes('_NET_WM_STATE_FOCUSED'),
      'Window did not receive desktop focus',
      8000,
    );
    await delay(400);
  };
  const gesture = async (target) => {
    await activate(target.id);
    await refresh();
    const start = avatarWin.getBounds();
    const from = screen.dipToScreenPoint({ x: start.x + 60, y: start.y + 60 });
    const to = {
      x: target.x + Math.round(target.width * 0.65),
      y: target.y + Math.round(target.height * 0.6),
    };
    await xt('mousemove', from.x, from.y);
    await wait(
      async () => screen.dipToScreenPoint(screen.getCursorScreenPoint()),
      (point) => Math.abs(point.x - from.x) < 4 && Math.abs(point.y - from.y) < 4,
      'Native pointer did not reach the avatar center',
      2000,
    );
    await xt('mousedown', 1);
    await delay(450);
    await wait(
      async () => getState().dragging,
      Boolean,
      'Desktop press did not reach the astronaut',
      2000,
    );
    for (let i = 1; i <= 12; i++) {
      await xt(
        'mousemove',
        Math.round(from.x + ((to.x - from.x) * i) / 12),
        Math.round(from.y + ((to.y - from.y) * i) / 12),
      );
      await delay(40);
    }
    await xt('mouseup', 1);
    await wait(
      () => rpc('status'),
      (s) => s.control?.window_id === target.id,
      `Avatar drop did not acquire ${target.id}: ${getState().dockError}`,
    );
    const away = screen.dipToScreenPoint({ x: display.bounds.x + 10, y: display.bounds.y + 10 });
    await xt('mousemove', away.x, away.y);
    await delay(500);
    assert.equal(
      await avatarWin.webContents.executeJavaScript(
        "getComputedStyle(document.getElementById('avatar')).opacity",
      ),
      '0.3',
    );
    await capture('dock-' + evidence.steps.length, target.id);
    evidence.steps.push({ action: 'native avatar drop', control: (await rpc('status')).control });
    await save();
    return getState().binding.session;
  };
  const undockGesture = async () => {
    const start = avatarWin.getBounds();
    const from = screen.dipToScreenPoint({ x: start.x + 60, y: start.y + 60 });
    await xt('mousemove', from.x, from.y);
    await wait(async () => getState().dockHovered, Boolean, 'Native hover did not brighten');
    await xt('mousedown', 1);
    await delay(450);
    const away = screen.dipToScreenPoint({ x: display.bounds.x + 80, y: display.bounds.y + 70 });
    await xt('mousemove', away.x, away.y);
    await delay(250);
    await xt('mouseup', 1);
    await wait(
      () => rpc('status'),
      (s) => s.control === null,
      'Native undock did not release control',
    );
    evidence.steps.push({ action: 'native hover and undock', status: await rpc('status') });
    await save();
  };
  const nativeCommand = async (window, text) => {
    await activate(window);
    await xt('type', '--clearmodifiers', text);
    await delay(500);
    await xt('key', 'Return');
  };
  const openOrdinary = async () => {
    const before = await inventory();
    const child = spawn('ghostty', [], {
      cwd: stateDir,
      env: { ...process.env, GDK_BACKEND: 'x11' },
      stdio: 'ignore',
    });
    await delay(500);
    const stack = await wait(
      inventory,
      (rows) => rows.some((w) => w.visible && !before.some((old) => old.id === w.id)),
      'Ordinary Ghostty did not open',
    );
    const target = stack.find((w) => w.visible && !before.some((old) => old.id === w.id));
    owned.set(target.id, child.pid);
    const at = screen.dipToScreenPoint({ x: display.bounds.x + 200, y: display.bounds.y + 250 });
    await xt('windowmove', target.id, at.x, at.y);
    await delay(400);
    Object.assign(
      target,
      (await inventory()).find((w) => w.id === target.id),
    );
    const record = await rpc('inspect-window', String(target.id));
    evidence.steps.push({
      action: 'ordinary Ghostty, no matching arguments',
      terminal: target,
      record,
      launcher: child.pid,
    });
    await save();
    return target;
  };
  try {
    placeAvatar();
    panelWin.setPosition(home.x - 100, home.y);
    evidence.displays = screen.getAllDisplays();
    evidence.avatar = avatarWin.getBounds();
    evidence.panel = panelWin.getBounds();
    await save();
    assert.deepEqual(await rpc('list'), []);
    await setExpanded(false);
    const other = await openOrdinary();
    const otherIdentity = await rpc('inspect-window', String(other.id));
    let terminal = await openOrdinary();
    await exec(
      'cargo',
      [
        'test',
        '--locked',
        '--test',
        'adoption',
        'dropping_handoff',
        '--',
        '--ignored',
        '--nocapture',
      ],
      {
        cwd: path.join(__dirname, '../..'),
        env: { ...process.env, VOYAGER_ADOPTION_WINDOW: String(terminal.id) },
        timeout: 30000,
      },
    );
    evidence.steps.push({
      action: 'native handoff released before adoption; known-different window',
      other: otherIdentity,
    });

    await fs.writeFile(path.join(stateDir, 'seed.sh'), 'export ADOPTION_VALUE=retained\n');
    await nativeCommand(terminal.id, 'source seed.sh');
    const shell = await gesture(terminal);
    const adoptedAgain = await rpc('adopt', String(terminal.id), 'same-instance');
    assert.equal(adoptedAgain.session_id, shell.id);
    assert.deepEqual(await rpc('adopt', String(terminal.id), 'same-instance'), adoptedAgain);
    await assert.rejects(rpc('adopt', '0', 'same-instance'), /request_conflict/);
    await assert.rejects(rpc('inspect-window', '0'));
    assert.equal((await rpc('list')).length, 1);

    await nativeCommand(terminal.id, 'echo captured');
    await wait(
      () => rpc('events', '0'),
      (p) =>
        p.events.some(
          (e) =>
            e.session_id === shell.id &&
            e.type === 'shell.command' &&
            e.payload.text === 'echo captured',
        ),
      'Native command not captured',
    );
    await activate(terminal.id);
    await xt('type', '--clearmodifiers', 'echo draft');
    await assert.rejects(
      rpc('shell-exec', shell.id, 'draft-refusal', 'echo mustnotrun'),
      /draft|busy/,
    );
    await xt('key', 'ctrl+c');
    await delay(400);
    await undockGesture();
    await rpc(
      'shell-exec',
      shell.id,
      'retained-command',
      `sleep 3; printf retained > '${stateDir}/job-result'`,
    );
    evidence.steps.push({ action: 'background', receipt: await rpc('background', shell.id) });
    await wait(
      () => fs.readFile(path.join(stateDir, 'job-result'), 'utf8').catch(() => ''),
      (v) => v === 'retained',
      'Foreground command did not survive',
    );
    const info = await rpc('attach-info', shell.id);
    const net = require('node:net');
    const bad = net.createConnection(info.socket);
    await new Promise((resolve) => bad.once('connect', resolve));
    bad.resume();
    bad.write(JSON.stringify({ resize: [0, 'invalid'] }) + '\n');
    await delay(300);
    bad.destroy();
    assert.equal((await rpc('status')).owns_shells, true);
    let opened = await rpc('open', shell.id, 'ghostty');
    owned.set(opened.window_id, opened.pid);
    await fs.writeFile(
      path.join(stateDir, 'proof.sh'),
      'printf "%s:%s" "$$" "$ADOPTION_VALUE" > retained-state\n',
    );
    await delay(400);
    await nativeCommand(opened.window_id, 'source proof.sh');
    const retained = await wait(
      () => fs.readFile(path.join(stateDir, 'retained-state'), 'utf8').catch(() => ''),
      (v) => v.endsWith(':retained'),
      'Native reopened shell lost state',
    );
    assert.equal(Number(retained.split(':')[0]), (await rpc('attach-info', shell.id)).pid);
    await refresh();
    terminal = (await inventory()).find((w) => w.id === opened.window_id);
    await gesture(terminal);
    evidence.steps.push({ action: 'same shell reopened', retained });
    await capture('shell-docked', terminal.id);
    evidence.steps.push({
      action: 'stop and remove shell',
      receipt: await rpc('remove', shell.id, '--stop'),
    });
    await delay(800);
    await refresh();
    park();
    placeAvatar();
    await delay(300);
    await nativeCommand(other.id, 'codex --dangerously-bypass-approvals-and-sandbox');
    await delay(2500);
    await nativeCommand(
      other.id,
      `Use the shell tool to write ready to '${stateDir}/other-codex-ready', then reply OTHERREADY.`,
    );
    await wait(
      () => fs.readFile(path.join(stateDir, 'other-codex-ready'), 'utf8').catch(() => ''),
      (v) => v === 'ready',
      'Unrelated Codex did not start',
      90000,
    );
    const otherCodex = await rpc('inspect-window', String(other.id));
    assert.equal(otherCodex.kind, 'codex');
    terminal = await openOrdinary();
    await fs.writeFile(
      path.join(stateDir, 'integration.sh'),
      `export PATH="${stateDir}/bin:$PATH"\n`,
    );
    await nativeCommand(terminal.id, 'source integration.sh');
    await nativeCommand(terminal.id, 'codex --dangerously-bypass-approvals-and-sandbox');
    await delay(2000);
    await wait(
      () => rpc('inspect-window', String(terminal.id)).catch(() => null),
      (r) => r?.kind === 'codex',
      'Installed Codex frontend unavailable',
      30000,
    );
    const initiallyEmpty = await gesture(terminal);
    evidence.steps.push({
      action: 'empty native Codex adopted before its first message',
      session_id: initiallyEmpty.id,
    });
    await undockGesture();
    await activate(terminal.id);
    await nativeCommand(
      terminal.id,
      `Use the shell tool to run: printf started > '${stateDir}/native-started'; sleep 30; printf retained > '${stateDir}/native-finished'. Then reply exactly NATIVEWORKPRESERVED.`,
    );
    await wait(
      () => fs.readFile(path.join(stateDir, 'native-started'), 'utf8').catch(() => ''),
      (v) => v === 'started',
      'Native task did not start',
      90000,
    );
    await input('\x1b[200~UNSENT_NATIVE_DRAFT 😀\nsecond line  \x1b[201~');
    await delay(300);
    await input('\x1b[D\x1b[D\x1b[D');
    await capture('draft-before', terminal.id);
    const agent = await gesture(terminal);
    assert.equal(agent.id, initiallyEmpty.id);
    await capture('draft-after', terminal.id);
    await assert.rejects(fs.access(path.join(stateDir, 'native-finished')));
    await wait(
      () => fs.readFile(path.join(stateDir, 'native-finished'), 'utf8').catch(() => ''),
      (v) => v === 'retained',
      'Native work did not survive adoption',
      45000,
    );
    await wait(
      () => rpc('events', '0'),
      (p) => p.events.some((e) => e.session_id === agent.id && e.type === 'turn.completed'),
      'Adopted native turn did not complete',
      60000,
    );
    await activate(terminal.id);
    await input('\x03');
    await delay(300);
    evidence.steps.push({ action: 'active native task and draft survived adoption' });
    const original = await rpc('attach-info', agent.id);
    const childCursor = (await rpc('events')).cursor;
    const child = await rpc(
      'launch',
      agent.id,
      'adopted-parent-worker',
      stateDir,
      'Reply exactly ADOPTEDPARENTWORKER',
    );
    assert.equal(child.parent_id, agent.id);
    await wait(
      () => rpc('events', String(childCursor)),
      (p) => p.events.some((e) => e.session_id === child.session_id && e.type === 'turn.completed'),
      'Worker launched from adopted parent did not complete',
      120000,
    );
    evidence.steps.push({ action: 'adopted parent launched real worker', receipt: child });
    await rpc('remove', child.session_id, '--stop');
    await activate(terminal.id);
    await refresh();
    await delay(500);

    await capture('codex-docked', terminal.id);
    await undockGesture();
    await delay(1500);
    const cursor = (await rpc('events')).cursor;
    const sent = await rpc(
      'send',
      agent.id,
      'adoption-native-task',
      `Run a shell command that writes started to '${stateDir}/close-started', sleeps for 30 seconds, then writes finished to '${stateDir}/close-finished'. Then reply exactly ADOPTIONCOMPLETE.`,
    );
    evidence.steps.push({ action: 'real task accepted', receipt: sent });
    await wait(
      () => fs.readFile(path.join(stateDir, 'close-started'), 'utf8').catch(() => ''),
      (v) => v === 'started',
      'Close task did not start',
      90000,
    );
    evidence.steps.push({
      action: 'background Codex during work',
      receipt: await rpc('background', agent.id),
    });
    await assert.rejects(fs.access(path.join(stateDir, 'close-finished')));
    assert(!(await inventory()).some((w) => w.id === terminal.id && w.pid === terminal.pid));
    const complete = await wait(
      () => rpc('events', String(cursor)),
      (p) =>
        p.events.some(
          (e) =>
            e.session_id === agent.id &&
            e.native_turn_id === sent.native_turn_id &&
            e.type === 'turn.completed',
        ),
      'Codex did not finish after native viewer close',
      120000,
    );
    assert(
      complete.events.some(
        (e) =>
          e.type === 'message' &&
          e.payload.role === 'assistant' &&
          e.payload.text.includes('ADOPTIONCOMPLETE'),
      ),
    );
    assert(complete.events.some((e) => e.type === 'message' && e.payload.role === 'user'));
    opened = await rpc('open', agent.id, 'ghostty');
    owned.set(opened.window_id, opened.pid);
    assert.equal((await rpc('attach-info', agent.id)).pid, original.pid);
    await refresh();
    terminal = (await inventory()).find((w) => w.id === opened.window_id);
    await gesture(terminal);
    assert.equal(getState().binding.session.id, agent.id);
    await capture('codex-reopened', opened.window_id);
    evidence.steps.push({
      action: 'Codex completion and same-session reopen',
      native_thread_id: agent.native_thread_id,
      events: complete.events,
      receipt: opened,
    });
    await nativeCommand(opened.window_id, '/new');
    await delay(1500);
    const staleCursor = (await rpc('events')).cursor;
    await assert.rejects(
      rpc('send', agent.id, 'stale-native-task', 'Reply exactly MUSTNOTSEND'),
      /native conversation changed/,
    );
    await assert.rejects(rpc('open', agent.id, 'ghostty'), /native conversation changed/);
    const afterSwitch = await rpc('events', String(staleCursor));
    assert(!afterSwitch.events.some((e) => e.type === 'turn.started' || e.type === 'message'));
    evidence.steps.push({
      action: 'native conversation switch refused instruction and open without dispatch',
    });
    await nativeCommand(opened.window_id, '/resume ' + agent.native_thread_id);
    await delay(2000);
    await rpc('open', agent.id, 'ghostty');
    await rpc('remove', agent.id);
    const removedCursor = (await rpc('events')).cursor;
    await nativeCommand(opened.window_id, 'Reply exactly REMOVEDPRIVATE');
    await delay(5000);
    assert(
      !(await rpc('events', String(removedCursor))).events.some(
        (e) => e.session_id === agent.id && e.type === 'message',
      ),
    );
    evidence.steps.push({
      action: 'remove ends capture; existing native runtime remains',
      receipt: await rpc('stop-instance', agent.id),
    });
    assert.deepEqual(await rpc('list'), []);
    assert.deepEqual(await rpc('inspect-window', String(other.id)), otherCodex);
    await nativeCommand(
      other.id,
      `Use the shell tool to write usable to '${stateDir}/other-codex-result', then reply OTHERUSABLE.`,
    );
    await wait(
      () => fs.readFile(path.join(stateDir, 'other-codex-result'), 'utf8').catch(() => ''),
      (v) => v === 'usable',
      'Unrelated Codex was affected',
      90000,
    );
    evidence.steps.push({
      action: 'unrelated Codex on shared daemon remained usable',
      identity: otherCodex,
    });
    await delay(2000);
    await nativeCommand(other.id, '/quit');
    await delay(1000);
    await fs.writeFile(path.join(stateDir, 'other-check.sh'), 'printf usable > other-result\n');
    await nativeCommand(other.id, 'source other-check.sh');
    await wait(
      () => fs.readFile(path.join(stateDir, 'other-result'), 'utf8').catch(() => ''),
      (v) => v === 'usable',
      'Known-different native terminal was affected',
    );
    evidence.steps.push({
      action: 'known-different terminal remained usable',
      original: otherIdentity,
    });
    await nativeCommand(other.id, 'exit');
    evidence.verdict = 'pass';
    evidence.limits = [
      'Linux x86_64 XWayland, one surface in the selected Ghostty process',
      'Unmodified Codex; supported native composer layout and local daemon connection',
      'No crash/reboot recovery',
    ];
    await save();
    pointer?.stdin.end();
    app.quit();
  } catch (error) {
    evidence.verdict = 'rework';
    evidence.error = error.stack;
    evidence.state = getState();
    evidence.pointer = screen.getCursorScreenPoint();
    evidence.avatar = avatarWin.getBounds();
    await capture('failure', avatarWin.getNativeWindowHandle().readUInt32LE()).catch(() => {});
    await save();
    await xt('mouseup', 1).catch(() => {});
    pointer?.stdin.end();
    app.quit();
  }
};
