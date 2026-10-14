const { randomUUID } = require('node:crypto');
const path = require('node:path');
function instanceCreator(rpc) {
  let pending = null,
    busy = false;
  return async (input) => {
    if (busy) throw Error('An instance is already being opened.');
    if (!input || !['codex', 'shell'].includes(input.kind)) throw Error('Choose an instance type.');
    const { kind, name, cwd } = input;
    if (typeof name !== 'string' || !name.trim() || Buffer.byteLength(name) > 100)
      throw Error('Enter a short name.');
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd))
      throw Error('Choose an absolute folder path.');
    const key = JSON.stringify([kind, name, cwd]);
    if (!pending || pending.key !== key) pending = { key, id: randomUUID(), session: null };
    busy = true;
    try {
      if (pending.session) {
        await rpc(
          'open',
          pending.session,
          'ghostty',
          '--request-id',
          (pending.openId ||= randomUUID()),
        );
      } else {
        try {
          const receipt = await rpc('create', kind, pending.id, name, cwd);
          if (receipt.state !== 'completed' || !receipt.session_id)
            throw Error('This instance did not start. Check the service log.');
          pending.session = receipt.session_id;
        } catch (error) {
          const receipt = await rpc('operation', pending.id).catch(() => null);
          if (receipt?.session_id) {
            pending.session = receipt.session_id;
            throw Error(
              'Created, but the terminal could not open. Try again to reopen the same instance.',
            );
          }
          if (receipt && receipt.state !== 'pending') pending = null;
          throw error;
        }
      }
      const session = pending.session;
      pending = null;
      return { session };
    } finally {
      busy = false;
    }
  };
}
module.exports = { instanceCreator };
