// Opt-in: uses the existing service and real desktop windows. No model calls.
// App-local pointer events verify the click handler, not compositor-level drag.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { processIdentity } = require('../binding.cjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({
  avatarWin,
  panelWin,
  advanceDrag,
  rpc,
  refresh,
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
  for (const selector of ['#quit', '#undock', '.session'])
    assert.equal(await region(panelWin, selector), 'no-drag', `${selector} must remain clickable`);
  receipts.push('Native drag regions exclude the astronaut and panel buttons');
  const worker = getState().sessions.find(
    (s) => s.ownership === 'managed' && s.capture === 'connected',
  );
  assert(worker, 'A connected real worker is required');
  const serviceBefore = await rpc('status');
  const workerBefore = await rpc('attach-info', worker.id);
  const original = await processIdentity(workerBefore.pid);
  const existing = getState().records.find(
    (r) =>
      r.sessionId === worker.id && getState().windows.some((w) => w.pid === r.pid && w.visible),
  );
  assert(existing, 'Open the native worker terminal before running this proof');
  const opened = {
    terminalPid: existing.pid,
    frontendPid: existing.frontend.pid,
    sessionId: worker.id,
  };
  await refresh();
  const ours = getState().windows.find((w) => w.pid === opened.terminalPid && w.visible);
  assert(ours, 'The native terminal must be present');
  if (existing)
    receipts.push('Rediscovered an already-open native worker terminal without a UI launch record');
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
      if (unrelated) break;
    }
    assert(unrelated, 'The unrelated terminal must be visible');
    assert.equal(unrelated.title, ours.title);
    assert.equal(await dock(unrelated.id), false);
    assert.equal(await dock(ours.id), true);
    assert.equal(getState().binding.session.id, worker.id);
    receipts.push('Exact native worker accepted; unrelated same-title terminal refused');
  } finally {
    other.kill('SIGTERM');
  }
  setExpanded(false);
  avatarWin.focus();
  await delay(300);
  const pointer = async (type) => {
    avatarWin.webContents.sendInputEvent({ type, button: 'left', x: 60, y: 60, clickCount: 1 });
  };
  await avatarWin.webContents.executeJavaScript(`
    window.undockCount = 0;
    window.voyager.onUndock(() => window.undockCount++);
  `);
  const soundCount = () => avatarWin.webContents.executeJavaScript('window.undockCount');
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
  assert.deepEqual(
    avatarWin.getSize(),
    avatarSizeBefore,
    'Toggling never resizes the avatar window',
  );
  assert.equal(await soundCount(), 0, 'Clicking is silent');
  assert.equal(await outline(), 'none', 'A released click must not leave a focus ring');
  receipts.push('Clicks toggled the separate panel without resizing the avatar');

  setExpanded(true);
  await delay(100);
  const panelBefore = panelWin.getBounds();
  await pointer('mouseDown');
  await delay(450);
  assert.notEqual(await outline(), 'none', 'Holding highlights the astronaut');
  assert(panelWin.isVisible(), 'Holding must leave the panel visible');
  assert(getState().seated, 'Holding alone must not lift the astronaut');
  assert.equal(getState().binding?.session.id, worker.id);
  await pointer('mouseUp');
  await delay(100);
  assert(panelWin.isVisible() && getState().seated, 'Stationary release does not toggle or undock');
  assert.equal(await soundCount(), 0, 'A stationary hold is silent');
  assert.equal(await outline(), 'none', 'Releasing the hold clears its highlight');

  await pointer('mouseDown');
  await delay(50);
  const start = getState().dragging.start;
  // Exercise the same main-process drag transition; this is not compositor mouse injection.
  advanceDrag({ x: start.x + 30, y: start.y + 20 });
  await delay(100);
  assert(panelWin.isVisible() && !getState().seated);
  assert.equal(getState().binding, null);
  assert.deepEqual(
    panelWin.getBounds(),
    panelBefore,
    'The panel stays put when the astronaut leaves',
  );
  assert.equal(await soundCount(), 1, 'Exactly one undock cue is emitted per departure');
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
  assert.equal(await outline(), 'none', 'Cancelling the gesture clears its highlight');
  assert.equal(getState().binding?.session.id, worker.id, 'Escape restores the prior attachment');
  receipts.push(
    'Hold stayed seated and silent; movement left the panel in place and cued once; Escape restored',
  );

  undock();
  park();
  setExpanded(true);
  await delay(350);
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
    scroll:document.getElementById('sessions').scrollHeight>document.getElementById('sessions').clientHeight,
    sessionCount:document.querySelectorAll('.session').length
  })`);
  assert(!ui.hasEvents && !ui.hasDockButtons && !ui.hasNotice && !ui.hasLauncher);
  assert(!ui.scroll, 'The real agent list must fit without scrolling');
  for (const s of getState().sessions)
    assert(!ui.text.includes(s.id) && !ui.text.includes(s.native_thread_id));
  assert(ui.text.includes('Online') && ui.text.includes('Connected'));
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
  const after = await rpc('attach-info', worker.id);
  assert.equal(after.pid, workerBefore.pid);
  assert.equal((await processIdentity(after.pid)).start, original.start);
  assert.equal((await rpc('status')).instance, serviceBefore.instance);
  receipts.push('Detach preserved the same worker process and service instance');
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        verdict: 'surface',
        receipts,
        rediscovered: Boolean(existing),
        opened,
        workerPid: after.pid,
        workerStart: original.start,
        limits: [
          'Physical drag, perceived flicker and audible cue still need a human desktop test',
          'Only dedicated Ghostty XWayland clients of the known worker',
          'No arbitrary CLI registration or current-thread switching detection',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Refinement proof saved. Panel left open; unrelated test shell closed.');
};
