export const emptyBoard = () => ({ version: 1, nodes: [], edges: [], strokes: [] });
export function validateBoard(board) {
  const fail = () => {
    throw new Error(
      'Not a supported board. Expected version 1 with valid nodes, edges and strokes.',
    );
  };
  const coord = (n) => Number.isFinite(n) && n >= 0 && n <= 32768;
  const point = (p) => Array.isArray(p) && p.length === 2 && p.every(coord);
  if (
    !board ||
    board.version !== 1 ||
    !['nodes', 'edges', 'strokes'].every((k) => Array.isArray(board[k]) && board[k].length <= 1000)
  )
    fail();
  const ids = new Set();
  for (const n of board.nodes) {
    if (
      !n ||
      typeof n.id !== 'string' ||
      !/^n[\w-]{1,80}$/.test(n.id) ||
      ids.has(n.id) ||
      !['box', 'text'].includes(n.kind) ||
      typeof n.label !== 'string' ||
      n.label.length > 120 ||
      !coord(n.x) ||
      !coord(n.y) ||
      !Number.isFinite(n.width ?? 200) ||
      (n.width ?? 200) < 40 ||
      (n.width ?? 200) > 4096 ||
      !Number.isFinite(n.height ?? 64) ||
      (n.height ?? 64) < 32 ||
      (n.height ?? 64) > 4096
    )
      fail();
    ids.add(n.id);
  }
  for (const e of board.edges)
    if (!e || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to) fail();
  let points = 0;
  for (const s of board.strokes) {
    if (!Array.isArray(s) || s.length < 2 || !s.every(point)) fail();
    points += s.length;
    if (points > 100000) fail();
  }
  // Copy just the supported fields: imported files never carry executable markup.
  return {
    version: 1,
    nodes: board.nodes.map(({ id, kind, label, x, y, width = 200, height = 64 }) => ({
      id,
      kind,
      label,
      x,
      y,
      width: width ?? 200,
      height: height ?? 64,
    })),
    edges: board.edges.map(({ from, to }) => ({ from, to })),
    strokes: board.strokes.map((s) => s.map((p) => [...p])),
  };
}
export function toMermaid(board) {
  const label = (s) =>
    s
      .replaceAll('&', '#38;')
      .replaceAll('"', '#34;')
      .replaceAll('<', '#60;')
      .replaceAll('>', '#62;')
      .replace(/[\r\n]/g, ' ');
  const ids = new Map(board.nodes.map((n, i) => [n.id, `N${i}`]));
  return (
    [
      'flowchart LR',
      ...board.nodes.map((n) => `  ${ids.get(n.id)}["${label(n.label)}"]`),
      ...board.edges.map((e) => `  ${ids.get(e.from)} --> ${ids.get(e.to)}`),
      ...(board.strokes.length
        ? ['  %% Freehand strokes omitted; inspect the board image to interpret them.']
        : []),
    ].join('\n') + '\n'
  );
}
