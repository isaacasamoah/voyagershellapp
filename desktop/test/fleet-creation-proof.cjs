const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
exports.run = async ({
  panelWin,
  rpc,
  refresh,
  inventory,
  dock,
  undock,
  setExpanded,
  stateDir,
}) => {
  const observations = [];
  const owned = [];
  const fleetIds = [];
  const file = path.join(stateDir, 'fleet-creation-proof.json');
  const save = (verdict, error) =>
    fs.writeFile(
      file,
      JSON.stringify(
        {
          verdict,
          observations,
          error,
          limits: [
            'Real panel creation, private conversation tool and docked Codex CLI; docking uses the existing native-window action. No voice is started.',
          ],
        },
        null,
        2,
      ),
    );
  const ui = (code) => panelWin.webContents.executeJavaScript(code);
  async function wait(read, accept, description, ms = 120000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = await read();
      if (accept(value)) return value;
      await delay(150);
    }
    throw Error(description);
  }
  try {
    await save('running');
    assert.deepEqual(await rpc('list'), []);
    for (const name of ['Launch', 'Research']) {
      const id = randomUUID();
      await rpc('create-fleet', id, name);
      fleetIds.push(id);
    }
    await refresh();
    await setExpanded(true);
    async function create(name, kind) {
      await ui(
        `document.getElementById('add').click();document.getElementById('instance-kind').value='${kind}';document.getElementById('instance-kind').dispatchEvent(new Event('change'));document.getElementById('instance-name').value=${JSON.stringify(name)};document.getElementById('instance-cwd').value=${JSON.stringify(stateDir)};document.getElementById('instance-fleet').value=${JSON.stringify(fleetIds[0])};document.getElementById('create-form').requestSubmit();`,
      );
      const rows = await wait(
        () => rpc('list'),
        (r) => r.some((s) => s.name === name),
        'Vessel not created',
      );
      const vessel = rows.find((s) => s.name === name);
      owned.push(vessel.id);
      await wait(
        () =>
          ui(
            `({hidden:document.getElementById('create-form').hidden,error:document.getElementById('instance-error').textContent})`,
          ),
        (v) => v.hidden && !v.error,
        'Creation did not finish',
      );
      assert.equal((await rpc('fleets')).assignments[vessel.id], fleetIds[0]);
      observations.push({ action: 'panel-created-in-fleet', vessel });
      return vessel;
    }
    const shell = await create('Fleet workbench', 'shell');
    const organizer = await create('Fleet organizer', 'codex');
    await wait(
      () => rpc('status'),
      (s) => s.conversation.phase === 'ready',
      'Private runtime not ready',
    );
    await ui(
      `document.getElementById('chat-text').value=${JSON.stringify(`Move the vessel Fleet workbench into the Research fleet. Use the Voyager tools, preserve its running work, and confirm the visual membership only. Do not create or change anything else.`)};document.getElementById('chat-form').requestSubmit();`,
    );
    await wait(
      () => rpc('fleets'),
      (data) => data.assignments[shell.id] === fleetIds[1],
      'Private Voyager did not move the Vessel',
    );
    await wait(
      () => rpc('status'),
      (s) => s.conversation.busy === false,
      'Private turn did not finish',
    );
    observations.push({ action: 'private-conversation-move', fleets: await rpc('fleets') });
    await refresh();
    const window = (await inventory()).find((w) => w.title === organizer.name);
    assert(window);
    assert(await dock(window.id));
    const request = randomUUID();
    const instruction = `Use your bound Voyager CLI to move Vessel ${shell.id} into Fleet ${fleetIds[0]}. The command is "$VOYAGER_BIN" --state "$VOYAGER_STATE" move-vessel ${shell.id} ${fleetIds[0]}. You are currently docked. This is visual organization only. Do not change ranks or assignments, start workers, or alter files. Report the command result.`;
    const sent = await rpc('send', organizer.id, request, instruction);
    const turn = sent.native_turn_id;
    assert.equal(typeof turn, 'string');
    await wait(
      () => rpc('fleets'),
      (data) => data.assignments[shell.id] === fleetIds[0],
      'Docked Codex did not move the Vessel',
    );
    await wait(
      () => rpc('events', '0'),
      (page) =>
        page.events.some(
          (e) =>
            e.session_id === organizer.id &&
            e.type === 'turn.completed' &&
            e.native_turn_id === turn &&
            e.payload.status === 'completed' &&
            e.payload.has_error === false,
        ),
      'Docked turn did not finish',
    );
    const after = (await rpc('list')).find((s) => s.id === organizer.id);
    assert.equal(after.rank, 'crew');
    assert.equal(after.supervisor_id, null);
    observations.push({
      action: 'docked-native-cli-move',
      fleets: await rpc('fleets'),
      organizer: after,
    });
    undock();
    await save('pass');
    console.log('Fleet creation and native agent moves passed.');
  } catch (error) {
    await save('rework', error.stack);
    throw error;
  } finally {
    undock();
    for (const id of owned) await rpc('remove', id, '--stop');
    for (const id of fleetIds) await rpc('remove-fleet', id);
  }
};
