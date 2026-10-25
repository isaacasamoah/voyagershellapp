const { placeAboveTarget } = require('./placement.cjs');
const { launchContext, recoveryDisplay } = require('./recovery.cjs');
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
  terminalSnapshot,
  identifyTerminal,
  resolveWindow,
  resolveDockTarget,
  registeredSession,
  windowAt,
} = require('./binding.cjs');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const stateDir =
  process.env.VOYAGER_STATE || path.join(require('node:os').homedir(), '.local/share/voyagershell');
if (!stateDir || !path.isAbsolute(stateDir))
  throw Error('Set VOYAGER_STATE to the existing private service directory');
const binaries = app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(root, 'target/debug');
const binary = path.join(binaries, 'voyager');
const probe = path.join(binaries, 'voyager-windows');
const avatarSize = 104,
  margin = 8,
  collapsedSize = avatarSize + margin * 2;
app.commandLine.appendSwitch('ozone-platform', 'x11');
app.disableHardwareAcceleration();
app.setName('Voyager Shell');
app.setDesktopName('voyagershell.desktop');
app.setPath('userData', path.join(stateDir, 'desktop-profile'));
const primaryInstance = app.requestSingleInstanceLock(launchContext());
if (!primaryInstance) app.quit();

let avatarWin,
  panelWin,
  candidateWin,
  timer,
  dragTimer,
  expanded = false,
  seated = false,
  dragging = null,
  panelDrag = null,
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
const dockAttempts = [];
const recoveryAttempts = [];
const createInstance = require('./instances.cjs').instanceCreator(rpc);
const resumeInstance = require('./instances.cjs').instanceResumer(rpc);
const openInstance = require('./instances.cjs').instanceOpener(rpc, refresh, surface);
const authorityActionsForInstance = authorityActions(rpc, () => sessions);
let dockGeneration = 0;
let dockOrigin = null;
let restoringOrigin = null;
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
async function identities(candidates = records) {
  const result = new Map();
  for (const pid of new Set(candidates.flatMap((r) => [r.pid, r.frontend.pid]))) {
    try {
      result.set(pid, await processIdentity(pid));
    } catch {}
  }
  return result;
}
async function discoverTerminals(currentWindows = windows, currentSessions = sessions) {
  const endpoints = [];
  if (service?.codex_connected) {
    const info = await rpc('connection-info');
    endpoints.push({
      server: info.server,
      executable: await fs.realpath(info.executable),
      external: true,
    });
  }
  const managed = currentSessions.filter(
    (s) => s.ownership === 'managed' && s.capture === 'connected' && s.worker_state === 'running',
  );
  endpoints.push(
    ...(await Promise.all(
      managed.map(async (session) => {
        const info = await rpc('attach-info', session.id);
        return {
          server: session.server,
          executable: await fs.realpath(info.executable),
          external: false,
          kind: session.kind,
          nativeId: session.native_thread_id,
          args: info.args,
        };
      }),
    )),
  );
  const found = (
    await Promise.all(
      [...new Set(currentWindows.map((w) => w.pid))].map(async (pid) => {
        const snapshot = await terminalSnapshot(pid).catch(() => null);
        if (!snapshot) return [];
        return (
          await Promise.all(
            endpoints.map((endpoint) =>
              identifyTerminal(
                pid,
                {
                  ...endpoint,
                  viewers: service?.terminal_viewers?.map((viewer) => viewer.executable),
                },
                snapshot,
              ).catch(() => null),
            ),
          )
        ).filter(Boolean);
      }),
    )
  ).flat();
  records = found;
  return found;
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
    avatarWin.setVisibleOnAllWorkspaces(!terminal);
  }
  if (!terminal && !avatarWin.isVisible()) avatarWin.showInactive();
}
async function placeAboveTerminal() {
  if (layer === 'floating' || !binding) return { state: 'superseded' };
  const target = binding.window.id;
  const generation = dockGeneration;
  const p = avatarPosition();
  const rectangle = avatarWin.getBounds();
  const top = screen.dipToScreenPoint({ x: rectangle.x, y: rectangle.y });
  const bottom = screen.dipToScreenPoint({
    x: rectangle.x + rectangle.width,
    y: rectangle.y + rectangle.height,
  });
  const bounds = { x: top.x, y: top.y, width: bottom.x - top.x, height: bottom.y - top.y };
  return placeAboveTarget({
    avatar: avatarWin,
    target,
    bounds,
    point: screen.dipToScreenPoint({ x: p.x + avatarSize / 2, y: p.y + avatarSize / 2 }),
    excluded: [avatarWin, candidateWin].map((w) => w.getNativeWindowHandle().readUInt32LE()),
    current: () =>
      generation === dockGeneration && layer !== 'floating' && binding?.window.id === target,
    inventory,
    above: (avatar, terminal) =>
      exec(probe, ['above', String(avatar), String(terminal)], { timeout: 2000 }),
  });
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
        lifecycle,
        resume,
        window,
        terminal,
        removed_ms,
        rank,
        supervisor_id,
        registered_ms,
        last_activity_ms,
      }) => ({
        id,
        name,
        kind,
        cwd,
        ownership,
        capture,
        worker_state,
        lifecycle,
        resume,
        window,
        terminal,
        removed_ms,
        rank,
        supervisor_id,
        registered_ms,
        last_activity_ms,
      }),
    ),
    service,
    fleetData,
    fleetError,
    serviceError,
    platformError,
    dockError,
    selected,
    displayHeight:
      panelWin && !panelWin.isDestroyed()
        ? screen.getDisplayMatching(panelWin.getBounds()).workArea.height
        : null,
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
function floatingPosition() {
  return { panel: panelWin.getBounds(), avatar: avatarPosition(), seated };
}
async function restoreFloating(position) {
  const generation = dockGeneration;
  restoringOrigin = position;
  const anchor = position && { x: position.panel.x + 108, y: position.panel.y + 44 };
  await setExpanded(true, anchor);
  if (generation !== dockGeneration || restoringOrigin !== position) return;
  if (position && !position.seated) {
    setSeated(false);
    placeAvatar(position.avatar.x, position.avatar.y);
    sendState();
  }
  restoringOrigin = null;
}
function setBoundsIfChanged(client, bounds) {
  const previous = client.getBounds();
  if (Object.keys(bounds).some((key) => previous[key] !== bounds[key])) client.setBounds(bounds);
}
function placePanel(p = avatarPosition()) {
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
  raiseSeatedAvatar();
}
function raiseSeatedAvatar() {
  if (expanded && seated && !dragging) avatarWin.moveTop();
}
async function recoverControls(context) {
  if (!avatarWin || avatarWin.isDestroyed()) return;
  undock();
  const generation = dockGeneration;
  const attempt = { generation, requestedAt: performance.now(), state: 'requested' };
  recoveryAttempts.push(attempt);
  if (recoveryAttempts.length > 32) recoveryAttempts.shift();
  dragging = null;
  panelDrag = null;
  candidateWin.hide();
  if (avatarWin.isMinimized()) avatarWin.restore();
  if (panelWin.isMinimized()) panelWin.restore();
  avatarWin.showInactive();
  let cursor = screen.getCursorScreenPoint();
  try {
    cursor = screen.screenToDipPoint((await desktopSnapshot()).pointer);
  } catch (error) {
    console.error(error.message);
  }
  if (generation !== dockGeneration) {
    attempt.state = 'superseded';
    return;
  }
  const area = recoveryDisplay(screen, cursor, context).workArea;
  attempt.display = area;
  attempt.cursor = cursor;
  await setExpanded(true, { x: area.x + area.width - avatarSize - 24, y: area.y + 28 });
  if (generation !== dockGeneration) {
    attempt.state = 'superseded';
    return;
  }
  panelWin.show();
  panelWin.focus();
  avatarWin.showInactive();
  raiseSeatedAvatar();
  Object.assign(attempt, { state: 'presented', presentedAt: performance.now() });
}
app.on('second-instance', (_event, _argv, _cwd, context) =>
  recoverControls(context).catch((error) => console.error(error.message)),
);

