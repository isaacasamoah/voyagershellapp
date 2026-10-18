const hierarchy = require('./ui/hierarchy.js');
function rectangles(sessions, bounds, minimum = { width: 1, height: 1 }) {
  if (!sessions.length) return [];
  let cells;
  if (sessions.length === 1) cells = [[0, 0, 1, 1]];
  else if (sessions.length === 2)
    cells = [
      [0, 0, 0.5, 1],
      [0.5, 0, 1, 1],
    ];
  else if (sessions.length === 3)
    cells = [
      [0, 0, 0.5, 1],
      [0.5, 0, 1, 0.5],
      [0.5, 0.5, 1, 1],
    ];
  else {
    const columns = Math.min(
      Math.ceil(Math.sqrt(sessions.length)),
      Math.floor(bounds.width / minimum.width),
    );
    if (columns < 1) throw Error('This display is too narrow for a terminal.');
    const rows = Math.ceil(sessions.length / columns);
    cells = sessions.map((_, index) => {
      const x = index % columns,
        y = Math.floor(index / columns);
      return [x / columns, y / rows, (x + 1) / columns, (y + 1) / rows];
    });
  }
  return cells.map(([left, top, right, bottom], index) => {
    const x = bounds.x + Math.round(bounds.width * left);
    const y = bounds.y + Math.round(bounds.height * top);
    const width = Math.round(bounds.width * right) - Math.round(bounds.width * left);
    const height = Math.round(bounds.height * bottom) - Math.round(bounds.height * top);
    if (width < minimum.width || height < minimum.height)
      throw Error('These vessels do not fit on this display. Try a smaller fleet.');
    return { session: sessions[index].id, x, y, width, height };
  });
}
function vesselPlan(sessions, ids, bounds, minimum) {
  const members = hierarchy
    .members(sessions)
    .filter((s) => ids.includes(s.id) && s.ownership === 'managed' && s.worker_state === 'running');
  if (!members.length) throw Error('No running vessels to surface.');
  return rectangles(members, bounds, minimum);
}
module.exports = { rectangles, vesselPlan };
