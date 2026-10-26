const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

exports.run = async (
  { rpc, stateDir, refresh, getState, panelWin, setExpanded },
  { wait, delay, pageClick, pageKey },
) => {
  const panel = process.env.VOYAGER_PROOF_JOURNEY === 'panel-resume';
  const cwd = path.join(stateDir, 'resume-project');
  const moved = cwd + '-hidden';
  await fs.mkdir(cwd);
  await fs.writeFile(
    path.join(cwd, 'AGENTS.md'),
    'This is a disposable proof. Use tools only when specifically requested. Never read or print credentials. Change only the explicitly requested proof output file. Reply concisely.\n',
  );
  let id;
  let paused;
  let hidden = false;
  let openFeedback;
  let workerContext;
  const events = async () => (await rpc('events')).events.filter((e) => e.session_id === id);
  const row = async () => (await rpc('list')).find((r) => r.id === id);
  const ask = async (request, message) => {
    const sent = await rpc('send', id, request, message);
    const observed = await wait(
      events,
      (items) =>
        items.some((e) => e.type === 'turn.completed' && e.native_turn_id === sent.native_turn_id),
      'Explicit proof turn did not finish',
      90000,
    );
    const completion = observed.find(
      (e) => e.type === 'turn.completed' && e.native_turn_id === sent.native_turn_id,
    );
    assert.equal(completion.payload.status, 'completed');
    assert.equal(completion.payload.has_error, false);
    return observed.filter((e) => e.native_turn_id === sent.native_turn_id);
  };
  const attached = async (opened, server) =>
    wait(
      async () => {
        await refresh();
        return getState().records.find((r) => r.pid === opened.pid && r.server === server);
      },
      Boolean,
      'Terminal did not attach to the expected running conversation',
    );
  try {
    const created = await rpc(
      'create',
      'codex',
      'resume-original',
      'Resume proof',
      cwd,
      '--background',
    );
    id = created.session_id;
    const original = await row();
    await ask('resume-save-marker', 'Remember RESUME_WINDOW_743. Reply SAVED. Do not use tools.');
    const oldViewer = await rpc('open', id, 'xterm', '--request-id', 'resume-old-viewer');
    await attached(oldViewer, original.server);
    assert.equal(await fs.realpath(`/proc/${oldViewer.pid}/exe`), '/usr/bin/xterm');
    process.kill(oldViewer.pid, 'SIGSTOP');
    paused = oldViewer.pid;
    await rpc('stop-instance', id, '--runtime-only', '--request-id', 'resume-stop-original');
    await assert.rejects(
      rpc('resume-instance', id, 'resume-old-window-refusal', '1'),
      /previous terminal|viewer_still_open/i,
    );
    assert.equal((await row()).lifecycle.runtime_generation, 1);
    process.kill(paused, 'SIGCONT');
    paused = null;
    await rpc('background', id, '--request-id', 'resume-close-old');
    await wait(row, (r) => r.window === 'closed');
    const configProof = process.env.VOYAGER_PROOF_CURRENT_CONFIG === '1';
    if (configProof)
      await fs.writeFile(
        path.join(process.env.CODEX_HOME, 'config.toml'),
        'model = "gpt-6-sol"\nmodel_reasoning_effort = "low"\n',
      );
    const before = (await events()).filter((e) => e.type === 'turn.started').length;
    const start = performance.now();
    let resumed;
    if (panel) {
      await setExpanded(true, { x: 180, y: 100 });
      await refresh();
      await pageClick(panelWin, 'previous-toggle');
      await panelWin.webContents.executeJavaScript(`
        window.resumeControl = document.getElementById('resume-${id}');
        window.resumeLabels = [];
        new MutationObserver(() => {
          const row = document.querySelector('#sessions [data-key="${id}"]');
          if (row) window.resumeLabels.push(row.getAttribute('aria-label'));
        }).observe(document.getElementById('sessions'), {childList:true,subtree:true});
      `);
      await pageClick(panelWin, `resume-${id}`);
      const request = await panelWin.webContents.executeJavaScript(
        'window.resumeControl.dataset.request',
      );
      resumed = await wait(
        () => rpc('operation', request),
        (r) => r.state === 'completed',
      );
      await wait(row, (r) => r.window === 'open');
      assert.ok(
        await panelWin.webContents.executeJavaScript(
          "window.resumeLabels.some(label => label.includes('Resuming'))",
        ),
      );
    } else resumed = await rpc('resume-instance', id, 'resume-idle', '1');
    if (configProof) {
      const { stdout } = await exec('python3', [
        '-c',
        'import json,sqlite3,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(c.execute("SELECT settings FROM runtime_generations WHERE session_id=? ORDER BY generation DESC LIMIT 1",[sys.argv[2]]).fetchone()[0])',
        path.join(stateDir, 'events.sqlite'),
        id,
      ]);
      const effective = JSON.parse(stdout).effective;
      assert.equal(effective.model, 'gpt-6-sol');
      assert.equal(effective.reasoningEffort, 'low');
      assert.equal(effective.approvalPolicy, 'never');
      assert.equal(effective.sandbox.type, 'dangerFullAccess');
    }
    const readyMs = performance.now() - start;
    assert.equal(resumed.state, 'completed');
    assert.equal(resumed.runtime_generation, 2);
    assert.notEqual(resumed.runtime_pid, created.runtime_pid);
    assert.equal(resumed.native_thread_id, original.native_thread_id);
    assert.equal(resumed.window, 'closed');
    if (!panel) assert.deepEqual(await rpc('operation', 'resume-idle'), resumed);
    await delay(5000);
    assert.equal((await events()).filter((e) => e.type === 'turn.started').length, before);
    const recalled = await ask(
      'resume-recall',
      'What marker did I ask you to remember? Reply only with the marker. Do not use tools.',
    );
    assert(
      recalled.some(
        (e) =>
          e.type === 'message' &&
          e.payload.role === 'assistant' &&
          /RESUME_WINDOW_743/.test(e.payload.text),
      ),
    );
    const capabilityFile = path.join(cwd, 'bound-capabilities.json');
    const capabilities = await ask(
      'resume-bound-capabilities',
      `Use exec_command to run exactly this read-only Voyager request: "$VOYAGER_BIN" --state "$VOYAGER_STATE" capabilities > ${JSON.stringify(capabilityFile)} . Then reply CAPABILITIES_DONE. Do not read the context file or print credentials.`,
    );
    assert(
      capabilities.some((e) => e.type === 'tool.completed' && e.payload.status === 'completed'),
    );
    const bound = JSON.parse(await fs.readFile(capabilityFile, 'utf8'));
    assert.equal(bound.actor.kind, 'instance');
    assert.equal(bound.actor.session_id, id);
    assert.equal(bound.session_id, id);
    const current = await row();
    const turns = (await events()).filter((e) => e.type === 'turn.started').length;
    if (panel) {
      await rpc('background', id);
      await refresh();
    }
    await fs.rename(cwd, moved);
    hidden = true;
    let failedRequest = 'resume-failed-open';
    if (panel) {
      await pageClick(panelWin, `menu-${id}`);
      await panelWin.webContents.executeJavaScript(
        `window.openControl = document.getElementById('open-${id}')`,
      );
      await pageClick(panelWin, `open-${id}`);
      await wait(() =>
        panelWin.webContents.executeJavaScript(
          "document.getElementById('instance-error').textContent",
        ),
      );
      failedRequest = await panelWin.webContents.executeJavaScript(
        'window.openControl.dataset.request',
      );
    } else await assert.rejects(rpc('open', id, 'xterm', '--request-id', failedRequest));
    const failedOpen = await rpc('operation', failedRequest);
    assert.equal(failedOpen.state, 'partial');
    assert.equal(failedOpen.runtime, 'running');
    assert.equal((await row()).lifecycle.runtime_generation, 2);
    await fs.rename(moved, cwd);
    hidden = false;
    const openStart = performance.now();
    let opened;
    if (panel) {
      await wait(
        () =>
          panelWin.webContents.executeJavaScript(`document.getElementById('open-${id}').disabled`),
        (disabled) => !disabled,
      );
      await pageClick(panelWin, `open-${id}`);
      const request = await panelWin.webContents.executeJavaScript(
        'window.openControl.dataset.request',
      );
      assert.notEqual(request, failedRequest);
      opened = await wait(
        () => rpc('operation', request),
        (r) => r.state === 'completed',
      );
      await wait(
        () => panelWin.webContents.executeJavaScript('window.openControl.disabled'),
        (disabled) => !disabled,
      );
      openFeedback = await panelWin.webContents.executeJavaScript(
        "document.getElementById('instance-error').textContent",
      );
      assert.ok(!openFeedback || openFeedback.startsWith('Terminal opened, but'), openFeedback);
    } else opened = await rpc('open', id, 'xterm', '--request-id', 'resume-open');
    const attachment = await attached(opened, current.server);
    const attachedMs = performance.now() - openStart;
    await exec('xdotool', ['windowclose', String(opened.window_id)]);
    await wait(row, (r) => r.window === 'closed');
    const reopened = await rpc('open', id, 'xterm', '--request-id', 'resume-reopen');
    await attached(reopened, current.server);
    await delay(1000);
    assert.equal((await rpc('attach-info', id)).pid, resumed.runtime_pid);
    assert.equal((await events()).filter((e) => e.type === 'turn.started').length, turns);
    if (panel)
      workerContext = await require('./panel-context-proof.cjs').run(
        { rpc, refresh, panelWin, stateDir, id, cwd, row },
        { wait, pageClick, pageKey },
      );
    if (panel)
      await fs.writeFile(
        path.join(stateDir, 'panel-resume.png'),
        (await panelWin.webContents.capturePage()).toPNG(),
      );
    return {
      id,
      thread: resumed.native_thread_id,
      resumed,
      failedOpen,
      opened,
      reopened,
      readyMs,
      attachedMs,
      viewer: {
        pid: attachment.pid,
        server: attachment.server,
        frontendPid: attachment.frontend.pid,
      },
      bound: { actor: bound.actor, rank: bound.rank },
      idleSeconds: 5,
      savedMarkerRecalled: true,
      currentConfigurationApplied: configProof,
      openFeedback,
      workerContext,
    };
  } finally {
    if (paused) process.kill(paused, 'SIGCONT');
    if (hidden) await fs.rename(moved, cwd);
    if (id && (await row()).lifecycle.runtime === 'running')
      await rpc('stop-instance', id, '--request-id', 'resume-proof-cleanup');
  }
};
