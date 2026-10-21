const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAstronaut } = require('../src/ui/astronaut.js');

function clock(reducedMotion = false) {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const frames = [];
  const astronaut = createAstronaut({
    frame: (src, fade) => frames.push({ src, fade, time: now }),
    schedule: (next, ms) => {
      timers.set(++id, { next, at: now + ms });
      return id;
    },
    cancel: (key) => timers.delete(key),
    random: () => 0,
    reducedMotion,
  });
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const first = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > end) break;
      now = first[1].at;
      timers.delete(first[0]);
      first[1].next();
    }
    now = end;
  }
  return { astronaut, frames, advance, timers };
}

test('idle stretch repeats only after resting and stops when the renderer closes', () => {
  const c = clock();
  c.advance(19999);
  assert.equal(c.frames.length, 0);
  c.advance(4000);
  assert.deepEqual(
    c.frames.map((f) => f.src),
    [
      'stretch-frames/frame-1-uncrossing.png',
      'stretch-frames/frame-2-stretched.png',
      'stretch-frames/frame-3-peak-stretch.png',
      'idle.png',
    ],
  );
  c.advance(20000);
  assert.equal(c.frames[4].src, 'stretch-frames/frame-1-uncrossing.png');
  const count = c.frames.length;
  c.astronaut.stop();
  c.advance(100000);
  assert.equal(c.frames.length, count);
  assert.equal(c.timers.size, 0);
});

test('real busy transitions open the book, tool beats turn pages, completion stretches to rest', () => {
  const c = clock();
  c.astronaut.setBusy(true);
  c.advance(2112);
  assert.equal(c.frames.at(-1).src, 'book-frames/reading-1.png');
  c.astronaut.toolBeat();
  c.advance(384);
  assert.equal(c.frames.at(-1).src, 'book-frames/reading-2.png');
  c.advance(5184);
  assert.equal(c.frames.at(-1).src, 'book-frames/reading-1.png');
  c.astronaut.setBusy(false);
  assert.equal(c.frames.at(-1).src, 'book-frames/book-away.png');
  c.advance(6000);
  assert.equal(c.frames.at(-1).src, 'idle.png');
  c.astronaut.stop();
});

test('a quick completion and new turn during a gesture retain the latest busy state', () => {
  const c = clock();
  c.astronaut.setBusy(true);
  c.astronaut.setBusy(false);
  c.advance(2112);
  assert.equal(c.frames.at(-1).src, 'book-frames/book-away.png');
  c.astronaut.setBusy(true);
  c.advance(9000);
  assert.equal(c.frames.at(-1).src, 'book-frames/reading-1.png');
  c.astronaut.setBusy(false);
  c.advance(6000);
  assert.equal(c.frames.at(-1).src, 'idle.png');
  c.astronaut.stop();
});

test('reduced motion shows static reading or rest without idle or transition gestures', () => {
  const c = clock(true);
  c.astronaut.setBusy(true);
  c.astronaut.toolBeat();
  c.advance(30000);
  c.astronaut.setBusy(false);
  assert.deepEqual(
    c.frames.map((f) => f.src),
    ['idle.png', 'book-frames/reading-1.png', 'idle.png'],
  );
  assert.equal(c.timers.size, 0);
});
