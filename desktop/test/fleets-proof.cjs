const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const hierarchy = require('../src/ui/hierarchy.js');
const { screen } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
exports.run = async ({ panelWin, rpc, refresh, stateDir, setExpanded, inventory, getState }) => {
  const observations = [];
  const file = path.join(stateDir, 'fleets-proof.json');
  let fleetId;
  let restore;
  const probe = path.resolve(__dirname, '../../target/debug/voyager-windows');
  const ui = (code) => panelWin.webContents.executeJavaScript(code);
  const save = (verdict, error) =>
    fs.writeFile(
      file,
      JSON.stringify(
        {
          verdict,
          error,
          observations,
          limits: [
            'Actual Electron renderer, preload and persisted fleet file; drag/drop events are programmatic, not physical pointer proof.',
            'No model requests or new vessels; native window placement is restored after the check.',
          ],
        },
        null,
        2,
      ),
    );
  const wait = async (read, accept, message) => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const value = await read();
      if (accept(value)) return value;
      await delay(60);
    }
    throw Error(message);
  };
  async function sizing(label) {
    const expected = await ui(
      `(() => { const p=document.getElementById('panel'), f=document.getElementById('panel-flow'), s=getComputedStyle(p); return Math.ceil(f.getBoundingClientRect().height+parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth)+16); })()`,
    );
    const area = screen.getDisplayMatching(panelWin.getBounds()).workArea;
    const bounds = await wait(
      async () => panelWin.getBounds(),
      (b) =>
        Math.abs(b.height - Math.min(area.height, expected)) <= 2 &&
        b.y >= area.y &&
        b.y + b.height <= area.y + area.height,
      `${label}: panel did not fit visible content`,
    );
    observations.push({ action: label, expected, bounds, display: area });
    return bounds.height;
  }
  async function drop(id, target) {
    await ui(
      `(() => { const source=document.querySelector('[data-key="${id}"]'); const transfer=new DataTransfer(); source.dispatchEvent(new DragEvent('dragstart',{dataTransfer:transfer,bubbles:true})); const target=${target}; target.dispatchEvent(new DragEvent('dragover',{dataTransfer:transfer,bubbles:true,cancelable:true})); target.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true})); })()`,
    );
  }
  await save('running');
  try {
    const prior = await fs.readFile(path.join(stateDir, 'fleets.json'), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (prior !== null)
      assert.deepEqual(
        JSON.parse(prior),
        { fleets: [], assignments: {} },
        'Requires empty fleet settings; existing fleets are preserved.',
      );
    const before = await rpc('status');
    const sessions = await rpc('list');
    await setExpanded(true);
    await refresh();
    const originalWindows = await inventory();
    const originalRecords = getState().records;
    const windows = originalRecords.map((r) => {
      const w = originalWindows.find((w) => w.pid === r.pid);
      assert.ok(w, 'Original terminal identity missing');
      return {
        id: w.id,
        pid: r.pid,
        start: r.start,
        minimise: !w.visible,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
      };
    });
    restore = { windows, focus: windows.find((w) => !w.minimise).id };
    assert.equal(
      await ui(
        "Boolean(document.getElementById('show-all') || document.getElementById('group-layout'))",
      ),
      false,
    );
    const captain = sessions.find(
      (s) => s.rank === 'captain' && sessions.filter((c) => c.supervisor_id === s.id).length >= 2,
    );
    assert.ok(captain, 'Requires an existing Captain with two reports.');
    const otherCrew = sessions
      .filter((s) => s.rank === 'crew' && s.supervisor_id !== captain.id)
      .slice(0, 2);
    assert.equal(otherCrew.length, 2, 'Requires two other Crew.');
    for (const s of hierarchy.members(sessions)) {
      const hasReports = sessions.some((r) => r.supervisor_id === s.id);
      if (!hasReports) continue;
      assert.equal(
        await ui(`document.querySelector('[data-expand="${s.id}"]').getAttribute('aria-expanded')`),
        'false',
      );
    }
    const initial = await sizing('collapsed hierarchy');
    await ui(
      "document.getElementById('add-fleet').click(); document.getElementById('fleet-name').value='Canvas check'; document.getElementById('fleet-form').requestSubmit()",
    );
    const data = await wait(
      async () =>
        fs
          .readFile(path.join(stateDir, 'fleets.json'), 'utf8')
          .then(JSON.parse)
          .catch(() => ({ fleets: [] })),
      (d) => d.fleets.some((f) => f.name === 'Canvas check'),
      'Fleet did not persist',
    );
    fleetId = data.fleets.find((f) => f.name === 'Canvas check').id;
    await wait(
      () => ui(`Boolean(document.querySelector('[data-fleet="${fleetId}"]'))`),
      Boolean,
      'Fleet not displayed',
    );
    const emptyHeight = await ui(
      `document.querySelector('[data-fleet="${fleetId}"] .fleet-canvas').getBoundingClientRect().height`,
    );
    assert.ok(emptyHeight >= 56 && emptyHeight <= 60, `Empty canvas size ${emptyHeight}`);
    await sizing('one-vessel empty canvas');
    for (const s of hierarchy.members(sessions)) {
      if (sessions.some((r) => r.supervisor_id === s.id))
        await ui(`document.querySelector('[data-expand="${s.id}"]').click()`);
    }
    await sizing('expanded hierarchy');
    await ui("document.getElementById('add').click()");
    await sizing('creation form within display');
    await ui("document.getElementById('cancel-create').click()");
    const canvas = `document.querySelector('[data-fleet="${fleetId}"] .fleet-canvas')`;
    for (const crew of otherCrew) {
      await drop(crew.id, canvas);
      await wait(
        () =>
          ui(
            `Boolean(document.querySelector('[data-fleet="${fleetId}"] [data-key="${crew.id}"]'))`,
          ),
        Boolean,
        'Crew drop not displayed',
      );
    }
    const joinedHeight = await ui(`${canvas}.getBoundingClientRect().height`);
    assert.ok(joinedHeight > emptyHeight, 'Canvas did not grow for a second vessel');
    await sizing('canvas grows with vessels');
    await drop(captain.id, canvas);
    await wait(
      async () => JSON.parse(await fs.readFile(path.join(stateDir, 'fleets.json'), 'utf8')),
      (d) =>
        hierarchy
          .members(sessions, captain.id)
          .every((s) => hierarchy.fleetOf(s.id, sessions, d.assignments) === fleetId),
      'Supervisor did not carry its reports',
    );
    observations.push({
      action: 'supervisor subtree drop',
      members: hierarchy.members(sessions, captain.id).map((s) => s.id),
      emptyHeight,
      joinedHeight,
    });
    await fs.rm(path.join(stateDir, 'last-layout.json'), { force: true });
    await ui(`document.querySelector('[data-fleet="${fleetId}"] .fleet-name').click()`);
    const placement = await wait(
      async () =>
        fs
          .readFile(path.join(stateDir, 'last-layout.json'), 'utf8')
          .then(JSON.parse)
          .catch(() => null),
      (d) => d?.mode === 'rank',
      'Fleet surface did not complete',
    );
    assert.equal(placement.result.state, 'confirmed');
    assert.equal(placement.result.windows.filter((w) => w.visible).length, 5);
    await wait(
      () => ui('document.body.dataset.arranging'),
      (v) => v !== 'true',
      'Fleet surface did not settle',
    );
    observations.push({ action: 'native fleet surface', placement });
    const restored = JSON.parse(
      (await exec(probe, ['layout', JSON.stringify(restore)], { timeout: 5000 })).stdout,
    );
    assert.equal(restored.state, 'confirmed');
    restore = null;
    await drop(captain.id, "document.getElementById('sessions')");
    await wait(
      async () => JSON.parse(await fs.readFile(path.join(stateDir, 'fleets.json'), 'utf8')),
      (d) =>
        hierarchy
          .members(sessions, captain.id)
          .every((s) => hierarchy.fleetOf(s.id, sessions, d.assignments) === null),
      'Return to Vessels did not carry subtree',
    );
    await ui(`document.querySelector('[data-fleet="${fleetId}"] .fleet-remove').click()`);
    await wait(
      () => ui(`!document.querySelector('[data-fleet="${fleetId}"]')`),
      Boolean,
      'Fleet did not disappear',
    );
    fleetId = null;
    const cleaned = JSON.parse(await fs.readFile(path.join(stateDir, 'fleets.json'), 'utf8'));
    assert.equal(cleaned.fleets.length, 0, 'Fleet settings changed during this check; preserved.');
    assert.ok(Object.values(cleaned.assignments).every((value) => value === null));
    if (prior === null) await fs.rm(path.join(stateDir, 'fleets.json'));
    else await fs.writeFile(path.join(stateDir, 'fleets.json'), prior, { mode: 0o600 });
    await refresh();
    for (const s of hierarchy.members(sessions)) {
      if (sessions.some((r) => r.supervisor_id === s.id))
        await ui(
          `(() => { const b=document.querySelector('[data-expand="${s.id}"]'); if(b?.getAttribute('aria-expanded')==='true')b.click(); })()`,
        );
    }
    const final = await sizing('shrinks after fleet removal and collapse');
    assert.ok(Math.abs(final - initial) <= 2);
    const after = await rpc('status');
    const latest = await rpc('list');
    assert.equal(after.capturing, before.capturing);
    assert.deepEqual(after.control, before.control);
    assert.deepEqual(
      latest.map((s) => [s.id, s.rank, s.supervisor_id]),
      sessions.map((s) => [s.id, s.rank, s.supervisor_id]),
    );
    observations.push({ action: 'service preserved', before, after });
    await fs.writeFile(
      path.join(stateDir, 'vessels-panel.png'),
      await panelWin.webContents.capturePage().then((i) => i.toPNG()),
    );
    await save('pass');
  } catch (error) {
    if (restore)
      await exec(probe, ['layout', JSON.stringify(restore)], { timeout: 5000 }).catch(() => {});
    if (fleetId) await ui(`window.voyager.removeFleet(${JSON.stringify(fleetId)})`).catch(() => {});
    await save('rework', error.message);
    throw error;
  }
};
