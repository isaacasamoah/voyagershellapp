const groups = (() => {
  const order = ['admiral', 'commodore', 'captain', 'crew'];
  const compare = (a, b) =>
    (a.rank ? order.indexOf(a.rank) : 4) - (b.rank ? order.indexOf(b.rank) : 4) ||
    (a.registered_ms || 0) - (b.registered_ms || 0) ||
    a.id.localeCompare(b.id);
  function active(sessions) {
    return sessions.filter((s) => s.removed_ms == null);
  }
  function members(sessions, root = null) {
    const rows = active(sessions);
    if (root === null) return rows.sort(compare);
    if (!rows.some((s) => s.id === root)) throw Error('This group is no longer registered.');
    const ids = new Set([root]);
    for (let changed = true; changed;) {
      changed = false;
      for (const s of rows) {
        if (ids.has(s.supervisor_id) && !ids.has(s.id)) {
          ids.add(s.id);
          changed = true;
        }
      }
    }
    return rows.filter((s) => ids.has(s.id)).sort(compare);
  }
  function roots(sessions) {
    const rows = active(sessions);
    const ids = new Set(rows.map((s) => s.id));
    return rows.filter((s) => !ids.has(s.supervisor_id)).sort(compare);
  }
  function children(sessions, id) {
    return active(sessions)
      .filter((s) => s.supervisor_id === id)
      .sort(compare);
  }
  return { members, roots, children };
})();
if (typeof module !== 'undefined') module.exports = groups;
