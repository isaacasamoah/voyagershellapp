const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { app } = require('electron');
const exec = promisify(execFile);

exports.run = async ({
  panelWin,
  rpc,
  refresh,
  inventory,
  dock,
  undock,
  getState,
  setExpanded,
  stateDir,
}) => {
  const file = path.join(stateDir, 'authority-proof.json');
  const observations = [];
  const created = [];
  const save = (verdict, error) =>
    fs.writeFile(
      file,
      JSON.stringify(
        {
          verdict,
          observations,
          error,
          limits: [
            'Real panel, IPC, service, Ghostty and one native Codex task; docking uses the existing programmatic native-window action.',
            'Physical drag quality and sound remain a person’s check.',
            'The separate native_authority test proves context delivery into actual Codex tool calls.',
            'Native voice and preemptive human override are later increments.',
          ],
        },
        null,
        2,
      ),
    );
  const ui = (code) => panelWin.webContents.executeJavaScript(code);
  const wait = async (read, accept, description, timeout = 25000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = await read();
      if (accept(value)) return value;
      await delay(100);
    }
    throw Error(description);
  };
  const list = () => rpc('list', '--include-removed');
  const create = async (name, kind, rank = 'crew', supervisor = '') => {
    await setExpanded(true);
    await ui("document.getElementById('add').click()");
    assert.equal(await ui("document.getElementById('instance-rank').value"), 'crew');
    await ui(
      `document.getElementById('instance-kind').value=${JSON.stringify(kind)}; document.getElementById('instance-kind').dispatchEvent(new Event('change')); document.getElementById('instance-rank').value=${JSON.stringify(rank)}; document.getElementById('instance-rank').dispatchEvent(new Event('change'));`,
    );
    assert.equal(await ui("document.getElementById('rank-field').hidden"), kind === 'shell');
    await ui(
      `document.getElementById('instance-supervisor').value=${JSON.stringify(supervisor)}; document.getElementById('instance-name').value=${JSON.stringify(name)}; document.getElementById('instance-cwd').value=${JSON.stringify(stateDir)}; document.getElementById('create-form').requestSubmit()`,
    );
    const rows = await wait(
      list,
      (r) => r.some((s) => s.name === name),
      'Panel creation did not register',
    );
    const session = rows.find((s) => s.name === name);
    created.push(session.id);
    await wait(
      () =>
        ui(
          "({hidden:document.getElementById('create-form').hidden,error:document.getElementById('instance-error').textContent})",
        ),
      (s) => s.hidden && !s.error,
      'Create form did not finish',
    );
    assert.equal(session.rank, kind === 'shell' ? null : rank);
    assert.equal(session.supervisor_id || '', supervisor);
    observations.push({
      action: 'panel create',
      session: session.id,
      kind,
      rank: session.rank,
      supervisor: session.supervisor_id,
    });
    return session;
  };
  const asInstance = async (session, ...args) => {
    let locator;
    for (const name of await fs.readdir(path.join(stateDir, 'contexts'))) {
      const candidate = path.join(stateDir, 'contexts', name);
      const context = JSON.parse(await fs.readFile(candidate, 'utf8'));
      if (context.session_id === session) locator = candidate;
    }
    assert(locator, 'Bound context missing');
    const result = await exec(
      path.resolve(__dirname, '../../target/debug/voyager'),
      ['--state', stateDir, ...args],
      {
        env: { ...process.env, VOYAGER_CALLER: 'instance', VOYAGER_SESSION_CONTEXT: locator },
        timeout: 25000,
        maxBuffer: 1024 * 1024,
      },
    );
    return JSON.parse(result.stdout);
  };
  try {
    await save('running');
    assert.deepEqual(await rpc('list'), [], 'Use a fresh private proof service');
    const captain = await create('Authority Captain', 'codex', 'captain');
    const crew = await create('Authority Crew', 'codex', 'crew', captain.id);
    await create('Authority Workbench', 'shell');
    await assert.rejects(
      asInstance(crew.id, 'send', captain.id, 'undocked-refusal', 'Reply exactly SHOULD_NOT_RUN.'),
      /forbidden/,
    );
    await refresh();
    const target = await wait(
      async () => {
        await refresh();
        const state = getState();
        const record = state.records.find(
          (r) => r.nativeId === crew.native_thread_id && r.server === crew.server,
        );
        return record && (await inventory()).find((w) => w.visible && w.pid === record.pid);
      },
      Boolean,
      'Crew native window did not become identifiable',
    );
    assert.equal(await dock(target.id), true);
    await wait(
      () => rpc('status'),
      (s) => s.control?.session_id === crew.id,
      'Crew did not take control',
    );
    const accepted = await asInstance(
      crew.id,
      'send',
      captain.id,
      'docked-delegation',
      'Run exactly one shell command: sleep 2. Then reply exactly DOCKED_AUTHORITY_42.',
    );
    assert.equal(accepted.state, 'accepted');
    assert.equal(accepted.actor_session_id, crew.id);
    undock();
    await wait(
      () => rpc('status'),
      (s) => s.control === null,
      'Undock did not release',
    );
    await assert.rejects(
      asInstance(crew.id, 'send', captain.id, 'released-refusal', 'Reply exactly SHOULD_NOT_RUN.'),
      /forbidden/,
    );
    await wait(
      () => rpc('events'),
      (page) =>
        page.events.some(
          (e) => e.native_turn_id === accepted.native_turn_id && e.type === 'turn.completed',
        ),
      'Accepted work did not complete after undock',
      180000,
    );
    assert.equal((await rpc('status')).capturing, 3);
    observations.push({
      action: 'native docking authority',
      crew: crew.id,
      window: target.id,
      accepted,
      after_undock: await rpc('status'),
    });
    await refresh();
    await setExpanded(true);
    await ui(
      `(async()=>{const row=Array.from(document.querySelectorAll('.instance-row')).find(r=>r.querySelector('[data-key]')?.dataset.key===${JSON.stringify(crew.id)});row.querySelector('.instance-menu>button').click();const menu=row.querySelector('.instance-actions');menu.querySelector('select[aria-label="Supervisor"]').value='';await Array.from(menu.querySelectorAll('button')).find(b=>b.textContent==='Change assignment').onclick();})()`,
    );
    await wait(
      list,
      (rows) => rows.find((s) => s.id === crew.id)?.supervisor_id === null,
      'Panel reassignment failed',
    );
    const question = await asInstance(
      crew.id,
      'escalate',
      'owner-question',
      'May I continue the local test?',
    );
    assert.equal(question.destination, null);
    await wait(
      async () => {
        await refresh();
        return ui("document.querySelectorAll('.chat-question').length");
      },
      (n) => n === 1,
      'Owner question did not appear',
    );
    await panelWin.webContents
      .capturePage()
      .then((image) => fs.writeFile(path.join(stateDir, 'authority-panel.png'), image.toPNG()));
    await ui(
      "(async()=>{document.getElementById('chat-text').value='Answer the pending question from the test vessel: Reply exactly OWNER_DECISION_42. No other action is needed.';await document.getElementById('chat-form').onsubmit({preventDefault(){}});})()",
    );
    const answered = await wait(
      () => rpc('escalations'),
      (entries) =>
        entries.some(
          (e) => e.request_id === question.request_id && e.answer?.delivery === 'accepted',
        ),
      'Owner answer not delivered',
    );
    observations.push({
      action: 'owner escalation and chat response',
      question,
      answer: answered.find((e) => e.request_id === question.request_id),
    });
    await save('pass');
  } catch (error) {
    await save('rework', error.message);
    console.error(error);
    process.exitCode = 1;
  } finally {
    undock();
    for (const id of created) {
      await rpc('stop-instance', id, '--request-id', `proof-stop-${id}`).catch((error) =>
        console.error(error.message),
      );
    }
    await rpc('stop').catch((error) => console.error(error.message));
    app.quit();
  }
};
