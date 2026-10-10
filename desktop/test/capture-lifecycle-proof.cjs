// Exercise real Electron/X11 windows with a controlled screenshot-helper reply.
// The interactive proof separately checks the desktop portal and actual pixels.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function inputArea(win) {
  const { stdout } = await exec('/usr/bin/python3', [
    '-c',
    `import ctypes as c
class Rect(c.Structure):
    _fields_ = [('x', c.c_short), ('y', c.c_short), ('width', c.c_ushort), ('height', c.c_ushort)]
x = c.CDLL('libX11.so.6')
s = c.CDLL('libXext.so.6')
x.XOpenDisplay.argtypes = [c.c_char_p]
x.XOpenDisplay.restype = c.c_void_p
x.XCloseDisplay.argtypes = [c.c_void_p]
x.XFree.argtypes = [c.c_void_p]
s.XShapeGetRectangles.argtypes = [c.c_void_p, c.c_ulong, c.c_int, c.POINTER(c.c_int), c.POINTER(c.c_int)]
s.XShapeGetRectangles.restype = c.POINTER(Rect)
d = x.XOpenDisplay(None)
assert d, 'X11 display unavailable'
n, ordering = c.c_int(), c.c_int()
rects = s.XShapeGetRectangles(d, ${win.getNativeWindowHandle().readUInt32LE()}, 2, c.byref(n), c.byref(ordering))
print(sum(rects[i].width * rects[i].height for i in range(n.value)))
if rects: x.XFree(rects)
x.XCloseDisplay(d)
`,
  ]);
  return Number(stdout.trim());
}
const hasPixels = (image) => image.toBitmap().some((byte, index) => index % 4 === 3 && byte);

exports.run = async ({ win, avatarWin, whiteboard, inventory, png, output }) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voyager-capture-proof-'));
  const response = path.join(directory, 'response.json');
  const started = path.join(directory, 'started');
  const imageFile = path.join(directory, 'fixture.png');
  const previousPath = process.env.PATH;
  const clients = [win, avatarWin];
  let pending;
  try {
    await fs.writeFile(imageFile, png);
    await fs.writeFile(
      path.join(directory, 'python3'),
      `#!/usr/bin/python3
import pathlib, sys, time
assert len(sys.argv) == 2 and pathlib.Path(sys.argv[1]).name == 'screenshot.py'
response = pathlib.Path(${JSON.stringify(response)})
pathlib.Path(${JSON.stringify(started)}).touch()
for _ in range(200):
    if response.exists():
        print(response.read_text())
        break
    time.sleep(0.05)
else:
    raise RuntimeError('Proof did not release the helper')
`,
      { mode: 0o700 },
    );
    process.env.PATH = `${directory}${path.delimiter}${previousPath}`;
    for (const outcome of [
      { uri: pathToFileURL(imageFile).href },
      { cancelled: true },
      { error: 'Controlled capture failure' },
    ]) {
      const before = await whiteboard.snapshot();
      const bounds = clients.map((client) => client.getBounds());
      pending = whiteboard.command({ action: 'snip' });
      for (let i = 0; i < 50; i++) {
        if (await fs.stat(started).catch(() => null)) break;
        await delay(50);
      }
      await fs.stat(started);
      assert(whiteboard.getState().capturing, 'Helper is waiting for capture completion');
      const windows = await inventory();
      for (const [index, client] of clients.entries()) {
        assert(client.isVisible(), 'Capture must not unmap either linked window');
        assert(
          windows.some((w) => w.id === client.getNativeWindowHandle().readUInt32LE() && w.visible),
          'Both windows remain in the native mapped stack',
        );
        assert.deepEqual(client.getBounds(), bounds[index]);
        // Chromium uses a 1x1 input region for an ignored X11 window.
        assert((await inputArea(client)) <= 1, 'Invisible windows must pass native input');
        assert(!hasPixels(await client.webContents.capturePage()), 'No Voyager pixels in Snip');
      }
      assert.equal(avatarWin.getParentWindow(), win);
      // Known-different arm: leaving the avatar painted must fail the pixel check.
      await avatarWin.webContents.executeJavaScript("document.body.dataset.capturing='false'");
      assert(hasPixels(await avatarWin.webContents.capturePage()));
      await avatarWin.webContents.executeJavaScript("document.body.dataset.capturing='true'");
      await fs.writeFile(response, JSON.stringify(outcome));
      await pending;
      pending = null;
      await delay(150);
      assert(!whiteboard.getState().capturing);
      assert(whiteboard.getState().active, 'Returning from Snip keeps the drawing open');
      assert.equal(avatarWin.getParentWindow(), win);
      for (const client of clients) {
        assert(client.isVisible());
        assert((await inputArea(client)) > 1, 'Native input is restored');
        assert(hasPixels(await client.webContents.capturePage()), 'Voyager is painted again');
      }
      const after = await whiteboard.snapshot();
      if (outcome.uri) {
        assert.equal(after.nodes.length, before.nodes.length + 1);
        assert.equal(after.nodes.at(-1).kind, 'image');
      } else {
        assert.deepEqual(after, before, 'Cancel and failure preserve every mark');
      }
      if (outcome.error) assert.match(whiteboard.getState().error, /Controlled capture failure/);
      await fs.unlink(response);
      await fs.unlink(started);
    }
    await fs.writeFile(
      path.join(output, 'capture-lifecycle.json'),
      JSON.stringify(
        {
          result: 'pass',
          cases: ['capture success', 'picker cancellation', 'capture failure'],
          checks: [
            'native mapping and input shapes',
            'transparent capture frames',
            'parent relationship',
            'board preservation',
          ],
          limit: 'Controlled helper response; actual portal requires the interactive proof',
        },
        null,
        2,
      ),
    );
  } finally {
    if (pending) {
      whiteboard.command({ action: 'hide' });
      await pending;
    }
    process.env.PATH = previousPath;
    await fs.rm(directory, { recursive: true, force: true });
  }
};
