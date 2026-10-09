const { ipcMain, screen, globalShortcut } = require('electron');
// Drawing and controls share the panel's native window, so tool clicks stay reachable.
exports.createWhiteboard = (panel, resizePanel, changed) => {
  const state = {
    active: false,
    tool: 'pen',
    nodes: 0,
    edges: 0,
    strokes: 0,
    canUndo: false,
    selectedCount: 0,
  };
  let sidebarBounds = null;
  const snapshot = () => panel.webContents.executeJavaScript('window.whiteboard.snapshot()');
  const update = () => changed({ ...state });
  const send = (command) => panel.webContents.send('whiteboard-command', command);
  const hide = () => {
    state.active = false;
    send({ action: 'cancel' });
    if (sidebarBounds) resizePanel(sidebarBounds, false);
    sidebarBounds = null;
    globalShortcut.unregister('Escape');
    update();
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
    globalShortcut.unregister('Escape');
    ipcMain.removeListener('whiteboard-report', report);
    screen.removeListener('display-metrics-changed', hide);
    screen.removeListener('display-removed', hide);
  });
  const command = (message) => {
    if (message.action === 'hide') return hide();
    if (message.action === 'tool') {
      if (!['pen', 'box', 'text', 'arrow', 'select'].includes(message.tool))
        throw Error('Unknown drawing tool');
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
