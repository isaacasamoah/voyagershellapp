const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async ({ avatarWin, panelWin, conversation, rpc, directory, setExpanded }, proof) => {
  await proof.wait(async () => {
    await conversation.poll();
    return conversation.snapshot().status.phase === 'ready';
  });
  assert.deepEqual(await rpc('list'), []);
  const initial = conversation.snapshot().status;
  const fixture = (await fs.readFile(process.env.VOYAGER_CONVERSATION_PROOF_AUDIO)).toString(
    'base64',
  );
  const observations = [];
  const expectedCount = /\b(?:zero|0|no)\s+(?:running\s+)?vessels\b/i;
  const expectAck = process.env.VOYAGER_HANDOFF_EXPECT_ACK !== 'disabled';
  const seen = new Set();
  let result;
  let journeyError;
  try {
    await avatarWin.webContents.executeJavaScript(`(async () => {
      const audio = new AudioContext();
      const destination = audio.createMediaStreamDestination();
      const samples = Uint8Array.from(atob(${JSON.stringify(fixture)}), c => c.charCodeAt(0));
      const source = audio.createBufferSource();
      source.buffer = await audio.decodeAudioData(samples.buffer);
      source.connect(destination);
      const events = [];
      let inputStarted = false;
      const create = RTCPeerConnection.prototype.createDataChannel;
      RTCPeerConnection.prototype.createDataChannel = function(...args) {
        const channel = create.apply(this, args);
        channel.addEventListener('open', () => events.push({ type: 'channel-open', at: performance.now() }));
        channel.addEventListener('message', ({ data }) => {
          const event = JSON.parse(data);
          events.push({ type: event.type, at: performance.now(), id: event.event_id,
            item: event.item_id || event.item?.id, delegation: event.delegation_item_id,
            itemFields: event.item ? Object.keys(event.item) : undefined,
            startMs: event.start_ms, endMs: event.end_ms, offsetMs: event.offset_ms,
            response: event.response_id || event.response?.id,
            turn: event.turn_id || event.turn?.id, fields: Object.keys(event),
            transcript: /^(input|output)_transcript\.added$/.test(event.type) ? event.item?.text : undefined });
        });
        return channel;
      };
      navigator.mediaDevices.getUserMedia = async () => destination.stream;
      window.nativeHandoff = { events, origin: performance.timeOrigin,
        start: async () => { await audio.resume(); source.start(); inputStarted = true; },
        close: async () => { if (inputStarted) source.stop(); await audio.close(); } };
    })()`);
    await setExpanded(true, { x: 800, y: 300 });
    avatarWin.show();
    await proof.delay(400);
    await proof.click(avatarWin, 'voice-toggle');
    await proof.wait(
      () => avatarWin.webContents.executeJavaScript('window.nativeHandoff.events'),
      (events) => events.some((event) => event.type === 'channel-open'),
      'Native voice channel did not open',
      30000,
    );
    const capture =
      process.env.VOYAGER_HANDOFF_DIAGNOSTIC_MUTED === '1'
        ? async (_directory, _label, action) => {
            await avatarWin.webContents.executeJavaScript(
              "document.getElementById('voice-output').muted = true",
            );
            return { result: await action(), audio: { recorded: false, peak: 0 } };
          }
        : proof.captureOutput;
    result = await capture(directory, 'handoff-output', async () => {
      await avatarWin.webContents.executeJavaScript('window.nativeHandoff.start()');
      let completedAt;
      return proof.wait(
        async () => {
          await conversation.poll();
          for (const event of conversation.snapshot().events) {
            if (seen.has(event.seq) || !['tool', 'message', 'turn-completed'].includes(event.type))
              continue;
            seen.add(event.seq);
            observations.push({ observedAt: performance.now(), event });
            if (event.type === 'turn-completed')
              completedAt = performance.timeOrigin + performance.now();
          }
          const voice = await avatarWin.webContents.executeJavaScript(
            '({ events: window.nativeHandoff.events, origin: window.nativeHandoff.origin })',
          );
          return { voice, completedAt };
        },
        ({ voice, completedAt }) =>
          observations.some(
            ({ event }) =>
              event.type === 'message' &&
              event.data.voice &&
              event.data.role === 'assistant' &&
              expectedCount.test(event.data.text),
          ) &&
          completedAt &&
          voice.events.some(
            (event) => event.type === 'turn.done' && voice.origin + event.at > completedAt,
          ),
        'No completed backing turn followed by final audio delivery',
        25000,
      );
    });
    assert(observations.some(({ event }) => event.type === 'tool' && event.data.success));
    assert(
      observations.some(
        ({ event }) =>
          event.type === 'message' &&
          event.data.role === 'assistant' &&
          expectedCount.test(event.data.text),
      ),
    );
    assert(
      observations.some(
        ({ event }) => event.type === 'turn-completed' && event.data.status === 'completed',
      ),
    );
    const events = result.result.voice.events;
    const delegated = events.find((event) => event.type === 'delegation.created');
    assert.equal(typeof delegated?.item, 'string', 'Missing native delegation identity');
    const returned = events.find((event) => event.type === 'delegation.context.appended');
    assert(returned, 'No native return of the backing result was observed');
    assert(
      events
        .filter((event) => event.type === 'delegation.context.appended')
        .every((event) => event.delegation === delegated.item),
      'Native result returned to a different delegation',
    );
    const outputs = events.filter((event) => event.type === 'output_transcript.added');
    assert(
      outputs.every(
        (event) => typeof event.item === 'string' && typeof event.transcript === 'string',
      ),
      'Missing public output item identity or transcript',
    );
    assert(
      expectedCount.test(
        outputs
          .filter((event) => event.at >= returned.at)
          .map((event) => event.transcript)
          .join(''),
      ),
      'Native final transcript did not contain the actual count',
    );
    const earlyOutput = events.some(
      (event) => event.type === 'output_transcript.added' && event.at < returned.at,
    );
    assert.equal(
      earlyOutput,
      expectAck,
      'Acknowledgement comparison did not distinguish early output',
    );
    result.readable = await proof.wait(
      () =>
        panelWin.webContents.executeJavaScript(`(() => {
        const disclosure = document.getElementById('chat-disclosure');
        const history = document.getElementById('chat-messages').getBoundingClientRect();
        return [...document.querySelectorAll('.chat-message[data-role="assistant"]')].map(node => {
          const rect = node.getBoundingClientRect();
          return { text: node.innerText, visible: !disclosure.inert && disclosure.getAttribute('aria-hidden') === 'false' && rect.height > 0 && rect.bottom > history.top && rect.top < history.bottom && rect.top < innerHeight && rect.bottom > 0 };
        });
      })()`),
      (messages) =>
        panelWin.isVisible() &&
        messages.some((message) => message.visible && expectedCount.test(message.text)),
      'The answer did not appear in visible chat',
    );
    await fs.writeFile(
      path.join(directory, 'handoff-panel.png'),
      (await panelWin.webContents.capturePage()).toPNG(),
    );
    assert.equal(conversation.snapshot().status.pid, initial.pid);
    assert.deepEqual(await rpc('list'), []);
    assert(
      result.audio.peak > 20,
      'No recorded output; muted diagnostics cannot pass audio acceptance',
    );
    return { initial, observations, ...result, realMicrophone: false, humanListening: false };
  } catch (error) {
    journeyError = error;
    throw error;
  } finally {
    const cleanup = await Promise.allSettled([
      (async () => {
        const voice = await avatarWin.webContents.executeJavaScript(
          'window.nativeHandoff && ({ events: window.nativeHandoff.events, origin: window.nativeHandoff.origin })',
        );
        await fs.writeFile(
          path.join(directory, 'handoff-observations.json'),
          JSON.stringify(
            { initial, expectAck, observations, result, voice, error: journeyError?.stack },
            null,
            2,
          ),
        );
      })(),
      avatarWin.webContents.executeJavaScript(
        'window.voyagerConversation.releaseAudio(); window.nativeHandoff?.close()',
      ),
      conversation.stopVoice(),
    ]);
    const failures = cleanup
      .filter((outcome) => outcome.status === 'rejected')
      .map((outcome) => outcome.reason);
    if (failures.length)
      throw new AggregateError(
        [journeyError, ...failures].filter(Boolean),
        'Handoff journey or cleanup failed',
      );
  }
};