async function setExpanded(value, position) {
  expanded = value;
  if (value) {
    if (binding) {
      sendState();
      panelWin.showInactive();
      return;
    }
    setSeated(true);
    placePanel(position);
    sendState();
    panelWin.showInactive();
    panelWin.setVisibleOnAllWorkspaces(true);
    const id = panelWin.getNativeWindowHandle().readUInt32LE();
    const deadline = performance.now() + 2000;
    while (expanded && seated) {
      const mapped = (await inventory()).some((window) => window.id === id && window.visible);
      if (!expanded || !seated) return;
      if (mapped) {
        avatarWin.setParentWindow(panelWin);
        raiseSeatedAvatar();
        return;
      }
      if (performance.now() >= deadline) throw Error('The desktop did not show the panel');
      await delay(25);
    }
  } else {
    panelDrag = null;
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
  const cursor = screen.getCursorScreenPoint();
  if (panelDrag)
    setBoundsIfChanged(panelWin, {
      x: Math.round(cursor.x - panelDrag.x),
      y: Math.round(cursor.y - panelDrag.y),
    });
  advanceDrag(cursor);
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
    previewDock(target);
  }
}
function showDockCandidate(target, result) {
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
  candidateWin.webContents
    .executeJavaScript(
      `document.body.dataset.state = ${JSON.stringify(result.state)}; document.getElementById('reason').textContent = ${JSON.stringify(result.reason)};`,
    )
    .catch((error) => console.error(error.message));
  if (!candidateWin.isVisible()) candidateWin.showInactive();
}
function previewDock(target) {
  const gesture = dragging;
  if (!target || target.id === panelWin.getNativeWindowHandle().readUInt32LE()) {
    if (gesture.candidate)
      gesture.candidate = {
        ...gesture.candidate,
        state: 'refused',
        outside: true,
        reason: 'This terminal is unavailable. Try docking again.',
      };
    candidateWin.hide();
    return;
  }
  if (gesture.candidate?.window.id === target.id && !gesture.candidate.outside) return;
  const candidate = { window: target, state: 'checking', reason: 'Checking this terminal…' };
  gesture.candidate = candidate;
  showDockCandidate(target, candidate);
  checkDockTarget(target.id)
    .catch(() => ({ state: 'refused', reason: 'Could not verify this terminal. Try again.' }))
    .then((result) => {
      if (dragging !== gesture || gesture.candidate !== candidate) return;
      gesture.candidate = { ...candidate, ...result };
      showDockCandidate(target, result);
    });
}
async function checkDockTarget(id, expected = null) {
  if (serviceError || platformError)
    return { state: 'refused', reason: serviceError || platformError };
  const currentWindows = await inventory();
  const currentSessions = await rpc('list', '--include-removed');
  const currentRecords = await discoverTerminals(currentWindows, currentSessions);
  return resolveDockTarget(
    currentWindows.find((w) => w.id === id),
    currentWindows,
    currentRecords,
    await identities(currentRecords),
    currentSessions,
    expected,
  );
}
async function refuseDock(reason) {
  const origin = binding ? dockOrigin : null;
  undock(reason);
  avatarWin.showInactive();
  await restoreFloating(origin);
  return false;
}
async function recoverDisplay() {
  if (!avatarWin || avatarWin.isDestroyed()) return;
  const origin = binding ? dockOrigin : restoringOrigin || floatingPosition();
  undock('The display changed. Dock again when the terminal is ready.');
  avatarWin.showInactive();
  await restoreFloating(origin);
}
function undock(message = '') {
  dockGeneration++;
  restoringOrigin = null;
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
async function dock(id, expected = null, droppedAt = performance.now(), origin = null) {
  origin = binding ? dockOrigin : origin || floatingPosition();
  restoringOrigin = null;
  if (binding) undock();
  const generation = ++dockGeneration;
  const attempt = { generation, target: id, droppedAt, state: 'checking' };
  dockAttempts.push(attempt);
  if (dockAttempts.length > 32) dockAttempts.shift();
  const superseded = () => {
    if (generation === dockGeneration) return false;
    attempt.state = 'superseded';
    return true;
  };
  let fresh;
  try {
    const target = await checkDockTarget(id, expected);
    if (superseded()) return false;
    if (target.state !== 'ready') {
      Object.assign(attempt, { state: 'refused', reason: target.reason });
      return refuseDock(target.reason);
    }
    fresh = await checkDockTarget(id, target);
    if (superseded()) return false;
    if (fresh.state !== 'ready') {
      Object.assign(attempt, { state: 'refused', reason: fresh.reason });
      return refuseDock(fresh.reason);
    }
  } catch {
    if (superseded()) return false;
    Object.assign(attempt, {
      state: 'failed',
      reason: 'Could not verify this terminal. Try again.',
    });
    return refuseDock(attempt.reason);
  }
  const session = fresh.session;
  const identity = ({ pid, start }) => ({ pid, start });
  let connection;
  let closed = false;
  try {
    connection = await connectControl(
      stateDir,
      {
        generation: randomUUID(),
        session_id: session.id,
        window_id: fresh.window.id,
        terminal: identity(fresh.record),
        frontend: identity(fresh.record.frontend),
      },
      () => {
        closed = true;
        if (connection && controlConnection === connection)
          refuseDock('Control attachment ended.').catch((error) => console.error(error.message));
      },
    );
  } catch {
    if (superseded()) return false;
    Object.assign(attempt, {
      state: 'failed',
      reason: 'Could not attach control. Try docking again.',
    });
    return refuseDock(attempt.reason);
  }
  if (closed || generation !== dockGeneration) {
    await releaseControl(connection);
    attempt.state = 'superseded';
    if (closed && generation === dockGeneration) return refuseDock('Control attachment ended.');
    return false;
  }
  Object.assign(attempt, {
    acceptedAt: performance.now(),
    attachment: connection.attachment.generation,
    state: 'accepted',
  });
  controlConnection = connection;
  service = { ...service, control: connection.attachment, voice: connection.voice };
  dockOrigin = origin;
  binding = { ...fresh, session };
  dockHovered = false;
  selected = session.id;
  dockError = '';
  setSeated(false);
  follow();
  sendState();
  try {
    const placement = await placeAboveTerminal();
    if (superseded()) {
      attempt.state = 'superseded';
      if (controlConnection === connection) undock();
      return false;
    }
    if (placement.state === 'superseded') {
      attempt.state = 'superseded';
      undock();
      return false;
    }
    if (placement.state !== 'placed') {
      Object.assign(attempt, { state: 'failed', reason: placement.reason });
      return refuseDock(placement.reason);
    }
    Object.assign(attempt, {
      placedAt: performance.now(),
      state: 'placed',
      marker: placement.marker,
      window: placement.target,
    });
  } catch (error) {
    if (superseded()) {
      attempt.state = 'superseded';
      if (controlConnection === connection) undock();
      return false;
    }
    Object.assign(attempt, { state: 'failed', reason: 'The desktop could not place the avatar.' });
    return refuseDock(attempt.reason);
  }
  if (superseded()) return false;
  avatarWin.webContents.send('dock-sound', 'dock');
  attempt.soundRequestedAt = performance.now();
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
const placedWindows = new Set();
let presentationReady = false;
let creating = 0;
async function refresh() {
  if (busy) return;
  busy = true;
  const generation = dockGeneration;
  try {
    await refreshState(generation);
  } catch (error) {
    if (generation === dockGeneration || !binding) {
      platformError = `Could not update the desktop: ${error.message}`;
      if (binding) undock(platformError);
      avatarWin.showInactive();
      sendState();
    }
    console.error(error.message);
  } finally {
    busy = false;
  }
}
async function refreshState(refreshGeneration) {
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
  if (refreshGeneration !== dockGeneration) {
    return;
  }
  if (binding) {
    const current = binding;
    const processes = await identities();
    if (binding !== current) {
      return;
    }
    const result = resolveWindow(
      windows.find((w) => w.id === current.window.id),
      windows,
      records,
      processes,
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
      await refuseDock(result.error || serviceError || 'This agent is disconnected.');
    else {
      binding = { ...result, session };
      follow();
      const generation = dockGeneration;
      try {
        const placement = await placeAboveTerminal();
        if (generation === dockGeneration && placement.state === 'failed')
          await refuseDock(placement.reason);
      } catch {
        if (generation === dockGeneration)
          await refuseDock('The desktop could not keep the marker with the terminal.');
      }
    }
  }
  if (expanded && !dragging) {
    if (seated) placePanel();
    else resizePanel();
  }
  sendState();
  const opened = records.flatMap((record) => {
    const session = registeredSession(record, sessions);
    const window = windows.find((w) => w.pid === record.pid);
    return session?.ownership === 'managed' && session.removed_ms == null && window
      ? [{ id: session.id, key: `${window.id}:${record.start}` }]
      : [];
  });
  if (!presentationReady) {
    opened.forEach((item) => placedWindows.add(item.key));
    presentationReady = true;
  } else if (!creating && !arranging && !dragging) {
    const next = opened.find((item) => !placedWindows.has(item.key));
    if (next) {
      placedWindows.add(next.key);
      try {
        await surface([next.id], true);
      } catch (error) {
        dockError = `Window placement failed: ${error.message}`;
        sendState();
      }
    }
  }
}
let arranging = false;
async function surface(ids, single = false) {
  const id = ids[0];
  if (arranging) throw Error('Windows are being arranged.');
  arranging = true;
  try {
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
      return await rpc('open', id, sessions.find((s) => s.id === id)?.terminal || 'ghostty');
    const display = screen.getDisplayMatching(panelWin.getBounds());
    const area = { ...display.workArea };
    if (single) area.width = Math.floor(area.width / 2);
    if (ids.some((id) => !sessions.some((session) => session.id === id)))
      sessions = await rpc('list', '--include-removed');
    let targets = vesselPlan(sessions, ids, area);
    if (!targets.length) throw Error('This instance is not running.');
    windows = await inventory();
    const hasViewer = (target) =>
      records.some(
        (r) =>
          registeredSession(r, sessions)?.id === target.session &&
          windows.some((w) => w.pid === r.pid),
      );
    if (targets.some((target) => !hasViewer(target))) await discoverTerminals();
    const missing = targets.filter((target) => !hasViewer(target));
    if (missing.length) {
      await Promise.all(
        missing.map((target) =>
          rpc(
            'open',
            target.session,
            sessions.find((s) => s.id === target.session)?.terminal || 'ghostty',
          ),
        ),
      );
      sessions = await rpc('list', '--include-removed');
      windows = await inventory();
      await discoverTerminals();
    }
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
      if (!w) continue;
      const match = resolveWindow(w, windows, [record], live, false);
      if (match.error) throw Error(match.error);
      const target = targets.find((t) => t.session === session.id);
      const entry = { id: w.id, pid: record.pid, start: record.start, minimise: !target };
      if (target) {
        const origin = screen.dipToScreenPoint({ x: target.x, y: target.y });
        const edge = screen.dipToScreenPoint({
          x: target.x + target.width,
          y: target.y + target.height,
        });
        Object.assign(entry, origin, { width: edge.x - origin.x, height: edge.y - origin.y });
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
    for (const entry of plan) {
      const record = records.find((r) => r.pid === entry.pid);
      if (record) placedWindows.add(`${entry.id}:${record.start}`);
    }
    if (result.state !== 'confirmed')
      throw Error('The desktop adjusted some window sizes. Try a smaller fleet.');
    return result;
  } finally {
    arranging = false;
    sendState();
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
    type: process.platform === 'linux' ? 'toolbar' : undefined,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, '../assets/idle.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  client.setVisibleOnAllWorkspaces(true);
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
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed'])
    screen.on(event, () => recoverDisplay().catch((error) => console.error(error.message)));
  candidateWin.setFocusable(false);
  candidateWin.setIgnoreMouseEvents(true);
  panelWin.on('focus', raiseSeatedAvatar);
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
  handle('voice-app', [avatarWin], () => {
    if (binding) throw Error('Voice belongs to the docked vessel.');
    return rpc('voice', 'app');
  });
  handle('voice-native', [avatarWin], (id, active) => {
    if (typeof active !== 'boolean' || !binding || binding.session.id !== id)
      throw Error('The docked vessel changed.');
    return rpc('voice', active ? id : 'none');
  });
  handle('conversation-send', [panelWin], (text, request) => conversation.send(text, request));
  handle('conversation-voice-start', [avatarWin], (sdp) => conversation.startVoice(sdp));
  handle('conversation-voice-stop', [avatarWin], () => conversation.stopVoice());
  handle('conversation-voice-activity', [avatarWin], (speaker, active) =>
    conversation.voiceActivity(speaker, active),
  );
  handle('toggle', [avatarWin], () => setExpanded(!expanded));
  handle('resume-instance', [panelWin], async (input) => {
    const polling = setInterval(refresh, 100);
    try {
      return await resumeInstance(input);
    } finally {
      clearInterval(polling);
      await refresh();
    }
  });
  handle('instance-history', [panelWin], require('./instances.cjs').historyReader(rpc));
  handle('ready', [avatarWin, panelWin], sendState);
  handle('quit-ui', [panelWin], () => app.quit());
  handle('stop-service', [panelWin], async () => {
    await rpc('stop');
    app.quit();
  });
  handle('choose-directory', [panelWin], async () => {
    const result = await dialog.showOpenDialog(panelWin, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('create-instance', [panelWin], async (input) => {
    creating++;
    try {
      const result = await createInstance(input);
      await refresh();
      try {
        await surface([result.session], true);
      } catch (error) {
        return { ...result, warning: `Created, but placement failed: ${error.message}` };
      }
      return result;
    } finally {
      creating--;
    }
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
  handle('rename-fleet', [panelWin], (id, name) => fleetAction(() => fleets.rename(id, name)));
  handle('rename-instance', [panelWin], (id, name, request) =>
    authorityAction(() => rpc('rename', id, name, '--request-id', request)),
  );
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
  handle('open-instance', [panelWin], async (id, terminal, request) => {
    if (!sessions.some((s) => s.id === id)) throw Error('Unknown instance');
    if (!['ghostty', 'xterm'].includes(terminal)) throw Error('Choose a terminal viewer.');
    if (typeof request !== 'string' || request.length < 1 || Buffer.byteLength(request) > 128)
      throw Error('Invalid action request');
    return openInstance(id, terminal, request);
  });
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
  handle('begin-panel-drag', [panelWin], (x, y) => {
    restoringOrigin = null;
    const bounds = panelWin.getBounds();
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > bounds.width || y > bounds.height)
      throw Error('Invalid panel drag');
    panelDrag = { x, y };
  });
  handle('end-panel-drag', [panelWin], () => {
    panelDrag = null;
  });
  handle('begin-drag', [avatarWin], (x, y) => {
    dockGeneration++;
    restoringOrigin = null;
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
      floating: binding ? dockOrigin : floatingPosition(),
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
      await dock(
        previous.binding.window.id,
        previous.binding,
        performance.now(),
        previous.floating,
      );
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
    const droppedAt = performance.now();
    candidateWin.hide();
    const { held, moved, candidate, floating } = dragging;
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
    if (target && target.id !== panelWin.getNativeWindowHandle().readUInt32LE()) {
      if (candidate && candidate.window.id !== target.id)
        await refuseDock('The target changed. Try docking again.');
      else
        await dock(target.id, candidate?.state === 'ready' ? candidate : null, droppedAt, floating);
    } else if (candidate) {
      await refuseDock('The target changed. Try docking again.');
    } else {
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
  try {
    if (process.argv.includes('--expanded') || process.argv.includes('--from-applications'))
      await recoverControls(launchContext());
  } catch (error) {
    platformError = `Could not confirm the controls: ${error.message}`;
    avatarWin.showInactive();
    sendState();
    console.error(platformError);
  }
  if (
    !globalShortcut.register('Control+Alt+V', () => {
      if (binding) avatarWin.webContents.send('dock-sound', 'undock');
      recoverControls().catch((error) => console.error(error.message));
    })
  )
    console.error('Ctrl+Alt+V is unavailable; hover and pull the astronaut');
  if (process.argv.includes('--proof-conversation')) {
    require('../test/native-proof.cjs')
      .run({
        panelWin,
        avatarWin,
        conversation,
        rpc,
        directory: process.env.VOYAGER_CONVERSATION_PROOF_DIR,
        journey: 'conversation',
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
    process.argv.includes('--proof-native') ||
    process.argv.includes('--proof-docking') ||
    process.argv.includes('--proof-fleet-creation') ||
    process.argv.includes('--proof-visibility') ||
    process.argv.includes('--proof-polish') ||
    process.argv.includes('--proof') ||
    process.argv.includes('--proof-lifecycle') ||
    process.argv.includes('--proof-authority') ||
    process.argv.includes('--proof-fleets') ||
    process.argv.includes('--proof-registration') ||
    process.argv.includes('--proof-control')
  ) {
    const proofDirectory = process.env.VOYAGER_PROOF_DIRECTORY || path.join(__dirname, '../test');
    if (!path.isAbsolute(proofDirectory)) throw Error('Proof directory must be absolute');
    require(
      path.join(
        proofDirectory,
        process.argv.includes('--proof-native')
          ? 'native-proof.cjs'
          : process.argv.includes('--proof-fleet-creation')
            ? 'fleet-creation-proof.cjs'
            : process.argv.includes('--proof-visibility')
              ? 'visibility-proof.cjs'
              : process.argv.includes('--proof-polish')
                ? 'polish-proof.cjs'
                : process.argv.includes('--proof-fleets')
                  ? 'fleets-proof.cjs'
                  : process.argv.includes('--proof-authority')
                    ? 'authority-proof.cjs'
                    : process.argv.includes('--proof-lifecycle')
                      ? 'lifecycle-proof.cjs'
                      : process.argv.includes('--proof-control')
                        ? 'control-proof.cjs'
                        : process.argv.includes('--proof-registration')
                          ? 'registration-proof.cjs'
                          : process.argv.includes('--proof-docking')
                            ? 'docking-proof.cjs'
                            : 'live-proof.cjs',
      ),
    )
      .run({
        conversation,
        screen,
        avatarWin,
        panelWin,
        candidateWin,
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
          candidate: { app: process.execPath, service: binary, packaged: app.isPackaged },
          dockAttempts,
          recoveryAttempts,
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
        if (process.argv.includes('--proof-native')) {
          try {
            await fs.writeFile(
              path.join(stateDir, 'native-proof.json'),
              JSON.stringify(
                {
                  journey: process.env.VOYAGER_PROOF_JOURNEY,
                  verdict: 'rework',
                  error: error.stack,
                  candidate: { app: process.execPath, service: binary, packaged: app.isPackaged },
                },
                null,
                2,
              ),
            );
          } finally {
            process.exitCode = 1;
            app.quit();
          }
          return;
        }

        const file = path.join(
          stateDir,
          process.argv.includes('--proof-fleet-creation')
            ? 'fleet-creation-proof.json'
            : process.argv.includes('--proof-visibility')
              ? 'visibility-proof.json'
              : process.argv.includes('--proof-polish')
                ? 'polish-proof.json'
                : process.argv.includes('--proof-fleets')
                  ? 'fleets-proof.json'
                  : process.argv.includes('--proof-authority')
                    ? 'authority-proof.json'
                    : process.argv.includes('--proof-lifecycle')
                      ? 'lifecycle-proof.json'
                      : process.argv.includes('--proof-control')
                        ? 'control-proof.json'
                        : process.argv.includes('--proof-registration')
                          ? 'registration-proof.json'
                          : process.argv.includes('--proof-docking')
                            ? 'docking-proof.json'
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
