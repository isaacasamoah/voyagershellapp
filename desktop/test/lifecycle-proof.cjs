const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

exports.run = async ({ panelWin, rpc, refresh, inventory, stateDir, setExpanded }) => {
  const file = path.join(stateDir, 'lifecycle-proof.json');
  const observations = [];
  const save = (verdict, error) =>
    fs.writeFile(
      file,
      JSON.stringify(
        {
          verdict,
          observations,
          error,
          limits: [
            'Renderer actions use real preload, IPC, Rust and Ghostty windows. Physical pointer quality and sound remain Isaac’s check.',
            'This panel journey uses real Bash; native Codex capture is checked separately.',
          ],
        },
        null,
        2,
      ),
    );
  const wait = async (read, accept, description, ms = 16000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const result = await read();
      if (await accept(result)) return result;
      await delay(100);
    }
    throw Error(description);
  };
  const ui = (code) => panelWin.webContents.executeJavaScript(code);
  const list = () => rpc('list', '--include-removed');
  const create = async (name) => {
    await setExpanded(true);
    await ui(
      `document.getElementById('add').click(); document.getElementById('instance-kind').value='shell'; document.getElementById('instance-name').value=${JSON.stringify(name)}; document.getElementById('instance-cwd').value=${JSON.stringify(stateDir)}; document.getElementById('create-form').requestSubmit();`,
    );
    const session = await wait(
      list,
      (rows) => rows.find((s) => s.name === name),
      'Panel creation did not register',
    );
    await wait(
      () =>
        ui(
          "({error:document.getElementById('instance-error').textContent,hidden:document.getElementById('create-form').hidden})",
        ),
      (s) => s.hidden,
      'Create form did not complete',
    );
    const current = session.find((s) => s.name === name);
    const window = await wait(
      inventory,
      (windows) => windows.find((w) => w.visible && w.title === name),
      'Native Ghostty did not map',
    );
    observations.push({
      action: 'create',
      session: current.id,
      window: window.find((w) => w.title === name),
    });
    return current;
  };
  const action = async (session, label, accept) => {
    await refresh();
    await ui(
      `(async () => { const row=Array.from(document.querySelectorAll('.instance-row')).find(r=>r.querySelector('[data-key]')?.dataset.key===${JSON.stringify(session.id)}); if(!row)throw Error('Missing instance'); const menu=row.querySelector('.instance-menu');menu.querySelector(':scope > button').click(); const button=Array.from(menu.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}); if(!button)throw Error('Missing action'); const bounds=row.querySelector('.instance-actions').getBoundingClientRect(); if(bounds.top<0 || bounds.bottom>innerHeight || bounds.left<0 || bounds.right>innerWidth)throw Error('Action menu is clipped'); const hit=document.elementFromPoint((bounds.left+bounds.right)/2, button.getBoundingClientRect().top + button.getBoundingClientRect().height/2); if(hit!==button)throw Error('Action button is clipped or covered'); if(getComputedStyle(button).getPropertyValue('-webkit-app-region')!=='no-drag')throw Error('Action button is a drag region'); await button.onclick(); const error=document.getElementById('instance-error').textContent; if(error) throw Error(error); })()`,
    );
    await wait(list, accept, `${label} did not achieve its result`);
    await wait(
      () =>
        ui(
          "({error:document.getElementById('instance-error').textContent,busy:Array.from(document.querySelectorAll('.instance-actions button')).some(b=>b.disabled)})",
        ),
      (s) => !s.busy && !s.error,
      `${label} did not finish cleanly`,
    );
    observations.push({ action: label, session: session.id, status: await rpc('status') });
  };
  const events = async () => {
    let cursor = 0,
      result = [];
    while (true) {
      const page = await rpc('events', String(cursor));
      result.push(...page.events);
      if (page.events.length < 100) return result;
      cursor = page.cursor;
    }
  };
  try {
    await save('running');
    assert.deepEqual(await rpc('list'), [], 'Use a fresh private proof service');
    const a = await create('Lifecycle Workbench');
    const b = await create('Independent Workbench');
    const info = await rpc('attach-info', a.id);
    const output = path.join(stateDir, 'background-completed.txt');
    await rpc(
      'shell-exec',
      a.id,
      'native-background-task',
      `sleep 3; printf 'same-shell' > '${output}'`,
    );
    await action(a, 'Run in background', async () => true);
    await wait(
      inventory,
      (windows) => !windows.some((w) => w.visible && w.title === a.name),
      'Background window remains',
    );
    const viewer = observations.find((o) => o.action === 'create' && o.session === a.id).window;
    observations.push({
      action: 'viewer closed',
      window: viewer.id,
      process_resident: await fs.stat(`/proc/${viewer.pid}`).then(
        () => true,
        () => false,
      ),
    });
    await action(a, 'Run in background', async () => true);
    await wait(
      async () => fs.readFile(output, 'utf8').catch(() => ''),
      (text) => text === 'same-shell',
      'Background task did not finish',
    );
    assert.equal((await rpc('attach-info', a.id)).pid, info.pid);
    observations.push({ action: 'background task completed', runtime_pid: info.pid });
    await refresh();
    await ui(
      `Array.from(document.querySelectorAll('.instance-row')).find(r=>r.querySelector('[data-key]')?.dataset.key===${JSON.stringify(a.id)}).querySelector('.session').click()`,
    );
    await wait(
      inventory,
      (windows) => windows.some((w) => w.visible && w.title === a.name),
      'Arrow did not reopen',
    );
    assert.equal((await rpc('attach-info', a.id)).pid, info.pid);
    await panelWin.webContents
      .capturePage()
      .then((image) => fs.writeFile(path.join(stateDir, 'panel-lifecycle.png'), image.toPNG()));
    await action(a, 'Stop', (rows) => rows.find((s) => s.id === a.id)?.worker_state === 'stopped');
    assert(!(await inventory()).some((w) => w.visible && w.title === a.name));
    assert.equal((await list()).find((s) => s.id === b.id).worker_state, 'running');
    const history = await events();
    assert(history.some((e) => e.session_id === a.id && e.type === 'shell.command'));
    const afterRemoval = path.join(stateDir, 'removed-completed.txt');
    await rpc(
      'shell-exec',
      b.id,
      'native-removed-task',
      `sleep 3; printf 'still-running' > '${afterRemoval}'`,
    );
    await action(b, 'Remove', (rows) => rows.find((s) => s.id === b.id)?.removed_ms != null);
    assert(!(await rpc('list')).some((s) => s.id === b.id));
    assert((await inventory()).some((w) => w.visible && w.title === b.name));
    await wait(
      async () => fs.readFile(afterRemoval, 'utf8').catch(() => ''),
      (text) => text === 'still-running',
      'Removed runtime did not keep working',
    );
    await delay(350);
    const cut = await events();
    const removed = cut.find((e) => e.session_id === b.id && e.type === 'session.removed');
    assert(removed);
    assert(
      !cut.some(
        (e) =>
          e.session_id === b.id &&
          e.sequence > removed.sequence &&
          ['shell.command', 'shell.completed'].includes(e.type),
      ),
    );
    await assert.rejects(rpc('shell-read', b.id), /removed/);
    await action(
      b,
      'Register again',
      (rows) => rows.find((s) => s.id === b.id)?.removed_ms == null,
    );
    await rpc('shell-exec', b.id, 'native-new-generation', 'printf new-generation');
    await wait(
      events,
      (rows) =>
        rows.some(
          (e) =>
            e.session_id === b.id &&
            e.type === 'shell.completed' &&
            e.payload.command_id === 'native-new-generation',
        ),
      'New capture did not arrive',
    );
    await action(
      b,
      'Stop and remove',
      (rows) =>
        rows.find((s) => s.id === b.id)?.removed_ms != null &&
        rows.find((s) => s.id === b.id)?.worker_state === 'stopped',
    );
    assert(!(await inventory()).some((w) => w.visible && w.title === b.name));
    await refresh();
    assert(
      !(await ui(
        `Array.from(document.querySelectorAll('[data-key]')).some(b=>b.dataset.key===${JSON.stringify(b.id)})`,
      )),
      'Stopped and removed instance remains in the panel',
    );
    const lifecycle = (await events()).filter((e) => e.session_id === b.id);
    assert(lifecycle.some((e) => e.type === 'interface.closed'));
    assert(lifecycle.some((e) => e.type === 'shell.stopped'));
    assert(lifecycle.some((e) => e.type === 'session.removed'));
    assert((await events()).some((e) => e.session_id === a.id && e.type === 'shell.command'));
    await save('surface');
    console.log('Lifecycle panel proof saved.');
  } catch (error) {
    await save('rework', error.message);
    throw error;
  }
};
