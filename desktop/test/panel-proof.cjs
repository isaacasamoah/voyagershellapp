const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async (
  { rpc, stateDir, refresh, panelWin, setExpanded, inventory, screen },
  proof,
) => {
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
    'Running agent was not shown under Vessels',
  );
  assert.deepEqual(initial.current, [live.session_id]);
  assert.deepEqual(initial.unregistered, [removed.session_id]);
  assert.deepEqual(initial.previous, [stopped.session_id]);
  assert.equal(initial.previousOpen, false);
  assert.equal(initial.count, 'Previous vessels (1)');
  assert.match(initial.text, /Running/);
  assert.match(initial.text, /Unregistered/);
  assert.ok(
    await panelWin.webContents.executeJavaScript(
      "document.querySelector('.session-name').getBoundingClientRect().height < 40",
    ),
    'Agent name was squeezed into an unreadable column',
  );
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
  const previous = [];
  for (let i = 0; i < 20; i++) {
    const agent = await make(`History ${i}`);
    await rpc('stop-instance', agent.session_id);
    previous.push(agent.session_id);
  }
  await rpc('stop-instance', removed.session_id);
  await refresh();
  const historyState = () =>
    panelWin.webContents.executeJavaScript(`({
    count:document.querySelectorAll('#previous-sessions [data-key]').length,
    height:document.getElementById('previous-sessions').clientHeight,
    total:document.getElementById('previous-sessions').scrollHeight,
    scroll:document.getElementById('previous-sessions').scrollTop,
    more:!document.getElementById('previous-more').hidden,
    focus:document.activeElement.id,
    bounds:document.getElementById('previous-sessions').getBoundingClientRect().toJSON(),
    viewport:innerHeight
  })`);
  await proof.wait(
    historyState,
    (s) => s.count > 0 && s.count < 21 && s.more && s.total > s.height,
  );
  await proof.pageClick(panelWin, 'previous-toggle');
  await proof.pageKey(panelWin, 'Space');
  await proof.pageKey(panelWin, 'Tab');
  await proof.pageKey(panelWin, 'Tab');
  assert.equal((await historyState()).focus, 'previous-sessions');
  await proof.pageKey(panelWin, 'End');
  await fs.writeFile(
    path.join(stateDir, 'history-layout.json'),
    JSON.stringify(await historyState()),
  );
  await proof.wait(historyState, (s) => s.scroll > 0);
  await proof.pageWheel(panelWin, 'previous-sessions', 300);
  await fs.writeFile(
    path.join(stateDir, 'history-wheel.json'),
    JSON.stringify(await historyState()),
  );
  await proof.wait(historyState, (s) => s.scroll === 0);
  const first = await historyState();
  await proof.pageClick(panelWin, 'previous-more');
  const grown = await proof.wait(historyState, (s) => s.count > first.count);
  assert.equal(grown.height, first.height);
  assert.equal(grown.scroll, first.scroll);
  while ((await historyState()).more) await proof.pageClick(panelWin, 'previous-more');
  const finalFocus = await panelWin.webContents.executeJavaScript(`({
    id: document.activeElement.id,
    withinList: document.getElementById('previous-sessions').contains(document.activeElement),
    list: document.activeElement.id === 'previous-sessions'
  })`);
  await fs.writeFile(path.join(stateDir, 'final-batch-focus.json'), JSON.stringify(finalFocus));
  assert.ok(finalFocus.withinList || finalFocus.list, 'Final Load more lost keyboard focus');
  const normal = await snapshot();
  const savedPosition = await historyState();
  const registrations = await rpc('list');
  assert.equal(
    await panelWin.webContents.executeJavaScript(
      "document.querySelectorAll('#previous-agents input[type=checkbox]').length",
    ),
    0,
  );
  await proof.pageClick(panelWin, 'menu-history');
  await proof.pageKey(panelWin, 'Tab');
  assert.equal((await historyState()).focus, 'show-removed');
  await proof.pageKey(panelWin, 'Return');
  assert.deepEqual((await snapshot()).previous, [removed.session_id]);
  await proof.pageClick(panelWin, 'previous-back');
  assert.deepEqual((await snapshot()).previous, normal.previous);
  assert.equal((await historyState()).scroll, savedPosition.scroll);
  assert.deepEqual(await rpc('list'), registrations);
  await proof.pageClick(panelWin, 'menu-history');
  await proof.pageKey(panelWin, 'Tab');
  await proof.pageKey(panelWin, 'Return');
  const removedId = removed.session_id;
  await proof.wait(() =>
    panelWin.webContents.executeJavaScript(
      `Boolean(document.getElementById('inspect-${removedId}'))`,
    ),
  );
  await proof.pageClick(panelWin, `menu-${removedId}`);
  await proof.pageKey(panelWin, 'Tab');
  assert.equal((await historyState()).focus, `inspect-${removedId}`);
  await proof.pageKey(panelWin, 'Return');
  const beforeRead = await rpc('events');
  await proof.pageKey(panelWin, 'Return');
  await proof.wait(
    () =>
      panelWin.webContents.executeJavaScript(
        "document.getElementById('history-status').textContent",
      ),
    (s) => s.includes('saved portion'),
  );
  assert.equal((await rpc('events')).cursor, beforeRead.cursor);
  await proof.wait(historyState, (s) => s.focus === 'history-read');
  await proof.pageKey(panelWin, 'Tab');
  assert.equal((await historyState()).focus, 'history-close');
  await panelWin.webContents.executeJavaScript(`
    window.reviewTextPointer = null;
    document.getElementById('panel').addEventListener('pointerdown', event => {
      window.reviewTextPointer = {target: event.target.id, prevented: event.defaultPrevented};
    });
  `);
  await proof.pageClick(panelWin, 'history-status');
  const textPointer = await panelWin.webContents.executeJavaScript('window.reviewTextPointer');
  await fs.writeFile(path.join(stateDir, 'history-text-pointer.json'), JSON.stringify(textPointer));
  assert.equal(textPointer.prevented, false, 'Reading saved text triggered panel dragging');
  await proof.delay(100);
  const viewport = await panelWin.webContents.executeJavaScript(`({
    width:innerWidth, height:innerHeight,
    content:document.getElementById('panel-flow').scrollWidth,
    available:document.getElementById('panel-viewport').clientWidth
  })`);
  assert.ok(viewport.content <= viewport.available, 'Panel content overflowed its narrow viewport');
  await fs.writeFile(
    path.join(stateDir, 'panel-display.json'),
    JSON.stringify({
      bounds: panelWin.getBounds(),
      display: screen.getDisplayMatching(panelWin.getBounds()),
      viewport,
      native: (await inventory()).find(
        (w) => w.id === panelWin.getNativeWindowHandle().readUInt32LE(),
      ),
    }),
  );
  const bounds = panelWin.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  assert.ok(
    bounds.height <= area.height &&
      bounds.y >= area.y &&
      bounds.y + bounds.height <= area.y + area.height,
  );
  const png = await panelWin.webContents.capturePage();
  await fs.writeFile(path.join(stateDir, 'panel-current.png'), png.toPNG());
  await proof.pageClick(panelWin, 'previous-toggle');
  await proof.pageClick(panelWin, 'history-close');
  assert.equal((await historyState()).focus, 'previous-toggle');
  await proof.pageClick(panelWin, 'panel-brand');
  assert.equal(
    await panelWin.webContents.executeJavaScript('window.reviewTextPointer.prevented'),
    true,
  );

  return {
    live: live.session_id,
    stopped: stopped.session_id,
    removed: removed.session_id,
    initial,
    viewport,
    expansionChangedEvents: false,
    history: {
      first,
      grown,
      inspected: removedId,
      keyboard: true,
      wheel: true,
      physicalTrackpad: false,
    },
    disconnectWithMenu: true,
    reconnectRefreshed: true,
  };
};
