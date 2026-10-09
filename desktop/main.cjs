const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { processIdentity, directChildren, resolveWindow, windowAt } = require('./binding.cjs');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');
const stateDir = process.env.VOYAGER_STATE;
if (!stateDir || !path.isAbsolute(stateDir))
  throw Error('Set VOYAGER_STATE to the existing private service directory');
const binary = path.join(root, 'target/debug/voyager');
const probe = path.join(root, 'target/debug/voyager-windows');
// The first platform adapter is explicitly XWayland; native Wayland needs GNOME.
app.commandLine.appendSwitch('ozone-platform', 'x11');
app.setPath('userData', path.join(stateDir, 'desktop-profile'));
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

let win,
  timer,
  dragTimer,
  expanded = false,
  dragging = null,
  binding = null;
let sessions = [],
  events = [],
  cursor = 0,
  selected = null,
  windows = [],
  records = [];
let service = null,
  serviceError = 'Connecting…',
  platformError = null,
  notice = 'Click for sessions · drag to dock';
let busy = false,
  opening = false;

async function rpc(...args) {
  const result = await exec(binary, ['--state', stateDir, ...args], {
    timeout: 23000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(result.stdout);
}
async function inventory() {
  const { stdout } = await exec(probe, [], { timeout: 2000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout).windows;
}
async function identities() {
  const result = new Map();
  for (const pid of new Set(records.flatMap((r) => [r.pid, r.frontend.pid]))) {
    try {
      result.set(pid, await processIdentity(pid));
    } catch {
      /* exited client */
    }
  }
  return result;
}
function sendState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', {
    expanded,
    dragging: Boolean(dragging?.moved),
    docked: binding?.session.id ?? null,
    sessions: sessions.map(({ id, native_thread_id, cwd, ownership, capture, worker_state }) => ({
      id,
      native_thread_id,
      cwd,
      ownership,
      capture,
      worker_state,
    })),
    events: events.filter((e) => e.session_id === selected).slice(-16),
    service,
    serviceError,
    platformError,
    notice,
    selected,
    opening,
    targets: windows
      .filter((w) => w.visible && records.some((r) => r.pid === w.pid))
      .map((w) => ({ id: w.id, title: w.title })),
  });
}
function avatarPosition() {
  const b = win.getBounds();
  return { x: b.x + b.width - 144, y: b.y + 8 };
}
function placeAvatar(x, y) {
  const area = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  const width = expanded ? 390 : 144,
    height = expanded ? 580 : 144;
  const left = Math.max(area.x, Math.min(area.x + area.width - width, x - width + 144));
  const top = Math.max(area.y, Math.min(area.y + area.height - height, y - 8));
  win.setBounds({ x: Math.round(left), y: Math.round(top), width, height });
}
function setExpanded(value) {
  const p = avatarPosition();
  expanded = value;
  placeAvatar(p.x, p.y);
  sendState();
}
function park() {
  const area = screen.getPrimaryDisplay().workArea;
  expanded = false;
  placeAvatar(area.x + area.width - 166, area.y + 28);
  sendState();
}
function undock(message = 'Undocked · service and agents keep running') {
  binding = null;
  notice = message;
  sendState();
}
async function dock(id) {
  if (serviceError || platformError) throw Error(serviceError || platformError);
  windows = await inventory();
  // Fresh service acknowledgement and fresh process/window identities before joining.
  sessions = await rpc('list');
  const result = resolveWindow(
    windows.find((w) => w.id === id),
    windows,
    records,
    sessions,
    await identities(),
  );
  if (result.error) {
    undock(result.error);
    setExpanded(true);
    return false;
  }
  binding = result;
  selected = result.session.id;
  notice = 'Docked to the window opened for this worker';
  follow();
  sendState();
  return true;
}
function follow() {
  if (!binding || dragging) return;
  const w = binding.window;
  const anchor = screen.screenToDipPoint({
    x: w.x + w.width,
    y: Math.round(w.y + w.height * 0.65),
  });
  placeAvatar(anchor.x - 144, anchor.y - 64);
}
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const [nextService, nextSessions, page] = await Promise.all([
      rpc('status'),
      rpc('list'),
      rpc('events', String(cursor)),
    ]);
    service = nextService;
    sessions = nextSessions;
    serviceError = null;
    events = [...events, ...page.events].slice(-400);
    cursor = page.cursor;
    if (!selected)
      selected = sessions.find((s) => s.ownership === 'managed')?.id ?? sessions[0]?.id ?? null;
  } catch {
    serviceError = 'Service unreachable · displayed sessions may be stale';
  }
  try {
    windows = await inventory();
    platformError = null;
  } catch {
    windows = [];
    platformError = 'Window connection unavailable · this demo requires XWayland';
  }
  if (binding) {
    const result = resolveWindow(
      windows.find((w) => w.id === binding.window.id),
      windows,
      records,
      sessions,
      await identities(),
    );
    if (result.error || serviceError) undock(result.error || serviceError);
    else {
      binding = result;
      follow();
    }
  }
  busy = false;
  sendState();
}
async function openTerminal(sessionId) {
  if (opening) throw Error('A terminal is already opening');
  if (!sessions.some((s) => s.id === sessionId && s.ownership === 'managed'))
    throw Error('This first demo opens only Voyager-managed worker terminals');
  opening = true;
  sendState();
  try {
    const info = await rpc('attach-info', sessionId);
    const child = spawn(
      '/usr/bin/ghostty',
      [
        '--gtk-single-instance=false',
        '--title=Voyager terminal',
        '-e',
        binary,
        '--state',
        stateDir,
        'attach',
        sessionId,
      ],
      { env: { ...process.env, GDK_BACKEND: 'x11' }, detached: true, stdio: 'ignore' },
    );
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    const terminal = await processIdentity(child.pid);
    // Bind only the direct native child created by our exact attach command.
    // Neither title nor a nearest-ancestor guess is used.
    for (let n = 0; n < 60; n++) {
      const children = await directChildren(child.pid);
      for (const pid of children) {
        let frontend;
        try {
          frontend = await processIdentity(pid);
        } catch {
          continue;
        }
        if (
          frontend.argv[0] !== info.executable ||
          JSON.stringify(frontend.argv.slice(1)) !== JSON.stringify(info.args)
        )
          continue;
        records.push({ ...terminal, frontend, sessionId, nativeId: info.native_thread_id });
        selected = sessionId;
        notice = 'Terminal ready · drag the avatar onto it';
        return { terminalPid: child.pid, frontendPid: pid, sessionId };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error('Opened terminal could not be verified; it remains unbound');
  } finally {
    opening = false;
    sendState();
  }
}

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  win = new BrowserWindow({
    width: 144,
    height: 144,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_web, _permission, callback) =>
    callback(false),
  );
  const handle = (name, fn) =>
    ipcMain.handle(name, async (event, ...args) => {
      if (event.senderFrame !== win.webContents.mainFrame) throw Error('Unknown caller');
      try {
        return await fn(...args);
      } catch (error) {
        notice = error.message;
        sendState();
        return { error: error.message };
      }
    });
  handle('toggle', () => setExpanded(!expanded));
  handle('ready', sendState);
  handle('undock', () => undock());
  handle('select', (id) => {
    if (!sessions.some((s) => s.id === id)) throw Error('Unknown session');
    selected = id;
    sendState();
  });
  handle('open-terminal', openTerminal);
  handle('dock', (id) => dock(Number(id)));
  handle('quit-ui', () => app.quit());
  handle('begin-drag', (x, y) => {
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > 144 || y > 144)
      throw Error('Invalid drag');
    dragging = {
      x,
      y,
      start: screen.getCursorScreenPoint(),
      moved: false,
      original: avatarPosition(),
      binding,
      expanded,
    };
  });
  handle('cancel-drag', () => {
    if (!dragging) return;
    const previous = dragging;
    dragging = null;
    expanded = previous.expanded;
    binding = previous.binding;
    placeAvatar(previous.original.x, previous.original.y);
    sendState();
  });
  handle('end-drag', async () => {
    if (!dragging) return;
    const moved = dragging.moved;
    dragging = null;
    if (!moved) {
      setExpanded(!expanded);
      return;
    }
    const point = screen.dipToScreenPoint(screen.getCursorScreenPoint());
    windows = await inventory();
    const target = windowAt(windows, point, process.pid);
    if (target) await dock(target.id);
    else {
      undock('No supported window here · work continues');
    }
    sendState();
  });
  await win.loadFile(path.join(__dirname, 'index.html'));
  park();
  win.showInactive();
  await refresh();
  timer = setInterval(refresh, 750);
  dragTimer = setInterval(() => {
    if (!dragging) return;
    const p = screen.getCursorScreenPoint();
    if (!dragging.moved && Math.hypot(p.x - dragging.start.x, p.y - dragging.start.y) > 7) {
      dragging.moved = true;
      binding = null;
      expanded = false;
      notice = 'Release over a verified terminal';
      sendState();
    }
    if (dragging.moved) placeAvatar(p.x - dragging.x, p.y - dragging.y);
  }, 32);
  // The opt-in local proof drives the same main/renderer operations, not a mock service.
  if (process.argv.includes('--proof')) {
    require('./test/live-proof.cjs')
      .run({
        win,
        rpc,
        refresh,
        openTerminal,
        dock,
        undock,
        setExpanded,
        park,
        getState: () => ({ sessions, events, cursor, windows, records, binding, serviceError }),
        stateDir,
      })
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
        app.quit();
      });
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  clearInterval(timer);
  clearInterval(dragTimer);
});
