const { app, BrowserWindow, ipcMain, screen, globalShortcut, dialog } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { connectControl } = require('./control.cjs');
const { conversationClient } = require('./conversation.cjs');
const { authorityActions } = require('./authority.cjs');
const { vesselPlan } = require('./layout.cjs');
const hierarchy = require('./ui/hierarchy.js');
const { fleetActions } = require('./fleets.cjs');
const { setTimeout: delay } = require('node:timers/promises');
const {
  processIdentity,
  identifyTerminal,
  resolveWindow,
  registeredSession,
  windowAt,
} = require('./binding.cjs');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const stateDir =
  process.env.VOYAGER_STATE || path.join(require('node:os').homedir(), '.local/share/voyagershell');
if (!stateDir || !path.isAbsolute(stateDir))
  throw Error('Set VOYAGER_STATE to the existing private service directory');
const binary = path.join(root, 'target/debug/voyager');
const probe = path.join(root, 'target/debug/voyager-windows');
const avatarSize = 104,
  margin = 8,
  collapsedSize = avatarSize + margin * 2;
app.commandLine.appendSwitch('ozone-platform', 'x11');
app.setPath('userData', path.join(stateDir, 'desktop-profile'));
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

let avatarWin,
  panelWin,
  candidateWin,
  timer,
  dragTimer,
  expanded = false,
  seated = false,
  dragging = null,
  binding = null;
const fleets = fleetActions(rpc);
let fleetData = { fleets: [], assignments: {} },
  fleetError = null,
  measuredPanelHeight = 372;
let sessions = [],
  selected = null,
  windows = [],
  records = [];
let service = null,
  serviceError = 'Connecting…',
  platformError = null,
  dockError = '';
let busy = false;
const createInstance = require('./instances.cjs').instanceCreator(rpc);
const authorityActionsForInstance = authorityActions(rpc, () => sessions);
let dockGeneration = 0;
let controlConnection = null;
const conversation = conversationClient(stateDir, (value) => {
  for (const client of [avatarWin, panelWin]) {
    if (client && !client.isDestroyed()) client.webContents.send('conversation', value);
  }
});
let conversationTimer;
let layer = '';
let dockHovered = false,
  panelHovered = false,
  hoverBusy = false,
  lastHoverProbe = 0;

