import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBoard, validateBoard, toMermaid } from '../src/ui/whiteboard/model.mjs';
test('agent-edited graph round trips and exports explicit relationships, not inferred strokes', () => {
  const board = {
    ...emptyBoard(),
    nodes: [
      { id: 'n1', kind: 'box', label: 'Claude "plan"', x: 100, y: 100, width: 200, height: 64 },
      { id: 'n2', kind: 'box', label: 'Voyager', x: 400, y: 100, width: 200, height: 64 },
    ],
    edges: [{ from: 'n1', to: 'n2' }],
    strokes: [
      [
        [1, 1],
        [2, 2],
      ],
    ],
  };
  assert.deepEqual(validateBoard(JSON.parse(JSON.stringify(board))), board);
  assert.match(toMermaid(board), /N0 --> N1/);
  assert.match(toMermaid(board), /#34;plan#34;/);
  assert.match(toMermaid(board), /Freehand strokes omitted/);
  assert.throws(() => validateBoard({ ...board, edges: [{ from: 'n1', to: 'missing' }] }));
  assert.throws(() => validateBoard({ ...board, nodes: [board.nodes[0], board.nodes[0]] }));
  assert.throws(() =>
    validateBoard({
      ...board,
      strokes: [
        [
          [NaN, 0],
          [1, 1],
        ],
      ],
    }),
  );
});
