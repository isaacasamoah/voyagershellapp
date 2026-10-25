const { test } = require('node:test');
const assert = require('node:assert/strict');
const hierarchy = require('../src/ui/hierarchy.js');
const { vesselPlan } = require('../src/layout.cjs');
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
test('a supervisor branch includes its assigned descendants, not peers or removed instances', () => {
  assert.deepEqual(
    hierarchy.members(sessions, 'admiral').map((s) => s.id),
    ['admiral', 'commodore', 'captain', 'crew'],
  );
  assert.deepEqual(
    hierarchy.members(sessions, 'captain').map((s) => s.id),
    ['captain', 'crew'],
  );
  assert.deepEqual(
    hierarchy.roots(sessions).map((s) => s.id),
    ['admiral', 'peer', 'unassigned'],
  );
  assert.throws(() => hierarchy.members(sessions, 'removed'), /registered/);
});
test('fixed quarters preserve rank order and negative monitor origins', () => {
  const plan = vesselPlan(
    sessions,
    hierarchy.members(sessions, 'admiral').map((s) => s.id),
    {
      x: -1920,
      y: 40,
      width: 1920,
      height: 1000,
    },
  );
  assert.equal(plan.length, 4);
  assert.deepEqual(plan[0], { session: 'admiral', x: -1920, y: 40, width: 960, height: 500 });
  assert.equal(plan[3].y, 540);
});
test('rank rows wrap before a terminal minimum would overlap its neighbour', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ ...base, id: String(i), rank: 'crew' }));
  const plan = vesselPlan(
    rows,
    rows.map((s) => s.id),
    { x: 0, y: 0, width: 3456, height: 1080 },
    { width: 592, height: 200 },
  );
  assert.equal(new Set(plan.map((p) => p.y)).size, 2);
  assert.ok(plan.every((p) => p.width >= 592 && p.height >= 200));
  assert.throws(
    () =>
      vesselPlan(
        rows,
        rows.map((s) => s.id),
        { x: 0, y: 0, width: 500, height: 100 },
        { width: 592, height: 200 },
      ),
    /narrow/,
  );
});

test('three vessels match a full-height left half and two flush right quarters', () => {
  const { rectangles } = require('../src/layout.cjs');
  assert.deepEqual(
    rectangles([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { x: 0, y: 0, width: 3840, height: 2160 }),
    [
      { session: 'a', x: 0, y: 0, width: 1920, height: 2160 },
      { session: 'b', x: 1920, y: 0, width: 1920, height: 1080 },
      { session: 'c', x: 1920, y: 1080, width: 1920, height: 1080 },
    ],
  );
});

test('work groups use runtime observations and include each record exactly once', () => {
  const record = (id, runtime, extra = {}) => ({
    id,
    ownership: 'managed',
    lifecycle: { runtime },
    ...extra,
  });
  const rows = [
    record('running', 'running', { window: 'closed' }),
    record('starting', 'starting'),
    record('unregistered', 'running', { removed_ms: 1 }),
    record('external', 'external', { ownership: 'external', capture: 'connected' }),
    record('unknown', 'unknown'),
    record('disconnected', 'external', { ownership: 'external', capture: 'disconnected' }),
    record('stopped', 'stopped'),
    record('removed', 'stopped', { removed_ms: 1 }),
    record('removed-external', 'external', { ownership: 'external', removed_ms: 1 }),
    { id: 'legacy', worker_state: 'stopped', ownership: 'managed' },
  ];
  const original = JSON.stringify(rows);
  const groups = hierarchy.classify(rows);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(groups).map(([group, members]) => [group, members.map((r) => r.id)]),
    ),
    {
      current: ['running', 'starting', 'unregistered', 'external'],
      attention: ['unknown', 'disconnected', 'legacy'],
      previous: ['stopped'],
      removed: ['removed', 'removed-external'],
    },
  );
  assert.equal(JSON.stringify(rows), original);
});
