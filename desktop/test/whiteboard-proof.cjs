// Opt-in proof through the real Voyager sidebar and transparent desktop layer.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { screen, dialog } = require('electron');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({ win, whiteboard, setExpanded, rpc }) => {
  const output = process.env.VOYAGER_WHITEBOARD_PROOF;
  if (!output || !path.isAbsolute(output))
    throw Error('Set VOYAGER_WHITEBOARD_PROOF to an absolute evidence directory');
  await fs.mkdir(output, { recursive: true });
  const before = await rpc('status');
  setExpanded(true);
  const panel = (code) => win.webContents.executeJavaScript(code, true);
  const overlay = whiteboard.overlay;
  const drawing = (code) => overlay.webContents.executeJavaScript(code, true);
  const click = async (x, y) => {
    overlay.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    overlay.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await delay(35);
    overlay.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await delay(100);
  };
  const tool = async (name) => {
    await panel(`document.querySelector('[data-drawing-tool="${name}"]').click()`);
    await delay(150);
  };
  const label = async (text) => {
    await panel(
      `(()=>{const e=document.getElementById('wb-label');e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input'));})()`,
    );
    await delay(80);
  };
  assert.equal(overlay.isVisible(), false);
  await tool('box');
  assert(overlay.isVisible());
  assert.deepEqual(overlay.getBounds(), screen.getDisplayMatching(win.getBounds()).bounds);
  await label('Desktop sketch');
  await click(200, 200);
  await label('Agent planning');
  await click(550, 200);
  await tool('arrow');
  await click(200, 200);
  await click(550, 200);
  await tool('pen');
  overlay.webContents.sendInputEvent({
    type: 'mouseDown',
    x: 150,
    y: 350,
    button: 'left',
    clickCount: 1,
  });
  for (let i = 1; i <= 16; i++) {
    overlay.webContents.sendInputEvent({
      type: 'mouseMove',
      x: 150 + i * 20,
      y: 350 + Math.round(Math.sin(i / 3) * 35),
    });
    await delay(20);
  }
  overlay.webContents.sendInputEvent({
    type: 'mouseUp',
    x: 470,
    y: 320,
    button: 'left',
    clickCount: 1,
  });
  await delay(150);
  let board = await drawing('window.whiteboard.snapshot()');
  assert.equal(board.nodes.length, 2);
  assert.equal(board.edges.length, 1);
  assert.equal(board.strokes.length, 1);
  assert(board.strokes[0].length > 5);
  const frame = await overlay.webContents.capturePage();
  const bitmap = frame.toBitmap();
  assert.equal(bitmap[3], 0, 'Empty desktop pixels must remain fully transparent');
  await fs.writeFile(path.join(output, 'overlay.png'), frame.toPNG());
  await fs.writeFile(
    path.join(output, 'sidebar.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  // The dialogs are replaced only here to choose bounded evidence filenames.
  const saveDialog = dialog.showSaveDialog,
    openDialog = dialog.showOpenDialog;
  try {
    dialog.showSaveDialog = async (_parent, options) => ({
      canceled: false,
      filePath: path.join(output, options.defaultPath),
    });
    for (const action of ['save-board', 'save-mermaid', 'save-image'])
      await whiteboard.command({ action });
    assert.equal(overlay.isVisible(), false);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(output, 'voyager-board.json'), 'utf8')).nodes.length,
      2,
    );
    assert.match(await fs.readFile(path.join(output, 'voyager-board.mmd'), 'utf8'), /N0 --> N1/);
    const png = await fs.readFile(path.join(output, 'voyager-board.png'));
    assert(png.length > 1000);
    board.nodes.push({ id: 'nagent', kind: 'box', label: 'Review together', x: 900, y: 200 });
    board.edges.push({ from: board.nodes[1].id, to: 'nagent' });
    const imported = path.join(output, 'edited-board.json');
    await fs.writeFile(imported, JSON.stringify(board));
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imported] });
    await whiteboard.command({ action: 'open' });
    await delay(100);
    assert.equal((await drawing('window.whiteboard.snapshot()')).nodes.length, 3);
    await fs.writeFile(imported, '{"version":999}');
    await assert.rejects(() => whiteboard.command({ action: 'open' }));
    assert.equal((await drawing('window.whiteboard.snapshot()')).nodes.length, 3);
    await tool('pen');
    await panel(`document.getElementById('wb-undo').click()`);
    await delay(100);
    assert.equal((await drawing('window.whiteboard.snapshot()')).nodes.length, 2);
  } finally {
    dialog.showSaveDialog = saveDialog;
    dialog.showOpenDialog = openDialog;
  }
  await panel(`document.getElementById('wb-hide').click()`);
  await delay(100);
  assert.equal(overlay.isVisible(), false);
  await tool('pen');
  assert.equal((await drawing('window.whiteboard.snapshot()')).nodes.length, 2);
  overlay.focus();
  overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await delay(150);
  assert.equal(overlay.isVisible(), false);
  await tool('pen');
  setExpanded(false);
  await delay(100);
  assert.equal(overlay.isVisible(), false);
  assert.equal((await rpc('status')).instance, before.instance);
  await fs.writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        verdict: 'surface',
        observed: [
          'existing sidebar controls the transparent layer',
          'layer matches the sidebar display',
          'empty pixels alpha zero',
          'pointer strokes, boxes and connections',
          'file exports and edited board import',
          'invalid board refused without loss',
          'hide and Escape remove input layer',
          'marks survive hide and reopen',
          'collapsing sidebar hides drawing layer',
          'same service instance',
        ],
        limits: [
          'compositor appearance and physical click routing require user check',
          'one display per drawing session',
          'no live agent whiteboard service tools',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'Desktop whiteboard checks passed; physical desktop interaction remains a user check.',
  );
};
