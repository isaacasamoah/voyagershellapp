const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const hierarchy = require('./ui/hierarchy.js');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function fleetStore(file, readSessions) {
  let queue = Promise.resolve();
  async function read() {
    let data;
    try {
      data = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return { fleets: [], assignments: {} };
      throw Error('Fleet settings could not be read. The saved file has been preserved.');
    }
    if (
      !Array.isArray(data.fleets) ||
      !data.assignments ||
      typeof data.assignments !== 'object' ||
      Array.isArray(data.assignments)
    )
      throw Error('Fleet settings are invalid. The saved file has been preserved.');
    const ids = new Set();
    for (const f of data.fleets) {
      if (
        !uuid.test(f.id) ||
        typeof f.name !== 'string' ||
        !f.name.trim() ||
        Buffer.byteLength(f.name) > 100 ||
        ids.has(f.id)
      )
        throw Error('Fleet settings are invalid. The saved file has been preserved.');
      ids.add(f.id);
    }
    for (const [id, fleet] of Object.entries(data.assignments))
      if (!uuid.test(id) || (fleet !== null && !ids.has(fleet)))
        throw Error('Fleet settings are invalid. The saved file has been preserved.');
    return data;
  }
  function update(change) {
    const result = queue.then(async () => {
      const data = await read();
      await change(data);
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return data;
    });
    queue = result.catch(() => {});
    return result;
  }
  return {
    read,
    create(name, id) {
      if (
        !uuid.test(id) ||
        typeof name !== 'string' ||
        !name.trim() ||
        Buffer.byteLength(name) > 100
      )
        throw Error('Enter a short fleet name.');
      name = name.trim();
      return update((data) => {
        const previous = data.fleets.find((f) => f.id === id);
        if (previous) {
          if (previous.name !== name) throw Error('This fleet request already has another name.');
          return;
        }
        if (data.fleets.some((f) => f.name.toLowerCase() === name.toLowerCase()))
          throw Error('That fleet name is already in use.');
        data.fleets.push({ id, name });
      });
    },
    move(vessel, fleet) {
      return update(async (data) => {
        if (fleet !== null && !data.fleets.some((f) => f.id === fleet))
          throw Error('Choose an existing fleet.');
        const members = hierarchy.members(await readSessions(), vessel);
        for (const s of members) delete data.assignments[s.id];
        data.assignments[vessel] = fleet;
      });
    },
    remove(id) {
      return update((data) => {
        data.fleets = data.fleets.filter((f) => f.id !== id);
        for (const vessel of Object.keys(data.assignments))
          if (data.assignments[vessel] === id) data.assignments[vessel] = null;
      });
    },
  };
}
module.exports = { fleetStore };
