const { ipcMain, screen, globalShortcut, nativeImage } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readFile, stat } = require('node:fs/promises');
const { fileURLToPath } = require('node:url');
const path = require('node:path');
const exec = promisify(execFile);
const { setTimeout: delay } = require('node:timers/promises');
// Drawing and controls share the panel's native window, so tool clicks stay reachable.
exports.createWhiteboard = (panel, avatar, resizePanel, changed) => {
  const state = {
    active: false,
    tool: 'pen',
    nodes: 0,
    edges: 0,
    strokes: 0,
    canUndo: false,
    selectedCount: 0,
    capturing: false,
    error: '',
  };
  let sidebarBounds = null;
  let capture = null;
  const snapshot = () => panel.webContents.executeJavaScript('window.whiteboard.snapshot()');
  const update = () => changed({ ...state });
  const send = (command) => panel.webContents.send('whiteboard-command', command);
  const hide = () => {
    capture?.abort();
    state.active = false;
    send({ action: 'cancel' });
    if (sidebarBounds) resizePanel(sidebarBounds, false);
    sidebarBounds = null;
    globalShortcut.unregister('Escape');
    update();
  };
  const snip = async () => {
    if (capture) return;
    if (process.platform !== 'linux') {
      state.error = 'Snip currently requires the Linux screenshot portal.';
      update();
      return;
    }
    command({ action: 'tool', tool: 'select' });
    const request = new AbortController();
    capture = request;
    state.capturing = true;
    state.error = '';
    update();
    const visible = [panel, avatar].filter((win) => win.isVisible());
    // The native picker owns Escape while it is open.
    globalShortcut.unregister('Escape');
    try {
      // Keep the linked windows mapped. Unmapping and focusing them again after
      // the portal closes can leave GNOME showing only an attention notification.
      // The capturing state hides their contents; input goes to the desktop.
      for (const win of visible) win.setIgnoreMouseEvents(true);
      await delay(180);
      if (request.signal.aborted) return;
      const { stdout } = await exec('python3', [path.join(__dirname, 'screenshot.py')], {
        signal: request.signal,
        timeout: 130000,
        maxBuffer: 64 * 1024,
      });
      const result = JSON.parse(stdout);
      if (result.cancelled || request.signal.aborted) return;
      if (result.error) throw Error(result.error);
      const file = fileURLToPath(result.uri);
      if ((await stat(file)).size > 12 * 1024 * 1024)
        throw Error('That image is too large. Snip a smaller area.');
      const bytes = await readFile(file);
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw Error('The desktop did not return a PNG image.');
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw Error('The desktop returned an empty image.');
      const size = image.getSize();
      const data = image.toDataURL();
      if (data.length > 16 * 1024 * 1024)
        throw Error('That image is too large. Snip a smaller area.');
      const scale = Math.min(
        1,
        800 / size.width,
        600 / size.height,
        (state.canvas.width - 40) / size.width,
        (state.canvas.height - 40) / size.height,
      );
      const width = Math.max(8, size.width * scale),
        height = Math.max(8, size.height * scale);
      if (request.signal.aborted) return;
      send({
        action: 'insert-image',
        image: data,
        rect: {
          x: (state.canvas.width - width) / 2,
          y: (state.canvas.height - height) / 2,
          width,
          height,
        },
      });
    } catch (error) {
      if (!request.signal.aborted) state.error = `Couldn’t snip: ${error.message}`;
    } finally {
      capture = null;
      state.capturing = false;
      for (const win of visible) if (!win.isDestroyed()) win.setIgnoreMouseEvents(false);
      if (!panel.isDestroyed()) {
        if (state.active) globalShortcut.register('Escape', hide);
        update();
      }
    }
  };
  const report = (event, value) => {
    if (
      event.senderFrame !== panel.webContents.mainFrame ||
      !value ||
      !['nodes', 'edges', 'strokes'].every((k) => Number.isInteger(value[k]) && value[k] >= 0)
    )
      return;
    Object.assign(state, {
      nodes: value.nodes,
      edges: value.edges,
      strokes: value.strokes,
      canUndo: Boolean(value.canUndo),
      selectedCount: Number.isInteger(value.selectedCount) ? value.selectedCount : 0,
    });
    update();
  };
  ipcMain.on('whiteboard-report', report);
  screen.on('display-metrics-changed', hide);
  screen.on('display-removed', hide);
  panel.on('closed', () => {
    capture?.abort();
    globalShortcut.unregister('Escape');
    ipcMain.removeListener('whiteboard-report', report);
    screen.removeListener('display-metrics-changed', hide);
    screen.removeListener('display-removed', hide);
  });
  const command = (message) => {
    if (message.action === 'hide') return hide();
    if (message.action === 'snip') return snip();
    if (capture) return;
    if (message.action === 'tool') {
      if (!['pen', 'box', 'text', 'arrow', 'select'].includes(message.tool))
        throw Error('Unknown drawing tool');
      state.error = '';
      state.tool = message.tool;
      if (!state.active) {
        sidebarBounds = panel.getBounds();
        const display = screen.getDisplayMatching(sidebarBounds).bounds;
        state.canvas = { width: display.width, height: display.height };
        state.sidebar = {
          x: sidebarBounds.x - display.x,
          y: sidebarBounds.y - display.y,
          width: sidebarBounds.width,
          height: sidebarBounds.height,
        };
        state.active = true;
        update();
        resizePanel(display, true);
        globalShortcut.register('Escape', hide);
      }
      send({ action: 'tool', tool: state.tool, canvas: state.canvas });
      update();
      return;
    }
    if (['undo', 'clear', 'delete'].includes(message.action)) {
      send(message);
      return;
    }
    throw Error('Unknown whiteboard command');
  };
  return { command, snapshot, getState: () => ({ ...state }) };
};
