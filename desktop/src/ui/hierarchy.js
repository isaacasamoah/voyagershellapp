const hierarchy = (() => {
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
    if (!rows.some((s) => s.id === root)) throw Error('This vessel is no longer registered.');
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
  function fleetOf(id, sessions, assignments) {
    const seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      if (Object.hasOwn(assignments, id)) return assignments[id];
      id = sessions.find((s) => s.id === id)?.supervisor_id;
    }
    return null;
  }
  return { members, roots, children, fleetOf };
})();
if (typeof module !== 'undefined') module.exports = hierarchy;