async function rpc(...args) {
  try {
    const result = await exec(binary, ['--state', stateDir, ...args], {
      timeout: 23000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(result.stdout);
  } catch (error) {
    throw Error(
      error.stderr
        ?.trim()
        .replace(/^Error: /, '')
        .replace(/ \(operation [^)]+\)$/, '') || 'Voyager did not respond.',
    );
  }
}
async function inventory() {
  return (await desktopSnapshot()).windows;
}
async function desktopSnapshot() {
  const { stdout } = await exec(probe, [], { timeout: 2000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}
async function identities() {
  const result = new Map();
  for (const pid of new Set(records.flatMap((r) => [r.pid, r.frontend.pid]))) {
    try {
      result.set(pid, await processIdentity(pid));
    } catch {}
  }
  return result;
}
async function discoverTerminals() {
  const endpoints = [];
  if (service?.codex_connected) {
    const info = await rpc('connection-info');
    endpoints.push({
      server: info.server,
      executable: await fs.realpath(info.executable),
      external: true,
    });
  }
  for (const session of sessions.filter(
    (s) => s.ownership === 'managed' && s.capture === 'connected' && s.worker_state === 'running',
  )) {
    const info = await rpc('attach-info', session.id);
    endpoints.push({
      server: session.server,
      executable: await fs.realpath(info.executable),
      external: false,
      kind: session.kind,
      nativeId: session.native_thread_id,
      args: info.args,
    });
  }
  const found = [];
  for (const endpoint of endpoints) {
    for (const pid of new Set(windows.map((w) => w.pid))) {
      try {
        const record = await identifyTerminal(pid, endpoint);
        if (record) found.push(record);
      } catch {}
    }
  }
  records = found;
}
function windowBehindAvatar(stack, point) {
  const overlays = [avatarWin, candidateWin].map((w) => w.getNativeWindowHandle().readUInt32LE());
  return windowAt(stack, point, overlays);
}
function syncLayer() {
  const terminal = Boolean(binding && !seated && !dragging);
  const next = terminal ? (dockHovered ? 'hover' : 'passive') : 'floating';
  if (next === layer) return;
  const wasTerminal = layer === 'hover' || layer === 'passive';
  layer = next;
  avatarWin.setIgnoreMouseEvents(terminal && !dockHovered);
  if (terminal !== wasTerminal) {
    avatarWin.setFocusable(!terminal);
    avatarWin.setAlwaysOnTop(!terminal);
  }
  if (!terminal && !avatarWin.isVisible()) avatarWin.showInactive();
}
async function placeAboveTerminal() {
  if (layer === 'floating' || !binding) return;
  const target = binding.window.id;
  const generation = dockGeneration;
  const avatar = avatarWin.getNativeWindowHandle().readUInt32LE();
  let stack = await inventory();
  if (generation !== dockGeneration || layer === 'floating' || binding?.window.id !== target)
    return;
  const p = avatarPosition();
  const center = screen.dipToScreenPoint({ x: p.x + avatarSize / 2, y: p.y + avatarSize / 2 });
  if (windowBehindAvatar(stack, center)?.id !== target) {
    avatarWin.hide();
    setDockHovered(false);
    return;
  }
  if (!avatarWin.isVisible()) avatarWin.showInactive();
  const a = stack.findIndex((w) => w.id === avatar),
    t = stack.findIndex((w) => w.id === target);
  if (t >= 0 && a > t) return;
  await exec(probe, ['above', String(avatar), String(target)], { timeout: 2000 });
  const deadline = performance.now() + 1000;
  while (layer !== 'floating' && binding?.window.id === target) {
    stack = await inventory();
    const a = stack.findIndex((w) => w.id === avatar),
      t = stack.findIndex((w) => w.id === target);
    if (t >= 0 && a > t) return;
    if (performance.now() >= deadline)
      throw Error(`The desktop did not place the docked marker (avatar ${a}, terminal ${t})`);
    await delay(25);
  }
}
function sendState() {
  syncLayer();
  const state = {
    expanded,
    seated,
    dockHovered,
    panelHovered,
    dragging: Boolean(dragging && (dragging.held || dragging.moved)),
    docked: binding?.session.id ?? null,
    sessions: sessions.map(
      ({
        id,
        name,
        kind,
        cwd,
        ownership,
        capture,
        worker_state,
        removed_ms,
        rank,
        supervisor_id,
        registered_ms,
      }) => ({
        id,
        name,
        kind,
        cwd,
        ownership,
        capture,
        worker_state,
        removed_ms,
        rank,
        supervisor_id,
        registered_ms,
      }),
    ),
    service,
    fleetData,
    fleetError,
    serviceError,
    platformError,
    dockError,
    selected,
    defaultDirectory: require('node:os').homedir(),
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
  const p = avatarPosition();
  const area = screen.getDisplayNearestPoint(p).workArea;
  const width = 320;
  const height = Math.min(area.height, panelHeight());
  const x = Math.round(Math.max(area.x, Math.min(area.x + area.width - width, p.x - 108)));
  const y = Math.round(Math.max(area.y, Math.min(area.y + area.height - height, p.y - 44)));
  setBoundsIfChanged(panelWin, { x, y, width, height });
  setBoundsIfChanged(avatarWin, { x: x + 100, y: y + 36 });
}
function panelHeight() {
  return measuredPanelHeight;
}
function resizePanel() {
  const previous = panelWin.getBounds();
  const area = screen.getDisplayMatching(previous).workArea;
  const height = Math.min(area.height, panelHeight());
  const width = 320;
  setBoundsIfChanged(panelWin, {
    x: Math.max(area.x, Math.min(previous.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(previous.y, area.y + area.height - height)),
    width,
    height,
  });
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
  if (!value || panelWin.isVisible()) avatarWin.setParentWindow(value ? panelWin : null);
}
async function setExpanded(value) {
  expanded = value;
  if (value) {
    if (binding) {
      sendState();
      panelWin.showInactive();
      return;
    }
    setSeated(true);
    placePanel();
    sendState();
    panelWin.showInactive();
    avatarWin.moveTop();
    const id = panelWin.getNativeWindowHandle().readUInt32LE();
    const deadline = performance.now() + 2000;
    while (expanded && seated) {
      const mapped = (await inventory()).some((window) => window.id === id && window.visible);
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
  placePanel();
}
function overAvatar(point) {
  const p = avatarPosition();
  return (
    Math.hypot(point.x - p.x - avatarSize / 2, point.y - p.y - avatarSize / 2) < avatarSize / 2
  );
}
function setDockHovered(value) {
  if (dockHovered === value) return;
  dockHovered = value;
  sendState();
}
function updateDockHover(snapshot) {
  const point = screen.screenToDipPoint(snapshot.pointer);
  const top = windowBehindAvatar(snapshot.windows, screen.dipToScreenPoint(point));
  setDockHovered(
    Boolean(
      binding &&
      !seated &&
      !dragging &&
      overAvatar(point) &&
      snapshot.pointer.buttons === 0 &&
      top?.id === binding.window.id,
    ),
  );
}
function updatePointer() {
  advanceDrag(screen.getCursorScreenPoint());
  if (!binding || seated || dragging) setDockHovered(false);
  if ((!binding && !expanded) || hoverBusy || performance.now() - lastHoverProbe < 100) return;
  hoverBusy = true;
  lastHoverProbe = performance.now();
  desktopSnapshot()
    .then((snapshot) => {
      const point = screen.screenToDipPoint(snapshot.pointer);
      const panel = panelWin.getBounds();
      const overPanel =
        expanded &&
        windowBehindAvatar(snapshot.windows, snapshot.pointer)?.id ===
          panelWin.getNativeWindowHandle().readUInt32LE() &&
        point.x >= panel.x + margin &&
        point.x < panel.x + panel.width - margin &&
        point.y >= panel.y + margin &&
        point.y < panel.y + panel.height - margin;
      if (panelHovered !== overPanel) {
        panelHovered = overPanel;
        sendState();
      }
      if (!dragging) updateDockHover(snapshot);
    })
    .catch(() => setDockHovered(false))
    .finally(() => {
      hoverBusy = false;
    });
}
function advanceDrag(p, now = performance.now()) {
  if (!dragging) return;
  if (!dragging.held && now - dragging.startedAt >= 350) {
    dragging.held = true;
    sendState();
  }
  if (!dragging.moved && Math.hypot(p.x - dragging.start.x, p.y - dragging.start.y) > 7) {
    dragging.moved = true;
    const wasAttached = seated || Boolean(binding);
    setSeated(false);
    undock();
    if (wasAttached) avatarWin.webContents.send('dock-sound', 'undock');
  }
  if (dragging.moved) {
    placeAvatar(p.x - dragging.x, p.y - dragging.y);
    const target = windowBehindAvatar(windows, screen.dipToScreenPoint(p));
    if (
      target &&
      records.filter((r) => r.pid === target.pid).length === 1 &&
      windows.filter((w) => w.pid === target.pid).length === 1
    ) {
      const top = screen.screenToDipPoint({ x: target.x, y: target.y });
      const bottom = screen.screenToDipPoint({
        x: target.x + target.width,
        y: target.y + target.height,
      });
      setBoundsIfChanged(candidateWin, {
        x: top.x,
        y: top.y,
        width: bottom.x - top.x,
        height: bottom.y - top.y,
      });
      if (!candidateWin.isVisible()) candidateWin.showInactive();
    } else candidateWin.hide();
  }
}
function undock(message = '') {
  dockGeneration++;
  const previous = controlConnection;
  controlConnection = null;
  if (previous && service?.control?.generation === previous.attachment.generation)
    service = { ...service, control: null };
  if (previous) releaseControl(previous);
  binding = null;
  dockHovered = false;
  dockError = message;
  sendState();
}
async function releaseControl(connection) {
  try {
    await rpc('undock', connection.attachment.generation);
  } catch (error) {
    console.error(`Control release: ${error.message}`);
  } finally {
    connection.close();
  }
}
async function dock(id) {
  if (serviceError || platformError) throw Error(serviceError || platformError);
  if (binding) undock();
  const generation = ++dockGeneration;
  windows = await inventory();
  sessions = await rpc('list', '--include-removed');
  await discoverTerminals();
  const target = resolveWindow(
    windows.find((w) => w.id === id),
    windows,
    records,
    await identities(),
  );
  if (target.error) {
    undock(target.error);
    return false;
  }
  if (target.record.external) await rpc('register', target.record.nativeId);
  sessions = await rpc('list', '--include-removed');
  windows = await inventory();
  const fresh = resolveWindow(
    windows.find((w) => w.id === id),
    windows,
    [target.record],
    await identities(),
  );
  if (generation !== dockGeneration) return false;
  if (fresh.error) {
    undock(fresh.error);
    return false;
  }
  const session = registeredSession(fresh.record, sessions);
  if (!session || session.capture !== 'connected') {
    undock('This agent is disconnected.');
    return false;
  }
  const identity = ({ pid, start }) => ({ pid, start });
  const connection = await connectControl(
    stateDir,
    {
      generation: randomUUID(),
      session_id: session.id,
      window_id: fresh.window.id,
      terminal: identity(fresh.record),
      frontend: identity(fresh.record.frontend),
    },
    () => {
      if (controlConnection === connection) undock('Control attachment ended.');
    },
  );
  if (generation !== dockGeneration) {
    await releaseControl(connection);
    return false;
  }
  controlConnection = connection;
  service = { ...service, control: connection.attachment, voice: connection.voice };
  binding = { ...fresh, session };
  dockHovered = false;
  selected = session.id;
  dockError = '';
  setSeated(false);
  follow();
  sendState();
  try {
    await placeAboveTerminal();
  } catch (error) {
    console.error(error.message);
    undock('Agent registered; the desktop could not place its marker.');
    return false;
  }
  if (generation !== dockGeneration) return false;
  avatarWin.webContents.send('dock-sound', 'dock');
  return true;
}
function follow() {
  if (!binding || dragging || seated) return;
  const w = binding.window;
  const anchor = screen.screenToDipPoint({
    x: Math.round(w.x + w.width / 2),
    y: Math.round(w.y + w.height * 0.76),
  });
  placeAvatar(anchor.x - avatarSize / 2, anchor.y - avatarSize / 2);
}
async function refresh() {
  if (busy) return;
  busy = true;
  const refreshGeneration = dockGeneration;
  try {
    const [nextService, nextSessions] = await Promise.all([
      rpc('status'),
      rpc('list', '--include-removed'),
    ]);
    service = nextService;
    sessions = nextSessions;
    try {
      fleetData = await fleets.read();
      fleetError = null;
    } catch (error) {
      fleetError = error.message;
    }
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
    const current = binding;
    const processes = await identities();
    if (binding !== current) {
      busy = false;
      return;
    }
    const result = resolveWindow(
      windows.find((w) => w.id === current.window.id),
      windows,
      records,
      processes,
      false,
    );
    const session = result.record && registeredSession(result.record, sessions);
    if (
      result.error ||
      serviceError ||
      session?.capture !== 'connected' ||
      session.id !== binding.session.id ||
      (refreshGeneration === dockGeneration &&
        service?.control?.generation !== controlConnection?.attachment.generation)
    )
      undock(result.error || serviceError || 'This agent is disconnected.');
    else {
      binding = { ...result, session };
      follow();
      const generation = dockGeneration;
      try {
        await placeAboveTerminal();
      } catch {
        if (generation === dockGeneration)
          undock('The desktop could not keep the marker with the terminal.');
      }
    }
  }
  busy = false;
  if (expanded && !dragging) {
    if (seated) placePanel();
    else resizePanel();
  }
  sendState();
}
let arranging = false;
async function surface(ids, single = false) {
  const id = ids[0];
  if (arranging) throw Error('Windows are being arranged.');
  arranging = true;
  try {
    sessions = await rpc('list', '--include-removed');
    if (
      single &&
      sessions.some(
        (s) =>
          s.id === id &&
          s.removed_ms != null &&
          s.ownership === 'managed' &&
          s.worker_state === 'running',
      )
    )
      return await rpc('open', id, 'ghostty');
    const display = screen.getDisplayMatching(panelWin.getBounds());
    const area = { ...display.workArea };
    if (single) area.width = Math.floor(area.width / 2);
    let targets = vesselPlan(sessions, ids, area);
    if (!targets.length) throw Error('This instance is not running.');
    windows = await inventory();
    await discoverTerminals();
    for (const target of targets) {
      if (!records.some((r) => registeredSession(r, sessions)?.id === target.session))
        await rpc('open', target.session, 'ghostty');
    }
    sessions = await rpc('list', '--include-removed');
    windows = await inventory();
    await discoverTerminals();
    const minimum = { width: 1, height: 1 };
    for (const record of records) {
      if (!targets.some((t) => registeredSession(record, sessions)?.id === t.session)) continue;
      const w = windows.find((w) => w.pid === record.pid);
      minimum.width = Math.max(
        minimum.width,
        Math.ceil((w?.minimum?.[0] || 100) / display.scaleFactor),
      );
      minimum.height = Math.max(
        minimum.height,
        Math.ceil((w?.minimum?.[1] || 80) / display.scaleFactor),
      );
    }
    targets = vesselPlan(sessions, ids, area, minimum);
    const live = await identities();
    const plan = [];
    for (const record of records) {
      const session = registeredSession(record, sessions);
      if (!session || session.ownership !== 'managed' || session.removed_ms != null) continue;
      const w = windows.find((w) => w.pid === record.pid);
      const match = resolveWindow(w, windows, [record], live, false);
      if (match.error) throw Error(match.error);
      const target = targets.find((t) => t.session === session.id);
      const entry = { id: w.id, pid: record.pid, start: record.start, minimise: !target };
      if (target) {
        const origin = screen.dipToScreenPoint({ x: target.x, y: target.y });
        Object.assign(entry, origin, {
          width: Math.round(target.width * display.scaleFactor),
          height: Math.round(target.height * display.scaleFactor),
        });
      }
      plan.push(entry);
    }
    for (const target of targets)
      if (
        !plan.some(
          (p) =>
            !p.minimise &&
            records.some(
              (r) => r.pid === p.pid && registeredSession(r, sessions)?.id === target.session,
            ),
        )
      )
        throw Error('A vessel terminal changed before it could be arranged.');
    const request = { windows: plan, focus: plan.find((p) => !p.minimise).id };
    const { stdout } = await exec(probe, ['layout', JSON.stringify(request)], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    if (single) selected = id;
    await fs.writeFile(
      path.join(stateDir, 'last-layout.json'),
      JSON.stringify(
        {
          mode: single ? 'single' : 'rank',
          vessels: ids,
          request,
          result,
          displays: screen.getAllDisplays(),
        },
        null,
        2,
      ),
    );
    if (result.state !== 'confirmed')
      throw Error('The desktop adjusted some window sizes. Try a smaller fleet.');
    return result;
  } finally {
    arranging = false;
    await refresh();
  }
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

  client.on('closed', () => app.quit());
  return client;
}
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  panelWin = createWindow(320, 372);
  avatarWin = createWindow(collapsedSize, collapsedSize);
  candidateWin = createWindow(100, 100);
  candidateWin.setFocusable(false);
  candidateWin.setIgnoreMouseEvents(true);
  panelWin.on('move', () => {
    if (!expanded || !seated || dragging) return;
    const panel = panelWin.getBounds();
    setBoundsIfChanged(avatarWin, { x: panel.x + 100, y: panel.y + 36 });
  });
  const localAvatar = (contents, details) =>
    contents === avatarWin.webContents && details.isMainFrame;
  avatarWin.webContents.session.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      permission === 'media' && details.mediaType === 'audio' && localAvatar(contents, details),
  );
  avatarWin.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(
        permission === 'media' &&
          localAvatar(contents, details) &&
          details.mediaTypes?.every((type) => type === 'audio'),
      ),
  );
  const handle = (name, clients, fn) =>
    ipcMain.handle(name, async (event, ...args) => {
      if (!clients.some((client) => event.senderFrame === client.webContents.mainFrame))
        throw Error('Unknown caller');
      try {
        return await fn(...args);
      } catch (error) {
        if (['begin-drag', 'end-drag', 'cancel-drag'].includes(name)) {
          dockError = 'Couldn’t connect to this terminal.';
          sendState();
        }
        return { error: error.message, code: error.code };
      }
    });
  handle('conversation-ready', [avatarWin, panelWin], () => conversation.snapshot());
  handle('conversation-send', [panelWin], (text, request) => conversation.send(text, request));
  handle('conversation-voice-start', [avatarWin], (sdp) => conversation.startVoice(sdp));
  handle('conversation-voice-stop', [avatarWin], () => conversation.stopVoice());
  handle('conversation-voice-activity', [avatarWin], (speaker, active) =>
    conversation.voiceActivity(speaker, active),
  );
  handle('toggle', [avatarWin], () => setExpanded(!expanded));
  handle('ready', [avatarWin, panelWin], sendState);
  handle('quit-ui', [panelWin], () => app.quit());
  handle('choose-directory', [panelWin], async () => {
    const result = await dialog.showOpenDialog(panelWin, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('create-instance', [panelWin], async (input) => {
    const result = await createInstance(input);
    await refresh();
    return result;
  });
  handle('panel-content-height', [panelWin], (height) => {
    if (!Number.isInteger(height) || height < 0 || height > 20000)
      throw Error('Invalid panel size.');
    measuredPanelHeight = height;
    if (expanded) {
      if (seated) placePanel();
      else resizePanel();
    }
  });
  handle('surface-instance', [panelWin], (id) => {
    if (typeof id !== 'string') throw Error('Choose a vessel.');
    return surface([id], true);
  });
  handle('surface-fleet', [panelWin], async (id) => {
    const data = await fleets.read();
    if (!data.fleets.some((f) => f.id === id)) throw Error('Choose a fleet.');
    const current = await rpc('list');
    return surface(
      current
        .filter((s) => hierarchy.fleetOf(s.id, current, data.assignments) === id)
        .map((s) => s.id),
    );
  });
  async function fleetAction(call) {
    try {
      return await call();
    } finally {
      await refresh();
    }
  }
  handle('create-fleet', [panelWin], (name, request) =>
    fleetAction(() => fleets.create(name, request)),
  );
  handle('move-vessel', [panelWin], (id, fleet) => fleetAction(() => fleets.move(id, fleet)));
  handle('remove-fleet', [panelWin], (id) => fleetAction(() => fleets.remove(id)));
  async function instanceAction(id, request, op, flags = []) {
    if (!sessions.some((s) => s.id === id)) throw Error('Unknown instance');
    if (typeof request !== 'string' || request.length < 1 || Buffer.byteLength(request) > 128)
      throw Error('Invalid action request');
    try {
      return await rpc(op, id, '--request-id', request, ...flags);
    } finally {
      await refresh();
    }
  }
  handle('background-instance', [panelWin], (id, request) =>
    instanceAction(id, request, 'background'),
  );
  handle('stop-instance', [panelWin], (id, request) =>
    instanceAction(id, request, 'stop-instance'),
  );
  handle('remove-instance', [panelWin], (id, request, stop) => {
    if (typeof stop !== 'boolean') throw Error('Invalid remove choice');
    return instanceAction(id, request, 'remove', stop ? ['--stop'] : []);
  });
  handle('register-instance', [panelWin], (id, request) =>
    instanceAction(id, request, 'register-instance'),
  );
  async function authorityAction(call) {
    try {
      return await call();
    } finally {
      await refresh();
    }
  }
  handle('rank-instance', [panelWin], (id, rank, request) =>
    authorityAction(() => authorityActionsForInstance.rank(id, rank, request)),
  );
  handle('supervise-instance', [panelWin], (id, supervisor, request) =>
    authorityAction(() => authorityActionsForInstance.supervise(id, supervisor, request)),
  );
  handle('begin-drag', [avatarWin], (x, y) => {
    dockGeneration++;
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > avatarSize || y > avatarSize)
      throw Error('Invalid drag');
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
    sendState();
    avatarWin.focus();
  });
  handle('cancel-drag', [avatarWin], async () => {
    if (!dragging) return;
    candidateWin.hide();
    const previous = dragging;
    dragging = null;
    if (previous.moved && previous.binding) {
      await dock(previous.binding.window.id);
      return;
    }
    setSeated(previous.seated);
    placeAvatar(previous.original.x, previous.original.y);
    sendState();
    placeAboveTerminal().catch(() => undock('The terminal is unavailable.'));
    if (previous.moved && (previous.seated || previous.binding))
      avatarWin.webContents.send('dock-sound', 'dock');
  });
  handle('end-drag', [avatarWin], async () => {
    if (!dragging) return;
    candidateWin.hide();
    const { held, moved } = dragging;
    dragging = null;
    if (!held && !moved) {
      await setExpanded(!expanded);
      return;
    }
    if (!moved) {
      sendState();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const panel = panelWin.getBounds();
    windows = await inventory();
    const target = windowBehindAvatar(windows, screen.dipToScreenPoint(cursor));
    if (
      expanded &&
      target?.id === panelWin.getNativeWindowHandle().readUInt32LE() &&
      (await panelWin.webContents.executeJavaScript(
        `Boolean(document.elementFromPoint(${cursor.x - panel.x}, ${cursor.y - panel.y})?.closest('#panel'))`,
      ))
    ) {
      setSeated(true);
      placeAvatar(panel.x + 108, panel.y + 44);
      sendState();
      avatarWin.webContents.send('dock-sound', 'dock');
      return;
    }
    if (target && target.id !== panelWin.getNativeWindowHandle().readUInt32LE())
      await dock(target.id);
    else {
      undock();
    }
    sendState();
  });
  await Promise.all([
    candidateWin.loadFile(path.join(__dirname, 'ui/candidate.html')),
    panelWin.loadFile(path.join(__dirname, 'ui/index.html'), { query: { view: 'panel' } }),
    avatarWin.loadFile(path.join(__dirname, 'ui/index.html'), { query: { view: 'avatar' } }),
  ]);
  park();
  avatarWin.showInactive();
  try {
    await rpc('start');
  } catch (error) {
    console.error(error.message);
  }
  await refresh();
  await conversation.poll();
  conversationTimer = setInterval(() => conversation.poll(), 250);
  if (process.argv.includes('--expanded')) await setExpanded(true);
  if (
    !globalShortcut.register('Control+Alt+V', () => {
      if (binding) avatarWin.webContents.send('dock-sound', 'undock');
      undock();
      setExpanded(true).catch((error) => console.error(error.message));
    })
  )
    console.error('Ctrl+Alt+V is unavailable; hover and pull the astronaut');
  if (process.argv.includes('--proof-conversation')) {
    require('./conversation-proof.cjs')
      .run({
        panelWin,
        avatarWin,
        conversation,
        rpc,
        directory: process.env.VOYAGER_CONVERSATION_PROOF_DIR,
        screen,
      })
      .catch(async (error) => {
        console.error(error);
        if (process.env.VOYAGER_CONVERSATION_PROOF_DIR)
          await fs.writeFile(
            path.join(process.env.VOYAGER_CONVERSATION_PROOF_DIR, 'error.txt'),
            error.stack,
          );
      });
  }
  timer = setInterval(refresh, 750);
  dragTimer = setInterval(updatePointer, 32);
  if (
    process.argv.includes('--proof') ||
    process.argv.includes('--proof-lifecycle') ||
    process.argv.includes('--proof-authority') ||
    process.argv.includes('--proof-fleets') ||
    process.argv.includes('--proof-registration') ||
    process.argv.includes('--proof-control')
  ) {
    require(
      process.argv.includes('--proof-fleets')
        ? '../test/fleets-proof.cjs'
        : process.argv.includes('--proof-authority')
          ? '../test/authority-proof.cjs'
          : process.argv.includes('--proof-lifecycle')
            ? '../test/lifecycle-proof.cjs'
            : process.argv.includes('--proof-control')
              ? '../test/control-proof.cjs'
              : process.argv.includes('--proof-registration')
                ? '../test/registration-proof.cjs'
                : '../test/live-proof.cjs',
    )
      .run({
        avatarWin,
        panelWin,
        advanceDrag,
        updateDockHover,
        rpc,
        refresh,
        inventory,
        surface,
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
          dockError,
          expanded,
          seated,
          dragging,
          dockHovered,
        }),
        stateDir,
      })
      .catch(async (error) => {
        console.error(error);
        const file = path.join(
          stateDir,
          process.argv.includes('--proof-fleets')
            ? 'fleets-proof.json'
            : process.argv.includes('--proof-authority')
              ? 'authority-proof.json'
              : process.argv.includes('--proof-lifecycle')
                ? 'lifecycle-proof.json'
                : process.argv.includes('--proof-control')
                  ? 'control-proof.json'
                  : process.argv.includes('--proof-registration')
                    ? 'registration-proof.json'
                    : 'desktop-refinement-proof.json',
        );
        const receipt = JSON.parse(await fs.readFile(file, 'utf8'));
        await fs.writeFile(
          file,
          JSON.stringify(
            {
              ...receipt,
              verdict: 'rework',
              error: error.message,
              dockError,
              gesture: dragging && {
                start: dragging.start,
                cursor: screen.getCursorScreenPoint(),
                held: dragging.held,
                moved: dragging.moved,
              },
              expanded,
              seated,
            },
            null,
            2,
          ),
        );
        process.exitCode = 1;
        app.quit();
      });
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  controlConnection?.close();
  conversation.close();
  clearInterval(conversationTimer);
  globalShortcut.unregisterAll();
  clearInterval(timer);
  clearInterval(dragTimer);
});
