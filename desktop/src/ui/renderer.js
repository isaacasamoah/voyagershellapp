const api = window.voyager;
const $ = (id) => document.getElementById(id);
const view = new URLSearchParams(location.search).get('view');
document.body.dataset.view = view;
let pointer = false;
let audio;
let lastRows;
api.onDrawingCommand((command) =>
  window.dispatchEvent(new CustomEvent('whiteboard-command', { detail: command })),
);
window.addEventListener('whiteboard-report', (event) => api.drawingReport(event.detail));
window.addEventListener('keydown', (event) => {
  if (view === 'panel' && event.key === 'Escape') api.whiteboard({ action: 'hide' });
});
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
  document.body.dataset.capturing = String(Boolean(value.whiteboard?.capturing));
  document.body.dataset.seated = String(value.seated);
  document.body.dataset.connected = String(!value.serviceError);
  $('avatar').setAttribute('aria-expanded', String(value.expanded));
  $('avatar').dataset.state = value.dragging ? 'moving' : value.docked ? 'docked' : 'floating';
  $('connection').textContent = value.serviceError ? 'Offline' : 'Online';
  $('avatar').title = value.platformError || value.dockError || '';
  document.body.dataset.dockError = String(Boolean(value.platformError || value.dockError));
  if (view !== 'panel') return;
  const drawing = value.whiteboard;
  $('wb-toggle').setAttribute('aria-expanded', String(value.whiteboardExpanded));
  $('wb-tools').hidden = !value.whiteboardExpanded;
  if (drawing) {
    document.body.dataset.drawing = String(drawing.active);
    $('drawing').hidden = !drawing.active;
    const bounds = drawing.sidebar;
    Object.assign(
      $('voyager-ui').style,
      drawing.active
        ? {
            left: `${bounds.x}px`,
            top: `${bounds.y}px`,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
          }
        : { left: '0', top: '0', width: '100%', height: '100%' },
    );
    for (const button of document.querySelectorAll('[data-drawing-tool]'))
      button.setAttribute(
        'aria-pressed',
        String(drawing.active && drawing.tool === button.dataset.drawingTool),
      );
    $('wb-snip').disabled = drawing.capturing;
    $('wb-delete').disabled = !drawing.selectedCount;
    $('wb-undo').disabled = !drawing.canUndo;
    $('wb-hide').disabled = !drawing.active;
    $('wb-status').hidden = !drawing.error;
    $('wb-status').textContent = drawing.error;
  }
  $('undock').hidden = !value.docked;
  const rows = JSON.stringify([value.sessions, value.selected, Boolean(value.serviceError)]);
  if (rows === lastRows) return;
  lastRows = rows;
  $('sessions').replaceChildren(
    ...value.sessions.map((s) => {
      const b = element('button', '', 'session');
      b.dataset.key = s.id;
      b.setAttribute('aria-pressed', String(s.id === value.selected));
      const name = s.cwd.split('/').filter(Boolean).at(-1) || 'This computer';
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
      return b;
    }),
  );
  if (!value.sessions.length)
    $('sessions').append(element('p', 'No agents connected yet.', 'empty'));
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
$('undock').onclick = () => api.undock();
$('quit').onclick = () => api.quit();
$('wb-toggle').onclick = () =>
  api.expandWhiteboard($('wb-toggle').getAttribute('aria-expanded') !== 'true');
for (const button of document.querySelectorAll('[data-drawing-tool]'))
  button.onclick = () => api.whiteboard({ action: 'tool', tool: button.dataset.drawingTool });
for (const [id, action] of Object.entries({
  'wb-hide': 'hide',
  'wb-snip': 'snip',
  'wb-undo': 'undo',
  'wb-clear': 'clear',
  'wb-delete': 'delete',
}))
  $(id).onclick = () => api.whiteboard({ action });
api.ready();
