const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

exports.run = async (
  { rpc, refresh, panelWin, stateDir, id, cwd, row },
  { wait, pageClick, pageKey },
) => {
  let workerContext;
  await rpc('rank', id, 'captain');
  const worker = await rpc(
    'create',
    'shell',
    'context-worker',
    'Context worker',
    cwd,
    '--background',
    '--supervisor',
    id,
  );
  const fleet = randomUUID();
  await rpc('create-fleet', fleet, 'Context work');
  await rpc('move-vessel', id, fleet);
  const placements = await rpc('fleets');
  await refresh();
  if (
    await panelWin.webContents.executeJavaScript("document.getElementById('previous-agents').open")
  )
    await pageClick(panelWin, 'previous-toggle');
  await panelWin.webContents.executeJavaScript(`
    window.focusJourney = [];
    document.addEventListener('focusin', event => window.focusJourney.push({id:event.target.id, tag:event.target.tagName, vessel:event.target.closest('[data-vessel]')?.dataset.vessel}));
  `);
  await pageClick(panelWin, `menu-${id}`);
  for (let step = 0; step < 30; step++) {
    if (
      await panelWin.webContents.executeJavaScript("document.activeElement.textContent === 'Stop'")
    )
      break;
    await pageKey(panelWin, 'Tab');
  }
  assert.equal(
    await panelWin.webContents.executeJavaScript('document.activeElement.textContent'),
    'Stop',
  );
  await pageKey(panelWin, 'Return');
  await wait(row, (r) => r.lifecycle.runtime === 'stopped');
  await refresh();
  try {
    await wait(
      () => panelWin.webContents.executeJavaScript('document.activeElement.id'),
      (focused) => focused === 'previous-toggle',
      'Stopped captain lost useful keyboard focus',
    );
  } catch (error) {
    await fs.writeFile(
      path.join(stateDir, 'focus-journey.json'),
      JSON.stringify(
        await panelWin.webContents.executeJavaScript(
          '({events:window.focusJourney, active:document.activeElement.id, tag:document.activeElement.tagName, previousOpen:document.getElementById("previous-agents").open, saved:document.activeElement===document.body?panelFocus.capture():null, error:document.getElementById("instance-error").textContent, menus:document.querySelectorAll(":popover-open").length, current:[...document.querySelectorAll("#fleets [data-key]")].map(n=>n.dataset.key)})',
        ),
      ),
    );
    throw error;
  }
  workerContext = await panelWin.webContents.executeJavaScript(`({
    rows: [...document.querySelectorAll('#fleets [data-key]')].map(n => n.dataset.key),
    text: document.getElementById('fleets').textContent
  })`);
  assert.deepEqual(workerContext.rows, [worker.session_id]);
  assert.match(workerContext.text, /Reports to Resume proof, Stopped/);
  assert.deepEqual(await rpc('fleets'), placements);
  assert.equal((await rpc('list')).find((r) => r.id === worker.session_id).supervisor_id, id);
  return workerContext;
};
