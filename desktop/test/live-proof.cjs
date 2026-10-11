// Opt-in: uses the existing service and real desktop windows. No model calls.
// App-local pointer events verify the click handler, not compositor-level drag.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { screen } = require('electron');
const { processIdentity, registeredSession, windowAt } = require('../src/binding.cjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({
  avatarWin,
  panelWin,
  advanceDrag,
  updateDockHover,
  rpc,
  refresh,
  inventory,
  dock,
  undock,
  setExpanded,
  park,
  getState,
  stateDir,
}) => {
  const receipts = [];
  const file = path.join(stateDir, 'desktop-refinement-proof.json');
  await fs.writeFile(file, JSON.stringify({ verdict: 'running' }));
  // sendInputEvent bypasses native hit testing: clickable controls must also be
  // excluded from Electron's window-drag regions, which swallow real clicks.
  const region = (client, selector) =>
    client.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue('-webkit-app-region')`,
    );
  assert.equal(
    await region(avatarWin, '#avatar'),
    'no-drag',
    'The astronaut must receive real pointer events',
  );
  assert.equal(
    await region(panelWin, '#panel'),
    'drag',
    'The panel background must move its native window',
  );
  for (const selector of ['#quit', '.session'])
    assert.equal(await region(panelWin, selector), 'no-drag', `${selector} must remain clickable`);
  receipts.push('Native drag regions exclude the astronaut and panel buttons');
  const existing = getState().records.find((r) => {
    const session = registeredSession(r, getState().sessions);
    return (
      session?.capture === 'connected' &&
      getState().windows.some((w) => w.pid === r.pid && w.visible)
    );
  });
  assert(existing, 'Open a registered native terminal before running this proof');
  const session = registeredSession(existing, getState().sessions);
  const serviceBefore = await rpc('status');
  const nativeBefore =
    session.ownership === 'managed'
      ? await rpc('attach-info', session.id)
      : { pid: existing.frontend.pid };
  const original = await processIdentity(nativeBefore.pid);
  const opened = {
    terminalPid: existing.pid,
    frontendPid: existing.frontend.pid,
    sessionId: session.id,
  };
  await refresh();
  const ours = getState().windows.find((w) => w.pid === opened.terminalPid && w.visible);
  assert(ours, 'The native terminal must be present');
  if (existing)
    receipts.push(
      'Rediscovered an already-open native session terminal without a UI launch record',
    );
  const other = spawn(
    '/usr/bin/ghostty',
    [
      '--gtk-single-instance=false',
      '--title=' + ours.title,
      '-e',
      '/bin/bash',
      '--noprofile',
      '--norc',
    ],
    { env: { ...process.env, GDK_BACKEND: 'x11' }, stdio: 'ignore' },
  );
  await new Promise((resolve, reject) => {
    other.once('spawn', resolve);
    other.once('error', reject);
  });
  let unrelated;
  try {
    for (let n = 0; n < 40; n++) {
      await delay(250);
      await refresh();
      unrelated = getState().windows.find((w) => w.pid === other.pid && w.visible);
      if (unrelated?.title === ours.title) break;
    }
    assert(unrelated, 'The unrelated terminal must be visible');
    assert.equal(unrelated.title, ours.title);
    await setExpanded(false);
    assert.equal(await dock(unrelated.id), false);
    assert(!panelWin.isVisible(), 'Dropping on an unsupported window must not open the panel');
    assert.equal(await dock(ours.id), true);
    assert(!panelWin.isVisible(), 'Docking the floating astronaut must not open the panel');
    assert.equal(getState().binding.session.id, session.id);
    const markerId = avatarWin.getNativeWindowHandle().readUInt32LE();
    const stack = await inventory();
    assert(stack.findIndex((w) => w.id === markerId) > stack.findIndex((w) => w.id === ours.id));
    assert.deepEqual(
      (await inventory()).find((w) => w.id === markerId).input_region,
      [{ x: 0, y: 0, width: 1, height: 1 }],
      'Docked marker yields input except its transparent corner pixel',
    );
    await delay(250);
    assert.equal(
      await avatarWin.webContents.executeJavaScript(
        "getComputedStyle(document.getElementById('avatar')).opacity",
      ),
      '0.3',
      'Only the terminal marker fades',
    );
    receipts.push('Exact native session accepted; unrelated same-title terminal refused');
    const bounds = avatarWin.getBounds();
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const sample = (point, buttons) => ({
      windows: stack,
      pointer: { ...screen.dipToScreenPoint(point), buttons },
    });
    // Exercise the same hover transition with explicit pointer samples, without
    // moving the desktop pointer or making a claim about physical mouse delivery.
    updateDockHover(sample(center, 256));
    assert(!getState().dockHovered, 'An existing text-selection drag must stay with the terminal');
    updateDockHover({ ...sample(center, 0), windows: [] });
    assert(!getState().dockHovered, 'A covered or missing target must not activate');
    updateDockHover(sample(center, 0));
    assert(getState().dockHovered, 'Hover over the visible marker enables grabbing');
    assert.equal(avatarWin.isFocusable(), false, 'Hover must leave keyboard focus alone');
    const region = (await inventory()).find((w) => w.id === markerId).input_region;
    assert(
      region.some((r) => r.width > 1 && r.height > 1),
      'Hover restores native pointer input',
    );
    assert.equal(
      await avatarWin.webContents.executeJavaScript(
        "getComputedStyle(document.getElementById('avatar')).opacity",
      ),
      '1',
    );
    updateDockHover(sample({ x: bounds.x - 20, y: bounds.y }, 0));
    assert(!getState().dockHovered, 'Leaving restores the passive marker');
    receipts.push(
      'Hover brightened and enabled native input; leave, held button and covered target stayed passive',
    );
  } finally {
    other.kill('SIGTERM');
  }
  undock();
  await setExpanded(false);
  const floatingRegion = (await inventory()).find(
    (w) => w.id === avatarWin.getNativeWindowHandle().readUInt32LE(),
  ).input_region;
  assert(
    floatingRegion.some((r) => r.width > 1 && r.height > 1),
    'Floating avatar accepts input again',
  );
  receipts.push('Native input shape yields the docked artwork and returns for the floating avatar');
  avatarWin.focus();
  await delay(300);
  const pointer = async (type) => {
    avatarWin.webContents.sendInputEvent({ type, button: 'left', x: 60, y: 60, clickCount: 1 });
  };
  await avatarWin.webContents.executeJavaScript(`
    window.dockSounds = [];
    window.voyager.onDockSound((action) => window.dockSounds.push(action));
  `);
  const sounds = () => avatarWin.webContents.executeJavaScript('window.dockSounds');
  const outline = () =>
    avatarWin.webContents.executeJavaScript(
      "getComputedStyle(document.getElementById('avatar')).outlineStyle",
    );
  const clickAvatar = async () => {
    await pointer('mouseDown');
    await delay(40);
    await pointer('mouseUp');
    await delay(200);
  };
  const avatarSizeBefore = avatarWin.getSize();
  await clickAvatar();
  assert(panelWin.isVisible());
  await clickAvatar();
  assert(!panelWin.isVisible());
  assert.equal(avatarWin.getParentWindow(), null, 'The collapsed avatar is an independent window');
  assert(avatarWin.isVisible(), 'Hiding the panel must not hide the astronaut');
  assert.deepEqual(
    avatarWin.getSize(),
    avatarSizeBefore,
    'Toggling never resizes the avatar window',
  );
  assert.deepEqual(await sounds(), [], 'Clicking is silent');
  assert.equal(await outline(), 'none', 'A released click must not leave a focus ring');
  receipts.push('Clicks toggled the separate panel without resizing the avatar');

  assert.equal(await dock(ours.id), true);
  await setExpanded(true);
  await delay(100);
  await avatarWin.webContents.executeJavaScript('window.dockSounds = []');
  const panelBefore = panelWin.getBounds();
  await pointer('mouseDown');
  await delay(450);
  assert.notEqual(await outline(), 'none', 'Holding highlights the astronaut');
  assert(panelWin.isVisible(), 'Holding must leave the panel visible');
  assert(getState().seated, 'Holding alone must not lift the astronaut');
  assert.equal(getState().binding?.session.id, session.id);
  await pointer('mouseUp');
  await delay(100);
  assert(panelWin.isVisible() && getState().seated, 'Stationary release does not toggle or undock');
  assert.deepEqual(await sounds(), [], 'A stationary hold is silent');
  assert.equal(await outline(), 'none', 'Releasing the hold clears its highlight');

  await pointer('mouseDown');
  await delay(50);
  const start = getState().dragging.start;
  // Exercise the same main-process drag transition; this is not compositor mouse injection.
  advanceDrag({ x: start.x + 30, y: start.y + 20 });
  await delay(100);
  assert(panelWin.isVisible() && !getState().seated);
  assert.equal(avatarWin.getParentWindow(), null, 'Pulling away releases the native parent');
  assert.equal(getState().binding, null);
  assert.deepEqual(
    panelWin.getBounds(),
    panelBefore,
    'The panel stays put when the astronaut leaves',
  );
  assert.deepEqual(await sounds(), ['undock'], 'Exactly one undock cue is emitted per departure');
  // Settle the synthetic pointer at the actual cursor before moving the panel independently.
  advanceDrag(start);
  await delay(50);
  const detachedAvatar = avatarWin.getBounds();
  panelWin.setPosition(panelBefore.x - 24, panelBefore.y + 24);
  await delay(100);
  assert.deepEqual(
    avatarWin.getBounds(),
    detachedAvatar,
    'Moving the panel leaves a detached avatar alone',
  );
  avatarWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  avatarWin.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await delay(150);
  await pointer('mouseUp');
  assert(getState().seated && panelWin.isVisible());
  assert.equal(avatarWin.getParentWindow(), panelWin, 'Escape restores the native parent');
  assert.equal(await outline(), 'none', 'Cancelling the gesture clears its highlight');
  assert.equal(getState().binding?.session.id, session.id, 'Escape restores the prior attachment');
  assert.deepEqual(
    await sounds(),
    ['undock', 'dock'],
    'Returning to the seat emits the inverse cue',
  );
  receipts.push(
    'Clicks and stationary holds were silent; pulling cued undock once and returning cued dock once',
  );

  undock();
  park();
  await setExpanded(true);
  await delay(350);
  // Read the real X11 stack after selecting each row. Renderer-injected clicks
  // alone would still reach an astronaut that the panel has covered.
  const avatarId = avatarWin.getNativeWindowHandle().readUInt32LE();
  // Reopen before each row: a just-shown parent is the mapping-race case.
  for (let attempt = 0; attempt < getState().sessions.length * 3; attempt++) {
    const index = attempt % getState().sessions.length;
    await setExpanded(false);
    await setExpanded(true);
    panelWin.focus();
    await panelWin.webContents.executeJavaScript(`{
      const row = document.querySelectorAll('.session')[${index}];
      row.focus(); row.click();
    }`);
    await delay(250);
    const stack = (await inventory()).filter((window) => window.pid === process.pid);
    const avatarWindow = stack.find((window) => window.id === avatarId);
    assert(avatarWindow?.visible, 'The astronaut remains visible after selecting a row');
    assert.equal(
      windowAt(stack, {
        x: avatarWindow.x + avatarWindow.width / 2,
        y: avatarWindow.y + avatarWindow.height / 2,
      })?.id,
      avatarId,
      'The astronaut must receive native clicks above the selected panel',
    );
  }
  receipts.push(
    'Selecting each agent row leaves the astronaut above the panel in the native stack',
  );
  const beforeMove = panelWin.getBounds();
  panelWin.setPosition(beforeMove.x - 24, beforeMove.y + 24);
  await delay(100);
  await refresh();
  const afterMove = panelWin.getBounds();
  assert.equal(afterMove.x, beforeMove.x - 24, 'Refresh must not undo a panel move');
  assert.equal(afterMove.y, beforeMove.y + 24);
  assert.equal(avatarWin.getBounds().x, afterMove.x + 100);
  assert.equal(avatarWin.getBounds().y, afterMove.y + 36);
  receipts.push('Panel movement carried a seated astronaut and left a detached one independent');
  const ui = await panelWin.webContents.executeJavaScript(`({
    text:document.body.innerText,
    hasEvents:Boolean(document.getElementById('events')),
    hasDockButtons:Boolean(document.getElementById('targets')),
    hasNotice:Boolean(document.getElementById('notice')),
    hasLauncher:Boolean(document.getElementById('open-terminal')),
    hasDetach:Boolean(document.getElementById('undock')),
    scroll:document.getElementById('sessions').scrollHeight>document.getElementById('sessions').clientHeight,
    sessionCount:document.querySelectorAll('.session').length
  })`);
  assert(!ui.hasEvents && !ui.hasDockButtons && !ui.hasNotice && !ui.hasLauncher && !ui.hasDetach);
  assert(!ui.scroll, 'The real agent list must fit without scrolling');
  for (const s of getState().sessions)
    assert(!ui.text.includes(s.id) && !ui.text.includes(s.native_thread_id));
  assert(ui.text.includes('Online'));
  const rows = await panelWin.webContents.executeJavaScript(`
    [...document.querySelectorAll('.session')].map(row => ({
      name: row.querySelector('.session-name').textContent,
      text: row.innerText,
      label: row.getAttribute('aria-label'),
      title: row.title,
      connected: row.dataset.connected,
      dot: Boolean(row.querySelector('.connection-dot'))
    }))
  `);
  assert(
    rows.every(
      (row) =>
        row.dot &&
        row.text === row.name &&
        row.label.startsWith(row.name) &&
        row.title.includes(row.name),
    ),
  );
  assert(rows.some((row) => row.connected === 'true' && row.label.includes('Connected')));
  assert.deepEqual(
    rows.map((row) => row.name),
    getState().sessions.map((s) => s.cwd.split('/').filter(Boolean).at(-1) || 'This computer'),
  );
  receipts.push(
    'Rows lead with project names and accessible connection dots, without harness labels',
  );
  assert.equal(ui.sessionCount, getState().sessions.length);
  const panel = panelWin.getBounds(),
    avatar = avatarWin.getBounds();
  assert.equal(avatar.x + 8, panel.x + 108);
  assert.equal(avatar.y + 8, panel.y + 44);
  receipts.push('Two desktop surfaces align the astronaut with the continuous glass panel');
  await fs.writeFile(
    path.join(stateDir, 'desktop-refinement-panel.png'),
    (await panelWin.webContents.capturePage()).toPNG(),
  );
  await fs.writeFile(
    path.join(stateDir, 'desktop-refinement-avatar.png'),
    (await avatarWin.webContents.capturePage()).toPNG(),
  );
  const after =
    session.ownership === 'managed'
      ? await rpc('attach-info', session.id)
      : { pid: existing.frontend.pid };
  assert.equal(after.pid, nativeBefore.pid);
  assert.equal((await processIdentity(after.pid)).start, original.start);
  assert.equal((await rpc('status')).instance, serviceBefore.instance);
  receipts.push('Detach preserved the same native process and service instance');
  // Leave the real overlay docked for physical hover, drag and sound checks.
  assert.equal(await dock(ours.id), true);
  await delay(250);
  await fs.writeFile(
    path.join(stateDir, 'desktop-docked-avatar.png'),
    (await avatarWin.webContents.capturePage()).toPNG(),
  );
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        verdict: 'surface',
        receipts,
        rediscovered: Boolean(existing),
        opened,
        nativePid: after.pid,
        nativeStart: original.start,
        limits: [
          'Physical drag, perceived flicker and audible cue still need a human desktop test',
          'Only dedicated Ghostty XWayland clients of the known session',
          'No arbitrary CLI registration or current-thread switching detection',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Refinement proof saved. Marker docked and panel open; unrelated test shell closed.');
};
