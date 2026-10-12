// Retry a failed native open against the same registration, never a duplicate.
const { randomUUID } = require('node:crypto');
function instanceCreator(rpc) {
  let pending = null,
    busy = false;
  return async (input) => {
    if (busy) throw Error('An instance is already being opened.');
    if (!input || !['codex', 'shell'].includes(input.kind)) throw Error('Choose an instance type.');
    const { kind, name, cwd } = input;
    if (typeof name !== 'string' || !name.trim() || Buffer.byteLength(name) > 100)
      throw Error('Enter a short name.');
    if (typeof cwd !== 'string' || !require('node:path').isAbsolute(cwd))
      throw Error('Choose an absolute folder path.');
    const key = JSON.stringify([kind, name, cwd]);
    if (!pending || pending.key !== key) pending = { key, id: randomUUID(), session: null };
    busy = true;
    try {
      const receipt = await rpc('create', kind, pending.id, name, cwd);
      if (receipt.state !== 'running' || !receipt.session_id) {
        pending = null;
        throw Error('This instance did not start. Check the service log, then try again.');
      }
      pending.session = receipt.session_id;
      await rpc('open', pending.session, 'ghostty');
      const session = pending.session;
      pending = null;
      return { session };
    } catch (error) {
      if (pending?.session)
        throw Error(
          'Created, but the terminal could not open. Try again to reopen the same instance.',
        );
      throw error;
    } finally {
      busy = false;
    }
  };
}
module.exports = { instanceCreator };
