const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const { snapshot, render } = require('../scripts/git-graph.cjs');

test('reports real divergence, worktrees and detached heads without interpreting names', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-graph-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('commit', '--allow-empty', '-m', 'base');
  git('branch', 'old');
  git('checkout', '-b', 'feature/<svg>');
  git('commit', '--allow-empty', '-m', '</script><script>alert(1)</script>');
  git('checkout', 'main');
  git('commit', '--allow-empty', '-m', 'main moves');
  const tree = path.join(root, 'tree with\nnewline');
  git('worktree', 'add', tree, 'feature/<svg>');
  git('worktree', 'add', '--detach', path.join(root, 'detached'), 'old');
  const data = snapshot(repo);
  const feature = data.branches.find((row) => row.name === 'feature/<svg>');
  assert.deepEqual([feature.behind, feature.ahead], [1, 1]);
  assert.equal(feature.worktrees[0].path, tree);
  assert.deepEqual(data.branches.find((row) => row.name === 'old').worktrees, []);
  assert.equal(data.branches.find((row) => row.detached).behind, 1);
  assert.equal(data.branches.find((row) => row.name === 'main').ahead, 0);
  const html = render(data);
  assert.ok(!html.includes('</script><script>alert(1)</script>'));
  assert.ok(html.includes('\\u003csvg>'));
  assert.throws(() => snapshot(root), /Git graph/);
});

if (process.env.VOYAGER_GRAPH_BROWSER) {
  test('browser renders the real snapshot and supports narrow screens and keyboard filtering', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-graph-browser-'));
    const output = process.env.VOYAGER_GRAPH_EVIDENCE || root;
    fs.mkdirSync(output, { recursive: true });
    const page = path.join(root, 'graph.html');
    fs.writeFileSync(page, render(snapshot(process.env.VOYAGER_GRAPH_BROWSER)));
    const chrome = spawn(
      'google-chrome',
      [
        '--headless',
        '--disable-gpu',
        '--disable-extensions',
        '--no-first-run',
        '--remote-debugging-port=0',
        `--user-data-dir=${root}/profile`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    t.after(async () => {
      if (chrome.exitCode === null) {
        chrome.kill('SIGTERM');
        await once(chrome, 'exit');
      }
      fs.rmSync(root, { recursive: true, force: true });
    });
    const portFile = path.join(root, 'profile', 'DevToolsActivePort');
    for (let attempt = 0; !fs.existsSync(portFile) && attempt < 100; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((entry) => entry.type === 'page');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await once(ws, 'open');
    t.after(() => ws.close());
    let sequence = 0;
    const pending = new Map();
    const errors = [];
    ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (
        message.method === 'Runtime.exceptionThrown' ||
        (message.method === 'Log.entryAdded' &&
          ['error', 'warning'].includes(message.params.entry.level))
      )
        errors.push(message);
      const request = pending.get(message.id);
      if (request) {
        clearTimeout(request.timer);
        pending.delete(message.id);
        message.error ? request.reject(message.error) : request.resolve(message.result);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`CDP timed out: ${method}`)), 10000);
        pending.set(++sequence, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: sequence, method, params }));
      });
    const read = async (expression) =>
      (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    const key = async (key, code, modifiers = 0) => {
      const windowsVirtualKeyCode =
        { Tab: 9, Enter: 13, Backspace: 8, ArrowUp: 38, ArrowDown: 40 }[key] ||
        key.toUpperCase().charCodeAt(0);
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        modifiers,
        windowsVirtualKeyCode,
        text: key === 'Enter' ? '\r' : undefined,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        modifiers,
        windowsVirtualKeyCode,
      });
    };
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: pathToFileURL(page).href });
    for (
      let attempt = 0;
      !(await read('Boolean(document.querySelector("article"))')) && attempt < 100;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    const widths = [];
    for (const width of [320, 768, 1024, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      assert.equal(
        await read('document.documentElement.scrollWidth <= window.innerWidth'),
        true,
        `overflow at ${width}`,
      );
      fs.writeFileSync(
        path.join(output, `graph-${width}.png`),
        Buffer.from((await send('Page.captureScreenshot')).data, 'base64'),
      );
      widths.push({ width, rendered: await read('window.innerWidth') });
    }
    await key('Tab', 'Tab');
    assert.equal(await read('document.activeElement.id'), 'search');
    await send('Input.insertText', { text: '___absent___' });
    assert.equal(await read('document.querySelector("#empty").hidden'), false);
    await key('a', 'KeyA', 2);
    await key('Backspace', 'Backspace');
    const active = await read('document.querySelectorAll("article").length');
    const visibleNames = () =>
      read('[...document.querySelectorAll("article h2")].map(node => node.textContent).sort()');
    assert.deepEqual(
      await visibleNames(),
      await read(
        'data.branches.filter(row => row.worktrees.length > 0).map(row => row.name).sort()',
      ),
    );
    const inactiveNames = await read(
      'data.branches.filter(row => row.worktrees.length === 0).map(row => row.name)',
    );
    for (const name of inactiveNames) assert.ok(!(await visibleNames()).includes(name));
    await key('Tab', 'Tab');
    assert.equal(await read('document.activeElement.id'), 'scope');
    await key('ArrowDown', 'ArrowDown');
    assert.equal(await read('document.querySelector("#scope").value'), 'all');
    assert.equal(
      await read('document.querySelectorAll("article").length'),
      await read('data.branches.length'),
    );
    await key('ArrowDown', 'ArrowDown');
    assert.equal(await read('document.querySelector("#scope").value'), 'unmerged');
    assert.deepEqual(
      await visibleNames(),
      await read('data.branches.filter(row => row.ahead > 0).map(row => row.name).sort()'),
    );
    await key('ArrowUp', 'ArrowUp');
    await key('Tab', 'Tab');
    await key('ArrowDown', 'ArrowDown');
    assert.equal(await read('document.querySelector("#sort").value'), 'ahead');
    const ahead = await read(
      '[...document.querySelectorAll("article .counts .ahead")].slice(1).map(node => Number.parseInt(node.textContent))',
    );
    assert.deepEqual(
      ahead,
      [...ahead].sort((a, b) => b - a),
    );
    await key('Tab', 'Tab');
    assert.equal(await read('document.activeElement.tagName'), 'SUMMARY');
    await key('Enter', 'Enter');
    assert.equal(await read('document.querySelector("article details").open'), true);
    const accessibility = await send('Accessibility.getFullAXTree');
    assert.ok(
      accessibility.nodes.some(
        (node) =>
          node.role?.value === 'searchbox' && node.name?.value === 'Find a branch or folder',
      ),
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'browser-result.json'),
      JSON.stringify(
        {
          widths,
          active,
          errors,
          keyboard: 'search, empty result, clear, scope selection',
          accessibility: 'named searchbox',
        },
        null,
        2,
      ),
    );
  });
}
