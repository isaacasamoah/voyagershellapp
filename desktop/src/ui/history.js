function createHistory(api, element, hierarchy) {
  const get = (id) => document.getElementById(id);
  const list = get('previous-sessions');
  let view = 'previous';
  const positions = new Map();
  let restoreScroll;
  const { menu, actions } = actionMenu('Previous vessels', 'history');
  const removed = element('button', 'Show removed vessels');
  removed.id = 'show-removed';
  actions.append(removed);
  get('history-options').append(menu);
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
    const all = hierarchy.historyOrder(groups[view]);
    get('previous-toggle').textContent = `Previous vessels (${groups.previous.length})`;
    removed.textContent = `Show removed vessels (${groups.removed.length})`;
    get('history-view').textContent = `Removed vessels (${groups.removed.length})`;
    get('history-view').hidden = view !== 'removed';
    get('previous-back').hidden = view !== 'removed';
    get('history-options').hidden = view === 'removed';
    list.setAttribute(
      'aria-label',
      view === 'removed' ? 'Removed vessels list' : 'Previous vessels list',
    );
    const scroll = restoreScroll ?? list.scrollTop;
    restoreScroll = undefined;
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
  function switchView(next) {
    positions.set(view, { shown, scroll: list.scrollTop });
    view = next;
    shown = positions.get(view)?.shown || batch;
    restoreScroll = positions.get(view)?.scroll || 0;
    token++;
    selected = null;
    details.hidden = true;
    redraw();
    get(view === 'removed' ? 'previous-back' : 'menu-history').focus();
  }
  removed.onclick = () => {
    actions.hidePopover();
    switchView('removed');
  };
  get('previous-back').onclick = () => switchView('previous');
  more.onclick = () => {
    shown += batch;
    redraw();
    if (more.hidden) list.lastElementChild?.querySelector('[id^="menu-"]')?.focus();
    else more.focus({ preventScroll: true });
  };
  get('previous-agents').ontoggle = redraw;
  async function read() {
    if (!selected || loading || current.state.serviceError) return;
    const hadFocus = document.activeElement === get('history-read');
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
        ? 'Read one saved portion. Continue for later events; other vessels may have occupied this portion.'
        : 'No later saved events. Missing capture does not mean no work occurred.';
      get('history-read').textContent = 'Read next portion';
    } catch (error) {
      if (requestToken === token) get('history-status').textContent = error.message;
    } finally {
      if (requestToken === token) {
        loading = false;
        const next = get('history-read');
        next.disabled = Boolean(current.state.serviceError);
        if (hadFocus && !next.disabled && document.activeElement === document.body)
          next.focus({ preventScroll: true });
      }
    }
  }
  function inspect(session, message) {
    selected = session;
    cursor = 0;
    loading = false;
    token++;
    const title = element('h3', session.name || 'Saved vessel');
    const metadata = element(
      'p',
      `${session.cwd}\n${session.id}\n${activity(session)}\n${session.lifecycle?.runtime || 'Runtime unverified'}${session.rank ? `\nRank: ${session.rank}` : ''}`,
      'saved-metadata',
    );
    const warning = element(
      'p',
      'History contains only events Voyager saved. Capture gaps and unavailable periods are shown in the saved events. An external process has no verified runtime ownership.',
    );
    if (message)
      metadata.textContent += `\n${message.full}${message.request ? `\nRequest: ${message.request}` : ''}`;
    if (session.resume?.reason) metadata.textContent += `\n${session.resume.reason}`;
    const status = element('p', 'Choose Read saved history to load a limited portion.');
    status.id = 'history-status';
    const events = element('div', '');
    events.id = 'history-events';
    const next = element('button', 'Read saved history');
    next.id = 'history-read';
    next.disabled = Boolean(current.state.serviceError);
    next.onclick = read;
    const close = element('button', 'Close details');
    close.id = 'history-close';
    close.onclick = () => {
      token++;
      details.hidden = true;
      const row = get(`menu-${session.id}`);
      const target = row?.closest('details:not([open])') ? get('previous-toggle') : row;
      (target || get('previous-toggle')).focus();
      selected = null;
    };
    details.replaceChildren(title, metadata, warning, status, events, next, close);
    details.hidden = false;
    next.focus();
  }
  function decorate(identity, session) {
    const folder = session.cwd?.split('/').filter(Boolean).at(-1) || 'Folder unavailable';
    const recorded = new Date(session.last_activity_ms);
    const date =
      Number.isFinite(session.last_activity_ms) && !Number.isNaN(recorded.getTime())
        ? recorded.toLocaleDateString()
        : 'Activity unavailable';
    const metadata = element('span', `${folder} · ${date}`, 'vessel-metadata');
    metadata.title = `${session.cwd || 'Folder unavailable'}\n${activity(session)}`;
    identity.append(metadata);
  }
  return { render, decorate, inspect };
}
