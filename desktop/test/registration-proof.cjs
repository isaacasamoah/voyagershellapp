// Explicit live experiment. Uses the selected native session and makes bounded
// model calls. Private receipts stay in VOYAGER_STATE, never in this repository.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { processIdentity } = require('../src/binding.cjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({
  avatarWin,
  panelWin,
  rpc,
  refresh,
  inventory,
  dock,
  undock,
  setExpanded,
  getState,
  stateDir,
}) => {
  const nativeId = process.env.VOYAGER_DEMO_THREAD;
  const file = path.join(stateDir, 'registration-proof.json');
  const receipts = [];
  const save = async (verdict, extra = {}) =>
    fs.writeFile(file, JSON.stringify({ verdict, receipts, ...extra }, null, 2));
  await save('running');
  assert(nativeId, 'Set VOYAGER_DEMO_THREAD to the explicitly selected live native conversation');
  const before = await rpc('list');
  const serviceBefore = await rpc('status');
  await refresh();
  const record = getState().records.find((r) => r.external && r.nativeId === nativeId);
  assert(record, 'Open the dedicated native resume client before this proof');
  const terminal = getState().windows.find((w) => w.pid === record.pid && w.visible);
  assert(terminal);
  const frontendBefore = await processIdentity(record.frontend.pid);
  const existing = before.find(
    (s) => s.native_thread_id === nativeId && s.server === record.server,
  );
  receipts.push(
    existing
      ? 'Existing registration: this run checks rejoin only'
      : 'Native terminal exists before registration; discovery did not add it',
  );
  await save('running');

  // Real same-title negative arm. No synthetic title matching or hidden registration.
  const unrelated = spawn(
    '/usr/bin/ghostty',
    [
      '--gtk-single-instance=false',
      '--title=' + terminal.title,
      '-e',
      '/bin/bash',
      '--noprofile',
      '--norc',
    ],
    {
      env: { ...process.env, GDK_BACKEND: 'x11' },
      stdio: 'ignore',
    },
  );
  await new Promise((resolve, reject) => {
    unrelated.once('spawn', resolve);
    unrelated.once('error', reject);
  });
  try {
    let other;
    for (let i = 0; i < 40; i++) {
      await delay(100);
      other = (await inventory()).find((w) => w.pid === unrelated.pid && w.visible);
      if (other?.title === terminal.title) break;
    }
    assert(other, 'The unrelated terminal must appear on the real desktop');
    assert.equal(other.title, terminal.title);
    await setExpanded(false);
    assert.equal(await dock(other.id), false);
    assert(!panelWin.isVisible());
    assert.deepEqual(await rpc('list'), before);
    receipts.push('Unrelated same-title terminal refused; registry unchanged');
  } finally {
    unrelated.kill('SIGTERM');
  }

  assert.equal(
    await dock(terminal.id),
    true,
    'Drop must acknowledge registration and native layering',
  );
  const session = getState().binding.session;
  assert.equal(session.native_thread_id, nativeId);
  assert.equal(session.ownership, 'external');
  assert.equal(getState().binding.record.frontend.start, frontendBefore.start);
  const avatarId = avatarWin.getNativeWindowHandle().readUInt32LE();
  const stack = await inventory();
  assert(stack.findIndex((w) => w.id === avatarId) > stack.findIndex((w) => w.id === terminal.id));
  assert.deepEqual(
    stack.find((w) => w.id === avatarId).input_region,
    [{ x: 0, y: 0, width: 1, height: 1 }],
    'Docked marker yields input except its transparent corner pixel',
  );
  assert.equal(avatarWin.isFocusable(), false, 'Docked marker must not take keyboard focus');
  assert.equal(
    await avatarWin.webContents.executeJavaScript(
      "getComputedStyle(document.getElementById('avatar')).opacity",
    ),
    '0.3',
  );
  receipts.push(
    'Exact existing native session registered; original frontend retained; faded overlay is above Ghostty in native stack',
  );
  await save('running', { sessionId: session.id, firstRegistration: !existing });

  // Rejoin the panel without altering the registered native session.
  await setExpanded(true);
  assert.equal(
    await avatarWin.webContents.executeJavaScript(
      "getComputedStyle(document.getElementById('avatar')).opacity",
    ),
    '1',
  );
  const lifted = (await inventory()).find((w) => w.id === avatarId);
  assert(
    lifted.input_region.some((r) => r.width > 1 && r.height > 1),
    'Seated avatar must accept input',
  );
  const cursor = (await rpc('events', '0')).cursor;
  const request = `dock-demo-${Date.now()}`;
  const sent = await rpc(
    'send',
    session.id,
    request,
    'Do not use tools or change files. Reply exactly: VOYAGER_DOCKED_42',
  );
  assert.equal(sent.state, 'accepted');
  undock();
  const observed = [];
  let after = cursor;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const page = await rpc('events', String(after));
    after = page.cursor;
    observed.push(
      ...page.events.filter(
        (e) => e.session_id === session.id && e.native_turn_id === sent.native_turn_id,
      ),
    );
    if (observed.some((e) => e.type === 'turn.completed')) break;
    await delay(250);
  }
  assert(
    observed.some(
      (e) =>
        e.type === 'message' &&
        e.payload.role === 'user' &&
        e.payload.text.includes('VOYAGER_DOCKED_42'),
    ),
  );
  assert(
    observed.some(
      (e) =>
        e.type === 'message' &&
        e.payload.role === 'assistant' &&
        e.payload.text.trim() === 'VOYAGER_DOCKED_42',
    ),
  );
  assert(observed.some((e) => e.type === 'turn.completed'));
  assert.equal((await rpc('status')).instance, serviceBefore.instance);
  assert.equal((await processIdentity(record.frontend.pid)).start, frontendBefore.start);
  receipts.push(
    'Real user and assistant messages recorded while avatar detached; same service and native client survived',
  );
  assert.equal(await dock(terminal.id), true);
  assert.equal(getState().binding.session.id, session.id);
  assert.equal(
    (await rpc('list')).filter((s) => s.native_thread_id === nativeId && s.server === record.server)
      .length,
    1,
  );
  receipts.push('Redocking rejoined the same registration with no duplicate');
  await save('surface', {
    sessionId: session.id,
    firstRegistration: !existing,
    limits: [
      'Physical dragging, normal terminal typing/selection, visual transparency and sound require a desktop check',
      'Dedicated fixed-thread Codex resume client in Ghostty XWayland only',
      'Switching native threads and opaque terminal backgrounds are unsupported',
    ],
  });
  console.log(
    'Registration proof saved. Native terminal and service left running for the desktop check.',
  );
};
