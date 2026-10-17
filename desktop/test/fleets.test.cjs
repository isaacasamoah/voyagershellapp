const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fleetStore } = require('../src/fleets.cjs');
const { fleetOf } = require('../src/ui/hierarchy.js');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v-fleet-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const captain = randomUUID(),
    crew = randomUUID(),
    peer = randomUUID();
  const sessions = [
    { id: captain, rank: 'captain', supervisor_id: null },
    { id: crew, rank: 'crew', supervisor_id: captain },
    { id: peer, rank: 'crew', supervisor_id: null },
  ];
  const file = path.join(dir, 'fleets.json');
  return { file, sessions, captain, crew, peer, store: fleetStore(file, async () => sessions) };
}
test('fleet creation persists, serialises concurrent writes and reuses its request identity', async (t) => {
  const f = await fixture(t);
  const a = randomUUID(),
    b = randomUUID();
  await Promise.all([f.store.create('Compiler', a), f.store.create('Docs', b)]);
  await f.store.create('Compiler', a);
  const saved = await fleetStore(f.file, async () => f.sessions).read();
  assert.deepEqual(
    saved.fleets.map((g) => g.name),
    ['Compiler', 'Docs'],
  );
  await assert.rejects(f.store.create('compiler', randomUUID()), /already in use/);
  assert.equal((await fs.stat(f.file)).mode & 0o777, 0o600);
});
test('dragging a supervisor carries its branch while preserving command assignments', async (t) => {
  const f = await fixture(t);
  const a = randomUUID(),
    b = randomUUID();
  await f.store.create('Compiler', a);
  await f.store.create('Docs', b);
  await f.store.move(f.crew, b);
  const original = structuredClone(f.sessions);
  await f.store.move(f.captain, a);
  let data = await f.store.read();
  assert.equal(fleetOf(f.captain, f.sessions, data.assignments), a);
  assert.equal(fleetOf(f.crew, f.sessions, data.assignments), a);
  assert.equal(fleetOf(f.peer, f.sessions, data.assignments), null);
  assert.deepEqual(f.sessions, original);
  const added = { id: randomUUID(), supervisor_id: f.captain, rank: 'crew' };
  f.sessions.push(added);
  assert.equal(fleetOf(added.id, f.sessions, data.assignments), a);
  await f.store.move(f.crew, null);
  data = await f.store.read();
  assert.equal(fleetOf(f.crew, f.sessions, data.assignments), null);
  assert.equal(fleetOf(added.id, f.sessions, data.assignments), a);
  await f.store.remove(a);
  data = await f.store.read();
  assert.equal(fleetOf(added.id, f.sessions, data.assignments), null);
});
test('unknown or removed vessels refuse without changing saved fleet data', async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  await f.store.create('Compiler', id);
  const before = await fs.readFile(f.file, 'utf8');
  await assert.rejects(f.store.move(randomUUID(), id), /no longer registered/);
  f.sessions[1].removed_ms = 1;
  await assert.rejects(f.store.move(f.crew, id), /no longer registered/);
  assert.equal(await fs.readFile(f.file, 'utf8'), before);
});
test('invalid saved fleet data is preserved rather than silently replaced', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.file, '{broken');
  await assert.rejects(f.store.create('Compiler', randomUUID()), /preserved/);
  assert.equal(await fs.readFile(f.file, 'utf8'), '{broken');
});
