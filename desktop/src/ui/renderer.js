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
const expandedVessels = new Set();
let fleetRequest;
let lastState;
const openMenus = new Set();
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
function renderState(value) {
  lastState = value;
  const focused = document.activeElement?.dataset.key;
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
  $('connection').textContent = value.serviceError ? 'Offline' : '';
  $('connection').hidden = !value.serviceError;
  $('avatar').title =
    value.platformError || value.dockError || (value.docked ? 'Master control' : '');
  document.body.dataset.dockError = String(Boolean(value.platformError || value.dockError));
  if (view !== 'panel') return;
  currentSessions = value.sessions;
  updateCreationAuthority();
  updateCreationFleets();
  if (!$('instance-cwd').value) $('instance-cwd').value = value.defaultDirectory;
  const rows = JSON.stringify([
    value.sessions,
    value.selected,
    Boolean(value.serviceError),
    value.fleetData,
    value.fleetError,
  ]);
  if (openMenus.size || rows === lastRows) return;
  lastRows = rows;
  const active = value.sessions.filter((s) => s.removed_ms == null);
  const unregistered = value.sessions.filter(
    (s) => s.removed_ms != null && s.ownership === 'managed' && s.worker_state === 'running',
  );
  const fleetData = value.fleetData || { fleets: [], assignments: {} };
  $('fleet-error').textContent = value.fleetError || '';
  $('fleet-error').hidden = !value.fleetError;
  function rowFor(s) {
    const b = element('button', '', 'session');
    b.dataset.key = s.id;
    b.draggable = true;
    b.ondragstart = (event) => {
      event.dataTransfer.setData('application/x-voyager-vessel', s.id);
      event.dataTransfer.effectAllowed = 'move';
    };
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
    b.disabled = s.ownership !== 'managed' || s.worker_state !== 'running';
    b.onclick = async () => {
      document.body.dataset.arranging = 'true';
      b.disabled = true;
      try {
        const result = await api.surfaceInstance(s.id);
        showError(result?.error);
      } catch (error) {
        showError(error.message);
      } finally {
        document.body.dataset.arranging = 'false';
        b.disabled = false;
      }
    };
    const row = element('div', '', 'instance-row');
    row.append(b);
    const { menu, actions, addAction } = actionMenu(name, s.id);
    const rename = nameEditor(actions, name, (next, request) =>
      api.renameInstance(s.id, next, request),
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
      if (s.window === 'open')
        addAction('Run in background', (request) => api.backgroundInstance(s.id, request));
      else addAction('Bring forward', () => api.surfaceInstance(s.id));
      addAction('Stop', (request) => api.stopInstance(s.id, request));
    }
    if (s.removed_ms == null) {
      addAction('Remove', (request) => api.removeInstance(s.id, request, false));
      if (s.ownership === 'managed')
        addAction('Stop and remove', (request) => api.removeInstance(s.id, request, true));
    } else addAction('Register again', (request) => api.registerInstance(s.id, request));
    row.append(menu);
    return row;
  }
  function ranked(s, visibleRows) {
    const tree = element('section', '', 'rank-tree');
    const row = rowFor(s);
    tree.append(row);
    const reports = hierarchy.children(visibleRows, s.id);
    if (!reports.length) return tree;
    const toggle = element('button', expandedVessels.has(s.id) ? '▾' : '▸', 'rank-toggle');
    toggle.setAttribute('aria-label', `Expand or collapse ${instanceName(s)}`);
    toggle.setAttribute('aria-expanded', String(expandedVessels.has(s.id)));
    toggle.dataset.expand = s.id;
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
      (s) => hierarchy.fleetOf(s.id, active, fleetData.assignments) === fleet,
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
    dropTarget(section, fleet.id);
    return section;
  });
  $('fleets').replaceChildren(...fleetNodes);
  $('unregistered-sessions').replaceChildren(...unregistered.map(rowFor));
  $('unregistered').hidden = unregistered.length === 0;
  if (focused) {
    for (const button of document.querySelectorAll('[data-key]')) {
      if (button.dataset.key === focused) button.focus({ preventScroll: true });
    }
  }
}
function actionMenu(name, key) {
  const menu = element('div', '', 'instance-menu');
  const summary = element('button', '⋯');
  summary.setAttribute('aria-label', `Actions for ${name}`);
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
      try {
        const result = await call(pendingActions.get(id));
        if (result?.error) throw Error(result.error);
        pendingActions.delete(id);
        if (close && actions.isConnected) actions.hidePopover();
        showError('');
      } catch (error) {
        showError(error.message);
      } finally {
        button.textContent = label;
        for (const node of actions.querySelectorAll('button')) node.disabled = false;
      }
    };
    actions.append(button);
  }
  menu.append(summary, actions);
  return { menu, actions, addAction };
}
function nameEditor(actions, current, save) {
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
      showError('');
      actions.hidePopover();
    } catch (error) {
      showError(error.message);
    } finally {
      submit.disabled = false;
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
    button.disabled = false;
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
      'button, input, select, textarea, a, form, .instance-menu, .fleet, #conversation',
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
    $('create').textContent = 'Create and open';
  }
};
