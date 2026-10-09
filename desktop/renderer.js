const api = window.voyager;
const $ = (id) => document.getElementById(id);
let pointer = false;
function element(tag, text, className) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
}
api.onState((value) => {
  const focused = document.activeElement?.dataset.key;
  $('panel').hidden = !value.expanded;
  document.body.dataset.expanded = String(value.expanded);
  document.body.dataset.connected = String(!value.serviceError);
  $('avatar').setAttribute('aria-expanded', String(value.expanded));
  $('avatar').dataset.state = value.dragging ? 'moving' : value.docked ? 'docked' : 'floating';
  $('connection').textContent = value.serviceError ? 'Offline' : 'Online';
  $('avatar').title = value.platformError || value.dockError || '';
  document.body.dataset.dockError = String(Boolean(value.platformError || value.dockError));
  $('sessions').replaceChildren(
    ...value.sessions.map((s) => {
      const b = element('button', '', 'session');
      b.dataset.key = s.id;
      b.setAttribute('aria-pressed', String(s.id === value.selected));
      const name = element('span', '', 'session-name');
      name.append(
        element('span', 'Codex'),
        element('span', s.cwd.split('/').filter(Boolean).at(-1) || 'This computer', 'project'),
      );
      const status =
        value.serviceError || s.worker_state === 'unknown'
          ? 'Unknown'
          : ['stopped', 'exited'].includes(s.worker_state)
            ? 'Stopped'
            : s.capture === 'connected'
              ? 'Connected'
              : 'Disconnected';
      b.append(name, element('span', status, 'state'));
      b.dataset.connected = String(!value.serviceError && s.capture === 'connected');
      b.onclick = () => api.select(s.id);
      return b;
    }),
  );
  if (!value.sessions.length)
    $('sessions').append(element('p', 'No agents connected yet.', 'empty'));
  $('undock').hidden = !value.docked;
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
  $('avatar').setPointerCapture(event.pointerId);
  const b = $('avatar').getBoundingClientRect();
  api.beginDrag(event.clientX - b.left, event.clientY - b.top);
});
$('avatar').addEventListener('pointerup', (event) => {
  if (!pointer) return;
  pointer = false;
  $('avatar').releasePointerCapture(event.pointerId);
  api.endDrag();
});
$('avatar').addEventListener('pointercancel', () => {
  if (!pointer) return;
  pointer = false;
  api.cancelDrag();
});
$('avatar').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    api.toggle();
  }
  if (event.key === 'Escape' && pointer) {
    pointer = false;
    api.cancelDrag();
  }
});
$('undock').onclick = () => api.undock();
$('quit').onclick = () => api.quit();
api.ready();
