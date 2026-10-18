const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function waitFor(check, description, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(200);
  }
  throw Error(description);
}
async function run({ panelWin, avatarWin, conversation, rpc, directory }) {
  const result = {};
  const ui = (code) => panelWin.webContents.executeJavaScript(code);
  const audio = (code) => avatarWin.webContents.executeJavaScript(code);
  const question = `native-question-${Date.now()}`;
  const work = path.join(process.env.VOYAGER_STATE, 'work');
  await fs.mkdir(work, { recursive: true });
  let vessel;
  async function send(text) {
    panelWin.show();
    panelWin.focus();
    await ui("document.getElementById('chat-text').focus()");
    await panelWin.webContents.insertText(text);
    panelWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    panelWin.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    panelWin.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  }
  try {
    await waitFor(async () => {
      await conversation.poll();
      return (
        conversation.snapshot().status.phase === 'ready' && !conversation.snapshot().status.busy
      );
    }, 'Private conversation not ready');
    assert.equal((await rpc('list')).length, 0);
    await send(
      `Create one Codex Vessel named Beacon in ${work}, rank admiral, unassigned, and open it in Ghostty. Create a Fleet named Beacon trial and move Beacon into it. Use the actual Voyager tools and poll their operations. Do not give Beacon a task yet. Reply briefly when done.`,
    );
    vessel = await waitFor(async () => {
      await conversation.poll();
      const rows = await rpc('list');
      return (
        !conversation.snapshot().status.busy &&
        rows.find((row) => row.name === 'Beacon' && row.capture === 'connected')
      );
    }, 'Conversation did not create and open Beacon');
    result.native_window = await rpc('open', vessel.id, 'ghostty');
    assert.equal(result.native_window.state, 'completed');
    const fleetData = await rpc('fleets');
    assert.equal(fleetData.fleets.length, 1);
    assert.equal(fleetData.assignments[vessel.id], fleetData.fleets[0].id);
    result.creation = { vessel, fleetData };
    result.chat_ui = await ui(
      "({composer:!document.getElementById('chat-form').hidden,heading:document.querySelector('#conversation summary')?.textContent||null,expanded:document.getElementById('conversation').dataset.open,fleetsHeading:document.getElementById('add-fleet').parentElement.textContent})",
    );
    assert.equal(result.chat_ui.heading, null);
    assert.equal(result.chat_ui.expanded, 'true');
    await audio(`(async()=>{
      window.assignmentSender=await window.voyagerConversation.startVoice(true);
      const context=new AudioContext();await context.resume();
      const destination=context.createMediaStreamDestination();await window.assignmentSender.replaceTrack(destination.stream.getAudioTracks()[0]);
      const analyser=context.createAnalyser(),gain=context.createGain();gain.gain.value=0;
      context.createMediaStreamSource(window.voyagerConversation.stream()).connect(analyser);analyser.connect(gain).connect(context.destination);
      window.assignmentAudio={context,destination,analyser,peak:0};
      window.assignmentAudio.timer=setInterval(()=>{const d=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(d);for(const x of d)window.assignmentAudio.peak=Math.max(window.assignmentAudio.peak,Math.abs(x));},25);
    })()`);
    await delay(2000);
    await audio('window.assignmentAudio.peak=0');
    const prompt = `Use your bound Voyager CLI to escalate the question to the human. Run exactly: "$VOYAGER_BIN" --state "$VOYAGER_STATE" escalate ${question} "May I create approved.txt containing the word Voyager in my working folder?". Do not create the file before the human answers. After the answer arrives, act only if it authorizes that file, create it, then reply exactly BEACON_COMPLETED. Do not wait in a polling loop; the human answer arrives as a new Voyager message.`;
    result.agent_request = await rpc('send', vessel.id, `ask-${question}`, prompt);
    result.presentation = await waitFor(async () => {
      await conversation.poll();
      const snapshot = conversation.snapshot();
      const presentation = snapshot.presentations?.[question];
      return (
        presentation?.text &&
        snapshot.events.some(
          (e) =>
            e.type === 'escalation-speech' &&
            e.data.request_id === question &&
            e.data.state === 'accepted',
        ) &&
        presentation
      );
    }, 'Escalation was not rewritten and queued to native voice');
    result.notification_audio_peak = await waitFor(async () => {
      const peak = await audio('window.assignmentAudio.peak');
      return peak > 0.001 && peak;
    }, 'No decoded notification audio');
    await waitFor(
      async () =>
        await ui(`Boolean(document.querySelector('.chat-question[data-request="${question}"]'))`),
      'Question did not appear inside chat',
    );
    await fs.writeFile(
      path.join(directory, 'pending-question.png'),
      (await panelWin.webContents.capturePage()).toPNG(),
    );
    const input = (await fs.readFile(process.env.VOYAGER_ASSIGNMENT_PROOF_AUDIO)).toString(
      'base64',
    );
    await audio(`(async()=>{
      const state=window.assignmentAudio;
      const samples=Uint8Array.from(atob(${JSON.stringify(input)}),c=>c.charCodeAt(0));
      const source=state.context.createBufferSource();source.buffer=await state.context.decodeAudioData(samples.buffer);source.connect(state.destination);source.start();
    })()`);
    result.answer = await waitFor(async () => {
      const questions = await rpc('escalations');
      return questions.find(
        (q) => q.request_id === question && q.answered && q.answer?.delivery === 'accepted',
      );
    }, 'Spoken human reply was not bound and delivered to the original escalation');
    await waitFor(async () => {
      try {
        return (await fs.readFile(path.join(work, 'approved.txt'), 'utf8')).trim() === 'Voyager';
      } catch {
        return false;
      }
    }, 'Beacon did not complete the approved file action');
    result.work_events = await waitFor(async () => {
      const page = await rpc('events', '0');
      const events = page.events.filter((e) => e.session_id === vessel.id);
      return (
        events.some(
          (e) =>
            e.type === 'message' &&
            e.payload?.role === 'assistant' &&
            e.payload?.text?.includes('BEACON_COMPLETED'),
        ) &&
        events.some((e) => e.type === 'turn.completed' && e.payload?.has_error === false) &&
        events
      );
    }, 'Native completion evidence was not captured');
    await waitFor(async () => {
      await conversation.poll();
      return await ui('document.querySelectorAll(".chat-question").length===0');
    }, 'Answered question remained in chat');
    result.final_conversation = conversation.snapshot().status;
    result.tools = conversation.snapshot().events.filter((e) => e.type === 'tool');
    assert.ok(result.tools.some((e) => e.data.name === 'voyager_answer' && e.data.success));
    result.status = 'pass';
  } catch (error) {
    result.status = 'rework';
    result.error = error.stack;
    throw error;
  } finally {
    await audio(
      `(async()=>{if(window.assignmentAudio){clearInterval(window.assignmentAudio.timer);await window.assignmentAudio.context.close();}window.voyagerConversation.releaseAudio();await window.voyager.stopVoice();})()`,
    ).catch(() => {});
    if (vessel) {
      result.cleanup = await rpc('remove', vessel.id, '--stop');
    }
    const data = await rpc('fleets');
    for (const fleet of data.fleets) await rpc('remove-fleet', fleet.id);
    await fs.writeFile(path.join(directory, 'assignment.json'), JSON.stringify(result, null, 2));
  }
  return result;
}
module.exports = { run };
