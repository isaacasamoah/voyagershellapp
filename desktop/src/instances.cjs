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
    const terminal = input.terminal ?? 'ghostty';
    if (!['ghostty', 'xterm'].includes(terminal)) throw Error('Choose a terminal viewer.');
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
    busy = true;
    try {
      if (input.fleet != null) {
        const data = await rpc('fleets');
        if (!data.fleets.some((fleet) => fleet.id === input.fleet))
          throw Error('Choose an existing fleet.');
      }
      if (!pending || pending.key !== key)
        pending = { key, id: randomUUID(), session: null, terminal };
      if (!pending.session && pending.terminal !== terminal)
        throw Error('Creation outcome is unknown. Retry the original terminal choice first.');
      if (pending.session) {
        if (pending.openTerminal !== terminal) {
          pending.openTerminal = terminal;
          pending.openId = randomUUID();
        }
        await rpc(
          'open',
          pending.session,
          terminal,
          '--request-id',
          (pending.openId ||= randomUUID()),
        );
      } else {
        try {
          const flags = rank ? ['--rank', rank] : [];
          if (supervisor) flags.push('--supervisor', supervisor);
          if (input.terminal != null) flags.push('--terminal', terminal);
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
function historyReader(rpc) {
  return async (id, cursor = 0) => {
    if (typeof id !== 'string' || !id || !Number.isSafeInteger(cursor) || cursor < 0)
      throw Error('Choose a saved agent and a valid history position.');
    const page = await rpc('events', String(cursor));
    return { ...page, events: page.events.filter((event) => event.session_id === id) };
  };
}
function matchesReceipt(receipt, action, session, request) {
  return (
    receipt?.request_id === request && receipt.action === action && receipt.session_id === session
  );
}
function instanceOpener(rpc, refresh, surface) {
  return async (id, terminal, request) => {
    let result;
    try {
      try {
        result = await rpc('open', id, terminal, '--request-id', request);
      } catch (error) {
        const receipt = await rpc('operation', request).catch(() => null);
        const matched = matchesReceipt(receipt, 'open', id, request);
        if (!matched || receipt.state !== 'completed')
          return {
            error: error.message,
            retry_with_new_request:
              matched && ['partial', 'failed', 'cancelled'].includes(receipt.state),
          };
        result = receipt;
      }
      if (!matchesReceipt(result, 'open', id, request) || result.state !== 'completed')
        return {
          error:
            'The terminal result could not be matched to this request. Inspect its saved state.',
        };
      await refresh();
      try {
        await surface([id], true);
      } catch (error) {
        return {
          ...result,
          warning: `Terminal opened, but its window could not be arranged. ${error.message}`,
        };
      }
      return result;
    } finally {
      await refresh();
    }
  };
}
function instanceReconnector(rpc) {
  return async (input) => {
    const { id, generation, request } = input || {};
    if (
      typeof id !== 'string' ||
      !id ||
      !Number.isSafeInteger(generation) ||
      generation < 0 ||
      typeof request !== 'string' ||
      !request ||
      Buffer.byteLength(request) > 128
    )
      throw Error('Choose a Vessel and its observed runtime.');
    let result;
    try {
      result = await rpc('reconnect-instance', id, request, String(generation));
    } catch (error) {
      result = await rpc('operation', request).catch(() => null);
      if (!matchesReceipt(result, 'reconnect-instance', id, request))
        return {
          error: `Connection check could not be confirmed. Keep this request and try again. ${error.message}`,
        };
    }
    if (!matchesReceipt(result, 'reconnect-instance', id, request))
      return { error: 'The connection result does not belong to this request.' };
    if (['partial', 'failed', 'cancelled', 'uncertain'].includes(result.state))
      return {
        ...result,
        error:
          result.error || 'Connection could not be verified. Retry when the agent is available.',
        retry_with_new_request: result.state !== 'uncertain',
      };
    return result;
  };
}
function instanceResumer(rpc) {
  const attempts = new Map();
  return (input) => {
    const { id, generation, terminal, request } = input || {};
    if (
      typeof id !== 'string' ||
      !id ||
      !Number.isSafeInteger(generation) ||
      generation < 0 ||
      !['ghostty', 'xterm'].includes(terminal) ||
      typeof request !== 'string' ||
      !request ||
      Buffer.byteLength(request) > 128
    )
      return Promise.reject(
        Error('Choose a saved conversation, its observed generation and a terminal viewer.'),
      );
    let attempt = attempts.get(id);
    if (!attempt) {
      attempt = { request, generation, terminal, submitted: false, busy: null };
      attempts.set(id, attempt);
    }
    if (attempt.busy) return attempt.busy;
    attempt.busy = (async () => {
      let receipt;
      if (!attempt.submitted) {
        const record = (await rpc('list', '--include-removed')).find((row) => row.id === id);
        if (record?.resume?.state === 'pending' && record.resume.request_id) {
          attempt.request = record.resume.request_id;
          attempt.submitted = true;
        } else {
          if (record?.resume?.state !== 'eligible') {
            attempts.delete(id);
            throw Error(record?.resume?.reason || 'This conversation is not available to resume.');
          }
          attempt.submitted = true;
          try {
            receipt = await rpc('resume-instance', id, attempt.request, String(attempt.generation));
          } catch (error) {
            attempt.error = error.message;
          }
        }
      }
      if (!receipt) {
        try {
          receipt = await rpc('operation', attempt.request);
        } catch {
          throw Error(
            `Resume could not be confirmed. No retry was sent. Request ${attempt.request}. ${attempt.error || ''}`,
          );
        }
      }
      const deadline = Date.now() + 23000;
      while (true) {
        if (!matchesReceipt(receipt, 'resume-instance', id, attempt.request))
          throw Error(
            'The saved Resume result does not belong to this request and conversation. No new request was sent.',
          );
        if (receipt.state !== 'pending' || Date.now() >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
        receipt = await rpc('operation', attempt.request);
      }
      if (receipt.state === 'pending') return { pending: true, request_id: attempt.request };
      if (receipt.state !== 'completed') {
        if (receipt.state !== 'uncertain') attempts.delete(id);
        throw Error(
          receipt.error || 'Resume has no confirmed successful outcome. Inspect its saved state.',
        );
      }
      const current = (await rpc('list', '--include-removed')).find((row) => row.id === id);
      if (
        !Number.isSafeInteger(receipt.runtime_generation) ||
        current?.lifecycle?.runtime !== 'running' ||
        current.lifecycle.runtime_generation !== receipt.runtime_generation
      )
        throw Error(
          'The earlier Resume finished, but its current runtime cannot be confirmed. No terminal was opened.',
        );
      attempt.openRequest ||= randomUUID();
      try {
        const opened = await rpc('open', id, attempt.terminal, '--request-id', attempt.openRequest);
        if (
          !matchesReceipt(opened, 'open', id, attempt.openRequest) ||
          opened.state !== 'completed'
        )
          throw Error('The terminal result could not be verified.');
      } catch (error) {
        const opening = await rpc('operation', attempt.openRequest).catch(() => null);
        const matched = matchesReceipt(opening, 'open', id, attempt.openRequest);
        if (matched && opening.state === 'completed') {
          attempts.delete(id);
          return { session: id, runtime_generation: receipt.runtime_generation, opened: true };
        }
        const uncertain = !matched || ['pending', 'uncertain'].includes(opening.state);
        if (!uncertain) attempts.delete(id);
        return {
          session: id,
          runtime_generation: receipt.runtime_generation,
          open_request_id: uncertain ? attempt.openRequest : null,
          error: uncertain
            ? `Conversation resumed, but the terminal result is unconfirmed. Keep its original Open request. ${error.message}`
            : `Conversation resumed, but the terminal could not open. ${error.message} Use Open viewer for this running agent.`,
        };
      }
      attempts.delete(id);
      return { session: id, runtime_generation: receipt.runtime_generation, opened: true };
    })().finally(() => {
      attempt.busy = null;
    });
    return attempt.busy;
  };
}
module.exports = {
  instanceCreator,
  historyReader,
  instanceResumer,
  instanceReconnector,
  instanceOpener,
  matchesReceipt,
};
