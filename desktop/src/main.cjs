const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { createWhiteboard } = require('./whiteboard.cjs');
const { setTimeout: delay } = require('node:timers/promises');
const { processIdentity, identifyTerminal, resolveWindow, windowAt } = require('./binding.cjs');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
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
const whiteboardProof = process.argv.includes('--whiteboard-proof');
app.setPath(
  'userData',
  path.join(
    stateDir,
    whiteboardProof ? 'desktop-whiteboard-proof-profile' : 'desktop-whiteboard-glass-profile',
  ),
);
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

let avatarWin,
  panelWin,
  timer,
  dragTimer,
  expanded = false,
  seated = false,
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
let whiteboard,
  whiteboardState = null,
  whiteboardExpanded = false;

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
  const state = {
    expanded,
    whiteboard: whiteboardState,
    whiteboardExpanded,
    seated,
    dragging: Boolean(dragging && (dragging.held || dragging.moved)),
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
  };
  for (const client of [avatarWin, panelWin]) {
    if (client && !client.isDestroyed()) client.webContents.send('state', state);
  }
}
function avatarPosition() {
  const b = avatarWin.getBounds();
  return { x: b.x + margin, y: b.y + margin };
}
function setBoundsIfChanged(client, bounds) {
  const previous = client.getBounds();
  if (Object.keys(bounds).some((key) => previous[key] !== bounds[key])) client.setBounds(bounds);
}
function placePanel() {
  if (whiteboardState?.active) return;
  const p = avatarPosition();
  const area = screen.getDisplayNearestPoint(p).workArea;
  const width = 320;
  const height = Math.min(
    area.height,
    252 +
      Math.max(1, sessions.length) * 44 +
      (binding ? 38 : 0) +
      44 +
      (whiteboardExpanded ? 110 : 0),
  );
  const x = Math.round(Math.max(area.x, Math.min(area.x + area.width - width, p.x - 108)));
  const y = Math.round(Math.max(area.y, Math.min(area.y + area.height - height, p.y - 44)));
  setBoundsIfChanged(panelWin, { x, y, width, height });
  // Keep the astronaut in its seat if the panel was clamped at a display edge.
  setBoundsIfChanged(avatarWin, { x: x + 100, y: y + 36 });
}
function placeAvatar(x, y) {
  const area = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  setBoundsIfChanged(avatarWin, {
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - collapsedSize, x - margin))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - collapsedSize, y - margin))),
  });
  if (expanded && seated) placePanel();
}
function setSeated(value) {
  seated = value;
  // Let the window manager keep the seated astronaut above its panel, even
  // when selecting a row raises the panel. Detaching restores a top-level window.
  if (!value || panelWin.isVisible()) avatarWin.setParentWindow(value ? panelWin : null);
}
async function setExpanded(value) {
  if (!value) whiteboard?.command({ action: 'hide' });
  expanded = value;
  if (value) {
    setSeated(true);
    placePanel();
    sendState();
    panelWin.showInactive();
    avatarWin.moveTop();
    // A show request is not a compositor acknowledgement. Wait for this exact
    // window in the managed X11 stack before assigning a transient parent.
    const id = panelWin.getNativeWindowHandle().readUInt32LE();
    const deadline = performance.now() + 2000;
    while (expanded && seated) {
      const mapped = (await inventory()).some((window) => window.id === id && window.visible);
      // A hide or pull can arrive while the native inventory is in flight.
      if (!expanded || !seated) return;
      if (mapped) {
        avatarWin.setParentWindow(panelWin);
        return;
      }
      if (performance.now() >= deadline) throw Error('The desktop did not show the panel');
      await delay(25);
    }
  } else {
    setSeated(false);
    panelWin.hide();
    sendState();
  }
}
function park() {
  const area = screen.getPrimaryDisplay().workArea;
  setExpanded(false);
  placeAvatar(area.x + area.width - avatarSize - 24, area.y + 28);
}
function advanceDrag(p, now = performance.now()) {
  if (!dragging) return;
  if (!dragging.held && now - dragging.startedAt >= 350) {
    dragging.held = true;
    sendState();
  }
  if (!dragging.moved && Math.hypot(p.x - dragging.start.x, p.y - dragging.start.y) > 7) {
    whiteboard?.command({ action: 'hide' });
    dragging.moved = true;
    const wasAttached = seated || Boolean(binding);
    setSeated(false);
    binding = null;
    dockError = '';
    sendState();
    if (wasAttached) avatarWin.webContents.send('dock-sound', 'undock');
  }
  if (dragging.moved) placeAvatar(p.x - dragging.x, p.y - dragging.y);
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
    return false;
  }
  const joined = binding?.window.id !== result.window.id;
  binding = result;
  selected = result.session.id;
  dockError = '';
  follow();
  sendState();
  if (joined) avatarWin.webContents.send('dock-sound', 'dock');
  return true;
}
function follow() {
  if (!binding || dragging || whiteboardState?.active) return;
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
  if (expanded && seated && !dragging) placePanel();
  sendState();
}
function createWindow(width, height) {
  const client = new BrowserWindow({
    width,
    height,
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
  client.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  client.webContents.on('will-navigate', (event) => event.preventDefault());
  client.webContents.session.setPermissionRequestHandler((_web, _permission, callback) =>
    callback(false),
  );
  client.on('closed', () => app.quit());
  return client;
}
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  panelWin = createWindow(320, 372);
  avatarWin = createWindow(collapsedSize, collapsedSize);
  panelWin.on('move', () => {
    if (!expanded || !seated || dragging || whiteboardState?.active) return;
    const panel = panelWin.getBounds();
    setBoundsIfChanged(avatarWin, { x: panel.x + 100, y: panel.y + 36 });
  });
  whiteboard = createWhiteboard(
    panelWin,
    (bounds, active) => {
      const avatarBounds = avatarWin.getBounds();
      avatarWin.setParentWindow(null);
      panelWin.setBounds(bounds);
      avatarWin.setBounds(avatarBounds);
      avatarWin.setParentWindow(active || seated ? panelWin : null);
    },
    (value) => {
      whiteboardState = value;
      sendState();
    },
  );
  const handle = (name, clients, fn) =>
    ipcMain.handle(name, async (event, ...args) => {
      if (!clients.some((client) => event.senderFrame === client.webContents.mainFrame))
        throw Error('Unknown caller');
      try {
        return await fn(...args);
      } catch (error) {
        dockError = 'Couldn’t connect to this terminal.';
        sendState();
        return { error: error.message };
      }
    });
  handle('toggle', [avatarWin], () => setExpanded(!expanded));
  handle('whiteboard', [panelWin], (message) => whiteboard.command(message));
  handle('whiteboard-expand', [panelWin], (value) => {
    if (typeof value !== 'boolean') throw Error('Invalid whiteboard expansion');
    if (!value) whiteboard.command({ action: 'hide' });
    whiteboardExpanded = value;
    placePanel();
    sendState();
  });
  handle('ready', [avatarWin, panelWin], sendState);
  handle('undock', [panelWin], () => undock());
  handle('select', [panelWin], (id) => {
    if (!sessions.some((s) => s.id === id)) throw Error('Unknown session');
    selected = id;
    sendState();
  });
  handle('quit-ui', [panelWin], () => app.quit());
  handle('begin-drag', [avatarWin], (x, y) => {
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > avatarSize || y > avatarSize)
      throw Error('Invalid drag');
    whiteboard.command({ action: 'hide' });
    dragging = {
      x,
      y,
      start: screen.getCursorScreenPoint(),
      startedAt: performance.now(),
      held: false,
      moved: false,
      original: avatarPosition(),
      binding,
      seated,
    };
  });
  handle('cancel-drag', [avatarWin], () => {
    if (!dragging) return;
    const previous = dragging;
    dragging = null;
    setSeated(previous.seated);
    binding = previous.binding;
    placeAvatar(previous.original.x, previous.original.y);
    sendState();
    if (previous.moved && (previous.seated || previous.binding))
      avatarWin.webContents.send('dock-sound', 'dock');
  });
  handle('end-drag', [avatarWin], async () => {
    if (!dragging) return;
    const { held, moved } = dragging;
    dragging = null;
    if (!held && !moved) {
      await setExpanded(!expanded);
      return;
    }
    // A stationary hold leaves the panel and attachment exactly as they were.
    if (!moved) {
      sendState();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const panel = panelWin.getBounds();
    if (
      expanded &&
      cursor.x >= panel.x &&
      cursor.x < panel.x + panel.width &&
      cursor.y >= panel.y &&
      cursor.y < panel.y + panel.height
    ) {
      setSeated(true);
      placeAvatar(panel.x + 108, panel.y + 44);
      sendState();
      avatarWin.webContents.send('dock-sound', 'dock');
      return;
    }
    const point = screen.dipToScreenPoint(cursor);
    windows = await inventory();
    const target = windowAt(windows, point, process.pid);
    if (target) await dock(target.id);
    else {
      undock();
    }
    sendState();
  });
  await Promise.all([
    panelWin.loadFile(path.join(__dirname, 'ui/index.html'), { query: { view: 'panel' } }),
    avatarWin.loadFile(path.join(__dirname, 'ui/index.html'), { query: { view: 'avatar' } }),
  ]);
  park();
  avatarWin.showInactive();
  await refresh();
  if (process.argv.includes('--expanded')) await setExpanded(true);
  timer = setInterval(refresh, 750);
  dragTimer = setInterval(() => advanceDrag(screen.getCursorScreenPoint()), 32);
  if (whiteboardProof) {
    require('../test/whiteboard-proof.cjs')
      .run({
        win: panelWin,
        avatarWin,
        whiteboard,
        setExpanded,
        rpc,
        inventory,
      })
      .then(() => app.quit())
      .catch((error) => {
        console.error(error);
        app.exit(1);
      });
  }
  // The opt-in local proof drives the same main/renderer operations, not a mock service.
  if (process.argv.includes('--proof')) {
    require('../test/live-proof.cjs')
      .run({
        avatarWin,
        panelWin,
        advanceDrag,
        rpc,
        refresh,
        inventory,
        dock,
        undock,
        setExpanded,
        park,
        getState: () => ({
          sessions,
          windows,
          records,
          binding,
          serviceError,
          expanded,
          seated,
          dragging,
        }),
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
