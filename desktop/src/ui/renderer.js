const api = window.voyager;
const $ = (id) => document.getElementById(id);
const view = new URLSearchParams(location.search).get('view');
document.body.dataset.view = view;
let pointer = false;
let audio;
let lastRows;
let creating = false;
let currentSessions = [];
const pendingActions = new Map();
const resumeViewers = new Map();
const vesselMessages = new Map();
const expandedVessels = new Set();
let fleetRequest;
let lastState;
const openMenus = new Set();
const history = createHistory(api, element, hierarchy);
const panelFocus = createPanelFocus($('panel'));
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
function runtimeLabel(session) {
  if (session.resume?.state === 'pending') return 'Resuming';
  if (session.recovery?.state === 'checking') return 'Reconnecting';
  if (session.recovery?.state === 'disconnected') return 'Connection unavailable';
  const runtime = session.lifecycle?.runtime;
  if (runtime === 'starting') return 'Starting';
  if (runtime === 'running') {
    if (session.removed_ms != null) return 'Unregistered';
    return session.capture === 'connected' ? 'Running' : 'Running, capture unavailable';
  }
  if (runtime === 'external') return 'External, process state unverified';
  if (runtime === 'stopped') return 'Stopped';
  return 'Runtime unverified';
}
function disableServiceActions(container) {
  for (const button of container.querySelectorAll('button'))
    if (!/^(menu|inspect|expand|dismiss)-/.test(button.id || '')) button.disabled = true;
}
function announceVessel(message) {
  $('vessel-status').textContent = message;
}
function vesselFeedback(id, message, request) {
  if (message) vesselMessages.set(id, { full: message, request });
  else vesselMessages.delete(id);
  const dismiss = $(`dismiss-${id}`);
  if (dismiss) dismiss.hidden = !message;
  const node = $(`feedback-${id}`);
  if (node) {
    node.textContent = (message || '').replace(/^[a-z_]+:\s*/, '').slice(0, 180);
    node.hidden = !message;
  }
  if (message) announceVessel(message.replace(/^[a-z_]+:\s*/, '').slice(0, 180));
}
function renderState(value) {
  const disconnected = Boolean(value.serviceError && !lastState?.serviceError);
  lastState = value;
  const focused = panelFocus.capture();
  $('panel').hidden = view !== 'panel';
  document.body.dataset.expanded = String(value.expanded);
  document.body.dataset.seated = String(value.seated);
  document.body.dataset.docked = String(Boolean(value.docked && !value.seated));
  document.body.dataset.panelHovered = String(value.panelHovered);
  $('avatar').dataset.hovered = String(value.dockHovered);
  document.body.dataset.connected = String(!value.serviceError);
  $('avatar').setAttribute('aria-expanded', String(value.expanded));
  $('avatar').dataset.state = value.dragging
    ? 'moving'
    : value.docked && !value.seated
      ? 'docked'
      : 'floating';
  const oldService = value.sessions.some((s) => !s.lifecycle?.runtime);
  $('connection').textContent = value.serviceError
    ? 'Connection lost. Showing last-known information.'
    : oldService
      ? 'Update the service for reliable runtime state. Resume is unavailable.'
      : value.dockError || '';
  $('connection').hidden = !value.serviceError && !value.dockError && !oldService;
  $('avatar').title =
    value.platformError || value.dockError || (value.docked ? 'Master control' : '');
  document.body.dataset.dockError = String(Boolean(value.platformError || value.dockError));
  if (view !== 'panel') return;
  currentSessions = value.sessions;
  $('create').disabled = Boolean(value.serviceError) || creating;
  $('create-fleet').disabled = Boolean(value.serviceError);
  for (const button of $('app-menu').querySelectorAll('button'))
    button.disabled = Boolean(value.serviceError);
  updateCreationAuthority();
  updateCreationFleets();
  if (!$('instance-cwd').value) $('instance-cwd').value = value.defaultDirectory;
  const rows = JSON.stringify([
    value.sessions,
    value.selected,
    Boolean(value.serviceError),
    value.fleetData,
    value.fleetError,
    value.displayHeight,
  ]);
  if (value.serviceError) {
    for (const id of [
      'sessions',
      'fleets',
      'unregistered-sessions',
      'needs-attention-sessions',
      'previous-sessions',
    ])
      disableServiceActions($(id));
    if (disconnected) {
      for (const menu of openMenus)
        if (menu.isConnected && menu.matches(':popover-open')) menu.hidePopover();
      openMenus.clear();
    }
  }
  if (openMenus.size || rows === lastRows) return;
  lastRows = rows;
  const groups = hierarchy.classify(value.sessions);
  const registered = value.sessions.filter((s) => s.removed_ms == null);
  const active = groups.current.filter((s) => s.removed_ms == null);
  const unregistered = groups.current.filter((s) => s.removed_ms != null);
  const fleetData = value.fleetData || { fleets: [], assignments: {} };
  $('fleet-error').textContent = value.fleetError || '';
  $('fleet-error').hidden = !value.fleetError;
  function rowFor(s) {
    const runtime = s.lifecycle?.runtime;
    const live = s.ownership === 'managed' && runtime === 'running';
    if (live) resumeViewers.delete(s.id);
    const b = element(live ? 'button' : 'div', '', 'session');
    b.dataset.key = s.id;
    b.draggable = true;
    b.ondragstart = (event) => {
      event.dataTransfer.setData('application/x-voyager-vessel', s.id);
      event.dataTransfer.effectAllowed = 'move';
    };
    if (live) b.setAttribute('aria-pressed', String(s.id === value.selected));
    else b.setAttribute('role', 'group');
    const name = s.name || s.cwd.split('/').filter(Boolean).at(-1) || 'This computer';
    let status = runtimeLabel(s);
    if (value.serviceError) status = `Last known: ${status}`;
    const dot = element('span', '', 'connection-dot');
    dot.setAttribute('aria-hidden', 'true');
    b.setAttribute('aria-label', `${name}, ${status}`);
    b.title = `${name}. ${status}`;
    const identity = element('span', '', 'session-identity');
    identity.append(element('span', name, 'session-name'));
    if (s.rank && runtime !== 'stopped')
      identity.append(element('span', authority.rankName(s.rank), 'session-rank'));
    identity.append(element('span', status, 'session-state'));
    b.append(identity, dot);
    b.dataset.connected = String(s.capture === 'connected' && !value.serviceError);
    b.disabled = Boolean(value.serviceError);
    const feedback = (message, request) => vesselFeedback(s.id, message, request);
    if (live)
      b.onclick = async () => {
        document.body.dataset.arranging = 'true';
        b.disabled = true;
        try {
          const result = await api.surfaceInstance(s.id);
          feedback(result?.error);
        } catch (error) {
          feedback(error.message);
        } finally {
          document.body.dataset.arranging = 'false';
          b.disabled = Boolean(lastState?.serviceError);
        }
      };
    const row = element('div', '', 'instance-row');
    row.dataset.vessel = s.id;
    row.append(b);
    const { menu, actions, addAction } = actionMenu(name, s.id, feedback);
    const inspect = element('button', 'Details');
    inspect.id = `inspect-${s.id}`;
    inspect.setAttribute('aria-label', `Details for ${name}`);
    inspect.onclick = () => {
      actions.hidePopover();
      history.inspect(s, vesselMessages.get(s.id));
    };
    actions.append(inspect);
    const dismiss = element('button', 'Dismiss message');
    dismiss.id = `dismiss-${s.id}`;
    dismiss.hidden = !vesselMessages.has(s.id);
    dismiss.onclick = () => {
      feedback('');
      actions.hidePopover();
      $(`menu-${s.id}`)?.focus();
    };
    actions.append(dismiss);
    const rename = nameEditor(
      actions,
      name,
      (next, request) => api.renameInstance(s.id, next, request),
      feedback,
    );
    addAction(
      'Rename',
      () => {
        rename.hidden = false;
        rename.querySelector('input').focus();
      },
      () => [],
      false,
    );
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
      const options = authority.supervisors(registered, s.kind, s.rank, s.id);
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
    if (s.recovery?.retry_available && s.removed_ms == null) {
      const retry = addAction(
        'Retry connection',
        async (request) => {
          announceVessel(`Checking the connection to ${name}.`);
          const result = await api.reconnectInstance({
            id: s.id,
            generation: s.lifecycle.runtime_generation,
            request,
          });
          if (!result?.error)
            announceVessel(
              result?.state === 'pending' ? `Still checking ${name}.` : `Reconnected ${name}.`,
            );
          return result;
        },
        () => [s.lifecycle.runtime_generation],
      );
      retry.id = `retry-${s.id}`;
    }
    if (s.recovery?.state === 'disconnected')
      row.append(
        element(
          'p',
          s.recovery.reason || 'Retry connection to check this agent again.',
          'agent-reason',
        ),
      );
    if (s.ownership === 'managed' && runtime === 'running') {
      if (s.window === 'open')
        addAction('Run in background', (request) => api.backgroundInstance(s.id, request));
      else {
        addAction('Bring forward', () => api.surfaceInstance(s.id));
        const viewer = choiceField(
          actions,
          'Terminal viewer',
          [
            ['ghostty', 'Ghostty'],
            ['xterm', 'xterm'],
          ],
          s.terminal || 'ghostty',
        );
        viewer.id = `open-viewer-${s.id}`;
        const open = addAction(
          'Open viewer',
          (request) => api.openInstance(s.id, viewer.value, request),
          () => [viewer.value],
        );
        open.id = `open-${s.id}`;
      }
      addAction('Stop', (request) => api.stopInstance(s.id, request));
    }
    if (s.removed_ms == null) {
      addAction('Remove', (request) => api.removeInstance(s.id, request, false));
      if (s.ownership === 'managed')
        addAction('Stop and remove', (request) => api.removeInstance(s.id, request, true));
    } else addAction('Register again', (request) => api.registerInstance(s.id, request));
    if (groups.attention.includes(s)) {
      const reason =
        typeof s.resume?.reason === 'string'
          ? s.resume.reason.replace(/^[a-z_]+:\s*/, '')
          : 'The service cannot confirm this runtime. Inspect its saved details.';
      row.append(element('p', reason, 'agent-reason'));
    }
    if (s.resume?.state === 'eligible' || s.resume?.state === 'pending') {
      const viewer = choiceField(
        actions,
        'Terminal viewer',
        [
          ['xterm', 'xterm'],
          ['ghostty', 'Ghostty'],
        ],
        resumeViewers.get(s.id) || s.terminal || 'xterm',
      );
      viewer.id = `resume-viewer-${s.id}`;
      viewer.onchange = () => resumeViewers.set(s.id, viewer.value);
      let pending = s.resume.state === 'pending';
      const resume = element('button', pending ? 'Resuming…' : 'Resume', 'resume-action');
      resume.id = `resume-${s.id}`;
      resume.disabled = Boolean(value.serviceError) || pending;
      resume.onclick = async () => {
        const key = JSON.stringify([s.id, 'Resume', s.lifecycle.runtime_generation]);
        if (!pendingActions.has(key))
          pendingActions.set(key, s.resume.request_id || crypto.randomUUID());
        resume.disabled = true;
        resume.dataset.request = pendingActions.get(key);
        feedback('');
        announceVessel(`Resuming ${name}.`);
        try {
          const result = await api.resumeInstance({
            id: s.id,
            generation: s.lifecycle.runtime_generation,
            terminal: viewer.value,
            request: pendingActions.get(key),
          });
          if (result?.open_request_id)
            pendingActions.set(
              JSON.stringify([s.id, 'Open viewer', viewer.value]),
              result.open_request_id,
            );
          if (result?.error) throw Error(result.error);
          pending = Boolean(result?.pending);
          announceVessel(pending ? `Still resuming ${name}.` : `Opened ${name}.`);
          if (!pending) {
            pendingActions.delete(key);
            feedback('');
          }
        } catch (error) {
          announceVessel(`Could not finish opening ${name}.`);
          feedback(error.message, pendingActions.get(key));
        } finally {
          resume.disabled = Boolean(lastState?.serviceError) || pending;
          resume.textContent = pending ? 'Resuming…' : 'Resume';
        }
      };
      row.append(resume);
    }
    history.decorate(identity, s);
    const notice = element('p', '', 'vessel-feedback');
    notice.id = `feedback-${s.id}`;
    const message = vesselMessages.get(s.id);
    notice.textContent = (message?.full || '').replace(/^[a-z_]+:\s*/, '').slice(0, 180);
    notice.hidden = !message;
    row.append(menu, notice);
    if (value.serviceError) disableServiceActions(row);
    return row;
  }
  function ranked(s, visibleRows) {
    const tree = element('section', '', 'rank-tree');
    const row = rowFor(s);
    if (s.supervisor_id && !visibleRows.some((parent) => parent.id === s.supervisor_id)) {
      const parent = value.sessions.find((parent) => parent.id === s.supervisor_id);
      let description = 'Supervisor unavailable';
      if (parent) {
        const status = value.serviceError
          ? `last known ${runtimeLabel(parent)}`
          : runtimeLabel(parent);
        description = `Reports to ${instanceName(parent)}, ${status}`;
      }
      row.append(element('p', description, 'agent-reason'));
    }
    tree.append(row);
    const reports = hierarchy.children(visibleRows, s.id);
    if (!reports.length) return tree;
    const toggle = element('button', expandedVessels.has(s.id) ? '▾' : '▸', 'rank-toggle');
    toggle.setAttribute('aria-label', `Expand or collapse ${instanceName(s)}`);
    toggle.setAttribute('aria-expanded', String(expandedVessels.has(s.id)));
    toggle.dataset.expand = s.id;
    toggle.id = `expand-${s.id}`;
    toggle.onclick = () => {
      if (expandedVessels.has(s.id)) expandedVessels.delete(s.id);
      else expandedVessels.add(s.id);
      lastRows = null;
      renderState(lastState);
    };
    row.append(toggle);
    const children = element('div', '', 'rank-children');
    children.hidden = !expandedVessels.has(s.id);
    children.append(...reports.map((r) => ranked(r, visibleRows)));
    tree.append(children);
    return tree;
  }
  function renderTree(container, fleet) {
    const members = active.filter(
      (s) => hierarchy.fleetOf(s.id, registered, fleetData.assignments) === fleet,
    );
    container.replaceChildren(...hierarchy.roots(members).map((s) => ranked(s, members)));
    dropTarget(container, fleet);
    if (!members.length && fleet) {
      container.append(element('span', 'Drop vessels here', 'fleet-empty'));
    }
  }
  renderTree($('sessions'), null);
  const fleetNodes = fleetData.fleets.map((fleet) => {
    const section = element('section', '', 'fleet');
    section.dataset.fleet = fleet.id;
    const heading = element('div', '', 'fleet-heading');
    const name = element('button', fleet.name, 'fleet-name');
    name.title = 'Surface this fleet';
    name.id = `fleet-${fleet.id}`;
    name.onclick = () => arrange(() => api.surfaceFleet(fleet.id), name);
    const { menu, actions, addAction } = actionMenu(fleet.name, fleet.id);
    const rename = nameEditor(actions, fleet.name, (next) => api.renameFleet(fleet.id, next));
    addAction(
      'Rename',
      () => {
        rename.hidden = false;
        rename.querySelector('input').focus();
      },
      () => [],
      false,
    );
    addAction('Remove fleet', () => api.removeFleet(fleet.id));
    heading.append(name, menu);
    const canvas = element('div', '', 'fleet-canvas');
    renderTree(canvas, fleet.id);
    section.append(heading, canvas);
    if (value.serviceError) disableServiceActions(section);
    dropTarget(section, fleet.id);
    return section;
  });
  $('fleets').replaceChildren(...fleetNodes);
  $('unregistered-sessions').replaceChildren(...unregistered.map(rowFor));
  $('unregistered').hidden = unregistered.length === 0;
  $('needs-attention-sessions').replaceChildren(...groups.attention.map(rowFor));
  $('needs-attention').hidden = groups.attention.length === 0;
  history.render(groups, rowFor, value);
  panelFocus.restore(focused, groups);
}
function actionMenu(name, key, feedback = showError) {
  const menu = element('div', '', 'instance-menu');
  const summary = element('button', '⋯');
  summary.setAttribute('aria-label', `Actions for ${name}`);
  summary.id = `menu-${key}`;
  summary.setAttribute('aria-expanded', 'false');
  const actions = element('div', '', 'instance-actions');
  actions.popover = 'auto';
  actions.id = `actions-${key}`;
  summary.setAttribute('aria-controls', actions.id);
  let observer;
  function position() {
    const anchor = summary.getBoundingClientRect();
    const bounds = actions.getBoundingClientRect();
    actions.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, anchor.right - bounds.width))}px`;
    actions.style.top = `${Math.max(8, Math.min(innerHeight - bounds.height - 8, anchor.bottom))}px`;
  }
  function visibility(open) {
    if (open) {
      openMenus.add(actions);
      observer ||= new ResizeObserver(position);
      observer.observe(actions);
    } else {
      openMenus.delete(actions);
      observer?.disconnect();
      renderState(lastState);
    }
    summary.setAttribute('aria-expanded', String(open));
  }
  actions.addEventListener('toggle', (event) => visibility(event.newState === 'open'));
  summary.onclick = () => {
    const open = actions.togglePopover();
    visibility(open);
    if (open) position();
  };
  function addAction(label, call, context = () => [], close = true) {
    const button = element('button', label);
    button.type = 'button';
    button.onclick = async () => {
      if (!close) {
        call();
        return;
      }
      const id = JSON.stringify([key, label, ...context()]);
      if (!pendingActions.has(id)) pendingActions.set(id, crypto.randomUUID());
      for (const node of actions.querySelectorAll('button')) node.disabled = true;
      button.textContent = 'Working…';
      button.dataset.request = pendingActions.get(id);
      try {
        const result = await call(pendingActions.get(id));
        if (result?.error) {
          if (result.retry_with_new_request) pendingActions.delete(id);
          throw Error(result.error);
        }
        pendingActions.delete(id);
        if (close && actions.isConnected) actions.hidePopover();
        feedback(result?.warning || '', button.dataset.request);
      } catch (error) {
        feedback(error.message, button.dataset.request);
      } finally {
        button.textContent = label;
        for (const node of actions.querySelectorAll('button')) node.disabled = false;
        if (lastState?.serviceError) disableServiceActions(actions);
      }
    };
    actions.append(button);
    return button;
  }
  menu.append(summary, actions);
  return { menu, actions, addAction };
}
function nameEditor(actions, current, save, feedback = showError) {
  const form = element('form', '', 'rename-form');
  form.hidden = true;
  const label = element('label', 'Name');
  const input = element('input');
  input.value = current;
  input.required = true;
  input.maxLength = 100;
  input.setAttribute('aria-label', 'New name');
  label.append(input);
  const submit = element('button', 'Save');
  submit.type = 'submit';
  const cancel = element('button', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = () => {
    form.hidden = true;
  };
  form.append(label, submit, cancel);
  let request;
  let previous;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    if (previous !== input.value) {
      previous = input.value;
      request = crypto.randomUUID();
    }
    submit.disabled = true;
    cancel.disabled = true;
    try {
      const result = await save(input.value, request);
      if (result?.error) throw Error(result.error);
      feedback('');
      if (actions.isConnected) actions.hidePopover();
    } catch (error) {
      feedback(error.message, request);
    } finally {
      submit.disabled = Boolean(lastState?.serviceError);
      cancel.disabled = false;
    }
  };
  actions.append(form);
  return form;
}
api.onState(renderState);
async function arrange(call, button) {
  document.body.dataset.arranging = 'true';
  button.disabled = true;
  try {
    const result = await call();
    showError(result?.error);
  } catch (error) {
    showError(error.message);
  } finally {
    document.body.dataset.arranging = 'false';
    button.disabled = Boolean(lastState?.serviceError);
  }
}
function dropTarget(node, fleet) {
  node.ondragover = (event) => {
    if (!Array.from(event.dataTransfer.types).includes('application/x-voyager-vessel')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    node.dataset.over = 'true';
  };
  node.ondragleave = () => {
    delete node.dataset.over;
  };
  node.ondrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    delete node.dataset.over;
    const id = event.dataTransfer.getData('application/x-voyager-vessel');
    if (!id) return;
    try {
      const result = await api.moveVessel(id, fleet);
      showError(result?.error);
    } catch (error) {
      showError(error.message);
    }
  };
}
$('add-fleet').onclick = () => {
  $('fleet-form').hidden = false;
  lastRows = null;
  renderState(lastState);
  $('fleet-name').focus();
};
$('cancel-fleet').onclick = () => {
  $('fleet-form').hidden = true;
  lastRows = null;
  renderState(lastState);
};
$('fleet-form').onsubmit = async (event) => {
  event.preventDefault();
  const name = $('fleet-name').value.trim();
  if (!fleetRequest || fleetRequest.name !== name) fleetRequest = { name, id: crypto.randomUUID() };
  try {
    const result = await api.createFleet(name, fleetRequest.id);
    if (result?.error) throw Error(result.error);
    fleetRequest = null;
    $('fleet-name').value = '';
    $('fleet-form').hidden = true;
    lastRows = null;
    renderState(lastState);
    showError('');
  } catch (error) {
    showError(error.message);
  }
};
$('panel').addEventListener('pointerdown', (event) => {
  if (
    event.button !== 0 ||
    event.target.closest(
      'button, input, select, textarea, a, form, details, .instance-menu, .fleet, #conversation, #agent-details',
    )
  )
    return;
  event.preventDefault();
  $('panel').setPointerCapture(event.pointerId);
  api.beginPanelDrag(event.clientX, event.clientY);
});
$('panel').addEventListener('pointerup', (event) => {
  if ($('panel').hasPointerCapture(event.pointerId))
    $('panel').releasePointerCapture(event.pointerId);
});
$('panel').addEventListener('lostpointercapture', () => api.endPanelDrag());
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
if (view === 'panel') {
  const { menu, addAction } = actionMenu('Voyager', 'service');
  addAction('Stop service', () => api.stopService());
  $('app-menu').append(menu);
}
if (view === 'panel' && typeof ResizeObserver !== 'undefined') {
  let previousHeight;
  new ResizeObserver(() => {
    const style = getComputedStyle($('panel'));
    const height = Math.ceil(
      $('panel-flow').getBoundingClientRect().height +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth) +
        16,
    );
    if (height !== previousHeight) {
      previousHeight = height;
      api.panelContentHeight(height);
    }
  }).observe($('panel-flow'));
}
api.ready();

function showError(message) {
  let text = message || '';
  for (const session of currentSessions) text = text.replaceAll(session.id, instanceName(session));
  text = text.replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, 'a vessel');
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
function updateCreationFleets() {
  const fleets = lastState?.fleetData?.fleets || [];
  const select = $('instance-fleet');
  const selected = select.value;
  $('instance-fleet-field').hidden = fleets.length === 0;
  const key = JSON.stringify(fleets);
  if (select.dataset.options === key) return;
  select.dataset.options = key;
  select.replaceChildren(
    ...[['', 'No fleet'], ...fleets.map((f) => [f.id, f.name])].map(([value, name]) => {
      const option = element('option', name);
      option.value = value;
      return option;
    }),
  );
  select.value = fleets.some((f) => f.id === selected) ? selected : '';
}
function showCreate(open) {
  if (creating) return;
  if (open) {
    $('instance-rank').value = 'crew';
    $('instance-supervisor').value = '';
    $('instance-fleet').value = '';
    updateCreationAuthority();
  }
  $('create-form').hidden = !open;
  $('add').setAttribute('aria-expanded', String(open));
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
      terminal: $('instance-terminal').value || 'ghostty',
      name: $('instance-name').value.trim(),
      cwd: $('instance-cwd').value,
      rank: $('instance-kind').value === 'codex' ? $('instance-rank').value : null,
      supervisor: $('instance-supervisor').value || null,
      ...(!$('instance-fleet-field').hidden ? { fleet: $('instance-fleet').value || null } : {}),
    });
    if (result?.error) throw Error(result.error);
    creating = false;
    showCreate(false);
    $('instance-name').value = '';
    $('instance-rank').value = 'crew';
    $('instance-supervisor').value = '';
    if (result?.warning) showError(result.warning);
  } catch (error) {
    showError(error.message);
  } finally {
    creating = false;
    for (const input of $('create-form').elements) input.disabled = false;
    $('create').disabled = Boolean(lastState?.serviceError);
    $('create').textContent = 'Create and open';
  }
};
