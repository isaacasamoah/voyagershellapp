const hierarchy = require('./ui/hierarchy.js');
function rectangles(sessions, bounds, minimum = { width: 1, height: 1 }) {
  if (!sessions.length) return [];
  const maxColumns = Math.floor(bounds.width / minimum.width);
  if (maxColumns < 1) throw Error('This display is too narrow for a terminal.');
  function chunks(items, columns) {
    const size = Math.ceil(items.length / Math.ceil(items.length / columns));
    return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
      items.slice(i * size, (i + 1) * size),
    );
  }
  const rows = [...new Set(sessions.map((s) => s.rank))].flatMap((rank) =>
    chunks(
      sessions.filter((s) => s.rank === rank),
      maxColumns,
    ),
  );
  if (Math.floor(bounds.height / rows.length) < minimum.height)
    throw Error('These vessels do not fit on this display. Try a smaller fleet.');
  return rows.flatMap((row, y) =>
    row.map((s, x) => ({
      session: s.id,
      x: bounds.x + Math.round((bounds.width * x) / row.length),
      y: bounds.y + Math.round((bounds.height * y) / rows.length),
      width:
        Math.round((bounds.width * (x + 1)) / row.length) -
        Math.round((bounds.width * x) / row.length),
      height:
        Math.round((bounds.height * (y + 1)) / rows.length) -
        Math.round((bounds.height * y) / rows.length),
    })),
  );
}
function vesselPlan(sessions, ids, bounds, minimum) {
  const members = hierarchy
    .members(sessions)
    .filter((s) => ids.includes(s.id) && s.ownership === 'managed' && s.worker_state === 'running');
  if (!members.length) throw Error('No running vessels to surface.');
  return rectangles(members, bounds, minimum);
}
module.exports = { rectangles, vesselPlan };
