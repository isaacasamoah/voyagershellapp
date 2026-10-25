function createHistory(api, element, hierarchy) {
  const get = (id) => document.getElementById(id);
  const list = get('previous-sessions');
  const removed = get('show-removed');
  const more = get('previous-more');
  const details = get('agent-details');
  let current;
  let shown = 1;
  let batch = 1;
  let selected;
  let cursor = 0;
  let loading = false;
  let token = 0;
  function activity(session) {
    if (!Number.isFinite(session.last_activity_ms)) return 'Activity time unavailable';
    const date = new Date(session.last_activity_ms);
    return Number.isNaN(date.getTime())
      ? 'Activity time unavailable'
      : `Last activity: ${date.toLocaleString()}`;
  }
  function render(groups, rowFor, state) {
    current = { groups, rowFor, state };
    const all = hierarchy.historyOrder([
      ...groups.previous,
      ...(removed.checked ? groups.removed : []),
    ]);
    get('previous-toggle').textContent = `Previous agents (${groups.previous.length})`;
    get('removed-label').textContent = `Show removed records (${groups.removed.length})`;
    const scroll = list.scrollTop;
    const focus = document.activeElement?.id;
    list.replaceChildren(...all.slice(0, shown).map(rowFor));
    const flow = get('panel-flow').getBoundingClientRect?.().height || 0;
    const height = state.displayHeight || 600;
    const available = Math.max(40, Math.min(height * 0.35, height - flow + list.clientHeight - 96));
    list.style.maxHeight = `${available}px`;
    const rowHeight = list.firstElementChild?.getBoundingClientRect().height;
    if (rowHeight > 0) {
      batch = Math.max(1, Math.ceil(available / rowHeight));
      if (shown < batch) {
        shown = batch;
        list.replaceChildren(...all.slice(0, shown).map(rowFor));
      }
    }
    more.hidden = shown >= all.length;
    more.textContent = `Load more (${Math.max(0, all.length - shown)} remaining)`;
    list.scrollTop = scroll;
    if (focus) get(focus)?.focus({ preventScroll: true });
    if (selected) get('history-read').disabled = Boolean(state.serviceError) || loading;
  }
  function redraw() {
    if (current) render(current.groups, current.rowFor, current.state);
  }
  removed.onchange = () => {
    shown = batch;
    list.scrollTop = 0;
    redraw();
  };
  more.onclick = () => {
    shown += batch;
    redraw();
    if (more.hidden) list.lastElementChild?.querySelector('button')?.focus();
    else more.focus({ preventScroll: true });
  };
  get('previous-agents').ontoggle = redraw;
  async function read() {
    if (!selected || loading || current.state.serviceError) return;
    loading = true;
    const requestToken = token;
    get('history-read').disabled = true;
    try {
      const page = await api.instanceHistory(selected.id, cursor);
      if (requestToken !== token) return;
      if (page.error) throw Error(page.error);
      if (!Number.isSafeInteger(page.cursor) || page.cursor < cursor)
        throw Error('History position was not valid.');
      const advanced = page.cursor > cursor;
      cursor = page.cursor;
      for (const event of page.events) {
        const line = element(
          'pre',
          `${event.type}\n${JSON.stringify(event.payload, null, 2)}`,
          'saved-event',
        );
        get('history-events').append(line);
      }
      get('history-status').textContent = advanced
        ? 'Read one saved portion. Continue for later events; other agents may have occupied this portion.'
        : 'No later saved events. Missing capture does not mean no work occurred.';
      get('history-read').textContent = 'Read next portion';
    } catch (error) {
      if (requestToken === token) get('history-status').textContent = error.message;
    } finally {
      if (requestToken === token) {
        loading = false;
        get('history-read').disabled = Boolean(current.state.serviceError);
      }
    }
  }
  function inspect(session) {
    selected = session;
    cursor = 0;
    loading = false;
    token++;
    const title = element('h3', session.name || 'Saved agent');
    const metadata = element(
      'p',
      `${session.cwd}\n${session.id}\n${activity(session)}\n${session.lifecycle?.runtime || 'Runtime unverified'}`,
      'saved-metadata',
    );
    const warning = element(
      'p',
      'History contains only events Voyager saved. Capture gaps and unavailable periods are shown in the saved events. An external process has no verified runtime ownership.',
    );
    const status = element('p', 'Choose Read saved history to load a limited portion.');
    status.id = 'history-status';
    const events = element('div', '');
    events.id = 'history-events';
    const next = element('button', 'Read saved history');
    next.id = 'history-read';
    next.disabled = Boolean(current.state.serviceError);
    next.onclick = read;
    const close = element('button', 'Close details');
    close.onclick = () => {
      token++;
      details.hidden = true;
      get(`inspect-${session.id}`)?.focus();
      selected = null;
    };
    details.replaceChildren(title, metadata, warning, status, events, next, close);
    details.hidden = false;
    next.focus();
  }
  function decorate(row, session) {
    const metadata = element('p', `${session.cwd}\n${activity(session)}`, 'saved-metadata');
    const button = element('button', 'Inspect');
    button.id = `inspect-${session.id}`;
    button.onclick = () => inspect(session);
    row.append(metadata, button);
  }
  return { render, decorate };
}
