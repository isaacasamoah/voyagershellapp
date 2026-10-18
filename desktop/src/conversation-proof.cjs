const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function waitFor(check, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw Error('Conversation proof timed out.');
}
async function run({ panelWin, avatarWin, conversation, rpc, directory, screen }) {
  await fs.mkdir(directory, { recursive: true });
  const ready = await waitFor(async () => {
    await conversation.poll();
    return conversation.snapshot().status.phase === 'ready' && conversation.snapshot().status;
  });
  const result = { ready, initial_vessels: await rpc('list') };
  assert.equal(result.initial_vessels.length, 0);
  result.geometry = await avatarWin.webContents.executeJavaScript(`(() => {
    const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
    return {avatar:rect('avatar'),voice:rect('voice-toggle'),indicator:rect('indicator')};
  })()`);
  assert.ok(result.geometry.voice.x < result.geometry.avatar.x + result.geometry.avatar.width / 2);
  assert.ok(
    result.geometry.indicator.x > result.geometry.avatar.x + result.geometry.avatar.width / 2,
  );
  const display =
    screen.getAllDisplays().find((candidate) => /dell/i.test(candidate.label)) ||
    screen.getAllDisplays().find((candidate) => candidate.id !== screen.getPrimaryDisplay().id) ||
    screen.getPrimaryDisplay();
  result.display = display;
  panelWin.setPosition(display.workArea.x + display.workArea.width - 344, display.workArea.y + 24);
  panelWin.show();
  panelWin.focus();
  await delay(200);
  await panelWin.webContents.executeJavaScript(`document.getElementById('chat-text').focus()`);
  await panelWin.webContents.insertText('Reply exactly: Voyager is ready to chat.');
  panelWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  panelWin.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  panelWin.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await waitFor(async () => {
    await conversation.poll();
    return conversation
      .snapshot()
      .events.some(
        (event) =>
          event.type === 'message' &&
          event.data.role === 'assistant' &&
          event.data.text === 'Voyager is ready to chat.',
      );
  });
  result.text_events = conversation
    .snapshot()
    .events.filter((event) => ['message', 'turn-completed'].includes(event.type));
  const fixture = (await fs.readFile(process.env.VOYAGER_CONVERSATION_PROOF_AUDIO)).toString(
    'base64',
  );
  result.voice = await avatarWin.webContents.executeJavaScript(`(async () => {
    const sender = await window.voyagerConversation.startVoice(true);
    const audio=document.getElementById('voice-output'); audio.muted=true;
    const context=new AudioContext(); await context.resume();
    const destination=context.createMediaStreamDestination();
    await sender.replaceTrack(destination.stream.getAudioTracks()[0]);
    const samples=Uint8Array.from(atob(${JSON.stringify(fixture)}), c=>c.charCodeAt(0));
    const source=context.createBufferSource(); source.buffer=await context.decodeAudioData(samples.buffer);source.connect(destination);
    const analyser=context.createAnalyser(), gain=context.createGain();gain.gain.value=0;
    context.createMediaStreamSource(window.voyagerConversation.stream()).connect(analyser);analyser.connect(gain).connect(context.destination);
    source.start(); const deadline=Date.now()+30000;let peak=0;
    while(Date.now()<deadline){const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);for(const sample of data)peak=Math.max(peak,Math.abs(sample));if(peak>.001)break;await new Promise(r=>setTimeout(r,50));}
    window.voyagerConversation.releaseAudio();await window.voyager.stopVoice();await context.close();
    return {decoded_peak:peak,real_microphone:false,full_duplex_human_acceptance:false};
  })()`);
  assert.ok(result.voice.decoded_peak > 0.001);
  await conversation.poll();
  result.final = await rpc('status');
  assert.equal(result.final.conversation.pid, ready.pid);
  assert.equal((await rpc('list')).length, 0);
  await delay(300);
  await fs.writeFile(
    path.join(directory, 'panel.png'),
    (await panelWin.webContents.capturePage()).toPNG(),
  );
  await fs.writeFile(
    path.join(directory, 'avatar.png'),
    (await avatarWin.webContents.capturePage()).toPNG(),
  );
  if (process.env.VOYAGER_CONVERSATION_PROOF_TOOLS === '1')
    result.assignment = await require('./assignment-proof.cjs').run({
      panelWin,
      avatarWin,
      conversation,
      rpc,
      directory,
    });
  await fs.writeFile(path.join(directory, 'proof.json'), JSON.stringify(result, null, 2));
  console.log(`Conversation proof passed: ${directory}`);
  return result;
}
module.exports = { run };
