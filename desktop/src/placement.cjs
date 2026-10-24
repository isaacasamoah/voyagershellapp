const { setTimeout: delay } = require('node:timers/promises');
const { windowAt } = require('./binding.cjs');

async function placeAboveTarget({ avatar, target, point, excluded, current, inventory, above }) {
  const marker = avatar.getNativeWindowHandle().readUInt32LE();
  const deadline = performance.now() + 1000;
  let requested = false;
  while (current()) {
    const stack = await inventory();
    if (!current()) return { state: 'superseded' };
    if (windowAt(stack, point, excluded)?.id !== target)
      return { state: 'failed', reason: 'The terminal is covered or unavailable.' };
    if (!avatar.isVisible()) avatar.showInactive();
    const a = stack.findIndex((w) => w.id === marker && w.visible);
    const t = stack.findIndex((w) => w.id === target && w.visible);
    if (t >= 0 && a > t && avatar.isVisible()) return { state: 'placed' };
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
