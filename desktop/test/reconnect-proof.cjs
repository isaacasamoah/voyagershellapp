const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async ({ rpc, stateDir }, { wait }) => {
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
  await fs.writeFile(
    path.join(stateDir, 'proof-service-control.json'),
    JSON.stringify({ action: 'restart', request }),
  );
  const restart = await wait(
    async () =>
      JSON.parse(
        await fs.readFile(path.join(stateDir, 'proof-service-restarted.json')).catch(() => '{}'),
      ),
    (value) => value.request === request,
  );
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
  const completed = await wait(
    events,
    (items) =>
      items.some((e) => e.type === 'turn.completed' && e.native_turn_id === sent.native_turn_id),
    'Original turn did not finish after reconnect',
    90000,
  );
  const original = completed.find(
    (e) => e.type === 'turn.completed' && e.native_turn_id === sent.native_turn_id,
  );
  assert.equal(original.payload.has_error, false);
  assert(
    completed.some(
      (e) =>
        e.native_turn_id === sent.native_turn_id &&
        e.type === 'message' &&
        e.payload.role === 'assistant' &&
        e.payload.text.includes('RECONNECTED_WORK_FINISHED'),
    ),
  );
  const answer = await rpc(
    'send',
    id,
    'reconnect-bound-tool',
    'Run "$VOYAGER_BIN" --state "$VOYAGER_STATE" capabilities with stdout redirected to capabilities.json in this folder. Do not read the output or context file. Reply CAPABILITIES_DONE after exit code 0.',
  );
  const finalEvents = await wait(
    events,
    (items) =>
      items.some((e) => e.type === 'turn.completed' && e.native_turn_id === answer.native_turn_id),
    'Bound native tool did not finish',
    90000,
  );
  const completion = finalEvents.find(
    (e) => e.type === 'turn.completed' && e.native_turn_id === answer.native_turn_id,
  );
  assert.equal(completion.payload.has_error, false);
  assert(
    finalEvents.some(
      (e) =>
        e.type === 'message' &&
        e.payload.role === 'assistant' &&
        JSON.stringify(e.payload).includes('CAPABILITIES_DONE'),
    ),
  );
  await fs.stat(path.join(cwd, 'capabilities.json'));
  assert.equal(
    new Set(finalEvents.filter((e) => e.type === 'turn.started').map((e) => e.native_turn_id)).size,
    2,
  );
  const stopped = await rpc('stop-instance', id, '--request-id', 'reconnect-explicit-stop');
  assert.equal(stopped.runtime, 'stopped');
  await assert.rejects(fs.readlink(`/proc/${created.runtime_pid}/exe`), { code: 'ENOENT' });
  return {
    id,
    nativeThread: before.native_thread_id,
    runtimePid: created.runtime_pid,
    runtimeGeneration: before.lifecycle.runtime_generation,
    restart,
    readyMs,
    stopped,
  };
};
