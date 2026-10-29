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
      this.disabled = false;
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
  document.getElementById = (id) =>
    nodes.get(id) ||
    [...nodes.values()]
      .flatMap((node) => node.querySelectorAll('*'))
      .find((node) => node.id === id);
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
  vm.runInContext(fs.readFileSync(require.resolve('../src/ui/history.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/ui/focus.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/ui/renderer.js'), 'utf8'), context);
  return {
    nodes,
    context,
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

test('direct choices apply once, restore refused values and retain their retry identity', async () => {
  for (const [method, field, current, next, other] of [
    ['rankInstance', 0, 'crew', 'captain', 'admiral'],
    ['superviseInstance', 1, '', 'captain', 'admiral'],
  ]) {
    const ui = renderer();
    let finish;
    const requests = [];
    ui.api[method] = (...args) => {
      requests.push(args);
      return requests.length === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { error: 'Assignments would be invalid.' };
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
          lifecycle: { runtime: 'stopped' },
        },
      ],
    });
    let row = ui.nodes.get('previous-sessions').children[0];
    assert.equal(
      row.querySelectorAll('button').some((b) => /^Change (rank|assignment)$/.test(b.textContent)),
      false,
    );
    let select = row.querySelectorAll('select')[field];
    await select.onchange();
    assert.equal(requests.length, 0);
    select.value = next;
    const pending = select.onchange();
    assert.equal(select.disabled, true);
    await select.onchange();
    vm.runInContext('lastRows = null; renderState(lastState)', ui.context);
    row = ui.nodes.get('previous-sessions').children[0];
    select = row.querySelectorAll('select')[field];
    assert.equal(select.disabled, true);
    await select.onchange();
    assert.equal(requests.length, 1);
    finish({ error: 'Assignments would be invalid.' });
    await pending;
    assert.equal(select.disabled, false);
    assert.equal(select.value, current);
    assert.equal(ui.nodes.get('instance-error').textContent, '');
    assert.equal(
      row.querySelectorAll('p').find((node) => node.id === 'feedback-one').textContent,
      'Assignments would be invalid.',
    );
    select.value = next;
    await select.onchange();
    assert.equal(requests[0][2], requests[1][2]);
    select.value = other;
    await select.onchange();
    assert.notEqual(requests[1][2], requests[2][2]);
    vm.runInContext('lastRows = null; renderState(lastState)', ui.context);
    const refreshed = ui.nodes.get('previous-sessions').children[0];
    assert.equal(
      refreshed.querySelectorAll('p').find((node) => node.id === 'feedback-one').textContent,
      'Assignments would be invalid.',
    );
    refreshed
      .querySelectorAll('button')
      .find((node) => node.id === 'dismiss-one')
      .onclick();
    assert.equal(
      refreshed.querySelectorAll('p').find((node) => node.id === 'feedback-one').hidden,
      true,
    );
  }
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

test('creation, Open and compact Resume retain the selected viewer', async () => {
  const ui = renderer();
  ui.update();
  ui.nodes.get('add').onclick();
  ui.nodes.get('instance-name').value = 'Viewer';
  ui.nodes.get('instance-terminal').value = 'xterm';
  await ui.nodes.get('create-form').onsubmit({ preventDefault() {} });
  assert.equal(ui.calls[0].terminal, 'xterm');
  const requests = [];
  ui.api.openInstance = async (...args) => requests.push(args);
  const session = {
    id: 'one',
    name: 'Viewer',
    kind: 'codex',
    rank: 'crew',
    ownership: 'managed',
    worker_state: 'running',
    capture: 'connected',
    cwd: '/project',
    lifecycle: { runtime: 'running' },
    window: 'closed',
    terminal: 'xterm',
  };
  ui.update({ sessions: [session] });
  const items = ui.nodes.get('sessions').querySelectorAll('*');
  const identity = items.find((n) => n.className === 'session-identity');
  assert.deepEqual(
    identity.children.map((n) => n.textContent),
    ['Viewer', 'Crew'],
  );
  const viewer = items.find((n) => n.tagName === 'select' && n.value === 'xterm');
  assert.ok(viewer);
  const open = items.find((n) => n.tagName === 'button' && n.textContent === 'Open viewer');
  await open.onclick();
  assert.equal(requests[0][0], 'one');
  assert.equal(requests[0][1], 'xterm');
  assert.equal(typeof requests[0][2], 'string');
  ui.api.resumeInstance = async (input) => requests.push(input);
  const previous = {
    ...session,
    lifecycle: { runtime: 'stopped', runtime_generation: 1 },
    resume: { state: 'eligible' },
  };
  ui.update({ sessions: [previous] });
  let row = ui.nodes.get('previous-sessions').children[0];
  const preference = row.querySelectorAll('select').find((node) => node.id === 'resume-viewer-one');
  preference.value = 'ghostty';
  preference.onchange?.();
  ui.update({ sessions: [{ ...previous, last_activity_ms: 1 }] });
  row = ui.nodes.get('previous-sessions').children[0];
  const resume = row.children.find(
    (node) => node.tagName === 'button' && node.textContent === 'Resume',
  );
  assert.ok(resume, 'One Resume action belongs directly to the compact row');
  assert.equal(row.children[0].tagName, 'div', 'A stopped name stays legible');
  assert.ok(!row.children.some((node) => node.tagName === 'select'));
  assert.ok(!row.children.some((node) => node.textContent === 'Inspect'));
  await resume.onclick();
  assert.equal(requests[1].terminal, 'ghostty');
  assert.equal(requests[1].generation, 1);
  ui.update({ sessions: [session] });
  ui.update({ sessions: [previous] });
  await ui.nodes
    .get('previous-sessions')
    .children[0].children.find((node) => node.textContent === 'Resume')
    .onclick();
  assert.equal(requests[2].terminal, 'xterm');
});

