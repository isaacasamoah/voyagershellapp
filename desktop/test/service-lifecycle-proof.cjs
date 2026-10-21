const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const binary = path.join(root, 'target/debug/voyager');
const electron = require('electron');
const state = process.env.VOYAGER_PANEL_LIFECYCLE_DIR;
assert(state && path.isAbsolute(state), 'Provide a fresh absolute VOYAGER_PANEL_LIFECYCLE_DIR');
const observations = [];
let app;
let socket;
let vessel;
const rpc = async (...args) =>
  JSON.parse((await exec(binary, ['--state', state, ...args], { timeout: 25000 })).stdout);
async function wait(read, accept, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(100);
  }
  throw Error(message);
}
async function open() {
  let output = '';
  app = spawn(electron, [path.join(root, 'desktop'), '--expanded', '--remote-debugging-port=0'], {
    env: { ...process.env, VOYAGER_STATE: state },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  app.stderr.on('data', (chunk) => (output += chunk));
  const address = await wait(
    async () => output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],
    Boolean,
    'Electron debugger did not start',
  );
  const endpoint = new URL(address);
  const targets = await wait(
    async () => (await fetch(`http://${endpoint.host}/json/list`)).json(),
    (rows) => rows.some((target) => target.url.includes('view=panel')),
    'Panel did not load',
  );
  socket = new WebSocket(
    targets.find((target) => target.url.includes('view=panel')).webSocketDebuggerUrl,
  );
  await once(socket, 'open');
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const value = JSON.parse(event.data);
    if (value.id) {
      pending.get(value.id)?.(value);
      pending.delete(value.id);
    }
  });
  const evaluate = async (expression) => {
    const id = ++sequence;
    const response = new Promise((resolve) => pending.set(id, resolve));
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
    const value = await Promise.race([
      response,
      delay(20000, undefined, { ref: false }).then(() => {
        throw Error('Panel evaluation timed out');
      }),
    ]);
    if (value.error || value.result?.exceptionDetails)
      throw Error(JSON.stringify(value.error || value.result.exceptionDetails));
    return value.result.result.value;
  };
  await wait(
    () => evaluate('document.body.dataset.connected'),
    (v) => v === 'true',
    'Panel did not connect',
  );
  return evaluate;
}
const serviceButton =
  "Array.from(document.querySelectorAll('#app-menu button')).find(b=>b.textContent==='Stop service')";
(async () => {
  await fs.mkdir(state, { mode: 0o700 });
  let ui = await open();
  const initial = await wait(
    () => rpc('status'),
    (s) => s.conversation.phase === 'ready',
    'Private Codex was not ready',
  );
  assert.equal(initial.conversation.voice, 'off');
  observations.push({
    action: 'app-starts-service-and-private-codex',
    instance: initial.instance,
    private_pid: initial.conversation.pid,
  });
  await ui(
    `document.getElementById('add').click();document.getElementById('instance-kind').value='shell';document.getElementById('instance-name').value='Lifecycle check';document.getElementById('instance-cwd').value=${JSON.stringify(state)};document.getElementById('create-form').requestSubmit();`,
  );
  vessel = (
    await wait(
      () => rpc('list'),
      (rows) => rows.some((s) => s.name === 'Lifecycle check'),
      'Bash creation missing',
    )
  ).find((s) => s.name === 'Lifecycle check');
  await wait(
    () => ui("document.getElementById('create-form').hidden"),
    Boolean,
    'Creation did not finish',
  );
  await ui(`(${serviceButton}).onclick()`);
  assert.match(
    await ui("document.getElementById('instance-error').textContent"),
    /stop managed instances explicitly/,
  );
  assert.equal((await rpc('status')).instance, initial.instance);
  observations.push({ action: 'service-stop-refuses-live-vessel', session: vessel.id });
  await ui("document.getElementById('quit').click()");
  await wait(
    async () => app.exitCode,
    (code) => code === 0,
    'Closing interface did not exit Electron',
  );
  socket.close();
  assert.equal((await rpc('status')).instance, initial.instance);
  await rpc('shell-exec', vessel.id, 'after-ui-close', 'printf still-working');
  await wait(
    () => rpc('events', '0'),
    (page) =>
      page.events.some(
        (e) => e.type === 'shell.completed' && e.payload.command_id === 'after-ui-close',
      ),
    'Closed UI interrupted shell capture',
  );
  observations.push({ action: 'close-ui-preserves-service-work-and-capture' });
  ui = await open();
  const reopened = await rpc('status');
  assert.equal(reopened.instance, initial.instance);
  assert.equal(reopened.conversation.pid, initial.conversation.pid);
  observations.push({ action: 'reopen-reuses-service-and-private-codex' });
  await wait(
    () =>
      ui(
        "Array.from(document.querySelectorAll('.instance-row')).some(r=>r.textContent.includes('Lifecycle check'))",
      ),
    Boolean,
    'Vessel missing after reopening',
  );
  await ui(
    `(async()=>{const row=Array.from(document.querySelectorAll('.instance-row')).find(r=>r.textContent.includes('Lifecycle check'));await Array.from(row.querySelectorAll('button')).find(b=>b.textContent==='Stop and remove').onclick()})()`,
  );
  await wait(
    () => rpc('list'),
    (rows) => rows.length === 0,
    'Stop and remove left active registration',
  );
  const removed = (await rpc('list', '--include-removed')).find((s) => s.id === vessel.id);
  assert.equal(removed.worker_state, 'stopped');
  assert(removed.removed_ms);
  const history = await rpc('events', '0');
  assert(history.events.some((e) => e.session_id === vessel.id && e.type === 'session.removed'));
  assert(history.events.some((e) => e.session_id === vessel.id && e.type === 'shell.completed'));
  observations.push({ action: 'stop-and-remove-closes-runtime-and-keeps-history' });
  await ui(`(${serviceButton}).click()`);
  await wait(
    async () => app.exitCode,
    (code) => code === 0,
    'Explicit service stop did not close Electron',
  );
  await assert.rejects(rpc('status'), /Voyager service unavailable/);
  await wait(
    async () => {
      try {
        process.kill(initial.conversation.pid, 0);
        return false;
      } catch (error) {
        if (error.code === 'ESRCH') return true;
        throw error;
      }
    },
    Boolean,
    'Private provider was not reaped',
  );
  observations.push({ action: 'explicit-stop-exits-service-and-reaps-private-provider' });
  await fs.writeFile(
    path.join(state, 'service-lifecycle-proof.json'),
    JSON.stringify(
      {
        verdict: 'pass',
        observations,
        limits: [
          'Real Electron, Rust, Bash and Ghostty; programmatic renderer actions, not physical pointer proof.',
          'Private installed Codex starts but no model turn or microphone is requested.',
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ verdict: 'pass', state, observations }));
})()
  .catch(async (error) => {
    await fs
      .writeFile(
        path.join(state, 'service-lifecycle-proof.json'),
        JSON.stringify({ verdict: 'rework', observations, error: error.message }, null, 2),
      )
      .catch(() => {});
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    socket?.close();
    if (app && app.exitCode === null) app.kill('SIGTERM');
    if (vessel) await rpc('remove', vessel.id, '--stop').catch(() => {});
    await rpc('stop').catch(() => {});
  });
