const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { conversationClient } = require('../src/conversation.cjs');

test('conversation preserves service refusals and releases only its held voice connection', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-client-'));
  let held;
  let heldClosed;
  const closed = new Promise((resolve) => {
    heldClosed = resolve;
  });
  let sequence = 0;
  const requests = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      const request = JSON.parse(buffer);
      requests.push(request);
      let reply;
      if (request.op === 'conversation-send')
        reply = { error: 'busy: native turn active', code: 'busy' };
      else if (request.op === 'conversation-attach') {
        held = socket;
        socket.on('close', heldClosed);
        reply = { result: { active: true, client_id: request.client_id } };
      } else if (request.op === 'conversation')
        reply = {
          result: {
            status: { phase: 'ready', voice: 'off', thread_id: 'one' },
            cursor: sequence,
            events: [],
          },
        };
      else reply = { result: { request_id: request.request_id, state: 'completed' } };
      const wire = JSON.stringify(reply) + '\n';
      socket.write(wire.slice(0, 5));
      socket.write(wire.slice(5));
    });
  });
  await new Promise((resolve) => server.listen(path.join(dir, 'service.sock'), resolve));
  const client = conversationClient(dir, () => {});
  try {
    await assert.rejects(client.send('hello', 'same-id'), (error) => error.code === 'busy');
    await client.startVoice('offer');
    assert.ok(held && !held.destroyed);
    client.close();
    await closed;
    assert.deepEqual(
      requests.filter((r) => r.op === 'conversation-send').map((r) => r.request_id),
      ['same-id'],
    );
    assert.equal(requests.filter((r) => r.op === 'conversation-attach').length, 1);
  } finally {
    client.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