test('the panel separates stopped and unknown records', () => {
  const ui = renderer();
  const row = (id, runtime) => ({
    id,
    name: id,
    kind: 'shell',
    cwd: '/project',
    ownership: 'managed',
    worker_state: 'running',
    lifecycle: { runtime },
    capture: 'connected',
  });
  const sessions = [
    row('live', 'running'),
    row('old', 'stopped'),
    { ...row('removed', 'stopped'), removed_ms: 1 },
    { ...row('legacy', 'unknown'), lifecycle: undefined },
  ];
  ui.update({ sessions });
  const ids = (container) =>
    ui.nodes
      .get(container)
      .querySelectorAll('[data-key]')
      .map((n) => n.dataset.key);
  assert.deepEqual(ids('sessions'), ['live']);
  assert.deepEqual(ids('needs-attention-sessions'), ['legacy']);
  assert.deepEqual(ids('previous-sessions'), ['old']);
  assert.equal(ui.nodes.get('previous-toggle').textContent, 'Previous vessels (1)');
  const snapshot = JSON.stringify(sessions);
  vm.runInContext("document.getElementById('show-removed').onclick()", ui.context);
  assert.deepEqual(ids('previous-sessions'), ['removed']);
  assert.equal(ui.nodes.get('previous-back').hidden, false);
  ui.nodes.get('previous-back').onclick();
  assert.deepEqual(ids('previous-sessions'), ['old']);
  assert.equal(JSON.stringify(sessions), snapshot);
  assert.match(ui.nodes.get('connection').textContent, /update/i);
});

test('late action completion cannot re-enable its offline control', async () => {
  const ui = renderer();
  const sessions = [
    {
      id: 'live',
      name: 'Live',
      cwd: '/project',
      kind: 'shell',
      ownership: 'managed',
      lifecycle: { runtime: 'running' },
      capture: 'connected',
    },
  ];
  ui.update({ sessions });
  let finish;
  ui.api.surfaceInstance = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const live = ui.nodes.get('sessions').querySelectorAll('[data-key]')[0];
  const pending = live.onclick();
  ui.update({ sessions, serviceError: 'Disconnected' });
  finish({});
  await pending;
  assert.equal(live.disabled, true);
});

test('a visible worker keeps its hidden captain context without another captain row', () => {
  const ui = renderer();
  const parent = {
    id: 'captain',
    name: 'Captain',
    kind: 'codex',
    rank: 'captain',
    cwd: '/project',
    ownership: 'managed',
    lifecycle: { runtime: 'stopped' },
  };
  const worker = {
    id: 'worker',
    name: 'Worker',
    kind: 'shell',
    supervisor_id: parent.id,
    cwd: '/project',
    ownership: 'managed',
    lifecycle: { runtime: 'running' },
  };
  const fleetData = { fleets: [{ id: 'work', name: 'Work' }], assignments: { captain: 'work' } };
  const original = JSON.stringify([parent, worker, fleetData]);
  ui.update({ sessions: [parent, worker], fleetData });
  const fleet = ui.nodes.get('fleets').children[0];
  assert.deepEqual(
    fleet.querySelectorAll('[data-key]').map((n) => n.dataset.key),
    ['worker'],
  );
  assert.ok(
    fleet.querySelectorAll('p').some((n) => n.textContent === 'Reports to Captain, Stopped'),
  );
  assert.equal(JSON.stringify([parent, worker, fleetData]), original);
  ui.update({ sessions: [worker] });
  assert.ok(
    ui.nodes
      .get('sessions')
      .querySelectorAll('p')
      .some((n) => n.textContent === 'Supervisor unavailable'),
  );
});
