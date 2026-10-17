const { test } = require('node:test');
const assert = require('node:assert/strict');
const groups = require('../src/ui/groups.js');
const { groupPlan } = require('../src/layout.cjs');
const base = { ownership: 'managed', worker_state: 'running' };
const sessions = [
  { ...base, id: 'crew', rank: 'crew', supervisor_id: 'captain' },
  { ...base, id: 'peer', rank: 'captain' },
  { ...base, id: 'captain', rank: 'captain', supervisor_id: 'commodore' },
  { ...base, id: 'admiral', rank: 'admiral' },
  { ...base, id: 'commodore', rank: 'commodore', supervisor_id: 'admiral' },
  { ...base, id: 'removed', rank: 'crew', supervisor_id: 'captain', removed_ms: 1 },
  { ...base, id: 'unassigned', kind: 'shell', rank: null },
];
test('a supervisor group includes its assigned descendants, not peers or removed instances', () => {
  assert.deepEqual(
    groups.members(sessions, 'admiral').map((s) => s.id),
    ['admiral', 'commodore', 'captain', 'crew'],
  );
  assert.deepEqual(
    groups.members(sessions, 'captain').map((s) => s.id),
    ['captain', 'crew'],
  );
  assert.deepEqual(
    groups.roots(sessions).map((s) => s.id),
    ['admiral', 'peer', 'unassigned'],
  );
  assert.throws(() => groups.members(sessions, 'removed'), /registered/);
});
test('rank layout uses ordered rank rows and handles negative monitor origins', () => {
  const plan = groupPlan(sessions, 'admiral', 'rank', {
    x: -1920,
    y: 40,
    width: 1920,
    height: 1000,
  });
  assert.equal(plan.length, 4);
  assert.deepEqual(plan[0], { session: 'admiral', x: -1920, y: 40, width: 1920, height: 250 });
  assert.equal(plan[3].y, 790);
});
test('even grid fits a non-square group without overlapping and does not include stopped runtimes', () => {
  const rows = [...sessions, { ...base, id: 'stopped', rank: 'crew', worker_state: 'stopped' }];
  const plan = groupPlan(rows, null, 'grid', { x: 10, y: 20, width: 1001, height: 801 });
  assert.equal(plan.length, 6);
  for (const cell of plan) {
    assert.ok(
      cell.x >= 10 && cell.y >= 20 && cell.x + cell.width <= 1011 && cell.y + cell.height <= 821,
    );
    for (const other of plan.filter((p) => p !== cell))
      assert.ok(
        cell.x + cell.width <= other.x ||
          other.x + other.width <= cell.x ||
          cell.y + cell.height <= other.y ||
          other.y + other.height <= cell.y,
      );
  }
  assert.throws(
    () => groupPlan(rows, null, 'unknown', { x: 0, y: 0, width: 1000, height: 1000 }),
    /layout/,
  );
});

test('rank rows wrap before a terminal minimum would overlap its neighbour', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ ...base, id: String(i), rank: 'crew' }));
  const plan = groupPlan(
    rows,
    null,
    'rank',
    { x: 0, y: 0, width: 3456, height: 1080 },
    { width: 592, height: 200 },
  );
  assert.equal(new Set(plan.map((p) => p.y)).size, 2);
  assert.ok(plan.every((p) => p.width >= 592 && p.height >= 200));
  assert.throws(
    () =>
      groupPlan(
        rows,
        null,
        'rank',
        { x: 0, y: 0, width: 500, height: 100 },
        { width: 592, height: 200 },
      ),
    /narrow/,
  );
});
