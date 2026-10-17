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
    adjudicate(id, escalation, decision, message, request) {
      target(id, request);
      actionRequest(escalation);
      if (!['accept', 'revise', 'resolve'].includes(decision)) throw Error('Choose a response.');
      if (typeof message !== 'string' || !message.trim()) throw Error('Enter a response.');
      return rpc('adjudicate', id, request, decision, message, '--reply-to', escalation);
    },
  };
}
module.exports = { authorityActions };
