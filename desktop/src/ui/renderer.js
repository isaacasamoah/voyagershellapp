const api = window.voyager;
const $ = (id) => document.getElementById(id);
const view = new URLSearchParams(location.search).get('view');
document.body.dataset.view = view;
let pointer = false;
let audio;
let lastRows;
let creating = false;
let currentSessions = [];
let lastEscalations;
let lastAnswer;
const escalationDrafts = new Map();
const pendingActions = new Map();
api.onDockSound((action) => {
  if (!audio || audio.state !== 'running') return;
  const tone = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;
  const [from, to] = action === 'dock' ? [310, 620] : [620, 310];
  tone.frequency.setValueAtTime(from, now);
  tone.frequency.exponentialRampToValueAtTime(to, now + 0.16);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.06, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  tone.connect(gain).connect(audio.destination);
  tone.start(now);
  tone.stop(now + 0.2);
  tone.onended = () => {
    tone.disconnect();
    gain.disconnect();
  };
});
function element(tag, text, className) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
}
api.onState((value) => {
  const focused = document.activeElement?.dataset.key;
  $('panel').hidden = view !== 'panel';
  document.body.dataset.expanded = String(value.expanded);
  document.body.dataset.seated = String(value.seated);
  document.body.dataset.panelHovered = String(value.panelHovered);
  $('avatar').dataset.hovered = String(value.dockHovered);
  document.body.dataset.connected = String(!value.serviceError);
  $('avatar').setAttribute('aria-expanded', String(value.expanded));
  $('avatar').dataset.state = value.dragging
    ? 'moving'
    : value.docked && !value.seated
      ? 'docked'
      : 'floating';
  $('connection').textContent = value.serviceError ? 'Offline' : 'Online';
  $('avatar').title =
    value.platformError ||
    value.dockError ||
    (value.docked && value.service?.voice?.state === 'unsupported'
      ? 'Master control · automatic voice is not available yet'
      : value.docked
        ? 'Master control'
        : '');
  document.body.dataset.dockError = String(Boolean(value.platformError || value.dockError));
  if (view !== 'panel') return;
  currentSessions = value.sessions;
  updateCreationAuthority();
  renderEscalations(value);
  if (!$('instance-cwd').value) $('instance-cwd').value = value.defaultDirectory;
  const rows = JSON.stringify([value.sessions, value.selected, Boolean(value.serviceError)]);
  if (rows === lastRows) return;
  lastRows = rows;
  const active = value.sessions.filter((s) => s.removed_ms == null);
  const unregistered = value.sessions.filter(
    (s) => s.removed_ms != null && s.ownership === 'managed' && s.worker_state === 'running',
  );
  function rowFor(s) {
    const b = element('button', '', 'session');
    b.dataset.key = s.id;
    b.setAttribute('aria-pressed', String(s.id === value.selected));
    const name = s.name || s.cwd.split('/').filter(Boolean).at(-1) || 'This computer';
    const status =
      value.serviceError || s.worker_state === 'unknown'
        ? 'Unknown'
        : ['stopped', 'exited'].includes(s.worker_state)
          ? 'Stopped'
          : s.capture === 'connected'
            ? 'Connected'
            : 'Disconnected';
    const dot = element('span', '', 'connection-dot');
    dot.setAttribute('aria-hidden', 'true');
    b.setAttribute('aria-label', `${name}, ${status}`);
    b.title = `${name} — ${status}`;
    const identity = element('span', '', 'session-identity');
    identity.append(element('span', name, 'session-name'));
    if (s.rank) identity.append(element('span', authority.rankName(s.rank), 'session-rank'));
    b.append(identity, dot);
    b.dataset.connected = String(status === 'Connected');
    b.onclick = () => api.select(s.id);
    const row = element('div', '', 'instance-row');
    row.append(b);
    if (s.ownership === 'managed' && s.worker_state === 'running') {
      const open = element('button', '↗', 'open-instance');
      open.setAttribute('aria-label', `Open ${name}`);
      open.title = `Open ${name}`;
      open.onclick = async () => {
        open.disabled = true;
        try {
          const result = await api.openInstance(s.id);
          showError(result?.error);
        } catch (error) {
          showError(error.message);
        } finally {
          open.disabled = false;
        }
      };
      row.append(open);
    }
    const menu = element('div', '', 'instance-menu');
    const summary = element('button', '⋯');
    summary.setAttribute('aria-label', `Actions for ${name}`);
    menu.append(summary);
    const actions = element('div', '', 'instance-actions');
    actions.popover = 'auto';
    actions.id = `actions-${s.id}`;
    summary.setAttribute('aria-controls', actions.id);
    actions.addEventListener('toggle', (event) => {
      summary.setAttribute('aria-expanded', String(event.newState === 'open'));
    });
    summary.onclick = () => {
      if (!actions.togglePopover()) return;
      const anchor = summary.getBoundingClientRect();
      const bounds = actions.getBoundingClientRect();
      actions.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, anchor.right - bounds.width))}px`;
      actions.style.top = `${Math.max(8, Math.min(innerHeight - bounds.height - 8, anchor.bottom))}px`;
    };
    function addAction(label, call, context = () => []) {
      const button = element('button', label);
      button.onclick = async () => {
        const key = JSON.stringify([s.id, label, ...context()]);
        if (!pendingActions.has(key)) pendingActions.set(key, crypto.randomUUID());
        for (const b of actions.querySelectorAll('button')) b.disabled = true;
        button.textContent = 'Working…';
        try {
          const result = await call(pendingActions.get(key));
          if (result?.error) throw Error(result.error);
          pendingActions.delete(key);
          if (actions.isConnected) actions.hidePopover();
          showError('');
        } catch (error) {
          showError(error.message);
        } finally {
          button.textContent = label;
          for (const b of actions.querySelectorAll('button')) b.disabled = false;
        }
      };
      actions.append(button);
    }
    if (s.removed_ms == null) {
      if (s.kind === 'codex') {
        const rank = choiceField(
          actions,
          'Rank',
          authority.ranks.map((r) => [r, authority.rankName(r)]),
          s.rank,
        );
        addAction(
          'Change rank',
          (request) => api.rankInstance(s.id, rank.value, request),
          () => [rank.value],
        );
      }
      const options = authority.supervisors(active, s.kind, s.rank, s.id);
      const supervisor = choiceField(
        actions,
        s.kind === 'shell' ? 'Controller' : 'Supervisor',
        [
          ['', 'Unassigned'],
          ...options.map((candidate) => [candidate.id, instanceName(candidate)]),
        ],
        s.supervisor_id || '',
      );
      addAction(
        'Change assignment',
        (request) => api.superviseInstance(s.id, supervisor.value || null, request),
        () => [supervisor.value],
      );
    }
    if (s.ownership === 'managed' && s.worker_state === 'running') {
      addAction('Run in background', (request) => api.backgroundInstance(s.id, request));
      addAction('Stop', (request) => api.stopInstance(s.id, request));
    }
    if (s.removed_ms == null) {
      addAction('Remove', (request) => api.removeInstance(s.id, request, false));
      if (s.ownership === 'managed')
        addAction('Stop and remove', (request) => api.removeInstance(s.id, request, true));
    } else addAction('Register again', (request) => api.registerInstance(s.id, request));
    menu.append(actions);
    row.append(menu);
    return row;
  }
  $('sessions').replaceChildren(...active.map(rowFor));
  $('unregistered-sessions').replaceChildren(...unregistered.map(rowFor));
  $('unregistered').hidden = unregistered.length === 0;
  if (!active.length) $('sessions').append(element('p', 'No instances yet.', 'empty'));
  if (focused) {
    for (const button of document.querySelectorAll('[data-key]')) {
      if (button.dataset.key === focused) button.focus({ preventScroll: true });
    }
  }
});
$('avatar').addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  pointer = true;
  audio ??= new AudioContext();
  audio.resume().catch(() => {});
  $('avatar').focus({ preventScroll: true });
  $('avatar').setPointerCapture(event.pointerId);
  const b = $('avatar').getBoundingClientRect();
  api.beginDrag(event.clientX - b.left, event.clientY - b.top);
});
$('avatar').addEventListener('pointerup', (event) => {
  if (!pointer) return;
  pointer = false;
  $('avatar').releasePointerCapture(event.pointerId);
  $('avatar').blur();
  api.endDrag();
});
$('avatar').addEventListener('pointercancel', () => {
  if (!pointer) return;
  pointer = false;
  $('avatar').blur();
  api.cancelDrag();
});
$('avatar').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    api.toggle();
  }
  if (event.key === 'Escape' && pointer) {
    pointer = false;
    $('avatar').blur();
    api.cancelDrag();
  }
});
$('quit').onclick = () => api.quit();
api.ready();

function showError(message) {
  let text = message || '';
  for (const session of currentSessions) text = text.replaceAll(session.id, instanceName(session));
  text = text.replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, 'an instance');
  $('instance-error').textContent = text;
  $('instance-error').hidden = !message;
}
function instanceName(session) {
  return session.name || session.cwd.split('/').filter(Boolean).at(-1) || 'This computer';
}
function choiceField(parent, name, options, selected) {
  const label = element('label', name);
  const select = element('select', '');
  select.setAttribute('aria-label', name);
  for (const [value, text] of options) {
    const option = element('option', text);
    option.value = value;
    select.append(option);
  }
  select.value = selected;
  label.append(select);
  parent.append(label);
  return select;
}
function updateCreationAuthority() {
  const shell = $('instance-kind').value === 'shell';
  $('rank-field').hidden = shell;
  $('supervisor-label').textContent = shell ? 'Controller' : 'Supervisor';
  const select = $('instance-supervisor');
  const selected = select.value;
  const choices = authority.supervisors(
    currentSessions,
    shell ? 'shell' : 'codex',
    $('instance-rank').value,
  );
  const options = [['', 'Unassigned'], ...choices.map((s) => [s.id, instanceName(s)])];
  const key = JSON.stringify(options);
  if (select.dataset.options === key) return;
  select.dataset.options = key;
  select.replaceChildren(
    ...options.map(([value, name]) => {
      const option = element('option', name);
      option.value = value;
      return option;
    }),
  );
  select.value = choices.some((s) => s.id === selected) ? selected : '';
}
function renderEscalations(value) {
  const entries = value.escalations || [];
  const answered = entries.find((entry) => entry.request_id === lastAnswer && entry.answer);
  if (answered) $('authority-feedback').textContent = responseStatus(answered.answer.delivery);
  const key = JSON.stringify([
    entries,
    value.escalationError,
    value.sessions.map((s) => [s.id, s.name]),
  ]);
  if (key === lastEscalations) return;
  lastEscalations = key;
  const pending = authority.visibleEscalations(entries);
  $('escalations').hidden = !pending.length && !value.escalationError;
  $('escalation-error').textContent = value.escalationError || '';
  $('escalation-error').hidden = !value.escalationError;
  $('escalation-list').replaceChildren(
    ...pending.map((entry) => {
      const card = element('form', '', 'escalation');
      const sender = value.sessions.find((s) => s.id === entry.session_id);
      card.append(element('strong', sender ? instanceName(sender) : 'An instance'));
      card.append(element('p', entry.message, 'question-text'));
      const delivery = {
        recorded: 'Recorded for you',
        accepted: 'Delivered',
        failed: 'Delivery failed',
        uncertain: 'Delivery uncertain',
      };
      if (entry.answered) {
        card.append(element('p', responseStatus(entry.answer?.delivery), 'form-hint'));
        return card;
      }
      card.append(element('p', delivery[entry.delivery] || 'Delivery pending', 'form-hint'));
      const draft = escalationDrafts.get(entry.request_id) || { decision: 'resolve', message: '' };
      const decision = choiceField(
        card,
        'Response',
        [
          ['resolve', 'Answer question'],
          ['accept', 'Accept result'],
          ['revise', 'Request changes'],
        ],
        draft.decision,
      );
      const label = element('label', 'Your response');
      const answer = element('textarea', '');
      answer.required = true;
      answer.value = draft.message;
      label.append(answer);
      card.append(label);
      const saveDraft = () =>
        escalationDrafts.set(entry.request_id, { decision: decision.value, message: answer.value });
      answer.oninput = saveDraft;
      decision.onchange = saveDraft;
      const submit = element('button', 'Send response');
      submit.type = 'submit';
      card.append(submit);
      card.onsubmit = async (event) => {
        event.preventDefault();
        const message = answer.value.trim();
        if (!message) return;
        const key = JSON.stringify([
          'adjudicate',
          entry.session_id,
          entry.request_id,
          decision.value,
          message,
        ]);
        if (!pendingActions.has(key)) pendingActions.set(key, crypto.randomUUID());
        for (const field of card.elements) field.disabled = true;
        submit.textContent = 'Sending…';
        try {
          const result = await api.adjudicateEscalation(
            entry.session_id,
            entry.request_id,
            decision.value,
            message,
            pendingActions.get(key),
          );
          if (result?.error && result.state !== 'completed') throw Error(result.error);
          pendingActions.delete(key);
          escalationDrafts.delete(entry.request_id);
          lastAnswer = entry.request_id;
          $('authority-feedback').textContent = responseStatus(result?.delivery);
          showError('');
        } catch (error) {
          showError(error.message);
        } finally {
          for (const field of card.elements) field.disabled = false;
          submit.textContent = 'Send response';
        }
      };
      return card;
    }),
  );
}
function responseStatus(delivery) {
  return (
    {
      recorded: 'Response recorded. Awaiting delivery.',
      accepted: 'Response delivered.',
      failed: 'Response recorded. Delivery failed.',
      uncertain: 'Response recorded. Delivery uncertain.',
    }[delivery] || 'Response recorded.'
  );
}
function showCreate(open) {
  if (creating) return;
  if (open) {
    $('instance-rank').value = 'crew';
    $('instance-supervisor').value = '';
    updateCreationAuthority();
  }
  $('create-form').hidden = !open;
  $('add').setAttribute('aria-expanded', String(open));
  api.createForm(open);
  showError('');
  if (open) $('instance-name').focus();
}
$('add').onclick = () => showCreate($('create-form').hidden);
$('cancel-create').onclick = () => showCreate(false);
$('instance-kind').onchange = updateCreationAuthority;
$('instance-rank').onchange = updateCreationAuthority;
$('choose-folder').onclick = async () => {
  const path = await api.chooseDirectory();
  if (typeof path === 'string') $('instance-cwd').value = path;
};
$('create-form').onsubmit = async (event) => {
  event.preventDefault();
  if (creating) return;
  creating = true;
  for (const input of $('create-form').elements) input.disabled = true;
  $('create').textContent = 'Opening…';
  try {
    const result = await api.createInstance({
      kind: $('instance-kind').value,
      name: $('instance-name').value.trim(),
      cwd: $('instance-cwd').value,
      rank: $('instance-kind').value === 'codex' ? $('instance-rank').value : null,
      supervisor: $('instance-supervisor').value || null,
    });
    if (result?.error) throw Error(result.error);
    creating = false;
    showCreate(false);
    $('instance-name').value = '';
    $('instance-rank').value = 'crew';
    $('instance-supervisor').value = '';
  } catch (error) {
    showError(error.message);
  } finally {
    creating = false;
    for (const input of $('create-form').elements) input.disabled = false;
    $('create').textContent = 'Create and open';
  }
};
