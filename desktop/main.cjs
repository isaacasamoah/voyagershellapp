const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { processIdentity, identifyTerminal, resolveWindow, windowAt } = require('./binding.cjs');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');
const stateDir = process.env.VOYAGER_STATE;
if (!stateDir || !path.isAbsolute(stateDir))
  throw Error('Set VOYAGER_STATE to the existing private service directory');
const binary = path.join(root, 'target/debug/voyager');
const probe = path.join(root, 'target/debug/voyager-windows');
const avatarSize = 104,
  margin = 8,
  collapsedSize = avatarSize + margin * 2;
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
  selected = null,
  windows = [],
  records = [];
let service = null,
  serviceError = 'Connecting…',
  platformError = null,
  dockError = '';
let busy = false;

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
async function discoverTerminals() {
  const found = [];
  for (const session of sessions.filter(
    (s) => s.ownership === 'managed' && s.capture === 'connected' && s.worker_state === 'running',
  )) {
    const info = await rpc('attach-info', session.id);
    for (const pid of new Set(windows.map((w) => w.pid))) {
      try {
        const record = await identifyTerminal(pid, session.id, info);
        if (record) found.push(record);
      } catch {
        /* Window or native client exited during inventory. */
      }
    }
  }
  records = found;
}
function sendState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', {
    expanded,
    dragging: Boolean(dragging?.moved),
    docked: binding?.session.id ?? null,
    sessions: sessions.map(({ id, cwd, ownership, capture, worker_state }) => ({
      id,
      cwd,
      ownership,
      capture,
      worker_state,
    })),
    service,
    serviceError,
    platformError,
    dockError,
    selected,
  });
}
function avatarPosition() {
  const b = win.getBounds();
  return { x: b.x + (b.width - avatarSize) / 2, y: b.y + avatarTop() };
}
function avatarTop() {
  return expanded ? 44 : margin;
}
function placeAvatar(x, y) {
  const area = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  const width = expanded ? 320 : collapsedSize,
    height = expanded
      ? Math.min(area.height, 252 + Math.max(1, sessions.length) * 60 + (binding ? 38 : 0))
      : collapsedSize;
  const left = Math.max(
    area.x,
    Math.min(area.x + area.width - width, x - (width - avatarSize) / 2),
  );
  const top = Math.max(area.y, Math.min(area.y + area.height - height, y - avatarTop()));
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
  placeAvatar(area.x + area.width - avatarSize - 24, area.y + 28);
  sendState();
}
function undock(message = '') {
  binding = null;
  dockError = message;
  sendState();
}
async function dock(id) {
  if (serviceError || platformError) throw Error(serviceError || platformError);
  windows = await inventory();
  // Fresh service acknowledgement and fresh process/window identities before joining.
  sessions = await rpc('list');
  await discoverTerminals();
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
  dockError = '';
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
  placeAvatar(anchor.x - avatarSize - margin, anchor.y - avatarSize / 2);
}
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const [nextService, nextSessions] = await Promise.all([rpc('status'), rpc('list')]);
    service = nextService;
    sessions = nextSessions;
    serviceError = null;
    if (!selected)
      selected = sessions.find((s) => s.ownership === 'managed')?.id ?? sessions[0]?.id ?? null;
  } catch {
    serviceError = 'Voyager is offline. Your agents may still be running.';
  }
  try {
    windows = await inventory();
    if (!serviceError) await discoverTerminals();
    else records = [];
    platformError = null;
  } catch {
    windows = [];
    platformError = 'Docking isn’t available on this desktop right now.';
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
  if (expanded && !dragging) {
    const p = avatarPosition();
    placeAvatar(p.x, p.y);
  }
  sendState();
}
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  win = new BrowserWindow({
    width: collapsedSize,
    height: collapsedSize,
    frame: false,
    transparent: true,
    hasShadow: false,
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
        dockError = 'Couldn’t connect to this terminal.';
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
  handle('quit-ui', () => app.quit());
  handle('begin-drag', (x, y) => {
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > avatarSize || y > avatarSize)
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
      undock();
    }
    sendState();
  });
  await win.loadFile(path.join(__dirname, 'index.html'));
  park();
  win.showInactive();
  await refresh();
  if (process.argv.includes('--expanded')) setExpanded(true);
  timer = setInterval(refresh, 750);
  dragTimer = setInterval(() => {
    if (!dragging) return;
    const p = screen.getCursorScreenPoint();
    if (!dragging.moved && Math.hypot(p.x - dragging.start.x, p.y - dragging.start.y) > 7) {
      dragging.moved = true;
      binding = null;
      expanded = false;
      dockError = '';
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
        dock,
        undock,
        setExpanded,
        park,
        getState: () => ({ sessions, windows, records, binding, serviceError }),
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
