const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { promisify } = require('node:util');
const { screen } = require('electron');
const { windowAt } = require('../src/binding.cjs');
const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({
  avatarWin,
  panelWin,
  setExpanded,
  inventory,
  stateDir,
  rpc,
  refresh,
  dock,
  undock,
  getState,
}) => {
  const observations = [];
  const file = path.join(stateDir, 'visibility-proof.json');
  const save = (verdict, error) =>
    fs.writeFile(
      file,
      JSON.stringify(
        {
          verdict,
          observations,
          error,
          limits: [
            'Native pointer and window proof on GNOME/XWayland; no voice or model turn is started.',
          ],
        },
        null,
        2,
      ),
    );
  const pointer = spawn('python3', [path.join(__dirname, 'native-pointer.py')], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const replies = createInterface({ input: pointer.stdout });
  let vessel;
  async function input(value) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Native pointer did not acknowledge')), 4000);
      replies.once('line', (line) => {
        clearTimeout(timer);
        const reply = JSON.parse(line);
        if (reply.error) reject(Error(reply.error));
        else resolve();
      });
      pointer.stdin.write(`${JSON.stringify(value)}\n`);
    });
  }
  async function move(point) {
    await input(['move', point.x, point.y, 1]);
    const probe = path.join(path.dirname(getState().candidate.service), 'voyager-windows');
    const actual = screen.screenToDipPoint(JSON.parse((await exec(probe, [])).stdout).pointer);
    assert(
      Math.abs(actual.x - point.x) <= 2 && Math.abs(actual.y - point.y) <= 2,
      'Native pointer did not reach requested position',
    );
  }
  async function clickAvatar() {
    const bounds = avatarWin.getBounds();
    await move({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    await input(['button', true]);
    await input(['button', false]);
    await delay(450);
  }
  try {
    await save('running');
    if (process.env.VOYAGER_PROOF_COLD_START === '1') {
      assert(
        getState().expanded && panelWin.isVisible() && avatarWin.isVisible(),
        'Cold Applications launch must reveal both controls',
      );
      assert.equal(getState().recoveryAttempts.at(-1)?.state, 'presented');
      await delay(600);
      const panelDom = await panelWin.webContents.executeJavaScript(
        `({hidden:document.getElementById('panel').hidden,display:getComputedStyle(document.getElementById('panel')).display,view:document.body.dataset.view})`,
      );
      assert.equal(panelDom.hidden, false);
      assert.notEqual(panelDom.display, 'none');
      await fs.writeFile(
        path.join(stateDir, 'cold-panel-renderer.png'),
        (await panelWin.webContents.capturePage()).toPNG(),
      );
      const stack = await inventory();
      observations.push({
        label: 'cold-applications-start',
        panelDom,
        candidate: getState().candidate,
        recovery: getState().recoveryAttempts.at(-1),
        windows: stack.filter((w) => w.pid === process.pid),
      });
      await exec(
        'python3',
        [
          path.join(__dirname, 'native-capture.py'),
          JSON.stringify(screen.getPrimaryDisplay().bounds),
          path.join(stateDir, 'cold-applications.png'),
        ],
        { timeout: 20000 },
      );
      await save('running');
      for (const workspace of ['1', '0']) {
        await exec('xdotool', ['set_desktop', workspace]);
        await delay(700);
      }
    }
    await setExpanded(false);
    const area = (screen.getAllDisplays().find((d) => !d.internal) || screen.getPrimaryDisplay())
      .workArea;
    avatarWin.setPosition(area.x + 200, area.y + 64);
    const avatarId = avatarWin.getNativeWindowHandle().readUInt32LE();
    const panelId = panelWin.getNativeWindowHandle().readUInt32LE();
    async function check(label) {
      await delay(250);
      const stack = await inventory();
      const w = stack.find((w) => w.id === avatarId);
      assert(w?.visible, `${label}: avatar must be mapped`);
      const top = windowAt(stack, { x: w.x + w.width / 2, y: w.y + w.height / 2 });
      const style = await avatarWin.webContents.executeJavaScript(
        `({opacity:getComputedStyle(document.getElementById('avatar')).opacity,state:document.getElementById('avatar').dataset.state,seated:document.body.dataset.seated,gesture:document.getElementById('avatar').dataset.gesture})`,
      );
      observations.push({ label, top: top?.id, avatar: avatarId, panel: panelId, style });
      await fs.writeFile(
        path.join(stateDir, `${label}.png`),
        (await avatarWin.webContents.capturePage()).toPNG(),
      );
      if (process.env.VOYAGER_VISIBILITY_CAPTURE_SCRIPT)
        await exec('python3', [
          process.env.VOYAGER_VISIBILITY_CAPTURE_SCRIPT,
          process.env.VOYAGER_VISIBILITY_MONITOR,
          path.join(stateDir, `${label}-desktop.png`),
        ]);
      assert.equal(
        style.opacity,
        '1',
        `${label}: panel and standalone avatar must not use terminal fade`,
      );
      assert.equal(top?.id, avatarId, `${label}: native panel must not cover the astronaut`);
    }
    await check('standalone');
    for (let i = 0; i < (process.env.VOYAGER_PROOF_KEYBOARD === '1' ? 0 : 3); i++) {
      await clickAvatar();
      assert(panelWin.isVisible(), 'Native click should open the panel');
      await check(`reopened-${i}`);
      const p = panelWin.getBounds();
      await move({ x: p.x + 24, y: p.y + p.height - 60 });
      const hoverDeadline = Date.now() + 2500;
      while (
        (await panelWin.webContents.executeJavaScript(`document.body.dataset.panelHovered`)) !==
          'true' &&
        Date.now() < hoverDeadline
      )
        await delay(100);
      observations.push({
        label: `panel-hover-${i}`,
        requested: p,
        actual: panelWin.getBounds(),
        pointer: screen.getCursorScreenPoint(),
        window: windowAt(await inventory(), screen.dipToScreenPoint(screen.getCursorScreenPoint())),
      });
      assert.equal(
        await panelWin.webContents.executeJavaScript(`document.body.dataset.panelHovered`),
        'true',
      );
      await check(`hovered-${i}`);
      await input(['button', true]);
      await input(['button', false]);
      await check(`focused-${i}`);
      const before = panelWin.getBounds();
      const start = { x: before.x + 24, y: before.y + before.height - 60 };
      await move(start);
      const pointerBefore = screen.getCursorScreenPoint();
      await input(['button', true]);
      if (i > 0) await delay(120);
      await move({ x: start.x + 80, y: start.y + 40 });
      await delay(200);
      await input(['button', false]);
      await delay(150);
      const after = panelWin.getBounds();
      observations.push({
        label: `panel-drag-${i}`,
        before,
        after,
        pointerBefore,
        pointerAfter: screen.getCursorScreenPoint(),
      });
      assert.equal(after.x - before.x, 80, 'Dragging the panel must move its native window');
      assert.equal(after.y - before.y, 40, 'Dragging the panel must preserve the pointer offset');
      const seatedAvatar = avatarWin.getBounds();
      assert.equal(seatedAvatar.x, after.x + 100);
      assert.equal(seatedAvatar.y, after.y + 36);
      await move({ x: start.x + 100, y: start.y + 50 });
      await delay(100);
      assert.deepEqual(
        panelWin.getBounds(),
        after,
        'Releasing the pointer must end panel movement',
      );
      if (i === 0) {
        const add = await panelWin.webContents.executeJavaScript(
          `(() => { const r = document.getElementById('add').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
        );
        await move({ x: after.x + add.x, y: after.y + add.y });
        await input(['button', true]);
        await input(['button', false]);
        await delay(200);
        assert.equal(
          await panelWin.webContents.executeJavaScript(
            `document.getElementById('create-form').hidden`,
          ),
          false,
        );
        const openBounds = panelWin.getBounds();
        assert.equal(openBounds.x, after.x);
        assert.equal(openBounds.y, after.y);
        const cancel = await panelWin.webContents.executeJavaScript(
          `(() => { const r = document.getElementById('cancel-create').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
        );
        await move({ x: openBounds.x + cancel.x, y: openBounds.y + cancel.y });
        await input(['button', true]);
        await input(['button', false]);
        await delay(200);
        assert.equal(
          await panelWin.webContents.executeJavaScript(
            `document.getElementById('create-form').hidden`,
          ),
          true,
        );
        observations.push({ label: 'panel-buttons-remain-clickable' });
      }
      await clickAvatar();
      assert(!panelWin.isVisible(), 'Native click should hide the panel');
      await check(`collapsed-${i}`);
    }
    const created = await rpc(
      'create',
      'shell',
      'visibility-shell',
      'Visibility terminal',
      stateDir,
      '--terminal',
      process.env.VOYAGER_PROOF_TERMINAL || 'ghostty',
    );
    vessel = created.session_id;
    await refresh();
    const record = getState().records.find((r) => r.nativeId === 'visibility-shell');
    const ownWindow = record && getState().windows.find((w) => w.pid === record.pid);
    assert(ownWindow, 'Disposable native terminal must be mapped');
    await setExpanded(false);
    await exec('xdotool', ['windowactivate', '--sync', String(ownWindow.id)], { timeout: 3000 });
    assert(await dock(ownWindow.id));
    await delay(350);
    assert.equal(
      await avatarWin.webContents.executeJavaScript(
        `getComputedStyle(document.getElementById('avatar')).opacity`,
      ),
      '0.3',
    );
    undock();
    await setExpanded(true);
    await check('returned-from-terminal');
    if (process.env.VOYAGER_PROOF_KEYBOARD !== '1') {
      await clickAvatar();
      await check('returned-collapsed');
      await clickAvatar();
      await check('returned-reopened');
    }
    if (process.env.VOYAGER_PROOF_D04 === '1')
      await require('./applications-proof.cjs').run({
        avatarWin,
        panelWin,
        rpc,
        inventory,
        dock,
        getState,
        setExpanded,
        stateDir,
        vessel,
        target: ownWindow.id,
        input,
        observations,
      });
    await save('pass');
    console.log('Native panel visibility journey passed.');
  } catch (error) {
    await save('rework', error.stack);
    throw error;
  } finally {
    pointer.stdin.end();
    replies.close();
    if (vessel) await rpc('remove', vessel, '--stop');
  }
};
