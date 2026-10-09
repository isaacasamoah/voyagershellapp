import { emptyBoard, validateBoard } from './model.mjs';
const svg = document.getElementById('board'),
  ns = 'http://www.w3.org/2000/svg';
const editor = document.getElementById('editor');
let canvasSize = { width: innerWidth, height: innerHeight };
let board = emptyBoard(),
  history = [],
  tool = 'pen',
  gesture = null,
  from = null;
let nodes = new Set(),
  strokes = new Set(),
  editing = null;
const count = () => nodes.size + strokes.size;
const single = () =>
  count() === 1 && nodes.size === 1 ? board.nodes.find((n) => nodes.has(n.id)) : null;
const clearSelection = () => {
  nodes.clear();
  strokes.clear();
};
function hint(text) {
  document.getElementById('hint').textContent = text;
}
function element(tag, attrs = {}, text) {
  const el = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}
function checkpoint() {
  history.push(structuredClone(board));
  if (history.length > 30) history.shift();
}
function render() {
  svg.replaceChildren();
  const defs = element('defs'),
    marker = element('marker', {
      id: 'arrowhead',
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: 'auto-start-reverse',
    });
  marker.append(element('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#527d72' }));
  defs.append(marker);
  svg.append(defs);
  board.strokes.forEach((stroke, i) =>
    svg.append(
      element('polyline', {
        'data-stroke': i,
        points: stroke.map((p) => p.join(',')).join(' '),
        fill: 'none',
        stroke: strokes.has(i) ? '#56c5ff' : '#d08a42',
        'stroke-width': strokes.has(i) ? 5 : 3,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ),
  );
  for (const edge of board.edges) {
    const a = board.nodes.find((n) => n.id === edge.from),
      b = board.nodes.find((n) => n.id === edge.to),
      dx = b.x - a.x,
      dy = b.y - a.y;
    const scale = 1 / Math.max(Math.abs(dx) / (b.width / 2), Math.abs(dy) / (b.height / 2), 1);
    svg.append(
      element('line', {
        x1: a.x,
        y1: a.y,
        x2: b.x - dx * scale,
        y2: b.y - dy * scale,
        stroke: '#527d72',
        'stroke-width': 2,
        'marker-end': 'url(#arrowhead)',
        'pointer-events': 'none',
      }),
    );
  }
  for (const n of board.nodes) {
    const g = element('g', { 'data-node': n.id, role: 'button', 'aria-label': n.label });
    g.append(
      element('rect', {
        x: n.x - n.width / 2,
        y: n.y - n.height / 2,
        width: n.width,
        height: n.height,
        rx: 12,
        fill: n.kind === 'box' ? '#eef3e8' : 'transparent',
        stroke: nodes.has(n.id)
          ? '#56c5ff'
          : from === n.id
            ? '#d08a42'
            : n.kind === 'box'
              ? '#88a695'
              : 'none',
        'stroke-width': nodes.has(n.id) ? 3 : 2,
      }),
    );
    const t = element(
      'text',
      {
        x: n.x,
        y: n.y + 6,
        'text-anchor': 'middle',
        fill: n.kind === 'text' ? '#fffdf7' : '#273d3b',
        stroke: n.kind === 'text' ? '#183c34' : 'none',
        'stroke-width': 2,
        'paint-order': 'stroke',
        'font-size': 18,
        'font-family': 'sans-serif',
        visibility: editing?.id === n.id ? 'hidden' : 'visible',
      },
      n.label,
    );
    if (n.label.length * 10 > n.width - 20) {
      t.setAttribute('textLength', String(n.width - 20));
      t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
    g.append(t);
    if (single()?.id === n.id)
      for (const [key, sx, sy] of [
        ['nw', -1, -1],
        ['ne', 1, -1],
        ['sw', -1, 1],
        ['se', 1, 1],
      ])
        g.append(
          element('rect', {
            'data-resize': key,
            'data-selection': 'true',
            x: n.x + (sx * n.width) / 2 - 6,
            y: n.y + (sy * n.height) / 2 - 6,
            width: 12,
            height: 12,
            fill: '#fff',
            stroke: '#277eaf',
            'stroke-width': 2,
          }),
        );
    svg.append(g);
  }
  if (gesture?.type === 'marquee') {
    const { start, p } = gesture;
    svg.append(
      element('rect', {
        'data-selection': 'true',
        x: Math.min(start[0], p[0]),
        y: Math.min(start[1], p[1]),
        width: Math.abs(start[0] - p[0]),
        height: Math.abs(start[1] - p[1]),
        fill: '#56c5ff22',
        stroke: '#56c5ff',
        'stroke-dasharray': '5 4',
        'pointer-events': 'none',
      }),
    );
  }
  window.dispatchEvent(
    new CustomEvent('whiteboard-report', {
      detail: {
        nodes: board.nodes.length,
        edges: board.edges.length,
        strokes: board.strokes.length,
        canUndo: history.length > 0,
        selectedCount: count(),
      },
    }),
  );
}
const position = (e) => [
  Math.max(0, Math.min(innerWidth, e.clientX)),
  Math.max(0, Math.min(innerHeight, e.clientY)),
];
function cancelGesture() {
  if (!gesture) return;
  if (gesture.before) board = gesture.before;
  if (gesture.checkpoint) history.pop();
  if (svg.hasPointerCapture(gesture.pointer)) svg.releasePointerCapture(gesture.pointer);
  gesture = null;
}
function commitEditor() {
  if (!editing) return;
  const n = board.nodes.find((n) => n.id === editing.id);
  const created = editing.created;
  editing = null;
  editor.hidden = true;
  if (n && n.label !== editor.value) {
    if (!created) checkpoint();
    n.label = editor.value;
  }
  render();
}
function startEditor(id, created = false) {
  commitEditor();
  cancelGesture();
  const n = board.nodes.find((n) => n.id === id);
  if (!n) return;
  clearSelection();
  nodes.add(id);
  editing = { id, created };
  editor.value = n.label;
  editor.placeholder = 'Type here…';
  editor.dataset.kind = n.kind;
  editor.hidden = false;
  Object.assign(editor.style, {
    left: `${n.x - n.width / 2}px`,
    top: `${n.y - n.height / 2}px`,
    width: `${n.width}px`,
    height: `${n.height}px`,
  });
  render();
  editor.focus();
  editor.select();
  hint('Type directly here · Enter or click outside to finish · double-click to edit again');
}
window.whiteboard = {
  snapshot: () => {
    commitEditor();
    return structuredClone(board);
  },
  image: () =>
    new Promise((resolve, reject) => {
      const copy = svg.cloneNode(true);
      copy.querySelectorAll('[data-selection]').forEach((e) => e.remove());
      const { width, height } = canvasSize;
      copy.setAttribute('width', String(width));
      copy.setAttribute('height', String(height));
      copy.setAttribute('xmlns', ns);
      const url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }),
        ),
        image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(image, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(Error('Image export failed'));
      };
      image.src = url;
    }),
  command: (command) => {
    commitEditor();
    cancelGesture();
    from = null;
    if (command.action === 'tool') {
      tool = command.tool;
      canvasSize = command.canvas;
      clearSelection();
    }
    if (command.action === 'undo' && history.length) {
      board = history.pop();
      clearSelection();
    }
    if (command.action === 'clear') {
      checkpoint();
      board = emptyBoard();
      clearSelection();
    }
    if (command.action === 'delete' && count()) {
      checkpoint();
      board.nodes = board.nodes.filter((n) => !nodes.has(n.id));
      board.edges = board.edges.filter((e) => !nodes.has(e.from) && !nodes.has(e.to));
      board.strokes = board.strokes.filter((_, i) => !strokes.has(i));
      clearSelection();
    }
    if (command.action === 'import') {
      const next = validateBoard(command.board);
      checkpoint();
      board = next;
      clearSelection();
    }
    render();
    hint(
      tool === 'select'
        ? 'Drag around items to select · Shift-click adds or removes · drag a selection to move it'
        : tool === 'arrow'
          ? 'Click the source item, then its destination'
          : 'Draw on the desktop · Escape returns to your apps',
    );
  },
};
svg.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || gesture) return;
  commitEditor();
  const p = position(event),
    id = event.target.closest('[data-node]')?.dataset.node;
  const stroke = event.target.closest('[data-stroke]')?.dataset.stroke;
  if (tool === 'arrow') {
    if (!id) return;
    if (!from) from = id;
    else if (from !== id) {
      if (!board.edges.some((e) => e.from === from && e.to === id)) {
        checkpoint();
        board.edges.push({ from, to: id });
      }
      from = null;
    }
    render();
    return;
  }
  const resize = event.target.dataset.resize;
  if (id || stroke !== undefined) {
    const set = id ? nodes : strokes,
      key = id ?? Number(stroke);
    if (event.shiftKey) {
      set.has(key) ? set.delete(key) : set.add(key);
      render();
      return;
    }
    if (!set.has(key)) {
      clearSelection();
      set.add(key);
    }
    const before = structuredClone(board);
    if (resize) {
      const n = single();
      gesture = {
        type: 'resize',
        pointer: event.pointerId,
        before,
        id: n.id,
        corner: resize,
        anchor: [
          n.x + ((resize.includes('w') ? 1 : -1) * n.width) / 2,
          n.y + ((resize.includes('n') ? 1 : -1) * n.height) / 2,
        ],
      };
    } else gesture = { type: 'move', pointer: event.pointerId, before, start: p };
    svg.setPointerCapture(event.pointerId);
    render();
    return;
  }
  clearSelection();
  if (tool === 'box' || tool === 'text') {
    event.preventDefault();
    checkpoint();
    const n = {
      id: `n${crypto.randomUUID()}`,
      kind: tool,
      label: '',
      x: Math.max(100, Math.min(innerWidth - 100, p[0])),
      y: Math.max(32, Math.min(innerHeight - 32, p[1])),
      width: 200,
      height: 64,
    };
    board.nodes.push(n);
    startEditor(n.id, true);
    return;
  }
  const before = structuredClone(board);
  if (tool === 'pen') {
    checkpoint();
    board.strokes.push([p, p]);
    gesture = { type: 'pen', pointer: event.pointerId, before, checkpoint: true };
  } else gesture = { type: 'marquee', pointer: event.pointerId, start: p, p };
  svg.setPointerCapture(event.pointerId);
  render();
});
svg.addEventListener('pointermove', (event) => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const p = position(event),
    g = gesture;
  if (g.type === 'pen') board.strokes.at(-1).push(p);
  if (g.type === 'marquee') g.p = p;
  if (g.type === 'move') {
    let dx = p[0] - g.start[0],
      dy = p[1] - g.start[1];
    const xs = [],
      ys = [];
    g.before.nodes
      .filter((n) => nodes.has(n.id))
      .forEach((n) => {
        xs.push(n.x - n.width / 2, n.x + n.width / 2);
        ys.push(n.y - n.height / 2, n.y + n.height / 2);
      });
    g.before.strokes.forEach((s, i) => {
      if (strokes.has(i))
        s.forEach((pt) => {
          xs.push(pt[0]);
          ys.push(pt[1]);
        });
    });
    dx = Math.max(-Math.min(...xs), Math.min(innerWidth - Math.max(...xs), dx));
    dy = Math.max(-Math.min(...ys), Math.min(innerHeight - Math.max(...ys), dy));
    board = structuredClone(g.before);
    board.nodes
      .filter((n) => nodes.has(n.id))
      .forEach((n) => {
        n.x += dx;
        n.y += dy;
      });
    board.strokes = board.strokes.map((s, i) =>
      strokes.has(i) ? s.map((pt) => [pt[0] + dx, pt[1] + dy]) : s,
    );
  }
  if (g.type === 'resize') {
    const n = board.nodes.find((n) => n.id === g.id),
      sx = g.corner.includes('w') ? -1 : 1,
      sy = g.corner.includes('n') ? -1 : 1;
    n.width = Math.max(40, Math.min(4096, sx * (p[0] - g.anchor[0])));
    n.height = Math.max(32, Math.min(4096, sy * (p[1] - g.anchor[1])));
    n.x = g.anchor[0] + (sx * n.width) / 2;
    n.y = g.anchor[1] + (sy * n.height) / 2;
  }
  render();
});
svg.addEventListener('pointerup', (event) => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const g = gesture;
  if (g.type === 'marquee') {
    const left = Math.min(g.start[0], g.p[0]),
      right = Math.max(g.start[0], g.p[0]),
      top = Math.min(g.start[1], g.p[1]),
      bottom = Math.max(g.start[1], g.p[1]);
    board.nodes.forEach((n) => {
      if (
        n.x - n.width / 2 >= left &&
        n.x + n.width / 2 <= right &&
        n.y - n.height / 2 >= top &&
        n.y + n.height / 2 <= bottom
      )
        nodes.add(n.id);
    });
    board.strokes.forEach((s, i) => {
      if (s.every((p) => p[0] >= left && p[0] <= right && p[1] >= top && p[1] <= bottom))
        strokes.add(i);
    });
  } else if (!g.checkpoint && JSON.stringify(board) !== JSON.stringify(g.before)) {
    history.push(g.before);
    if (history.length > 30) history.shift();
  }
  gesture = null;
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  render();
});
svg.addEventListener('pointercancel', () => {
  cancelGesture();
  render();
});
svg.addEventListener('mousedown', (event) => {
  if (event.detail !== 2) return;
  event.preventDefault();
  cancelGesture();
  // Pointer capture and selection redraws can make SVG itself the click target.
  const [x, y] = position(event);
  const n = [...board.nodes]
    .reverse()
    .find(
      (n) =>
        x >= n.x - n.width / 2 &&
        x <= n.x + n.width / 2 &&
        y >= n.y - n.height / 2 &&
        y <= n.y + n.height / 2,
    );
  if (!n) return;
  startEditor(n.id);
});
editor.addEventListener('blur', commitEditor);
editor.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitEditor();
  }
});
window.addEventListener('keydown', (event) => {
  if (
    (event.key === 'Delete' || event.key === 'Backspace') &&
    !event.target.closest('input,textarea')
  ) {
    event.preventDefault();
    window.whiteboard.command({ action: 'delete' });
  }
});
window.addEventListener('whiteboard-command', (event) => window.whiteboard.command(event.detail));
render();
