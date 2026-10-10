// Opt-in interaction proof: every sidebar action is reached with pointer input.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { BrowserWindow, screen } = require('electron');
const { windowAt } = require('../src/binding.cjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({ win, avatarWin, whiteboard, setExpanded, rpc, inventory }) => {
  const output = process.env.VOYAGER_WHITEBOARD_PROOF;
  if (!output || !path.isAbsolute(output))
    throw Error('Set VOYAGER_WHITEBOARD_PROOF to an absolute directory');
  await fs.mkdir(output, { recursive: true });
  const before = await rpc('status');
  await setExpanded(true);
  win.focus();
  await delay(250);
  const panel = (code) => win.webContents.executeJavaScript(code, true);
  const drawing = panel;
  const snapshot = () => whiteboard.snapshot();
  async function click(x, y, count = 1, modifiers = []) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      clickCount: count,
      modifiers,
    });
    await delay(35);
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      clickCount: count,
      modifiers,
    });
    await delay(100);
  }
  async function button(selector) {
    const p = await panel(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:e.disabled}})()`,
    );
    assert(!p.disabled, `${selector} must be enabled`);
    await click(p.x, p.y);
  }
  async function tool(name) {
    await button(`[data-drawing-tool="${name}"]`);
    assert.equal(whiteboard.getState().tool, name);
  }
  async function typeInline(text, finish = true) {
    assert.equal(await drawing('document.activeElement.id'), 'editor');
    assert.equal(await drawing(`document.querySelector('#editor').hidden`), false);
    await win.webContents.insertText(text);
    if (finish) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    }
    await delay(100);
  }
  async function drag(a, b) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: a[0], y: a[1] });
    await delay(35);
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      x: a[0],
      y: a[1],
      button: 'left',
      clickCount: 1,
    });
    for (let i = 1; i <= 12; i++) {
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(a[0] + ((b[0] - a[0]) * i) / 12),
        y: Math.round(a[1] + ((b[1] - a[1]) * i) / 12),
      });
      await delay(15);
    }
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      x: b[0],
      y: b[1],
      button: 'left',
      clickCount: 1,
    });
    await delay(100);
  }
  const compact = win.getBounds();
  assert.equal(await panel("document.querySelector('#wb-tools').hidden"), true);
  assert.equal(
    await panel(
      "getComputedStyle(document.querySelector('#wb-toggle')).getPropertyValue('-webkit-app-region')",
    ),
    'no-drag',
  );
  await fs.writeFile(
    path.join(output, 'collapsed.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  await button('#wb-toggle');
  assert.equal(await panel("document.querySelector('#wb-tools').hidden"), false);
  const normal = win.getBounds();
  assert(normal.height > compact.height, 'Expanding controls grows the glass panel');
  const avatarBefore = avatarWin.getBounds();
  for (const id of ['wb-label', 'wb-image', 'wb-json', 'wb-open', 'wb-mermaid'])
    assert.equal(
      await panel(`document.getElementById('${id}')`),
      null,
      'Only direct drawing controls belong in the panel',
    );
  await tool('pen');
  assert(whiteboard.getState().active);
  assert.deepEqual(win.getBounds(), screen.getDisplayMatching(normal).bounds);
  assert.equal(
    BrowserWindow.getAllWindows().length,
    2,
    'Only the existing panel and astronaut windows; no separate canvas window',
  );
  assert.deepEqual(
    avatarWin.getBounds(),
    avatarBefore,
    'Expanding the canvas must keep the astronaut in its seat',
  );
  assert.equal(avatarWin.getParentWindow(), win);
  assert.equal(
    await panel(
      "getComputedStyle(document.querySelector('#panel')).getPropertyValue('-webkit-app-region')",
    ),
    'no-drag',
  );
  const assertAvatarReachable = async () => {
    const b = avatarWin.getBounds();
    const point = screen.dipToScreenPoint({
      x: b.x + Math.round(b.width / 2),
      y: b.y + Math.round(b.height / 2),
    });
    assert.equal(
      windowAt(await inventory(), point)?.id,
      avatarWin.getNativeWindowHandle().readUInt32LE(),
      'Native stack must leave the astronaut above the drawing panel',
    );
  };
  await assertAvatarReachable();
  // Deliberately recreate the bug inside the window: canvas over controls.
  await panel(`document.querySelector('#drawing').style.zIndex='2'`);
  await button('[data-drawing-tool="box"]');
  assert.equal(
    whiteboard.getState().tool,
    'pen',
    'Known-broken stacking must swallow the Box click',
  );
  await panel(`document.querySelector('#drawing').style.zIndex=''`);
  await tool('box');
  await button('#wb-clear');
  assert.equal(await panel(`document.querySelector('#wb-label')`), null);
  await click(200, 200);
  await typeInline('Desktop sketch');
  assert.equal((await snapshot()).nodes[0].label, 'Desktop sketch');
  await button('#wb-undo');
  assert.equal((await snapshot()).nodes.length, 0, 'Undo removes a newly labelled box in one step');
  await click(200, 200);
  await typeInline('Desktop sketch');
  await click(550, 200);
  await typeInline('Agent planning', false);
  // Switching tools commits in-place text without needing Enter first.
  await tool('text');
  assert.equal((await snapshot()).nodes[1].label, 'Agent planning');
  await click(850, 360);
  await typeInline('A shared thought');
  await tool('arrow');
  const textId = (await snapshot()).nodes[2].id;
  assert.deepEqual(
    await drawing(
      `(()=>{const r=document.querySelector('[data-node="${textId}"] rect');return [r.getAttribute('fill'),r.getAttribute('stroke')]})()`,
    ),
    ['transparent', 'none'],
    'Text must render without a card background or outline',
  );
  await click(200, 200);
  await click(550, 200);
  assert.equal((await snapshot()).edges.length, 1);
  await tool('pen');
  await drag([150, 400], [450, 430]);
  assert.equal((await snapshot()).strokes.length, 1);
  await tool('select');
  await click(200, 200);
  assert.equal(whiteboard.getState().selectedCount, 1);
  // Bottom-right resize handle must change the box rather than move it.
  await drag([300, 232], [350, 272]);
  let board = await snapshot();
  assert.equal(board.nodes[0].width, 250, JSON.stringify(board.nodes[0]));
  assert.equal(board.nodes[0].height, 104);
  // Double-click opens direct text editing inside the box.
  await click(225, 220);
  await click(225, 220, 2);
  await typeInline('Direct edit');
  assert.equal((await snapshot()).nodes[0].label, 'Direct edit');
  await button('#wb-undo');
  assert.equal((await snapshot()).nodes[0].label, 'Desktop sketch');
  assert.equal(
    (await snapshot()).nodes[0].width,
    250,
    'Undo text editing preserves the resized box',
  );
  // Marquee two boxes, move together, and undo as one operation.
  await drag([80, 130], [680, 300]);
  assert.equal(whiteboard.getState().selectedCount, 2);
  const old = await snapshot();
  await drag([225, 220], [275, 250]);
  board = await snapshot();
  assert.equal(board.nodes[0].x, old.nodes[0].x + 50);
  assert.equal(board.nodes[1].x, old.nodes[1].x + 50);
  await button('#wb-undo');
  assert.equal((await snapshot()).nodes[0].x, old.nodes[0].x);
  // Shift-click expands selection. Strokes can participate as well.
  await click(225, 220);
  await click(550, 200, 1, ['shift']);
  assert.equal(whiteboard.getState().selectedCount, 2);
  await click(300, 415, 1, ['shift']);
  assert.equal(whiteboard.getState().selectedCount, 3);
  await button('#wb-delete');
  assert.equal((await snapshot()).nodes.length, 1);
  assert.equal((await snapshot()).strokes.length, 0);
  await button('#wb-undo');
  assert.equal((await snapshot()).nodes.length, 3);
  assert.equal((await snapshot()).strokes.length, 1);
  await button('#wb-clear');
  assert.equal((await snapshot()).nodes.length, 0);
  await button('#wb-undo');
  assert.equal((await snapshot()).nodes.length, 3);
  await button('#wb-toggle');
  assert(!whiteboard.getState().active, 'Collapsing controls releases desktop input');
  await delay(150);
  assert.equal(win.getBounds().height, compact.height);
  await button('#wb-toggle');
  await tool('pen');
  await button('#wb-hide');
  assert(!whiteboard.getState().active);
  assert.deepEqual(win.getBounds(), normal);
  assert.equal(
    await panel(
      "getComputedStyle(document.querySelector('#panel')).getPropertyValue('-webkit-app-region')",
    ),
    'drag',
  );
  await tool('select');
  await click(225, 220);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await delay(100);
  assert(!whiteboard.getState().active);
  await tool('select');
  assert.equal((await snapshot()).nodes.length, 3);
  const capture = await win.webContents.capturePage();
  assert.equal(capture.toBitmap()[3], 0, 'Desktop background must stay transparent');
  await fs.writeFile(path.join(output, 'shared-surface.png'), capture.toPNG());
  await fs.writeFile(
    path.join(output, 'sidebar.png'),
    (
      await win.webContents.capturePage({
        x: whiteboard.getState().sidebar.x,
        y: whiteboard.getState().sidebar.y,
        width: normal.width,
        height: normal.height,
      })
    ).toPNG(),
  );
  await assertAvatarReachable();
  await require('./snip-proof.cjs').run({
    win,
    avatarWin,
    inventory,
    whiteboard,
    button,
    tool,
    drag,
    click,
    snapshot,
    panel,
    output,
  });
  await assertAvatarReachable();
  avatarWin.focus();
  avatarWin.webContents.sendInputEvent({
    type: 'mouseDown',
    x: 60,
    y: 60,
    button: 'left',
    clickCount: 1,
  });
  await delay(40);
  avatarWin.webContents.sendInputEvent({
    type: 'mouseUp',
    x: 60,
    y: 60,
    button: 'left',
    clickCount: 1,
  });
  await delay(250);
  assert(!win.isVisible(), 'Astronaut click still closes the drawing panel');
  assert(avatarWin.isVisible());
  assert.equal(avatarWin.getParentWindow(), null);
  avatarWin.webContents.sendInputEvent({
    type: 'mouseDown',
    x: 60,
    y: 60,
    button: 'left',
    clickCount: 1,
  });
  await delay(40);
  avatarWin.webContents.sendInputEvent({
    type: 'mouseUp',
    x: 60,
    y: 60,
    button: 'left',
    clickCount: 1,
  });
  await delay(250);
  assert(win.isVisible(), 'The next astronaut click reopens the panel after Snip');
  await assertAvatarReachable();
  await setExpanded(false);
  await delay(100);
  assert(!whiteboard.getState().active);
  assert.equal((await rpc('status')).instance, before.instance);
  await fs.writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        verdict: 'surface',
        observed: [
          'drawing and glass controls share the panel, with the astronaut above it in the native stack',
          'collapsible controls resize the panel and release drawing when collapsed',
          'native drag regions preserve button clicks and panel dragging outside drawing mode',
          'pointer clicks detect deliberate canvas-over-sidebar bug',
          'Pen Box Text Connect Select all reachable while drawing',
          'new boxes and text receive keyboard focus directly on the canvas',
          'creation and initial label undo together; later text edits undo separately',
          'tool switching commits inline text; no sidebar label field',
          'box resize',
          'marquee select and group move with undo',
          'Shift-click extends selection to boxes and strokes',
          'Delete selected and undo',
          'Clear Undo Done and collapse reachable through pointer input',
          'no sidebar label or save/open/export controls',
          'Escape and collapse restore ordinary window',
          'same service instance',
        ],
        limits: [
          'physical pointer and drawing feel need final user check',
          'agent MCP tools and persistence remain planned',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Shared-surface whiteboard interaction checks passed.');
};
