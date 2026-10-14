const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { connectControl } = require('../src/control.cjs');

test('control socket survives acknowledgement and reports owner loss', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voyager-control-'));
  const server = net.createServer();
  t.after(async () => {
    server.close();
    await fs.rm(dir, { recursive: true });
  });
  server.listen(path.join(dir, 'service.sock'));
  await once(server, 'listening');
  const peers = once(server, 'connection');
  let closed = false;
  const pending = connectControl(dir, { generation: 'one', session_id: 'session' }, () => {
    closed = true;
  });
  const [peer] = await peers;
  const [data] = await once(peer, 'data');
  assert.equal(JSON.parse(data).op, 'dock');
  peer.write('{"result":{"active":true,"attachment":{"generation":"one"}}}\n');
  const connection = await pending;
  assert.equal(closed, false);
  assert.equal(peer.destroyed, false);
  const end = once(peer, 'close');
  connection.close();
  await end;
  // Reverse direction: a service handoff ends the old UI's claim.
  const nextPeer = once(server, 'connection');
  let resolveClosed;
  const lost = new Promise((resolve) => (resolveClosed = resolve));
  const next = connectControl(dir, { generation: 'two' }, resolveClosed);
  const [other] = await nextPeer;
  await once(other, 'data');
  other.write('{"result":{"active":true,"attachment":{"generation":"two"}}}\n');
  await next;
  other.destroy();
  await lost;
});

test('inactive acknowledgement cannot be mistaken for current control', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voyager-control-'));
  const server = net.createServer((peer) => {
    peer.once('data', () =>
      peer.end('{"result":{"active":false,"attachment":{"generation":"old"}}}\n'),
    );
  });
  t.after(async () => {
    server.close();
    await fs.rm(dir, { recursive: true });
  });
  server.listen(path.join(dir, 'service.sock'));
  await once(server, 'listening');
  await assert.rejects(
    connectControl(dir, { generation: 'old' }, () => {}),
    /not accepted/,
  );
});
