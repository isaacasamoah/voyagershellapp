const assert = require('node:assert/strict');

exports.run = async ({ rpc, stateDir, refresh, panelWin, setExpanded }, proof) => {
  await setExpanded(true, { x: 180, y: 100 });
  await refresh();
  const read = (script) => panelWin.webContents.executeJavaScript(script);
  assert.equal(await read("document.getElementById('current-heading').textContent"), 'Vessels');
  await proof.pageClick(panelWin, 'add');
  await proof.pageClick(panelWin, 'instance-terminal');
  await proof.pageKey(panelWin, 'End');
  await proof.pageKey(panelWin, 'Return');
  await proof.pageFill(panelWin, 'instance-name', 'Trial check');
  await proof.pageFill(panelWin, 'instance-cwd', stateDir);
  await proof.pageClick(panelWin, 'create');
  const rows = await proof.wait(
    () => rpc('list'),
    (rows) => rows.some((row) => row.name === 'Trial check'),
  );
  const vessel = rows.find((row) => row.name === 'Trial check');
  assert.equal(vessel.kind, 'codex');
  assert.equal(vessel.lifecycle.runtime, 'running');
  assert.equal(vessel.cwd, stateDir);
  assert.equal(vessel.terminal, 'xterm');
  await proof.wait(() =>
    read(`Boolean(document.querySelector('#sessions [data-key="${vessel.id}"]'))`),
  );
  await rpc('stop-instance', vessel.id);
  await refresh();
  const previous = await proof.wait(
    () => read("document.getElementById('previous-toggle').textContent"),
    (text) => text === 'Previous vessels (1)',
  );
  return {
    vessel: vessel.id,
    createdThroughForm: true,
    runtime: 'stopped',
    headings: ['Vessels', previous],
  };
};
