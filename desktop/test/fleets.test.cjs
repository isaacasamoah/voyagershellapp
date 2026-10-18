const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fleetActions } = require('../src/fleets.cjs');
test('Fleet panel actions use the one service owner without writing local state', async () => {
  const calls = [];
  const fleets = fleetActions(async (...args) => {
    calls.push(args);
    return { fleets: [], assignments: {} };
  });
  await fleets.read();
  await fleets.create('Compiler', 'request');
  await fleets.move('vessel', 'fleet');
  await fleets.move('vessel', null);
  await fleets.remove('fleet');
  assert.deepEqual(calls, [
    ['fleets'],
    ['create-fleet', 'request', 'Compiler'],
    ['move-vessel', 'vessel', 'fleet'],
    ['move-vessel', 'vessel', 'none'],
    ['remove-fleet', 'fleet'],
  ]);
});
