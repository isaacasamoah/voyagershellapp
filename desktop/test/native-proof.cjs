const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
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
  const save = (value) =>
    fs.writeFile(path.join(directory, 'native-proof.json'), JSON.stringify(value, null, 2));
  try {
    await save({ journey, verdict: 'running' });
    const result = await require(journeys[journey]).run(
      { ...context, directory },
      { wait, input, click, delay, captureOutput },
    );
    await save({ journey, verdict: 'pass', candidate: context.getState?.().candidate, result });
    return result;
  } catch (error) {
    await save({ journey, verdict: 'rework', error: error.stack });
    throw error;
  } finally {
    const exited = new Promise((resolve) => pointer.once('exit', resolve));
    pointer.stdin.end();
    replies.close();
    if (pointer.exitCode === null && pointer.signalCode === null)
      await Promise.race([
        exited,
        delay(4000).then(() => {
          if (pointer.exitCode === null && pointer.signalCode === null) pointer.kill('SIGTERM');
        }),
      ]);
  }
}
module.exports = { run };
