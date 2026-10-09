const api = window.voyager;
const $ = (id) => document.getElementById(id);
let state,
  pointer = false;
function element(tag, text, className) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
}
api.onState((value) => {
  const focused = document.activeElement?.dataset.key;
  state = value;
  $('panel').hidden = !value.expanded;
  $('avatar').setAttribute('aria-expanded', String(value.expanded));
  $('avatar').dataset.state = value.dragging ? 'moving' : value.docked ? 'docked' : 'floating';
  document.body.dataset.connected = String(!value.serviceError);
  $('connection').textContent =
    value.serviceError || `Service running · ${value.service?.capturing ?? 0} sessions recording`;
  $('notice').textContent = value.platformError || value.notice;
  $('sessions').replaceChildren(
    ...value.sessions.map((s) => {
      const b = element('button', '', 'session');
      b.dataset.key = `session-${s.id}`;
      b.setAttribute('aria-pressed', String(s.id === value.selected));
      b.append(
        element('span', `${s.ownership === 'managed' ? 'worker' : 'lead'} · ${s.id.slice(0, 8)}`),
        element(
          'span',
          value.serviceError ? 'status unknown' : `${s.ownership} · ${s.capture}`,
          'state',
        ),
      );
      b.title = `${s.cwd}\nNative thread ${s.native_thread_id}`;
      b.onclick = () => api.select(s.id);
      return b;
    }),
  );
  if (!value.sessions.length) $('sessions').append(element('p', 'No sessions registered'));
  $('open-terminal').disabled =
    value.opening ||
    Boolean(value.serviceError) ||
    !value.sessions.some(
      (s) =>
        s.id === value.selected &&
        s.ownership === 'managed' &&
        s.worker_state === 'running' &&
        s.capture === 'connected',
    );
  $('open-terminal').textContent = value.opening ? 'Opening…' : 'Open demo terminal';
  $('undock').disabled = !value.docked;
  $('targets').replaceChildren(
    ...value.targets.map((t) => {
      const b = element('button', `Dock · window ${t.id.toString(16)}`);
      b.dataset.key = `window-${t.id}`;
      b.onclick = () => api.dock(t.id);
      return b;
    }),
  );
  const box = $('events'),
    bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  box.replaceChildren(
    ...value.events.map((e) => {
      const row = element('div', '', 'event');
      row.append(element('div', `#${e.sequence} · ${e.payload.role || e.type}`, 'kind'));
      row.append(element('p', e.type === 'message' ? e.payload.text : JSON.stringify(e.payload)));
      return row;
    }),
  );
  if (!value.events.length)
    box.append(element('p', 'Waiting for captured events from this session…'));
  if (bottom) box.scrollTop = box.scrollHeight;
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
  if (pointer) {
    pointer = false;
    api.cancelDrag();
  }
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
$('open-terminal').onclick = () => api.openTerminal(state.selected);
$('undock').onclick = () => api.undock();
$('quit').onclick = () => api.quit();
api.ready();
