const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function renderer() {
  let onState;
  const calls = [];
  const nodes = new Map();
  const document = { body: { dataset: {} }, activeElement: null };
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.style = {};
      this.value = '';
      this.textContent = '';
      this.hidden = false;
      this.isConnected = true;
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.children = children;
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    addEventListener() {}
    focus() {
      document.activeElement = this;
    }
    querySelectorAll(selector) {
      const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
      return descendants.filter(
        (child) =>
          selector === '*' ||
          child.tagName === selector ||
          (selector === '[data-key]' && child.dataset.key),
      );
    }
    get elements() {
      return this.querySelectorAll('*').filter((child) =>
        ['input', 'select', 'textarea', 'button'].includes(child.tagName),
      );
    }
    hidePopover() {
      this.open = false;
    }
  }
  for (const match of fs
    .readFileSync(require.resolve('../src/ui/index.html'), 'utf8')
    .matchAll(/id="([^"]+)"/g))
    nodes.set(match[1], new Node());
  document.createElement = (tag) => new Node(tag);
  document.getElementById = (id) => nodes.get(id);
  document.querySelectorAll = () => [];
  nodes.get('instance-kind').value = 'codex';
  nodes.get('instance-rank').value = 'crew';
  nodes.get('create-form').hidden = true;
  nodes.get('fleet-form').hidden = true;
  const api = {
    onState: (callback) => {
      onState = callback;
    },
    onDockSound() {},
    ready() {},
    createInstance: async (input) => {
      calls.push(input);
      return { session: 'created' };
    },
  };
  const context = vm.createContext({
    window: { voyager: api },
    document,
    location: { search: '?view=panel' },
    URLSearchParams,
    crypto: { randomUUID },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/ui/authority.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/ui/hierarchy.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/ui/renderer.js'), 'utf8'), context);
  return {
    nodes,
    api,
    calls,
    update: (extra = {}) =>
      onState({ sessions: [], escalations: [], defaultDirectory: '/project', ...extra }),
  };
}

test('the real creation form resets Crew and hides rank for Bash', async () => {
  const ui = renderer();
  ui.update();
  const node = (id) => ui.nodes.get(id);
  node('instance-rank').value = 'admiral';
  node('add').onclick();
  assert.equal(node('instance-rank').value, 'crew');
  node('instance-rank').value = 'captain';
  node('cancel-create').onclick();
  node('add').onclick();
  assert.equal(node('instance-rank').value, 'crew');
  node('instance-name').value = 'Worker';
  await node('create-form').onsubmit({ preventDefault() {} });
  assert.equal(ui.calls[0].rank, 'crew');
  node('add').onclick();
  node('instance-kind').value = 'shell';
  node('instance-kind').onchange();
  assert.equal(node('rank-field').hidden, true);
  node('instance-name').value = 'Terminal';
  await node('create-form').onsubmit({ preventDefault() {} });
  assert.equal(ui.calls[1].rank, null);
});

test('a rejected rank change keeps the same request on an explicit retry', async () => {
  const ui = renderer();
  const requests = [];
  ui.api.rankInstance = async (...args) => {
    requests.push(args);
    return { error: 'Assignments would be invalid.' };
  };
  ui.update({
    sessions: [
      {
        id: 'one',
        name: 'Worker',
        kind: 'codex',
        cwd: '/project',
        rank: 'crew',
        ownership: 'managed',
        worker_state: 'stopped',
      },
    ],
  });
  const row = ui.nodes.get('sessions').children[0].children[0];
  const change = row
    .querySelectorAll('button')
    .find((button) => button.textContent === 'Change rank');
  const select = row.querySelectorAll('select')[0];
  select.value = 'captain';
  await change.onclick();
  assert.equal(ui.nodes.get('instance-error').textContent, 'Assignments would be invalid.');
  assert.equal(ui.nodes.get('instance-error').hidden, false);
  await change.onclick();
  assert.equal(requests[0][2], requests[1][2]);
  select.value = 'admiral';
  await change.onclick();
  assert.notEqual(requests[1][2], requests[2][2]);
});

test('rank rows start collapsed and expand without a duplicate group header', async () => {
  const ui = renderer();
  const requests = [];
  ui.api.surfaceInstance = async (id) => requests.push(id);
  const base = { kind: 'codex', cwd: '/project', ownership: 'managed', worker_state: 'running' };
  const rows = [
    { ...base, id: 'captain', name: 'Captain', rank: 'captain' },
    { ...base, id: 'crew', name: 'Crew', rank: 'crew', supervisor_id: 'captain' },
  ];
  ui.update({ sessions: rows });
  let tree = ui.nodes.get('sessions').children[0];
  assert.equal(tree.children[1].hidden, true);
  tree.children[0].children[2].onclick();
  tree = ui.nodes.get('sessions').children[0];
  assert.equal(tree.children[1].hidden, false);
  assert.equal(tree.children[0].children[0].children[0].children[0].textContent, 'Captain');
  await tree.children[0].children[0].onclick();
  assert.deepEqual(requests, ['captain']);
});
test('existing fleets appear in creation and the selected fleet reaches the service action', async () => {
  const ui = renderer();
  ui.update();
  assert.equal(ui.nodes.get('instance-fleet-field').hidden, true);
  ui.update({ fleetData: { fleets: [{ id: 'a', name: 'Launch' }], assignments: {} } });
  assert.equal(ui.nodes.get('instance-fleet-field').hidden, false);
  ui.nodes.get('add').onclick();
  ui.nodes.get('instance-name').value = 'Designer';
  ui.nodes.get('instance-fleet').value = 'a';
  await ui.nodes.get('create-form').onsubmit({ preventDefault() {} });
  assert.equal(ui.calls[0].fleet, 'a');
});

test('the panel exposes explicit service stop and preserves a refused shutdown', async () => {
  const ui = renderer();
  ui.update();
  let stopped = 0;
  let closed = 0;
  ui.api.quit = () => closed++;
  ui.api.stopService = async () => {
    stopped++;
    return { error: 'Stop running vessels before stopping Voyager.' };
  };
  const stop = ui.nodes
    .get('app-menu')
    .querySelectorAll('button')
    .find((button) => button.textContent === 'Stop service');
  assert.ok(stop, 'Stop service is reachable from the panel menu');
  await stop.onclick();
  assert.equal(stopped, 1);
  assert.equal(closed, 0);
  assert.equal(
    ui.nodes.get('instance-error').textContent,
    'Stop running vessels before stopping Voyager.',
  );
  ui.nodes.get('quit').onclick();
  assert.equal(closed, 1);
  assert.equal(stopped, 1);
});
