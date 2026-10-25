const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async ({ rpc, stateDir, refresh, panelWin, setExpanded, inventory }, proof) => {
  const make = (id) => rpc('create', 'shell', id, id, stateDir, '--background');
  const live = await make('Panel live');
  const stopped = await make('Panel previous');
  await rpc('stop-instance', stopped.session_id);
  const removed = await make('Panel unregistered');
  await rpc('remove', removed.session_id);
  await setExpanded(true, { x: 180, y: 100 });
  await refresh();
  const snapshot = () =>
    panelWin.webContents.executeJavaScript(`({
    current: [...document.querySelectorAll('#sessions [data-key]')].map(n => n.dataset.key),
    unregistered: [...document.querySelectorAll('#unregistered-sessions [data-key]')].map(n => n.dataset.key),
    previous: [...document.querySelectorAll('#previous-sessions [data-key]')].map(n => n.dataset.key),
    previousOpen: document.getElementById('previous-agents').open,
    count: document.getElementById('previous-toggle').textContent,
    text: document.getElementById('panel').textContent
  })`);
  const initial = await proof.wait(
    snapshot,
    (s) => s.current.includes(live.session_id),
    'Running agent was not shown under Current work',
  );
  assert.deepEqual(initial.current, [live.session_id]);
  assert.deepEqual(initial.unregistered, [removed.session_id]);
  assert.deepEqual(initial.previous, [stopped.session_id]);
  assert.equal(initial.previousOpen, false);
  assert.equal(initial.count, 'Previous agents (1)');
  assert.match(initial.text, /Running/);
  assert.match(initial.text, /Unregistered/);
  const before = await rpc('events');
  await fs.writeFile(
    path.join(stateDir, 'panel-before.png'),
    (await panelWin.webContents.capturePage()).toPNG(),
  );
  const geometry = await panelWin.webContents.executeJavaScript(
    "({bounds:document.getElementById('previous-toggle').getBoundingClientRect().toJSON(),height:innerHeight})",
  );
  await fs.writeFile(
    path.join(stateDir, 'panel-layout.json'),
    JSON.stringify({
      window: panelWin.getBounds(),
      geometry,
      native: (await inventory()).find(
        (w) => w.id === panelWin.getNativeWindowHandle().readUInt32LE(),
      ),
    }),
  );
  await proof.pageClick(panelWin, 'previous-toggle');
  await proof.wait(snapshot, (s) => s.previousOpen);
  await proof.pageClick(panelWin, `menu-${live.session_id}`);
  await proof.wait(
    () =>
      panelWin.webContents.executeJavaScript("document.querySelectorAll(':popover-open').length"),
    (count) => count === 1,
    'Actions menu did not open before the disconnect check',
  );
  const socket = path.join(stateDir, 'service.sock');
  const hiddenSocket = path.join(stateDir, 'service-hidden.sock');
  await fs.rename(socket, hiddenSocket);
  try {
    await refresh();
    await proof.wait(
      () =>
        panelWin.webContents.executeJavaScript(`({
      disabled: document.querySelector('[data-key="${live.session_id}"]').disabled,
      label: document.querySelector('[data-key="${live.session_id}"]').getAttribute('aria-label'),
      open: document.querySelectorAll(':popover-open').length
    })`),
      (s) => s.disabled && s.label.includes('Last known') && s.open === 0,
      'Open menu kept stale controls available after disconnect',
    );
  } finally {
    await fs.rename(hiddenSocket, socket);
  }
  await refresh();
  await proof.wait(
    () =>
      panelWin.webContents.executeJavaScript(
        `document.querySelector('[data-key="${live.session_id}"]').disabled`,
      ),
    (disabled) => !disabled,
    'Reconnect did not refresh the existing row',
  );
  const after = await rpc('events');
  assert.equal(after.cursor, before.cursor);
  const png = await panelWin.webContents.capturePage();
  await fs.writeFile(path.join(stateDir, 'panel-current.png'), png.toPNG());
  return {
    live: live.session_id,
    stopped: stopped.session_id,
    removed: removed.session_id,
    initial,
    expansionChangedEvents: false,
    disconnectWithMenu: true,
    reconnectRefreshed: true,
  };
};
