const groups = require('./ui/groups.js');
function rectangles(sessions, bounds, mode = 'rank', minimum = { width: 1, height: 1 }) {
  if (!['rank', 'grid'].includes(mode)) throw Error('Choose a layout.');
  if (!sessions.length) return [];
  const maxColumns = Math.floor(bounds.width / minimum.width);
  if (maxColumns < 1) throw Error('This display is too narrow for a terminal.');
  function chunks(items, columns) {
    const size = Math.ceil(items.length / Math.ceil(items.length / columns));
    return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
      items.slice(i * size, (i + 1) * size),
    );
  }
  const rows =
    mode === 'rank'
      ? [...new Set(sessions.map((s) => s.rank))].flatMap((rank) =>
          chunks(
            sessions.filter((s) => s.rank === rank),
            maxColumns,
          ),
        )
      : chunks(sessions, Math.min(Math.ceil(Math.sqrt(sessions.length)), maxColumns));
  if (Math.floor(bounds.height / rows.length) < minimum.height)
    throw Error('These windows do not fit. Try Even grid or a smaller group.');
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
function groupPlan(sessions, root, mode, bounds, minimum) {
  const members = groups
    .members(sessions, root)
    .filter((s) => s.ownership === 'managed' && s.worker_state === 'running');
  if (!members.length) throw Error('This group has no running instances.');
  return rectangles(members, bounds, mode, minimum);
}
module.exports = { rectangles, groupPlan };
