const { ipcMain, screen, dialog, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
// Sidebar and drawing share one native window; no separate layer can steal tool clicks.
exports.createWhiteboard = async (panel, changed) => {
  const { validateBoard, toMermaid } = await import('./whiteboard/model.mjs');
  let state = {
    active: false,
    tool: 'pen',
    label: 'An idea',
    nodes: 0,
    edges: 0,
    strokes: 0,
    canUndo: false,
    selectedCount: 0,
    selectedLabel: null,
    notice: 'Draw over your desktop. Escape returns to your apps.',
  };
  let sidebarBounds = null;
  const snapshot = () => panel.webContents.executeJavaScript('window.whiteboard.snapshot()');
  const update = () => changed({ ...state });
  const send = (command) => panel.webContents.send('whiteboard-command', command);
  const hide = () => {
    state.active = false;
    send({ action: 'cancel' });
    if (sidebarBounds) panel.setBounds(sidebarBounds);
    sidebarBounds = null;
    globalShortcut.unregister('Escape');
    update();
  };
  const owned = (event) => event.senderFrame === panel.webContents.mainFrame;
  const report = (event, value) => {
    if (
      !owned(event) ||
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
      selectedLabel: typeof value.selectedLabel === 'string' ? value.selectedLabel : null,
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
  let saving = false;
  const command = async (message) => {
    if (message.action === 'hide') {
      hide();
      return;
    }
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
        panel.setBounds(display);
        state.notice = globalShortcut.register('Escape', hide)
          ? 'Escape or Use desktop returns to your apps.'
          : 'Use desktop returns to your apps. Escape works when the drawing layer is focused.';
      }
      send({ action: 'tool', tool: state.tool, label: state.label, canvas: state.canvas });
      update();
      return;
    }
    if (message.action === 'label') {
      if (typeof message.label !== 'string' || message.label.length > 120)
        throw Error('Invalid label');
      state.label = message.label;
      send({ action: 'label', label: state.label });
      return;
    }
    if (['undo', 'clear', 'delete'].includes(message.action)) {
      send(message);
      return;
    }
    if (saving) return;
    saving = true;
    try {
      if (message.action === 'open') {
        hide();
        const result = await dialog.showOpenDialog(panel, {
          filters: [{ name: 'Voyager board', extensions: ['json'] }],
          properties: ['openFile'],
        });
        if (result.canceled) return;
        if ((await fs.stat(result.filePaths[0])).size > 5 * 1024 * 1024)
          throw Error('Board files must be under 5 MB');
        const board = validateBoard(JSON.parse(await fs.readFile(result.filePaths[0], 'utf8')));
        send({ action: 'import', board });
        await command({ action: 'tool', tool: state.tool });
        return;
      }
      if (!['save-image', 'save-board', 'save-mermaid'].includes(message.action))
        throw Error('Unknown whiteboard command');
      const board = validateBoard(await snapshot());
      let data, extension;
      if (message.action === 'save-image') {
        // Marks only: never captures other applications or their private content.
        const image = await panel.webContents.executeJavaScript('window.whiteboard.image()');
        data = Buffer.from(image.split(',')[1], 'base64');
        extension = 'png';
      } else if (message.action === 'save-board') {
        data = JSON.stringify(board, null, 2);
        extension = 'json';
      } else {
        data = toMermaid(board);
        extension = 'mmd';
      }
      hide();
      const result = await dialog.showSaveDialog(panel, {
        defaultPath: `voyager-board.${extension}`,
        filters: [{ name: 'Whiteboard', extensions: [extension] }],
      });
      if (!result.canceled) {
        await fs.writeFile(result.filePath, data);
        state.notice =
          extension === 'mmd' && board.strokes.length
            ? 'Mermaid saved; freehand marks are omitted.'
            : 'Whiteboard saved.';
        update();
      }
    } finally {
      saving = false;
    }
  };
  return {
    command,
    snapshot,
    getState: () => ({ ...state }),
    getSidebarBounds: () => sidebarBounds,
  };
};
