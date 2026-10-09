import { emptyBoard, validateBoard, toMermaid } from './model.mjs';
const $ = (id) => document.getElementById(id);
const svg = $('board');
let board = emptyBoard(),
  history = [],
  tool = 'pen',
  gesture = null,
  from = null;
const ns = 'http://www.w3.org/2000/svg';
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
function hint(text) {
  $('hint').textContent = text;
}
function render() {
  svg.replaceChildren();
  svg.append(element('rect', { width: 1400, height: 800, fill: '#fffdf7' }));
  const defs = element('defs');
  const marker = element('marker', {
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
  for (const stroke of board.strokes)
    svg.append(
      element('polyline', {
        points: stroke.map((p) => p.join(',')).join(' '),
        fill: 'none',
        stroke: '#d08a42',
        'stroke-width': 3,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    );
  for (const edge of board.edges) {
    const a = board.nodes.find((n) => n.id === edge.from),
      b = board.nodes.find((n) => n.id === edge.to);
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const scale = 1 / Math.max(Math.abs(dx) / 100, Math.abs(dy) / 32, 1);
    svg.append(
      element('line', {
        x1: a.x,
        y1: a.y,
        x2: b.x - dx * scale,
        y2: b.y - dy * scale,
        stroke: '#527d72',
        'stroke-width': 2,
        'marker-end': 'url(#arrowhead)',
      }),
    );
  }
  for (const n of board.nodes) {
    const g = element('g', {
      'data-node': n.id,
      role: 'button',
      'aria-label': n.label,
      tabindex: 0,
    });
    g.append(
      element('rect', {
        x: n.x - 100,
        y: n.y - 32,
        width: 200,
        height: 64,
        rx: 12,
        fill: n.kind === 'box' ? '#eef3e8' : '#fffdf7',
        stroke: from === n.id ? '#d08a42' : n.kind === 'box' ? '#88a695' : 'none',
        'stroke-width': 2,
      }),
    );
    const label = element(
      'text',
      {
        x: n.x,
        y: n.y + 6,
        'text-anchor': 'middle',
        fill: '#273d3b',
        'font-size': 18,
        'font-family': 'sans-serif',
      },
      n.label,
    );
    if (n.label.length > 20) {
      label.setAttribute('textLength', '180');
      label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
    g.append(label);
    svg.append(g);
  }
  $('count').textContent =
    `${board.nodes.length} ideas · ${board.edges.length} connections · ${board.strokes.length} strokes`;
  $('undo').disabled = !history.length;
}
function position(event) {
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
    svg.getScreenCTM().inverse(),
  );
  return [Math.max(0, Math.min(1400, p.x)), Math.max(0, Math.min(800, p.y))];
}
for (const button of document.querySelectorAll('[data-tool]'))
  button.addEventListener('click', () => {
    tool = button.dataset.tool;
    from = null;
    for (const b of document.querySelectorAll('[data-tool]'))
      b.setAttribute('aria-pressed', String(b === button));
    hint(
      {
        pen: 'Drag to draw.',
        box: 'Set a label, then click to place a box.',
        text: 'Set a label, then click to place text.',
        arrow: 'Click the source item, then its destination.',
        move: 'Drag a labelled item. Connections follow it.',
      }[tool],
    );
    render();
  });
svg.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || gesture) return;
  const p = position(event),
    id = event.target.closest('[data-node]')?.dataset.node;
  if (tool === 'arrow') {
    if (!id) return;
    if (!from) {
      from = id;
      hint('Now click the destination.');
    } else if (from !== id) {
      if (!board.edges.some((e) => e.from === from && e.to === id)) {
        checkpoint();
        board.edges.push({ from, to: id });
      }
      from = null;
      hint('Connection added. Click another source.');
    }
    render();
    return;
  }
  if (tool === 'box' || tool === 'text') {
    const label = $('label').value.trim();
    if (!label) {
      hint('Give this idea a label first.');
      return;
    }
    checkpoint();
    board.nodes.push({
      id: `n${crypto.randomUUID()}`,
      kind: tool,
      label,
      x: Math.max(105, Math.min(1295, p[0])),
      y: Math.max(35, Math.min(765, p[1])),
    });
    render();
    return;
  }
  if (tool === 'move' && !id) return;
  checkpoint();
  svg.setPointerCapture(event.pointerId);
  if (tool === 'pen') {
    board.strokes.push([p, p]);
    gesture = { type: 'pen', pointer: event.pointerId };
  } else {
    const n = board.nodes.find((n) => n.id === id);
    gesture = { type: 'move', id, offset: [n.x - p[0], n.y - p[1]], pointer: event.pointerId };
  }
  render();
});
svg.addEventListener('pointermove', (event) => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const p = position(event);
  if (gesture.type === 'pen') board.strokes.at(-1).push(p);
  else {
    const n = board.nodes.find((n) => n.id === gesture.id);
    n.x = Math.max(105, Math.min(1295, p[0] + gesture.offset[0]));
    n.y = Math.max(35, Math.min(765, p[1] + gesture.offset[1]));
  }
  render();
});
function finish(event) {
  if (gesture?.pointer === event.pointerId) {
    gesture = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }
}
svg.addEventListener('pointerup', finish);
svg.addEventListener('pointercancel', finish);
$('undo').addEventListener('click', () => {
  if (history.length) {
    board = history.pop();
    from = null;
    gesture = null;
    render();
    hint('Undid the last change.');
  }
});
$('fullscreen').addEventListener('click', () =>
  document
    .querySelector('.sheet')
    .requestFullscreen()
    .catch((e) => hint(e.message)),
);
function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  hint(`Export requested: ${name}`);
}
$('json').addEventListener('click', () =>
  download(
    'voyager-board.json',
    new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' }),
  ),
);
$('mermaid').addEventListener('click', () => {
  download('voyager-board.mmd', new Blob([toMermaid(board)], { type: 'text/plain' }));
  if (board.strokes.length)
    hint('Mermaid exported. Freehand marks are omitted; share the image too.');
});
$('png').addEventListener('click', () => {
  const image = new Image();
  const copy = svg.cloneNode(true);
  copy.setAttribute('width', '1400');
  copy.setAttribute('height', '800');
  copy.setAttribute('xmlns', ns);
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }),
  );
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 800;
    canvas.getContext('2d').drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (blob) download('voyager-board.png', blob);
      else hint('Image export failed.');
    }, 'image/png');
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    hint('Image export failed. Save the board file instead.');
  };
  image.src = url;
});
$('open').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw Error('Board files must be under 5 MB.');
    const next = validateBoard(JSON.parse(await file.text()));
    checkpoint();
    board = next;
    from = null;
    render();
    hint('Board opened. Undo returns to the previous canvas.');
  } catch (e) {
    hint(`Could not open board: ${e.message}`);
  }
  event.target.value = '';
});
render();
