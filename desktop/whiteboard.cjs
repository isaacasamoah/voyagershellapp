const { BrowserWindow, ipcMain, screen, dialog, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
// One transparent drawing layer; the existing Voyager window owns every control.
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
    notice: 'Draw over your desktop. Escape returns to your apps.',
  };
  const overlay = new BrowserWindow({
    ...screen.getDisplayMatching(panel.getBounds()).bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'whiteboard/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlay.webContents.on('will-navigate', (event) => event.preventDefault());
  // Keep the tool sidebar accessible after a drawing click focuses the layer.
  const raisePanel = () => {
    if (!panel.isDestroyed()) panel.moveTop();
  };
  overlay.on('focus', raisePanel);
  const update = () => changed({ ...state });
  const send = (command) => overlay.webContents.send('whiteboard-command', command);
  const hide = () => {
    state.active = false;
    send({ action: 'cancel' });
    overlay.hide();
    globalShortcut.unregister('Escape');
    update();
  };
  const owned = (event) => event.senderFrame === overlay.webContents.mainFrame;
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
    });
    update();
  };
  const ready = (event) => {
    if (owned(event)) send({ action: 'tool', tool: state.tool, label: state.label });
  };
  const dismiss = (event) => {
    if (owned(event)) hide();
  };
  ipcMain.on('whiteboard-report', report);
  ipcMain.on('whiteboard-ready', ready);
  ipcMain.on('whiteboard-hide', dismiss);
  screen.on('display-metrics-changed', hide);
  screen.on('display-removed', hide);
  overlay.on('closed', () => {
    globalShortcut.unregister('Escape');
    ipcMain.removeListener('whiteboard-report', report);
    ipcMain.removeListener('whiteboard-ready', ready);
    ipcMain.removeListener('whiteboard-hide', dismiss);
    screen.removeListener('display-metrics-changed', hide);
    screen.removeListener('display-removed', hide);
  });
  overlay.webContents.on('render-process-gone', hide);
  await overlay.loadFile(path.join(__dirname, 'whiteboard/index.html'));
  let saving = false;
  const command = async (message) => {
    if (message.action === 'hide') {
      hide();
      return;
    }
    if (message.action === 'tool') {
      if (!['pen', 'box', 'text', 'arrow', 'move'].includes(message.tool))
        throw Error('Unknown drawing tool');
      state.tool = message.tool;
      if (!state.active) {
        overlay.setBounds(screen.getDisplayMatching(panel.getBounds()).bounds);
        state.active = true;
        state.notice = globalShortcut.register('Escape', hide)
          ? 'Escape or Use desktop returns to your apps.'
          : 'Use desktop returns to your apps. Escape works when the drawing layer is focused.';
      }
      overlay.show();
      send({ action: 'tool', tool: state.tool, label: state.label });
      raisePanel();
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
    if (['undo', 'clear'].includes(message.action)) {
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
      const board = validateBoard(
        await overlay.webContents.executeJavaScript('window.whiteboard.snapshot()'),
      );
      let data, extension;
      if (message.action === 'save-image') {
        // Marks only: never captures other applications or their private content.
        const image = await overlay.webContents.executeJavaScript('window.whiteboard.image()');
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
  return { command, overlay, getState: () => ({ ...state }), destroy: () => overlay.destroy() };
};
