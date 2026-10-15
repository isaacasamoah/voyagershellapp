const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { serveWhiteboard } = require('../src/whiteboard-read.cjs');
const read = (directory) =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection(path.join(directory, 'whiteboard.sock'));
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks)));
    socket.on('error', reject);
  });
test('fresh snapshots and capture errors cross the private socket', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-read-'));
  let fail = false;
  let calls = 0;
  const close = await serveWhiteboard(directory, async () => {
    calls++;
    if (fail) throw Error('Finish the current edit');
    return 'data:image/png;base64,' + Buffer.from('picture ' + calls).toString('base64');
  });
  try {
    assert.equal((await fs.stat(path.join(directory, 'whiteboard.sock'))).mode & 0o777, 0o600);
    assert.equal((await read(directory)).toString(), 'picture 1');
    assert.equal((await read(directory)).toString(), 'picture 2');
    fail = true;
    assert.match((await read(directory)).toString(), /Finish the current edit/);
  } finally {
    close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
