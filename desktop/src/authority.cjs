const { ranks } = require('./ui/authority.js');
function actionRequest(request) {
  if (typeof request !== 'string' || !request || Buffer.byteLength(request) > 128)
    throw Error('Invalid action request');
}
function authorityActions(rpc, getSessions) {
  function target(id, request) {
    actionRequest(request);
    if (!getSessions().some((s) => s.id === id && s.removed_ms == null))
      throw Error('This instance is no longer registered.');
  }
  return {
    rank(id, rank, request) {
      target(id, request);
      if (!ranks.includes(rank)) throw Error('Choose a rank.');
      return rpc('rank', id, rank, '--request-id', request);
    },
    supervise(id, supervisor, request) {
      target(id, request);
      if (supervisor !== null && (typeof supervisor !== 'string' || !supervisor))
        throw Error('Choose a supervisor.');
      return rpc('supervise', id, supervisor ?? 'none', '--request-id', request);
    },
  };
}
module.exports = { authorityActions };
