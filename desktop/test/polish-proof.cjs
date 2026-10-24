const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
exports.run = async ({
  panelWin,
  avatarWin,
  rpc,
  refresh,
  inventory,
  surface,
  dock,
  undock,
  setExpanded,
  stateDir,
  getState,
}) => {
  const terminal = process.env.VOYAGER_PROOF_TERMINAL || 'ghostty';
  assert(['ghostty', 'xterm'].includes(terminal));
  const observations = [{ action: 'viewer-choice', terminal }];
  const owned = [];
  const file = path.join(stateDir, 'polish-proof.json');
  const save = async (verdict, error) =>
    fs.writeFile(
      file,
      JSON.stringify(
        {
          verdict,
          observations,
          error,
          limits: [
            'Programmatic panel input and real native windows; physical drag, voice quality and smoothness require Isaac.',
            'Codex voice adapter on this Linux host and selected viewer only.',
            'Sound measurements observe Web Audio scheduling and completion, not acoustic output or perceived volume.',
          ],
        },
        null,
        2,
      ),
    );
  const ui = (code) => panelWin.webContents.executeJavaScript(code);
  const avatar = (code) => avatarWin.webContents.executeJavaScript(code);
  const wait = async (read, accept, description, ms = 30000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const v = await read();
      if (accept(v)) return v;
      await delay(100);
    }
    throw Error(description);
  };
  const rows = () => rpc('list', '--include-removed');
  const byId = async (id) => (await rows()).find((s) => s.id === id);
  const action = async (id, label) => {
    await refresh();
    await ui(
      `(async()=>{const row=[...document.querySelectorAll('.instance-row')].find(n=>n.querySelector('[data-key]')?.dataset.key===${JSON.stringify(id)});const summary=row.querySelector('.instance-menu > button');summary.click();const action=[...row.querySelectorAll('.instance-actions > button')].find(n=>n.textContent===${JSON.stringify(label)});if(!action)throw Error('Missing ${label}');await action.onclick();})()`,
    );
    await delay(80);
    const error = await ui(`document.getElementById('instance-error').textContent`);
    assert.equal(error, '');
  };
  const rename = async (id, name, fleet = false) => {
    await refresh();
    await wait(
      () =>
        ui(
          `Boolean(${fleet ? `document.querySelector('[data-fleet="${id}"]')` : `document.querySelector('[data-key="${id}"]')`})`,
        ),
      Boolean,
      'Rename target not rendered',
    );
    await ui(
      `(()=>{const row=${fleet ? `document.querySelector('[data-fleet="${id}"]')` : `[...document.querySelectorAll('.instance-row')].find(n=>n.querySelector('[data-key]')?.dataset.key==='${id}')`};row.querySelector('.instance-menu > button').click();[...row.querySelectorAll('.instance-actions > button')].find(n=>n.textContent==='Rename').click();const form=row.querySelector('.rename-form');form.querySelector('input').value=${JSON.stringify(name)};form.requestSubmit();})()`,
    );
    await wait(
      () => (fleet ? rpc('fleets') : byId(id)),
      (v) => (fleet ? v.fleets.some((f) => f.id === id && f.name === name) : v.name === name),
      'Rename did not persist',
    );
    await delay(100);
  };
  async function create(kind, name) {
    await setExpanded(true);
    await ui(
      `document.getElementById('add').click();document.getElementById('instance-kind').value='${kind}';document.getElementById('instance-kind').dispatchEvent(new Event('change'));document.getElementById('instance-terminal').value=${JSON.stringify(terminal)};document.getElementById('instance-name').value=${JSON.stringify(name)};document.getElementById('instance-cwd').value=${JSON.stringify(stateDir)};document.getElementById('create-form').requestSubmit();`,
    );
    const found = await wait(
      rows,
      (r) => r.some((s) => s.name === name),
      'Create did not register',
    );
    const session = found.find((s) => s.name === name);
    owned.push(session.id);
    await wait(
      () =>
        ui(
          `({hidden:document.getElementById('create-form').hidden,error:document.getElementById('instance-error').textContent})`,
        ),
      (v) => v.hidden && !v.error,
      'Creation or placement did not finish',
    );
    const layout = JSON.parse(await fs.readFile(path.join(stateDir, 'last-layout.json'), 'utf8'));
    assert.equal(layout.result.state, 'confirmed');
    observations.push({ action: 'create-half-screen', id: session.id, layout });
    return session;
  }
  async function voice(target) {
    return wait(
      () => rpc('status'),
      (s) => s.voice.target === target && s.voice.state === (target === 'none' ? 'off' : 'on'),
      'Voice handoff did not confirm',
      40000,
    );
  }
  const microphones = async () =>
    JSON.parse((await exec('pactl', ['-f', 'json', 'list', 'source-outputs'])).stdout).filter((v) =>
      (v.properties?.['application.name'] || '').includes('codex-voice-host'),
    ).length;
  const timedDock = async (window) => {
    await exec('xdotool', ['windowactivate', '--sync', String(window)], { timeout: 3000 });
    await refresh();
    await avatar(`window.viewerSoundMarks=[];`);
    const started = performance.timeOrigin + performance.now();
    assert(await dock(window));
    const attached = performance.timeOrigin + performance.now();
    const attempt = getState().dockAttempts.at(-1);
    assert.equal(attempt.state, 'placed');
    assert(avatarWin.isVisible());
    assert(attempt.placedAt >= attempt.acceptedAt);
    const sound = await wait(
      () => avatar(`window.viewerSoundMarks.find(mark=>mark.ended)`),
      Boolean,
      'Dock sound did not start and finish in the renderer',
    );
    observations.push({
      action: 'dock-through-sound',
      attempt,
      terminal,
      window,
      attached_ms: attached - started,
      sound_scheduled_ms: sound.started - started,
      sound_ended_ms: sound.ended - started,
      sound_measurement:
        'Web Audio start and ended callbacks; audible output requires a separate observation',
    });
  };
  try {
    await avatar(`(async()=>{
      audio ??= new AudioContext();
      await audio.resume();
      if(audio.state!=='running')throw Error('Dock sound context is not running');
      const create=audio.createOscillator.bind(audio);
      audio.createOscillator=()=>{
        const tone=create();
        const start=tone.start.bind(tone);
        tone.start=(when)=>{
          const mark={started:performance.timeOrigin+performance.now()};
          window.viewerSoundMarks.push(mark);
          tone.addEventListener('ended',()=>{mark.ended=performance.timeOrigin+performance.now();},{once:true});
          return start(when);
        };
        return tone;
      };
      window.viewerSoundMarks=[];
    })()`);
    const { screen } = require('electron');
    const display =
      screen.getAllDisplays().find((d) => /dell/i.test(d.label)) ||
      screen.getAllDisplays().find((d) => d.id !== screen.getPrimaryDisplay().id) ||
      screen.getPrimaryDisplay();
    panelWin.setPosition(
      display.workArea.x + display.workArea.width - 344,
      display.workArea.y + 24,
    );
    await save('running');
    assert.deepEqual(await rpc('list'), []);
    await wait(
      () => rpc('status'),
      (s) => s.conversation.phase === 'ready',
      'Private runtime not ready',
    );
    assert.deepEqual(
      await ui(
        `({placeholder:document.getElementById('chat-text').placeholder,statusHidden:document.getElementById('connection').hidden,empty:document.getElementById('sessions').textContent})`,
      ),
      { placeholder: 'sup?', statusHidden: true, empty: '' },
    );
    const shell = await create('shell', 'Proof workbench');
    console.log('Proof: created shell');
    const initial = await rpc('attach-info', shell.id);
    await rename(shell.id, 'Workbench renamed');
    console.log('Proof: renamed vessel');
    assert.equal((await rpc('attach-info', shell.id)).pid, initial.pid);
    await ui(
      `document.getElementById('add-fleet').click();document.getElementById('fleet-name').value='Proof fleet';document.getElementById('fleet-form').requestSubmit()`,
    );
    let fleet = (
      await wait(
        () => rpc('fleets'),
        (v) => v.fleets.some((f) => f.name === 'Proof fleet'),
        'Fleet creation failed',
      )
    ).fleets.find((f) => f.name === 'Proof fleet');
    await rename(fleet.id, 'Fleet renamed', true);
    console.log('Proof: renamed fleet');
    await rpc('move-vessel', shell.id, fleet.id);
    await rpc(
      'shell-exec',
      shell.id,
      'proof-background',
      `sleep 2; printf done > '${stateDir}/background.txt'`,
    );
    await action(shell.id, 'Run in background');
    await wait(
      () => byId(shell.id),
      (s) => s.window === 'closed',
      'Background did not close viewer',
    );
    await action(shell.id, 'Bring forward');
    await wait(
      () => byId(shell.id),
      (s) => s.window === 'open',
      'Bring forward did not reopen',
    );
    assert.equal((await rpc('attach-info', shell.id)).pid, initial.pid);
    await wait(
      () => fs.readFile(path.join(stateDir, 'background.txt'), 'utf8').catch(() => ''),
      (s) => s === 'done',
      'Background task failed',
    );
    observations.push({
      action: 'rename-background-reopen',
      session: await byId(shell.id),
      fleet: await rpc('fleets'),
    });
    await rpc('background', shell.id);
    const reopened = await surface([shell.id], true);
    assert.equal(reopened.state, 'confirmed');
    observations.push({ action: 'reopen-before-refresh', id: shell.id });
    const launched = await rpc(
      'create',
      'shell',
      'proof-cli',
      'CLI workbench',
      stateDir,
      '--terminal',
      terminal,
    );
    owned.push(launched.session_id);
    await wait(
      async () =>
        fs
          .readFile(path.join(stateDir, 'last-layout.json'), 'utf8')
          .then(JSON.parse)
          .catch(() => null),
      (layout) => layout?.vessels.includes(launched.session_id),
      'CLI viewer was not placed',
    );
    observations.push({ action: 'cli-launch-placed', id: launched.session_id });
    const a = await create('codex', 'Proof voice A');
    const b = await create('codex', 'Proof voice B');
    const started = performance.now();
    const arranged = await surface([a.id, b.id, shell.id]);
    observations.push({
      action: 'arrange-three',
      elapsed_ms: performance.now() - started,
      result: arranged,
    });
    assert.equal(arranged.state, 'confirmed');
    const baseline = await microphones();
    let maximum = baseline;
    const watch = setInterval(
      () =>
        microphones()
          .then((n) => {
            maximum = Math.max(maximum, n);
          })
          .catch(() => {}),
      30,
    );
    try {
      const windowFor = (id) =>
        wait(
          async () => {
            await refresh();
            const session = await byId(id);
            const record = getState().records.find(
              (r) =>
                !r.external &&
                r.server === session.server &&
                r.nativeId === session.native_thread_id,
            );
            return record && (await inventory()).find((w) => w.pid === record.pid && w.visible);
          },
          Boolean,
          'Managed native viewer must be identifiable',
        );
      await timedDock((await windowFor(a.id)).id);
      let v = await voice(a.id);
      assert.equal(v.conversation.voice, 'off');
      await wait(microphones, (n) => n === baseline + 1, 'Native microphone did not open');
      observations.push({ action: 'native-voice-A', status: v, microphones: await microphones() });
      await timedDock((await windowFor(b.id)).id);
      v = await voice(b.id);
      assert.equal(v.conversation.voice, 'off');
      await wait(microphones, (n) => n === baseline + 1, 'Voice B microphone did not open');
      observations.push({ action: 'native-voice-B', status: v, microphones: await microphones() });
      undock();
      await voice('none');
      await wait(microphones, (n) => n === baseline, 'Undock microphone remains open');
      await avatar(
        `(async()=>{const ctx=new AudioContext();const output=ctx.createMediaStreamDestination();const source=ctx.createConstantSource();source.offset.value=0;source.connect(output);source.start();window.voiceProofAudio={ctx,source};await window.voyagerConversation.startVoice(output.stream.getAudioTracks()[0]);})()`,
      );
      await wait(
        () => rpc('status'),
        (s) => s.conversation.voice === 'on' && s.voice.target === 'app',
        'App voice not active',
      );
      observations.push({
        action: 'app-voice-suppresses-native',
        status: await rpc('status'),
        microphones: await microphones(),
      });
      assert.equal(await microphones(), baseline);
      await timedDock((await windowFor(a.id)).id);
      v = await voice(a.id);
      assert.equal(v.conversation.voice, 'off');
      assert(await avatar(`window.voyagerConversation.startVoice().then(()=>false,()=>true)`));
      observations.push({ action: 'app-to-native', status: v });
      await wait(
        () =>
          avatar(
            `!document.getElementById('voice-toggle').disabled && document.getElementById('voice-toggle').getAttribute('aria-pressed')==='true'`,
          ),
        Boolean,
        'Native waveform not ready',
      );
      await avatar(`document.getElementById('voice-toggle').click()`);
      await voice('none');
      await wait(microphones, (n) => n === baseline, 'Native wave stop did not close microphone');
      await wait(
        () =>
          avatar(
            `!document.getElementById('voice-toggle').disabled && document.getElementById('voice-toggle').getAttribute('aria-pressed')==='false'`,
          ),
        Boolean,
        'Native waveform did not reset',
      );
      await avatar(`document.getElementById('voice-toggle').click()`);
      await voice(a.id);
      undock();
      await voice('none');
      await wait(microphones, (n) => n === baseline, 'Final native microphone remains');
      await avatar(`window.voiceProofAudio.source.stop();window.voiceProofAudio.ctx.close()`);
      observations.push({ action: 'voice-stream-bound', baseline, maximum });
      assert(maximum <= baseline + 1);
    } finally {
      clearInterval(watch);
      undock();
    }
    for (const id of owned) await action(id, 'Stop and remove');
    await rpc('remove-fleet', fleet.id);
    await refresh();
    assert.deepEqual(await rpc('list'), []);
    assert.equal(await ui(`document.querySelectorAll('[data-key]').length`), 0);
    const events = await rpc('events', '0');
    assert(events.events.some((e) => e.type === 'session.renamed'));
    observations.push({
      action: 'cleanup',
      status: await rpc('status'),
      retained_events: events.events.length,
    });
    await fs.writeFile(
      path.join(stateDir, 'panel-polish.png'),
      (await panelWin.webContents.capturePage()).toPNG(),
    );
    await save('pass');
    console.log('Polish and voice native journey passed.');
  } catch (error) {
    const detail = await ui(`document.getElementById('instance-error').textContent`).catch(
      () => 'Renderer unavailable',
    );
    await save('rework', `${error.stack}\nPanel: ${detail}`);
    throw error;
  }
};
