// Opt-in proof on two already-open native clients; no model calls or input injection.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.run = async ({
  rpc,
  refresh,
  dock,
  undock,
  getState,
  setExpanded,
  stateDir,
  panelWin,
  avatarWin,
}) => {
  const file = path.join(stateDir, 'control-proof.json');
  const receipts = [];
  await fs.writeFile(file, JSON.stringify({ verdict: 'running' }));
  const waitControl = async (matches) => {
    for (let n = 0; n < 40; n++) {
      const status = await rpc('status');
      if (matches(status.control)) return status;
      await delay(100);
    }
    throw Error('Control state did not settle');
  };
  try {
    await refresh();
    const before = await rpc('status');
    const cursor = (await rpc('events')).cursor;
    const targets = getState()
      .records.map((r) => getState().windows.find((w) => w.pid === r.pid && w.visible))
      .filter(Boolean);
    assert(targets.length >= 2, 'Open two dedicated supported terminal clients');
    const home = panelWin.getBounds();
    await setExpanded(false);
    assert.equal(await dock(targets[0].id), true);
    const a = (await waitControl((c) => c?.window_id === targets[0].id)).control;
    assert.equal(getState().binding.window.id, a.window_id);
    receipts.push('First native window acknowledged as current control in Rust and Electron');
    undock();
    await waitControl((c) => c === null);
    assert.equal((await rpc('status')).capturing, before.capturing);
    receipts.push('Undock cleared control while the same registrations continued capturing');
    assert.equal(await dock(targets[1].id), true);
    const b = (await waitControl((c) => c?.window_id === targets[1].id)).control;
    assert.notEqual(a.generation, b.generation);
    assert.notEqual(a.frontend.pid, b.frontend.pid);
    assert.equal((await rpc('undock', a.generation)).released, false);
    assert.equal((await rpc('status')).control.generation, b.generation);
    receipts.push('Second native client selected; stale release from the first could not clear it');
    // Exercise the real renderer click handler; this is not a physical mouse test.
    const avatar = avatarWin.getBounds();
    for (const visible of [true, false]) {
      avatarWin.webContents.sendInputEvent({
        type: 'mouseDown',
        button: 'left',
        x: 60,
        y: 60,
        clickCount: 1,
      });
      await delay(40);
      avatarWin.webContents.sendInputEvent({
        type: 'mouseUp',
        button: 'left',
        x: 60,
        y: 60,
        clickCount: 1,
      });
      await delay(250);
      assert.equal(panelWin.isVisible(), visible);
      assert.deepEqual(panelWin.getBounds(), home);
      assert.deepEqual(avatarWin.getBounds(), avatar);
      assert.equal((await rpc('status')).control.generation, b.generation);
    }
    receipts.push(
      'Click toggled the panel at its saved position without moving the astronaut or releasing control',
    );
    const final = await waitControl((c) => c?.window_id === targets[1].id);
    assert.equal(final.instance, before.instance);
    const events = (await rpc('events', String(cursor))).events;
    assert(events.some((e) => e.type === 'interface.docked'));
    assert(events.some((e) => e.type === 'interface.undocked'));
    await fs.writeFile(
      file,
      JSON.stringify(
        {
          verdict: 'surface',
          receipts,
          control: final.control,
          voice: final.voice,
          limits: [
            'Programmatic dock calls on real windows; physical gestures remain a human check',
            'Two terminal clients may display the same conversation',
            'No voice activation or supervisor interruption',
          ],
        },
        null,
        2,
      ),
    );
    console.log('Control proof saved; docked marker ready for the physical test.');
  } catch (error) {
    await fs.writeFile(
      file,
      JSON.stringify({ verdict: 'rework', receipts, error: error.message }, null, 2),
    );
    throw error;
  }
};
