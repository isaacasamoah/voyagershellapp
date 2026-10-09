// Explicitly opt-in: uses an already-running private service and one real worker.
// Opens native windows. It makes no model call and never terminates the worker.
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
  openTerminal,
  dock,
  undock,
  setExpanded,
  park,
  getState,
  stateDir,
}) => {
  const receipts = [];
  await fs.writeFile(
    path.join(stateDir, 'desktop-proof.json'),
    JSON.stringify({ verdict: 'running' }),
  );
  const worker = getState().sessions.find(
    (s) => s.ownership === 'managed' && s.capture === 'connected',
  );
  assert(worker, 'A connected real worker is required');
  const serviceBefore = await rpc('status');
  const workerBefore = await rpc('attach-info', worker.id);
  const originalProcess = await processIdentity(workerBefore.pid);
  const opened = await openTerminal(worker.id);
  // Same title, distinct process, deliberately unrelated to any agent.
  const other = spawn(
    '/usr/bin/ghostty',
    [
      '--gtk-single-instance=false',
      '--title=Voyager terminal',
      '-e',
      '/bin/bash',
      '--noprofile',
      '--norc',
    ],
    { env: { ...process.env, GDK_BACKEND: 'x11' }, stdio: 'ignore', detached: true },
  );
  await new Promise((resolve, reject) => {
    other.once('spawn', resolve);
    other.once('error', reject);
  });
  other.unref();
  await fs.writeFile(
    path.join(stateDir, 'desktop-proof-processes.json'),
    JSON.stringify({ opened, otherPid: other.pid }),
  );
  let ours, unrelated;
  for (let n = 0; n < 40; n++) {
    await delay(250);
    await refresh();
    ours = getState().windows.find((w) => w.pid === opened.terminalPid);
    unrelated = getState().windows.find((w) => w.pid === other.pid);
    if (ours?.visible && unrelated?.visible) break;
  }
  assert(
    ours?.visible && unrelated?.visible,
    'Both real windows must be visible in the X11 inventory',
  );
  assert.equal(ours.title, unrelated.title);
  assert.equal(await dock(unrelated.id), false);
  receipts.push('An unrelated real terminal with the same title was refused');
  assert.equal(await dock(ours.id), true);
  assert.equal(getState().binding.session.id, worker.id);
  receipts.push('The known native worker window resolved to the exact registered session');
  // Exercise only our own renderer. This does not drive the desktop mouse or
  // prove physical drag delivery through the compositor.
  setExpanded(false);
  win.focus();
  await delay(500);
  const clickAvatar = async () => {
    const x = win.getBounds().width - 72,
      y = 72;
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x, y, clickCount: 1 });
    await delay(40);
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x, y, clickCount: 1 });
    await delay(300);
  };
  await fs.writeFile(
    path.join(stateDir, 'desktop-proof.json'),
    JSON.stringify({ verdict: 'running', step: 'renderer click', receipts }),
  );
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
  receipts.push('Renderer pointer events opened and collapsed the status panel');
  setExpanded(true);
  await delay(500);
  const ui = await win.webContents.executeJavaScript(
    `({visible:!document.getElementById('panel').hidden,expanded:document.getElementById('avatar').getAttribute('aria-expanded'),events:document.getElementById('events').innerText})`,
  );
  assert(ui.visible && ui.expanded === 'true');
  assert(ui.events.length > 0, 'Captured worker events must be visible');
  if (process.env.VOYAGER_PROOF_EXPECT)
    assert(
      ui.events.includes(process.env.VOYAGER_PROOF_EXPECT),
      'Expected worker result must be visible',
    );
  const image = await win.webContents.capturePage();
  await fs.writeFile(path.join(stateDir, 'desktop-proof.png'), image.toPNG());
  undock();
  assert.equal(getState().binding, null);
  const after = await rpc('attach-info', worker.id);
  const processAfter = await processIdentity(after.pid);
  assert.equal(after.pid, workerBefore.pid);
  assert.equal(processAfter.start, originalProcess.start);
  assert.equal((await rpc('status')).instance, serviceBefore.instance);
  receipts.push('Undock preserved the same worker process and service instance');
  park();
  await fs.writeFile(
    path.join(stateDir, 'desktop-proof.json'),
    JSON.stringify(
      {
        verdict: 'surface',
        receipts,
        opened,
        otherPid: other.pid,
        window: ours.id,
        unrelatedWindow: unrelated.id,
        workerPid: after.pid,
        workerStart: processAfter.start,
        limits: [
          'Physical pointer drag and overall desktop appearance still need user proof',
          'Fixed launch binding does not observe Codex switching threads',
          'Wayland-native windows are unsupported',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'Desktop proof saved in the private service directory. Both demo terminals remain open.',
  );
};
