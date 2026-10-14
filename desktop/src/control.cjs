const net = require('node:net');
const path = require('node:path');

// Keep this connection open for exactly as long as the desktop is attached.
// No automatic reconnect: a new connection requires another deliberate dock.
function connectControl(stateDir, request, onClose) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path.join(stateDir, 'service.sock'));
    let buffer = '';
    let acknowledged = false;
    const timer = setTimeout(() => socket.destroy(Error('Control attachment timed out')), 20000);
    socket.once('connect', () => socket.write(`${JSON.stringify({ ...request, op: 'dock' })}\n`));
    socket.on('error', reject);
    socket.once('close', () => {
      clearTimeout(timer);
      if (acknowledged) onClose();
      else reject(Error('Control connection closed before acknowledgement'));
    });
    socket.on('data', (chunk) => {
      if (acknowledged) return socket.destroy(Error('Unexpected control data'));
      buffer += chunk.toString('utf8');
      if (buffer.length > 65536) return socket.destroy(Error('Control response is too large'));
      if (!buffer.includes('\n')) return;
      try {
        const response = JSON.parse(buffer);
        if (response.error) throw Error(response.error);
        const result = response.result;
        if (!result?.active || result.attachment?.generation !== request.generation)
          throw Error('Control attachment was not accepted');
        clearTimeout(timer);
        acknowledged = true;
        resolve({ ...result, close: () => socket.destroy() });
      } catch (error) {
        socket.destroy(error);
      }
    });
  });
}

module.exports = { connectControl };
