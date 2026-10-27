const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { completedTurn } = require('./native-proof.cjs');
const { execFileSync } = require('node:child_process');

exports.run = async (
  { rpc, stateDir, refresh, getState, panelWin, avatarWin, inventory, screen, setExpanded },
  { wait, pageClick, input, delay },
) => {
  const retryMode = process.env.VOYAGER_PROOF_RECONNECT_RETRY === '1';
  const viewerMode = process.env.VOYAGER_PROOF_RECONNECT_VIEWER;
  const { processIdentity } = require('../src/binding.cjs');
  const control = viewerMode
    ? await processIdentity(Number(process.env.VOYAGER_PROOF_CONTROL_PID))
    : null;
  const cwd = path.join(stateDir, 'reconnect-project');
  await fs.mkdir(cwd);
  await fs.writeFile(
    path.join(cwd, 'AGENTS.md'),
    'Disposable proof. Only follow the explicit proof request. Never read or print credentials.\n',
  );
  const created = await rpc(
    'create',
    'codex',
    'reconnect-proof',
    'Reconnect proof',
    cwd,
    '--background',
  );
  const id = created.session_id;
  const row = async () => (await rpc('list')).find((r) => r.id === id);
  const events = async () => (await rpc('events')).events.filter((e) => e.session_id === id);
  const before = await row();
  let viewer;
  let viewerIdentity;
  let viewerBounds;
  if (viewerMode) {
    viewer = await rpc('open', id, 'xterm', '--request-id', 'reconnect-old-viewer');
    viewerIdentity = await processIdentity(viewer.pid);
    await assert.rejects(
      rpc('open', id, 'ghostty', '--request-id', 'reconnect-viewer-conflict'),
      /viewer_conflict/,
    );
    await wait(
      async () => {
        await refresh();
        const layout = JSON.parse(
          await fs.readFile(path.join(stateDir, 'last-layout.json')).catch(() => '{}'),
        );
        return layout.vessels?.includes(id) && layout.result?.state === 'confirmed';
      },
      Boolean,
      'Initial terminal arrangement did not finish',
    );
    viewerBounds = (await inventory()).find((w) => w.id === viewer.window_id);
    assert(viewerBounds, 'Original viewer was not mapped');
  }
  const sent = await rpc(
    'send',
    id,
    'reconnect-active-work',
    'Run sleep 15 in the shell, then reply RECONNECTED_WORK_FINISHED. Use no other tools.',
  );
  await wait(events, (items) => items.some((e) => e.type === 'tool.started'));
  const receipt = await rpc('operation', 'reconnect-proof');
  assert.equal(receipt.process_identity, undefined);
  const request = 'active-service-restart';
  const started = performance.now();
  const serviceCommand = async (action, request, details = {}) => {
    await fs.writeFile(
      path.join(stateDir, 'proof-service-control.json'),
      JSON.stringify({ action, request, ...details }),
    );
    return wait(
      async () =>
        JSON.parse(
          await fs.readFile(path.join(stateDir, 'proof-service-restarted.json')).catch(() => '{}'),
        ),
      (r) => r.request === request,
    );
  };
  const restart = await serviceCommand('restart', request, {
    ...(retryMode ? { block_endpoint: id } : {}),
    ...(viewerMode === 'closed' ? { close_viewer: 'reconnect-old-viewer' } : {}),
  });
  let retried;
  if (retryMode) {
    const failed = await wait(
      row,
      (r) => r.recovery?.retry_available,
      'Automatic checks did not finish',
      30000,
    );
    assert.equal(failed.lifecycle.runtime, 'unknown');
    await refresh();
    await setExpanded(true, { x: 180, y: 100 });
    const retryButton = await wait(
      async () => {
        await refresh();
        return panelWin.webContents.executeJavaScript(`(() => {
        const row = document.querySelector('[data-vessel="${id}"]');
        if (!row || !document.querySelector('#sessions').contains(row)) return null;
        const action = [...row.querySelectorAll('button')].find(b => b.textContent === 'Retry connection');
        if (!action) return null;
        action.id = 'reconnect-retry';
        action.addEventListener('click', () => queueMicrotask(() => window.reconnectProofRequest = action.dataset.request), { once: true });
        return action.id;
      })()`);
      },
      Boolean,
      'Retry connection was not shown in current Vessels',
    );
    await serviceCommand('restore-endpoint', 'restore-existing-endpoint');
    await pageClick(panelWin, `menu-${id}`);
    await pageClick(panelWin, retryButton);
    retried = await wait(
      async () => {
        const request = await panelWin.webContents.executeJavaScript(
          'window.reconnectProofRequest',
        );
        return request ? rpc('operation', request) : null;
      },
      (r) => r?.state === 'completed',
      'Panel Retry did not complete',
    );
    assert.equal(retried.action, 'reconnect-instance');
    assert.equal(retried.runtime_generation, before.lifecycle.runtime_generation);
  }
  const recovered = await wait(
    row,
    (r) => r.capture === 'connected',
    'Existing agent did not reconnect',
    30000,
  );
  assert.equal(recovered.id, before.id);
  assert.equal(recovered.native_thread_id, before.native_thread_id);
  assert.deepEqual(recovered.lifecycle, before.lifecycle);
  assert.equal((await rpc('attach-info', id)).pid, created.runtime_pid);
  const readyMs = performance.now() - started;
  await completedTurn(events, sent, 'RECONNECTED_WORK_FINISHED');
  let viewerRecovery;
  if (viewerMode) {
    assert.equal(recovered.window, viewerMode === 'closed' ? 'closed' : 'open');
    if (viewerMode !== 'closed') {
      assert.deepEqual(await processIdentity(viewer.pid), viewerIdentity);
      const observed = (await inventory()).find((w) => w.id === viewer.window_id);
      for (const key of ['x', 'y', 'width', 'height'])
        assert.equal(observed[key], viewerBounds[key]);
      const focused = await rpc('open', id, 'xterm', '--request-id', 'reconnect-focus-existing');
      assert.deepEqual([focused.pid, focused.window_id], [viewer.pid, viewer.window_id]);
    }
    await refresh();
    await setExpanded(true, { x: 180, y: 100 });
    const activate = async () => {
      await refresh();
      await wait(
        () =>
          panelWin.webContents.executeJavaScript(
            `!document.querySelector('.instance-actions:popover-open') && document.body.dataset.arranging !== 'true' && !document.querySelector('[data-key="${id}"]')?.disabled`,
          ),
        Boolean,
        'Previous panel action did not finish',
      );
      const button = await panelWin.webContents.executeJavaScript(
        `document.querySelector('[data-key="${id}"]').id = 'reconnect-open'`,
      );
      await pageClick(panelWin, button);
      const attached = await wait(
        async () => {
          await refresh();
          return getState().records.find((r) => r.nativeId === before.native_thread_id);
        },
        Boolean,
        'Native viewer did not attach to recovered Vessel',
      );
      const mapped = (await inventory()).find((w) => w.pid === attached.pid);
      await wait(
        async () =>
          Number(execFileSync('xdotool', ['getactivewindow'], { timeout: 1000 }).toString()),
        (window) => window === mapped?.id,
        'Open did not focus its terminal',
      );
      return attached;
    };
    const attached = await activate();
    if (viewerMode !== 'closed') assert.equal(attached.pid, viewer.pid);
    else assert.notEqual(attached.pid, viewer.pid);
    const target = (await inventory()).find((w) => w.pid === attached.pid);
    assert(target, 'Recovered terminal window was not found');
    const marker = avatarWin.getBounds();
    const destination = screen.screenToDipPoint({
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    });
    await input(['move', marker.x + marker.width / 2, marker.y + marker.height / 2, 1]);
    await input(['button', true]);
    await delay(400);
    await input(['move', destination.x, destination.y, 1]);
    await delay(250);
    await input(['button', false]);
    const docked = await wait(
      async () => {
        await refresh();
        return getState().binding;
      },
      (binding) => binding?.session.id === id,
      'Recovered terminal did not dock',
    );
    await setExpanded(true);
    const voice = await wait(
      () => rpc('status'),
      (status) => status.voice?.target === id && status.voice.state === 'on',
      'Recovered terminal did not acquire native voice',
      20000,
    );
    await rpc('voice', 'none');
    await pageClick(panelWin, `menu-${id}`);
    await panelWin.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('#actions-${id} button')).find(b => b.textContent === 'Run in background').id = 'reconnect-background'`,
    );
    await pageClick(panelWin, 'reconnect-background');
    await wait(
      async () => (await row()).window,
      (state) => state === 'closed',
    );
    await setExpanded(true, { x: 180, y: 100 });
    const reopened = await activate();
    assert.notEqual(reopened.pid, attached.pid);
    viewerRecovery = {
      mode: viewerMode,
      original: viewerIdentity,
      attached,
      dockedWindow: docked.window.id,
      voice: voice.voice,
      reopened,
    };
  }
  const answer = await rpc(
    'send',
    id,
    'reconnect-bound-tool',
    'Run "$VOYAGER_BIN" --state "$VOYAGER_STATE" capabilities with stdout redirected to capabilities.json in this folder. Do not read the output or context file. Reply CAPABILITIES_DONE after exit code 0.',
  );
  const finalEvents = await completedTurn(events, answer, 'CAPABILITIES_DONE');
  await fs.stat(path.join(cwd, 'capabilities.json'));
  assert.equal(
    new Set(finalEvents.filter((e) => e.type === 'turn.started').map((e) => e.native_turn_id)).size,
    2,
  );
  let stopRequest;
  if (viewerMode) {
    const previousSeq = (await events()).at(-1)?.sequence || 0;
    await setExpanded(true, { x: 180, y: 100 });
    await refresh();
    await pageClick(panelWin, `menu-${id}`);
    await panelWin.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('#actions-${id} button')).find(b => b.textContent === 'Stop').id = 'reconnect-stop'`,
    );
    await pageClick(panelWin, 'reconnect-stop');
    const closed = await wait(events, (items) =>
      items.some(
        (e) =>
          e.sequence > previousSeq && e.type === 'interface.closed' && e.payload.runtime_stopped,
      ),
    );
    stopRequest = closed.find(
      (e) => e.sequence > previousSeq && e.type === 'interface.closed' && e.payload.runtime_stopped,
    ).payload.request_id;
  }
  const stopped = viewerMode
    ? await wait(
        () => rpc('operation', stopRequest),
        (r) => r.state !== 'pending',
        'Panel Stop did not finish',
      )
    : await rpc('stop-instance', id, '--request-id', 'reconnect-explicit-stop');
  assert.equal(stopped.runtime, 'stopped');
  assert.equal(stopped.state, 'completed');
  if (viewerMode) assert.equal(stopped.window, 'closed');
  if (control) assert.deepEqual(await processIdentity(control.pid), control);
  await assert.rejects(fs.readlink(`/proc/${created.runtime_pid}/exe`), { code: 'ENOENT' });
  return {
    id,
    nativeThread: before.native_thread_id,
    runtimePid: created.runtime_pid,
    runtimeGeneration: before.lifecycle.runtime_generation,
    restart,
    readyMs,
    retried,
    stopped,
    viewerRecovery,
    unrelatedControl: control,
  };
};
