const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');
const fs = require('node:fs/promises');

let window;
let runtime;
let ready;
let sequence = 0;
const pending = new Map();
const observations = [];
const proof = process.argv.includes('--proof');
const evidence = process.env.VOYAGER_EXPERIMENT_EVIDENCE;

function request(action, fields = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${action} exceeded 30 seconds; not retried`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    runtime.stdin.write(JSON.stringify({ id, action, ...fields }) + '\n');
  });
}

function failPending(message) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error(message));
  }
  pending.clear();
}

app.whenReady().then(async () => {
  app.setPath('userData', process.env.VOYAGER_EXPERIMENT_PROFILE);
  window = new BrowserWindow({
    width: 540,
    height: 650,
    title: 'Voyager — conversation experiment',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const expected = 'file://' + path.join(__dirname, 'index.html');
  const senderAllowed = (event) =>
    event.sender === window.webContents && event.senderFrame.url === expected;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      contents === window.webContents && permission === 'media' && details.isMainFrame,
  );
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(
        contents === window.webContents &&
          permission === 'media' &&
          details.isMainFrame &&
          details.mediaTypes?.every((type) => type === 'audio'),
      ),
  );
  for (const [channel, action, fields] of [
    ['voyager-chat', 'chat', (value) => ({ text: value })],
    ['voyager-voice-start', 'voice-start', (value) => ({ sdp: value })],
    ['voyager-voice-stop', 'voice-stop', () => ({})],
  ]) {
    ipcMain.handle(channel, async (event, value) => {
      if (!senderAllowed(event)) throw new Error('Unexpected sender');
      if (channel !== 'voyager-voice-stop' && (typeof value !== 'string' || value.length > 65536))
        throw new Error('Invalid text');
      return request(action, fields(value));
    });
  }
  ipcMain.handle('voyager-ready', (event) => {
    if (!senderAllowed(event)) throw new Error('Unexpected sender');
    return ready;
  });
  ipcMain.handle('voyager-observe', async (event, value) => {
    if (!senderAllowed(event) || typeof value !== 'object')
      throw new Error('Unexpected observation');
    observations.push(value);
    if (evidence)
      await fs.writeFile(
        path.join(evidence, 'electron-observations.json'),
        JSON.stringify(observations, null, 2),
      );
  });
  runtime = spawn(process.env.VOYAGER_RUNTIME_PROBE, [], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Runtime startup timed out')), 30000);
    createInterface({ input: runtime.stdout }).on('line', (line) => {
      const value = JSON.parse(line);
      if (value.event === 'ready') {
        clearTimeout(timer);
        resolve(value.params);
      }
      if (value.id) {
        const entry = pending.get(value.id);
        if (entry) {
          pending.delete(value.id);
          clearTimeout(entry.timer);
          if (value.error) entry.reject(new Error(value.error));
          else entry.resolve(value.result);
        }
      } else if (value.event && !window.isDestroyed()) {
        window.webContents.send('voyager-event', value);
      }
    });
    runtime.once('error', reject);
    runtime.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Runtime exited: ${code}`));
      failPending('Runtime exited; request outcome may be uncertain');
      if (!window.isDestroyed())
        window.webContents.send('voyager-event', { event: 'runtime-closed', params: { code } });
    });
  });
  ready.catch(() => {});
  runtime.stderr.on('data', (data) => process.stderr.write(data));
  await window.loadFile(path.join(__dirname, 'index.html'));
  if (proof) {
    try {
      await ready;
      const fixture = process.env.VOYAGER_EXPERIMENT_AUDIO
        ? (await fs.readFile(process.env.VOYAGER_EXPERIMENT_AUDIO)).toString('base64')
        : null;
      const result = await window.webContents.executeJavaScript(
        `window.runExperimentProof(${JSON.stringify(fixture)})`,
      );
      observations.push({ proof_result: result });
      await fs.writeFile(
        path.join(evidence, 'electron-proof.json'),
        JSON.stringify(
          {
            result,
            observations,
            security: window.webContents.getLastWebPreferences(),
            rust_pid: runtime.pid,
          },
          null,
          2,
        ),
      );
      await fs.writeFile(
        path.join(evidence, 'electron.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      console.log(JSON.stringify({ evidence, result }));
    } catch (error) {
      console.error(error);
    }
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  failPending('Experiment closed');
  runtime?.stdin.end();
});
