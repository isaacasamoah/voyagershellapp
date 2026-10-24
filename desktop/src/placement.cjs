const { setTimeout: delay } = require('node:timers/promises');
const { windowAt } = require('./binding.cjs');

function geometry({ id, pid, x, y, width, height, visible }) {
  return { id, pid, x, y, width, height, visible };
}

async function placeAboveTarget({
  avatar,
  target,
  point,
  bounds,
  excluded,
  current,
  inventory,
  above,
}) {
  const marker = avatar.getNativeWindowHandle().readUInt32LE();
  const deadline = performance.now() + 1000;
  let requested = false;
  while (current()) {
    const stack = await inventory();
    if (!current()) return { state: 'superseded' };
    const validBounds = (w) =>
      w &&
      ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(w[k])) &&
      w.width > 0 &&
      w.height > 0;
    const nativeTarget = stack.find((w) => w.id === target);
    const nativeMarker = stack.find((w) => w.id === marker);
    if (!validBounds(nativeTarget) || !validBounds(nativeMarker) || !validBounds(bounds))
      return { state: 'failed', reason: 'The desktop returned invalid window bounds.' };
    if (windowAt(stack, point, excluded)?.id !== target)
      return { state: 'failed', reason: 'The terminal is covered or unavailable.' };
    if (!avatar.isVisible()) avatar.showInactive();
    const a = stack.findIndex((w) => w.id === marker && w.visible);
    const t = stack.findIndex((w) => w.id === target && w.visible);
    const positioned = ['x', 'y', 'width', 'height'].every(
      (k) => Math.abs(nativeMarker[k] - bounds[k]) <= 2,
    );
    if (t >= 0 && a > t && avatar.isVisible() && positioned)
      return { state: 'placed', marker: geometry(nativeMarker), target: geometry(nativeTarget) };
    if (performance.now() >= deadline)
      return { state: 'failed', reason: 'The desktop could not show the docked avatar.' };
    if (!requested) {
      await above(marker, target);
      if (!current()) return { state: 'superseded' };
      requested = true;
    }
    await delay(25);
  }
  return { state: 'superseded' };
}
module.exports = { placeAboveTarget };
