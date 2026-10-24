const { test } = require('node:test');
const assert = require('node:assert/strict');
const { placeAboveTarget } = require('../src/placement.cjs');
function setup() {
  const target = { id: 1, pid: 10, visible: true, x: 0, y: 0, width: 400, height: 400 };
  const marker = { id: 2, pid: 20, visible: true, x: 100, y: 100, width: 80, height: 80 };
  let visible = true;
  let current = true;
  const calls = [];
  return {
    calls,
    target,
    marker,
    supersede() {
      current = false;
    },
    options: {
      avatar: {
        getNativeWindowHandle: () => Buffer.from([2, 0, 0, 0]),
        isVisible: () => visible,
        showInactive() {
          visible = true;
          calls.push('show');
        },
      },
      target: 1,
      bounds: { x: 100, y: 100, width: 80, height: 80 },
      point: { x: 140, y: 140 },
      excluded: [2],
      current: () => current,
      inventory: async () => [target, marker],
      above: async () => calls.push('above'),
    },
  };
}
test('placement requires the visible native marker above the intended target', async () => {
  const t = setup();
  assert.equal((await placeAboveTarget(t.options)).state, 'placed');
  t.marker.visible = false;
  assert.equal((await placeAboveTarget(t.options)).state, 'failed');
});
test('covered target refuses placement without hiding or raising the marker', async () => {
  const t = setup();
  t.options.inventory = async () => [t.target, t.marker, { ...t.target, id: 3 }];
  assert.equal((await placeAboveTarget(t.options)).state, 'failed');
  assert.deepEqual(t.calls, []);
});
test('a newer attempt invalidates a delayed inventory result', async () => {
  const t = setup();
  let finish;
  t.options.inventory = () => new Promise((r) => (finish = r));
  const result = placeAboveTarget(t.options);
  t.supersede();
  finish([t.target, t.marker]);
  assert.equal((await result).state, 'superseded');
  assert.deepEqual(t.calls, []);
});

test('an off-target visible marker cannot confirm placement', async () => {
  const t = setup();
  t.marker.x = 1400;
  t.marker.y = 1400;
  assert.equal((await placeAboveTarget(t.options)).state, 'failed');
});
test('malformed native marker or terminal bounds cannot confirm placement', async () => {
  for (const [which, changes] of [
    ['marker', { width: 0 }],
    ['marker', { height: -1 }],
    ['marker', { x: NaN }],
    ['target', { height: Infinity }],
  ]) {
    const t = setup();
    Object.assign(t[which], changes);
    assert.equal((await placeAboveTarget(t.options)).state, 'failed');
  }
});
test('a pending native move must reach the expected position before placement succeeds', async () => {
  const t = setup();
  const displaced = { ...t.marker, x: 1400 };
  let reads = 0;
  t.options.inventory = async () => [t.target, ++reads < 3 ? displaced : t.marker];
  assert.equal((await placeAboveTarget(t.options)).state, 'placed');
  assert.ok(reads >= 3);
});
