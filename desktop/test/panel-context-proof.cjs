const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

exports.run = async (
  { rpc, refresh, panelWin, stateDir, id, cwd, row },
  { wait, pageClick, pageKey },
) => {
  const read = panelWin.webContents.executeJavaScript.bind(panelWin.webContents);
  let workerContext;
  await refresh();
  await pageClick(panelWin, `menu-${id}`);
  await pageClick(panelWin, `rank-${id}`);
  await pageKey(panelWin, 'Up');
  await pageKey(panelWin, 'Return');
  await wait(row, (r) => r.rank === 'captain', 'Rank choice did not apply');
  const worker = await rpc(
    'create',
    'shell',
    'context-worker',
    'Context worker',
    cwd,
    '--background',
  );
  await refresh();
  await pageClick(panelWin, `menu-${worker.session_id}`);
  const windows = () =>
    execFileSync('xdotool', ['search', '--onlyvisible', '--pid', String(process.pid)], {
      encoding: 'utf8',
    })
      .trim()
      .split(/\s+/);
  const before = new Set(windows());
  await pageClick(panelWin, `supervisor-${worker.session_id}`);
  const popup = await wait(
    () => {
      const added = windows().filter((window) => !before.has(window));
      return added.length === 1 ? added[0] : null;
    },
    Boolean,
    'Controller popup did not appear',
  );
  const geometry = Object.fromEntries(
    execFileSync('xdotool', ['getwindowgeometry', '--shell', popup], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  );
  execFileSync('xdotool', [
    'mousemove',
    '--window',
    popup,
    String(Math.round(Number(geometry.WIDTH) / 2)),
    String(Math.round(Number(geometry.HEIGHT) * 0.75)),
    'click',
    '1',
  ]);
  await wait(
    () => rpc('list'),
    (rows) => rows.find((r) => r.id === worker.session_id).supervisor_id === id,
    'Controller choice did not apply',
  );
  const fleet = randomUUID();
  await rpc('create-fleet', fleet, 'Context work');
  await rpc('move-vessel', id, fleet);
  const placements = await rpc('fleets');
  await refresh();
  if (await read("document.getElementById('previous-agents').open"))
    await pageClick(panelWin, 'previous-toggle');
  const names = () =>
    read(
      `[...document.querySelectorAll('#fleets .session-name')].filter(n => n.getClientRects().length).map(n => n.textContent)`,
    );
  assert.deepEqual(await names(), ['Resume proof']);
  await pageClick(panelWin, `expand-${id}`);
  assert.deepEqual(await names(), ['Resume proof', 'Context worker']);
  await fs.writeFile(
    path.join(stateDir, 'panel-resume.png'),
    (await panelWin.webContents.capturePage()).toPNG(),
  );
  await pageClick(panelWin, `expand-${id}`);
  assert.deepEqual(await names(), ['Resume proof']);
  await pageClick(panelWin, `menu-${id}`);
  for (let step = 0; step < 30; step++) {
    if (await read("document.activeElement.textContent === 'Stop'")) break;
    await pageKey(panelWin, 'Tab');
  }
  assert.equal(await read('document.activeElement.textContent'), 'Stop');
  await pageKey(panelWin, 'Return');
  await wait(row, (r) => r.lifecycle.runtime === 'stopped');
  await refresh();
  await wait(
    () => read('document.activeElement.id'),
    (focused) => focused === 'previous-toggle',
    'Stopped captain lost useful keyboard focus',
  );
  workerContext = await read(`({
    rows: [...document.querySelectorAll('#fleets [data-key]')].map(n => n.dataset.key),
    text: document.getElementById('fleets').textContent
  })`);
  assert.deepEqual(workerContext.rows, [worker.session_id]);
  assert.match(workerContext.text, /Reports to Resume proof, Stopped/);
  assert.deepEqual(await rpc('fleets'), placements);
  assert.equal((await rpc('list')).find((r) => r.id === worker.session_id).supervisor_id, id);
  return { ...workerContext, choices: { rank: 'keyboard', controller: 'mouse' } };
};
