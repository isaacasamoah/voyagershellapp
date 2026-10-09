// Opt-in: uses the existing service and real desktop windows. No model calls.
// App-local pointer events verify the click handler, not compositor-level drag.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { processIdentity } = require('../binding.cjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({
  win,
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
  win.focus();
  await delay(300);
  const pointer = async (type) => {
    const { x, y } = await win.webContents.executeJavaScript(`(() => {
      const r = document.getElementById('avatar').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    win.webContents.sendInputEvent({ type, button: 'left', x, y, clickCount: 1 });
  };
  const panelHidden = () =>
    win.webContents.executeJavaScript("document.getElementById('panel').hidden");
  const clickAvatar = async () => {
    await pointer('mouseDown');
    await delay(40);
    await pointer('mouseUp');
    await delay(300);
  };
  await clickAvatar();
  assert.equal(
    await win.webContents.executeJavaScript("document.getElementById('panel').hidden"),
    false,
  );
  await clickAvatar();
  assert.equal(
    await win.webContents.executeJavaScript("document.getElementById('panel').hidden"),
    true,
  );
  receipts.push('Renderer pointer events opened and collapsed the panel');
  setExpanded(true);
  await delay(100);
  await pointer('mouseDown');
  await delay(450);
  assert(await panelHidden(), 'Holding lifts the astronaut out of the panel');
  assert.equal(getState().binding, null, 'Holding detaches the interface from the terminal');
  assert.equal(win.getBounds().width, 120);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await delay(150);
  await pointer('mouseUp');
  assert.equal(await panelHidden(), false, 'Escape restores the panel');
  assert.equal(getState().binding?.session.id, worker.id, 'Escape restores the prior attachment');
  await pointer('mouseDown');
  await delay(450);
  await pointer('mouseUp');
  await delay(150);
  assert(await panelHidden(), 'Releasing a stationary hold leaves the astronaut floating');
  assert.equal(getState().binding, null, 'A stationary hold must not join a window underneath');
  receipts.push('Hold lifted and detached; Escape restored; stationary release stayed floating');
  undock();
  park();
  setExpanded(true);
  // Leave a pointer-use preview after testing the visible keyboard focus ring.
  await win.webContents.executeJavaScript('document.activeElement?.blur()');
  await delay(350);
  const ui = await win.webContents.executeJavaScript(`({
    text:document.body.innerText,
    hasEvents:Boolean(document.getElementById('events')),
    hasDockButtons:Boolean(document.getElementById('targets')),
    hasNotice:Boolean(document.getElementById('notice')),
    hasLauncher:Boolean(document.getElementById('open-terminal')),
    scroll:document.getElementById('sessions').scrollHeight>document.getElementById('sessions').clientHeight,
    sessionCount:document.querySelectorAll('.session').length,
    avatar:document.getElementById('avatar').getBoundingClientRect().toJSON(),
    panel:document.getElementById('panel').getBoundingClientRect().toJSON()
  })`);
  assert(!ui.hasEvents && !ui.hasDockButtons && !ui.hasNotice && !ui.hasLauncher);
  assert(!ui.scroll, 'The real agent list must fit without scrolling');
  for (const s of getState().sessions)
    assert(!ui.text.includes(s.id) && !ui.text.includes(s.native_thread_id));
  assert(ui.text.includes('Online') && ui.text.includes('Connected'));
  assert.equal(ui.sessionCount, getState().sessions.length);
  assert.equal(ui.avatar.width, 104);
  assert(
    ui.avatar.top >= ui.panel.top && ui.avatar.bottom < ui.panel.bottom,
    'The seated astronaut is contained in the continuous panel surface',
  );
  receipts.push(
    'Continuous curved panel, human-readable agent status, no visible IDs or event feed',
  );
  const image = await win.webContents.capturePage();
  await fs.writeFile(path.join(stateDir, 'desktop-refinement.png'), image.toPNG());
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
          'Physical drag still needs a human desktop test',
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
