const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { ranks } = require('./ui/authority.js');
function instanceCreator(rpc) {
  let pending = null,
    busy = false;
  return async (input) => {
    if (busy) throw Error('An instance is already being opened.');
    if (!input || !['codex', 'shell'].includes(input.kind)) throw Error('Choose an instance type.');
    const { kind, name, cwd } = input;
    const rank = kind === 'codex' ? (input.rank ?? 'crew') : null;
    const supervisor = input.supervisor ?? null;
    if (kind === 'codex' && !ranks.includes(rank)) throw Error('Choose a rank.');
    if (supervisor !== null && (typeof supervisor !== 'string' || !supervisor))
      throw Error('Choose a supervisor.');
    if (typeof name !== 'string' || !name.trim() || Buffer.byteLength(name) > 100)
      throw Error('Enter a short name.');
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd))
      throw Error('Choose an absolute folder path.');
    const key = JSON.stringify([kind, name, cwd, rank, supervisor]);
    if (!pending || pending.key !== key) pending = { key, id: randomUUID(), session: null };
    busy = true;
    try {
      if (input.fleet != null) {
        const data = await rpc('fleets');
        if (!data.fleets.some((fleet) => fleet.id === input.fleet))
          throw Error('Choose an existing fleet.');
      }
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
          const flags = rank ? ['--rank', rank] : [];
          if (supervisor) flags.push('--supervisor', supervisor);
          const receipt = await rpc('create', kind, pending.id, name, cwd, ...flags);
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
      if (Object.hasOwn(input, 'fleet')) {
        try {
          await rpc('move-vessel', session, input.fleet ?? 'none');
        } catch {
          throw Error(
            'Vessel created, but its fleet could not be updated. Try again to move the same vessel.',
          );
        }
      }
      pending = null;
      return { session };
    } finally {
      busy = false;
    }
  };
}
module.exports = { instanceCreator };
