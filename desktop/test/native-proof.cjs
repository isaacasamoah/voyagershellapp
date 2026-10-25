const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');
const { captureOutput } = require('./output-audio.cjs');

async function wait(read, accept = Boolean, message = 'Native proof timed out', timeout = 10000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(50);
  }
  throw Error(message);
}

async function run(context) {
  const journey = context.journey || process.env.VOYAGER_PROOF_JOURNEY;
  const journeys = {
    conversation: '../src/conversation-proof.cjs',
    handoff: './voice-handoff-proof.cjs',
    resume: './resume-proof.cjs',
    'panel-resume': './resume-proof.cjs',
    'panel-current': './panel-proof.cjs',
    'return-position': './recovery-position-proof.cjs',
  };
  if (!Object.hasOwn(journeys, journey)) throw Error('Select a supported native proof journey');
  const directory = context.directory || context.stateDir;
  await fs.mkdir(directory, { recursive: true });
  const pointer = spawn('python3', [path.join(__dirname, 'native-pointer.py')], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const replies = createInterface({ input: pointer.stdout });
  let inputError;
  pointer.on('error', (error) => {
    inputError = error;
  });
  pointer.stdin.on('error', (error) => {
    inputError = error;
  });
  const closed = new Promise((resolve) => pointer.once('close', resolve));
  const waitForExit = () =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      closed.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  const input = (value) =>
    new Promise((resolve, reject) => {
      if (inputError) return reject(inputError);
      const finish = (error) => {
        clearTimeout(timer);
        replies.removeListener('line', onLine);
        error ? reject(error) : resolve();
      };
      const onLine = (line) => {
        try {
          const reply = JSON.parse(line);
          finish(reply.error ? Error(reply.error) : null);
        } catch (error) {
          finish(error);
        }
      };
      const timer = setTimeout(() => finish(Error('Native input acknowledgement timed out')), 4000);
      replies.once('line', onLine);
      pointer.stdin.write(JSON.stringify(value) + '\n', (error) => {
        if (error) finish(error);
      });
    });
  const click = async (window, id) => {
    const rect = await window.webContents.executeJavaScript(
      `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
    );
    const bounds = window.getBounds();
    await input(['move', bounds.x + rect.x, bounds.y + rect.y, 1]);
    await input(['button', true]);
    await input(['button', false]);
  };
  const pageClick = async (window, id) => {
    window.focus();
    if (!window.isFocused()) {
      await new Promise((resolve, reject) =>
        execFile(
          'xdotool',
          ['windowactivate', '--sync', String(window.getNativeWindowHandle().readUInt32LE())],
          { timeout: 3000 },
          (error) => (error ? reject(error) : resolve()),
        ),
      );
    }
    await wait(() => window.isFocused(), Boolean, 'Proof window could not receive input');
    const point = await window.webContents.executeJavaScript(
      `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) throw Error('Control is outside the visible page'); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`,
    );
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
      window.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
      await delay(30);
    }
  };
  const pageKey = async (window, keyCode) => {
    if (!window.isFocused()) throw Error('Proof window lost keyboard focus');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode === 'Return') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await delay(80);
  };
  const pageWheel = async (window, id, deltaY) => {
    const point = await window.webContents.executeJavaScript(
      `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`,
    );
    window.focus();
    window.webContents.sendInputEvent({ type: 'mouseWheel', ...point, deltaY, canScroll: true });
    await delay(100);
  };
  const save = (value) =>
    fs.writeFile(path.join(directory, 'native-proof.json'), JSON.stringify(value, null, 2));
  let result;
  let failure;
  let cleanup;
  try {
    await save({ journey, verdict: 'running' });
    result = await require(journeys[journey]).run(
      { ...context, directory },
      { wait, input, click, pageClick, pageKey, pageWheel, delay, captureOutput },
    );
  } catch (error) {
    failure = error;
  }
  try {
    pointer.stdin.end();
    replies.close();
    if (!(await waitForExit())) {
      pointer.kill('SIGTERM');
      if (!(await waitForExit())) throw Error('Pointer helper exit could not be confirmed');
    }
    cleanup = { confirmed: true, code: pointer.exitCode, signal: pointer.signalCode };
    if (inputError) throw inputError;
    if (pointer.exitCode !== 0 && pointer.signalCode !== 'SIGTERM')
      throw Error('Pointer helper exited unsuccessfully');
  } catch (error) {
    cleanup = { ...cleanup, error: error.stack };
    failure = failure ? new Error(`${failure.stack}\nPointer cleanup: ${error.stack}`) : error;
  }
  await save({
    journey,
    verdict: failure ? 'rework' : 'pass',
    candidate: context.getState?.().candidate,
    result,
    cleanup,
    error: failure?.stack,
  });
  if (failure) throw failure;
  return result;
}
module.exports = { run };
