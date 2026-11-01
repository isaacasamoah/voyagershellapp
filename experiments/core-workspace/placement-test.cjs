const assert = require("node:assert/strict");
const test = require("node:test");
const { side, neighbour } = require("./placement.js");

test("a drop preview chooses the same side at edges and deterministic ties", () => {
  const rect = { x: 10, y: 20, width: 200, height: 100 };
  assert.equal(side(rect, 11, 70), "left");
  assert.equal(side(rect, 209, 70), "right");
  assert.equal(side(rect, 110, 21), "top");
  assert.equal(side(rect, 110, 119), "bottom");
  assert.equal(side(rect, 110, 70), "left");
});

test("directional movement chooses a centre in its half-plane and handles uneven layouts and absence", () => {
  const current = { x: 100, y: 100, width: 100, height: 100 };
  const candidates = [
    { id: "b", x: 200, y: 100, width: 100, height: 100 },
    { id: "a", x: 200, y: 100, width: 100, height: 100 },
    { id: "top", x: 40, y: 0, width: 220, height: 70 },
  ];
  assert.equal(neighbour(current, candidates, "right"), "a");
  assert.equal(neighbour(current, candidates, "top"), "top");
  assert.equal(neighbour(current, candidates, "left"), undefined);
  assert.equal(neighbour(current, candidates, "bottom"), undefined);
});
