const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { connectControl } = require('../src/control.cjs');
const request = (generation) => ({
  generation,
  session_id: 'session',
  window_id: 1,
  terminal: { pid: 10, start: '100' },
  frontend: { pid: 11, start: '110' },
});
const reply = (generation) =>
  JSON.stringify({ result: { active: true, attachment: request(generation) } }) + '\n';

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
  const pending = connectControl(dir, request('one'), () => {
    closed = true;
  });
  const [peer] = await peers;
  const [data] = await once(peer, 'data');
  assert.equal(JSON.parse(data).op, 'dock');
  peer.write(reply('one'));
  const connection = await pending;
  assert.equal(closed, false);
  assert.equal(peer.destroyed, false);
  const end = once(peer, 'close');
  connection.close();
  await end;
  const nextPeer = once(server, 'connection');
  let resolveClosed;
  const lost = new Promise((resolve) => (resolveClosed = resolve));
  const next = connectControl(dir, request('two'), resolveClosed);
  const [other] = await nextPeer;
  await once(other, 'data');
  other.write(reply('two'));
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

test('a matching generation with a different target cannot attach', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voyager-control-'));
  const server = net.createServer((peer) =>
    peer.once('data', () =>
      peer.end(
        JSON.stringify({
          result: { active: true, attachment: { ...request('one'), window_id: 2 } },
        }) + '\n',
      ),
    ),
  );
  t.after(async () => {
    server.close();
    await fs.rm(dir, { recursive: true });
  });
  server.listen(path.join(dir, 'service.sock'));
  await once(server, 'listening');
  await assert.rejects(
    connectControl(dir, request('one'), () => {}),
    /not accepted/,
  );
});
