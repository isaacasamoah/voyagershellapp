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

function rendererConversation() {
  const vm = require('node:vm');
  const source = require('node:fs');
  const { randomUUID } = require('node:crypto');
  class Node {
    constructor() {
      this.dataset = {};
      this.attributes = {};
      this.children = [];
      this.textContent = '';
      this.hidden = false;
      this.value = '';
      this.scrollHeight = 0;
      this.scrollTop = 0;
      this.clientHeight = 0;
    }
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
    }
  }
  const nodes = new Map(
    [
      ...source
        .readFileSync(require.resolve('../src/ui/index.html'), 'utf8')
        .matchAll(/id="([^"]+)"/g),
    ].map((m) => [m[1], new Node()]),
  );
  nodes.get('conversation').dataset.open = 'false';
  const calls = [];
  let update;
  const api = {
    onConversation: (fn) => (update = fn),
    conversationReady: async () => ({ status: { phase: 'ready', voice: 'off' }, events: [] }),
    chat: async (text, id) => {
      calls.push({ text, id });
      return { state: 'accepted' };
    },
  };
  const context = {
    window: { voyager: api },
    document: { getElementById: (id) => nodes.get(id), createElement: () => new Node() },
    location: { search: '?view=panel' },
    URLSearchParams,
    crypto: { randomUUID },
    setTimeout,
  };
  vm.runInNewContext(
    source.readFileSync(require.resolve('../src/ui/conversation.js'), 'utf8'),
    context,
  );
  return {
    nodes,
    calls,
    api,
    update: (value) => update({ status: { phase: 'ready', voice: 'off' }, events: [], ...value }),
  };
}
test('quiet composer expands for new messages, remains collapsed on repeat polls and retires answered questions', async () => {
  const ui = rendererConversation();
  await Promise.resolve();
  assert.equal(ui.nodes.get('conversation').dataset.open, 'false');
  await ui.update({
    events: [{ seq: 1, type: 'message', data: { role: 'assistant', text: 'A real reply.' } }],
  });
  assert.equal(ui.nodes.get('conversation').dataset.open, 'true');
  ui.nodes.get('chat-expand').onclick();
  await ui.update({
    events: [{ seq: 1, type: 'message', data: { role: 'assistant', text: 'A real reply.' } }],
  });
  assert.equal(ui.nodes.get('conversation').dataset.open, 'false');
  const question = {
    request_id: 'q',
    source_name: 'Captain',
    message: 'Original evidence',
    answered: false,
  };
  await ui.update({ questions: [question], presentations: { q: { text: 'A clear decision.' } } });
  assert.equal(ui.nodes.get('conversation').dataset.open, 'true');
  assert.equal(
    ui.nodes.get('chat-questions').children[0].children[1].textContent,
    'A clear decision.',
  );
  await ui.update({ questions: [{ ...question, answered: true }], presentations: {} });
  assert.equal(ui.nodes.get('chat-questions').children.length, 0);
});
test('uncertain chat input is retained without automatically sending another message', async () => {
  const ui = rendererConversation();
  await Promise.resolve();
  ui.api.chat = async () => ({ error: 'Reply lost.' });
  ui.nodes.get('chat-text').value = 'Keep my exact decision';
  await ui.nodes.get('chat-form').onsubmit({ preventDefault() {} });
  assert.equal(ui.nodes.get('chat-text').value, 'Keep my exact decision');
  assert.equal(ui.nodes.get('chat-send').disabled, true);
  assert.match(ui.nodes.get('chat-status').textContent, /not automatically retried/);
});
