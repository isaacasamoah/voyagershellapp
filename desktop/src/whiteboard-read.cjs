const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.serveWhiteboard = async (stateDir, image) => {
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const address = path.join(stateDir, 'whiteboard.sock');
  try {
    const existing = await fs.lstat(address);
    if (!existing.isSocket()) throw Error('Whiteboard socket path is not a socket');
    await fs.unlink(address);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let busy = false;
  const server = net.createServer(async (socket) => {
    socket.on('error', () => {});
    socket.setTimeout(10000, () => socket.destroy());
    if (busy) return socket.end('Whiteboard snapshot is busy; try again.');
    busy = true;
    try {
      const data = await image();
      if (!data.startsWith('data:image/png;base64,')) throw Error('Invalid whiteboard image');
      const bytes = Buffer.from(data.slice('data:image/png;base64,'.length), 'base64');
      if (bytes.length > 16 * 1024 * 1024) throw Error('Whiteboard image exceeds 16 MiB');
      socket.end(bytes);
    } catch (error) {
      socket.end(`Whiteboard snapshot failed: ${error.message}`);
    } finally {
      busy = false;
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(address, resolve);
  });
  await fs.chmod(address, 0o600);
  return () => server.close();
};
