const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
exports.run = async ({ panelWin, rpc, refresh, stateDir, setExpanded }) => {
  const observations = [];
  const file = path.join(stateDir, 'groups-proof.json');
  const save = (verdict, error) =>
    fs.writeFile(
      file,
      JSON.stringify(
        {
          verdict,
          error,
          observations,
          limits: [
            'Actual existing native windows and renderer/preload actions; no model requests or new instances.',
            'Physical pointer feel remains a user check; dedicated Ghostty XWayland only.',
          ],
        },
        null,
        2,
      ),
    );
  await save('running');
  const ui = (code) => panelWin.webContents.executeJavaScript(code);
  const initial = await rpc('list');
  const before = await rpc('status');
  const waitLayout = async (action, root, mode) => {
    await fs.rm(path.join(stateDir, 'last-layout.json'), { force: true });
    await ui(action);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const result = await fs
        .readFile(path.join(stateDir, 'last-layout.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      if (result && result.root === root && result.mode === mode) {
        observations.push(result);
        assert.equal(result.result.state, 'confirmed', JSON.stringify(result));
        while (await ui("document.body.dataset.arranging === 'true'")) {
          if (Date.now() >= deadline) throw Error('Panel layout action did not settle.');
          await delay(50);
        }
        return result;
      }
      const error = await ui("document.getElementById('instance-error').textContent");
      if (error) throw Error(error);
      await delay(150);
    }
    throw Error('Panel layout did not finish.');
  };
  try {
    await setExpanded(true);
    await refresh();
    assert.ok((await ui("document.querySelectorAll('.instance-group').length")) > 0);
    await waitLayout(
      "document.getElementById('group-layout').value='grid'; document.getElementById('show-all').click()",
      null,
      'grid',
    );
    const captain = initial.find(
      (s) => s.rank === 'captain' && initial.some((c) => c.supervisor_id === s.id),
    );
    assert.ok(captain, 'This check requires an existing Captain group.');
    await waitLayout(
      `document.getElementById('group-layout').value='rank'; document.querySelector('[data-group="${captain.id}"]').click()`,
      captain.id,
      'rank',
    );
    await waitLayout(
      `document.querySelector('[data-key="${captain.id}"]').click()`,
      captain.id,
      'single',
    );
    await waitLayout(
      "document.getElementById('group-layout').value='grid'; document.getElementById('show-all').click()",
      null,
      'grid',
    );
    const after = await rpc('status');
    assert.equal(after.capturing, before.capturing);
    assert.deepEqual(after.control, before.control);
    assert.deepEqual(
      (await rpc('list')).map((s) => s.id),
      initial.map((s) => s.id),
    );
    observations.push({ action: 'service preserved', before, after });
    await fs.writeFile(
      path.join(stateDir, 'groups-panel.png'),
      await panelWin.webContents.capturePage().then((image) => image.toPNG()),
    );
    await save('pass');
  } catch (error) {
    await save('rework', error.message);
    throw error;
  }
};
