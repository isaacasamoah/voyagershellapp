// Deliberate visible Electron interaction proof, separate from normal tests.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = process.env.VOYAGER_WHITEBOARD_PROOF;
if (!output || !path.isAbsolute(output))
  throw Error('Set VOYAGER_WHITEBOARD_PROOF to an absolute evidence directory');
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await fs.mkdir(output, { recursive: true });
    const downloads = [];
    win.webContents.session.on('will-download', (_event, item) => {
      item.setSavePath(path.join(output, item.getFilename()));
      downloads.push(
        new Promise((resolve, reject) =>
          item.once('done', (_e, state) =>
            state === 'completed' ? resolve() : reject(Error(state)),
          ),
        ),
      );
    });
    await win.loadFile(path.join(__dirname, '../whiteboard/index.html'));
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const click = async (x, y) => {
      win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 40));
    };
    const bounds = await js(
      `(()=>{const r=document.querySelector('#board').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`,
    );
    const point = (x, y) => [
      Math.round(bounds.x + (x / 1400) * bounds.w),
      Math.round(bounds.y + (y / 800) * bounds.h),
    ];
    await js(
      `document.querySelector('[data-tool="box"]').click();document.querySelector('#label').value='Human sketch'`,
    );
    await click(...point(260, 240));
    await js(`document.querySelector('#label').value='Agent interpretation'`);
    await click(...point(700, 240));
    await js(`document.querySelector('[data-tool="arrow"]').click()`);
    await click(...point(260, 240));
    await click(...point(700, 240));
    await js(`document.querySelector('[data-tool="pen"]').click()`);
    const [x, y] = point(240, 380);
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 20; i++) {
      const [px, py] = point(240 + i * 20, 380 + Math.sin(i / 3) * 30);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: px, y: py });
    }
    const [ex, ey] = point(640, 390);
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      x: ex,
      y: ey,
      button: 'left',
      clickCount: 1,
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      await js(`document.querySelector('#count').textContent`),
      '2 ideas · 1 connections · 1 strokes',
    );
    await js(
      `document.querySelector('#json').click();document.querySelector('#mermaid').click();document.querySelector('#png').click()`,
    );
    await new Promise((r) => setTimeout(r, 1000));
    await Promise.all(downloads);
    assert.equal(downloads.length, 3);
    const board = JSON.parse(await fs.readFile(path.join(output, 'voyager-board.json'), 'utf8'));
    assert.equal(board.nodes.length, 2);
    assert.equal(board.edges.length, 1);
    assert.ok(board.strokes[0].length > 2);
    assert.match(await fs.readFile(path.join(output, 'voyager-board.mmd'), 'utf8'), /N0 --> N1/);
    const shot = await win.webContents.capturePage();
    await fs.writeFile(path.join(output, 'whiteboard.png'), shot.toPNG());
    // A programmatic edit exercises the file-exchange contract an agent would use.
    board.nodes.push({ id: 'nagent', kind: 'box', label: 'Mermaid plan', x: 1120, y: 240 });
    board.edges.push({ from: board.nodes[1].id, to: 'nagent' });
    await fs.writeFile(path.join(output, 'agent-board.json'), JSON.stringify(board, null, 2));
    async function importBoard(content) {
      await js(
        `(()=>{const f=new File([${JSON.stringify(content)}],'agent-board.json',{type:'application/json'});const dt=new DataTransfer();dt.items.add(f);const el=document.querySelector('#open');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await new Promise((r) => setTimeout(r, 100));
    }
    await importBoard(JSON.stringify(board));
    assert.equal(
      await js(`document.querySelector('#count').textContent`),
      '3 ideas · 2 connections · 1 strokes',
    );
    await importBoard('{"version":999}');
    assert.match(await js(`document.querySelector('#hint').textContent`), /Could not open board/);
    assert.equal(
      await js(`document.querySelector('#count').textContent`),
      '3 ideas · 2 connections · 1 strokes',
    );
    await js(`document.querySelector('#undo').click()`);
    assert.equal(
      await js(`document.querySelector('#count').textContent`),
      '2 ideas · 1 connections · 1 strokes',
    );
    await fs.writeFile(
      path.join(output, 'result.json'),
      JSON.stringify(
        {
          verdict: 'pass',
          actor: 'Electron input driver and deterministic JSON-edit fixture',
          observed: [
            'box placement',
            'pointer stroke',
            'connect two nodes',
            'PNG JSON Mermaid downloaded',
            'programmatically edited board imported',
            'invalid import preserves canvas',
            'undo restores previous board',
          ],
          limits: [
            'no service tool integration',
            'no model-based sketch interpretation',
            'physical user interaction pending',
          ],
        },
        null,
        2,
      ),
    );
    console.log('Whiteboard Electron proof passed');
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
