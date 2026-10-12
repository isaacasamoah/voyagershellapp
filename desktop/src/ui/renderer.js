const api = window.voyager;
const $ = (id) => document.getElementById(id);
const view = new URLSearchParams(location.search).get('view');
document.body.dataset.view = view;
let pointer = false;
let audio;
let lastRows;
let creating = false;
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
  if (!$('instance-cwd').value) $('instance-cwd').value = value.defaultDirectory;
  const rows = JSON.stringify([value.sessions, value.selected, Boolean(value.serviceError)]);
  if (rows === lastRows) return;
  lastRows = rows;
  $('sessions').replaceChildren(
    ...value.sessions.map((s) => {
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
      b.append(element('span', name, 'session-name'), dot);
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
      return row;
    }),
  );
  if (!value.sessions.length) $('sessions').append(element('p', 'No instances yet.', 'empty'));
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
  $('instance-error').textContent = message || '';
  $('instance-error').hidden = !message;
}
function showCreate(open) {
  if (creating) return;
  $('create-form').hidden = !open;
  $('add').setAttribute('aria-expanded', String(open));
  api.createForm(open);
  showError('');
  if (open) $('instance-name').focus();
}
$('add').onclick = () => showCreate($('create-form').hidden);
$('cancel-create').onclick = () => showCreate(false);
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
    });
    if (result?.error) throw Error(result.error);
    creating = false;
    showCreate(false);
    $('instance-name').value = '';
  } catch (error) {
    showError(error.message);
  } finally {
    creating = false;
    for (const input of $('create-form').elements) input.disabled = false;
    $('create').textContent = 'Create and open';
  }
};
