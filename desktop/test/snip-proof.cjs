// Image editing uses a controlled PNG. Opt in to the actual native picker separately.
const { BrowserWindow, screen, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.run = async ({ win, whiteboard, button, tool, drag, click, snapshot, panel, output }) => {
  const display = screen.getDisplayMatching(win.getBounds());
  const fixture = new BrowserWindow({
    x: display.bounds.x + 40,
    y: display.bounds.y + 500,
    width: 400,
    height: 260,
    frame: false,
    show: false,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  });
  const interactive = process.env.VOYAGER_SNIP_INTERACTIVE === '1';
  try {
    await fixture.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="margin:0;background:linear-gradient(to right,#ea3469 50%,#36bf83 50%);height:100vh"></body>',
        ),
    );
    await button('#wb-clear');
    await tool('select');
    if (interactive) {
      fixture.show();
      win.moveTop();
      win.focus();
      console.log(
        'NATIVE SNIP: select a rectangle across BOTH colours of the pink/green card, then capture.',
      );
      await button('#wb-snip');
      for (let i = 0; i < 1250; i++) {
        if (!whiteboard.getState().capturing && (await snapshot()).nodes.length) break;
        if (whiteboard.getState().error) throw Error(whiteboard.getState().error);
        await delay(100);
      }
      assert.equal((await snapshot()).nodes.length, 1, 'Native picker must return a snippet');
      const image = nativeImage.createFromDataURL((await snapshot()).nodes[0].image);
      const data = image.toBitmap();
      const colours = new Set();
      for (let i = 0; i < data.length; i += 4)
        colours.add(`${data[i + 2]},${data[i + 1]},${data[i]}`);
      assert(
        colours.has('234,52,105') && colours.has('54,191,131'),
        'Native capture contains both real desktop colours',
      );
      await fs.writeFile(path.join(output, 'native-snippet.png'), image.toPNG());
      await button('#wb-clear');
    }
    const png = (await fixture.webContents.capturePage()).toDataURL();
    await panel(
      `window.whiteboard.command(${JSON.stringify({ action: 'insert-image', image: png, rect: { x: 60, y: 520, width: 360, height: 200 } })})`,
    );
    await delay(100);
    let image = (await snapshot()).nodes[0];
    assert.equal(whiteboard.getState().selectedCount, 1);
    await drag([300, 650], [550, 850]);
    image = (await snapshot()).nodes[0];
    assert.equal(image.x, 490);
    assert.equal(image.y, 820);
    await drag([670, 920], [760, 970]);
    image = (await snapshot()).nodes[0];
    assert.equal(image.width, 450);
    assert.equal(image.height, 250);
    await click(image.x, image.y, 2);
    assert.equal(
      await panel("document.querySelector('#editor').hidden"),
      true,
      'Images never open the text editor',
    );
    await tool('pen');
    await drag([400, 800], [600, 820]);
    assert.equal((await snapshot()).strokes.length, 1);
    assert.equal(
      (await snapshot()).nodes[0].x,
      image.x,
      'Pen annotates rather than moving the image',
    );
    assert(
      await panel(
        "document.querySelector('#board image').compareDocumentPosition(document.querySelector('#board polyline')) & Node.DOCUMENT_POSITION_FOLLOWING",
      ),
      'Ink is rendered above images',
    );
    await tool('select');
    await drag([300, 700], [780, 990]);
    assert.equal(whiteboard.getState().selectedCount, 2, 'Image and ink select together');
    await button('#wb-delete');
    assert.equal((await snapshot()).nodes.length, 0);
    await button('#wb-undo');
    assert.equal((await snapshot()).nodes.length, 1);
    const beforeCancel = await snapshot();
    const pending = whiteboard.command({ action: 'snip' });
    assert(whiteboard.getState().capturing);
    whiteboard.command({ action: 'hide' });
    await pending;
    assert.deepEqual(
      await snapshot(),
      beforeCancel,
      'Cancelling before the picker preserves the board',
    );
    assert(!whiteboard.getState().active);
    assert(win.isVisible(), 'Cancelled capture restores Voyager');
    await tool('select');
    assert.equal((await snapshot()).strokes.length, 1);
    await button('#wb-clear');
    assert.equal((await snapshot()).nodes.length, 0);
    await button('#wb-undo');
    assert.equal((await snapshot()).nodes.length, 1);
    assert.equal(await panel("document.getElementById('hint')"), null);
    assert.equal(await panel("document.getElementById('wb-status').hidden"), true);
    await fs.writeFile(
      path.join(output, 'snippet-board.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    await fs.writeFile(
      path.join(output, 'snippet-result.json'),
      JSON.stringify(
        {
          verdict: 'surface',
          nativePickerTested: interactive,
          observed: [
            'Move and proportional resize',
            'Ink above image, group select, delete, clear and undo',
            'No canvas or sidebar help text',
            'Cancellation before opening the native picker preserves the board',
            ...(interactive ? ['Native screenshot portal returned both real desktop colours'] : []),
          ],
          limits: [
            'Physical drawing feel remains a user check',
            ...(interactive
              ? ['Capture tested only on Fedora GNOME']
              : ['Native picker requires the interactive proof']),
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    fixture.destroy();
  }
};
