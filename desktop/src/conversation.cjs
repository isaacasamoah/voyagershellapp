const net = require('node:net');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function exchange(stateDir, request, hold = false) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path.join(stateDir, 'service.sock'));
    let buffer = '';
    let done = false;
    const timer = setTimeout(
      () => socket.destroy(Error('Voyager conversation did not respond.')),
      4000,
    );
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('error', reject);
    socket.once('close', () => {
      clearTimeout(timer);
      if (!done) reject(Error('Conversation connection closed before acknowledgement.'));
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024)
        return socket.destroy(Error('Conversation response too large.'));
      if (!buffer.includes('\n')) return;
      try {
        const value = JSON.parse(buffer);
        if (value.error) throw Object.assign(Error(value.error), { code: value.code });
        done = true;
        clearTimeout(timer);
        if (hold) resolve({ result: value.result, close: () => socket.destroy() });
        else {
          resolve(value.result);
          socket.end();
        }
      } catch (error) {
        socket.destroy(error);
      }
    });
  });
}

function conversationClient(stateDir, publish) {
  let cursor = 0;
  let serviceIdentity;
  let polling = false;
  let lease;
  let clientId;
  let status = { phase: 'starting', voice: 'off' };
  const events = [];
  const request = (input) => exchange(stateDir, input);
  function update(page) {
    status = page.status;
    cursor = page.cursor;
    for (const event of page.events) events.push(event);
    if (events.length > 256) events.splice(0, events.length - 256);
    publish({ status, events });
  }
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const page = await request({ op: 'conversation', after: cursor, client_id: clientId });
      if (serviceIdentity && page.status.thread_id && serviceIdentity !== page.status.thread_id) {
        events.length = 0;
        cursor = 0;
        await request({ op: 'conversation', after: 0 }).then(update);
      } else update(page);
      serviceIdentity = status.thread_id;
    } catch (error) {
      lease?.close();
      lease = null;
      status = { phase: 'failed', voice: 'off', error: error.message };
      publish({ status, events });
    } finally {
      polling = false;
    }
  }
  async function action(input) {
    let receipt = await request(input);
    const deadline = Date.now() + 20000;
    while (receipt.state === 'pending') {
      if (Date.now() > deadline) throw Error('Request outcome is uncertain. It was not retried.');
      await new Promise((resolve) => setTimeout(resolve, 50));
      receipt = await request({ op: 'conversation-operation', request_id: input.request_id });
    }
    if (receipt.error)
      throw Error(
        typeof receipt.error === 'string'
          ? receipt.error
          : 'Voyager could not complete the request.',
      );
    await poll();
    return receipt;
  }
  return {
    poll,
    snapshot: () => ({ status, events }),
    send(text, requestId) {
      if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 8192)
        throw Error('Enter a message under 8192 bytes.');
      if (typeof requestId !== 'string' || !requestId || requestId.length > 128)
        throw Error('Invalid message identity.');
      return action({ op: 'conversation-send', text, request_id: requestId });
    },
    async startVoice(sdp) {
      if (lease) throw Error('Voice is already attached.');
      if (typeof sdp !== 'string' || Buffer.byteLength(sdp) > 48 * 1024)
        throw Error('Invalid voice offer.');
      clientId = randomUUID();
      lease = await exchange(stateDir, { op: 'conversation-attach', client_id: clientId }, true);
      try {
        await action({
          op: 'conversation-voice-start',
          request_id: randomUUID(),
          client_id: clientId,
          sdp,
        });
        return { client_id: clientId };
      } catch (error) {
        lease.close();
        lease = null;
        throw error;
      }
    },
    async stopVoice() {
      if (!lease) return;
      const previous = lease;
      try {
        await action({
          op: 'conversation-voice-stop',
          request_id: randomUUID(),
          client_id: clientId,
        });
      } finally {
        previous.close();
        lease = null;
      }
    },
    close() {
      lease?.close();
      lease = null;
    },
  };
}
module.exports = { conversationClient };
