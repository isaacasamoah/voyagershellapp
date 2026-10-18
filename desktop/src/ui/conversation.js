(() => {
  const api = window.voyager;
  const view = new URLSearchParams(location.search).get('view');
  const $ = (id) => document.getElementById(id);
  const toggle = $('voice-toggle');
  const disclosure = $('conversation');
  const output = $('voice-output');
  let docked = null;
  let nativeSupported = false;
  let vesselVoice = {};
  let peer;
  let microphone;
  let voiceClient;
  let changingVoice = false;
  const voiceActivity = new Map();
  let status = { phase: 'starting', voice: 'off' };
  let lastSequence = 0;
  let thread;
  let requestId;
  let pendingText;
  let uncertain = false;
  let issue = null;
  let initialized = false;
  let questionKey;
  function setOpen(open) {
    disclosure.dataset.open = String(open);
    $('chat-disclosure').inert = !open;
    $('chat-disclosure').setAttribute('aria-hidden', String(!open));
    $('chat-expand').textContent = open ? '⌃' : '⌄';
    $('chat-expand').setAttribute('aria-expanded', String(open));
    $('chat-expand').setAttribute('aria-label', open ? 'Hide conversation' : 'Show conversation');
    $('chat-expand').title = open ? 'Hide conversation' : 'Show conversation';
  }
  const messages = [];

  function feedback(message) {
    $('chat-status').textContent = message || '';
    $('chat-status').hidden = !message;
    if (!docked) toggle.title = message || (status.voice === 'on' ? 'Stop voice' : 'Start voice');
  }
  function releaseAudio() {
    microphone?.getTracks().forEach((track) => track.stop());
    microphone = null;
    peer?.close();
    peer = null;
    voiceClient = null;
    voiceActivity.clear();
  }
  function render() {
    const active = docked
      ? vesselVoice.target === docked && vesselVoice.state === 'on'
      : status.voice === 'on';
    toggle.disabled =
      changingVoice ||
      (docked ? !nativeSupported || vesselVoice.state === 'switching' : status.phase !== 'ready');
    toggle.setAttribute('aria-pressed', String(active));
    toggle.setAttribute('aria-label', active ? 'Stop voice' : 'Start voice');
    if (docked)
      toggle.title = !nativeSupported
        ? 'Voice is unavailable for this vessel'
        : vesselVoice.error || (active ? 'Stop vessel voice' : 'Start vessel voice');
    $('chat-send').disabled = status.phase !== 'ready' || status.busy || uncertain;
    $('chat-text').readOnly = uncertain;
    $('chat-retry').hidden = !uncertain;
    $('chat-retry').disabled = status.phase !== 'ready';
    if (status.phase === 'failed')
      feedback('Voyager conversation is unavailable. Your vessels are unaffected.');
    else if (status.busy) feedback('Thinking…');
    else if (!uncertain && !issue) feedback('');
  }
  function addMessage(data) {
    if (!['user', 'assistant'].includes(data.role) || typeof data.text !== 'string' || !data.text)
      return;
    messages.push(data);
    if (messages.length > 100) messages.shift();
    if (view !== 'panel') return;
    const nearBottom =
      $('chat-messages').scrollHeight -
        $('chat-messages').scrollTop -
        $('chat-messages').clientHeight <
      50;
    const nodes = messages.map((entry) => {
      const line = document.createElement('p');
      line.className = 'chat-message';
      line.dataset.role = entry.role;
      line.textContent = entry.text;
      line.setAttribute(
        'aria-label',
        `${entry.role === 'user' ? 'You' : 'Voyager'}: ${entry.text}`,
      );
      return line;
    });
    $('chat-messages').replaceChildren(...nodes);
    if (nearBottom) $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
    if (initialized) setOpen(true);
  }
  function renderQuestions(value) {
    if (view !== 'panel') return;
    const pending = (value.questions || []).filter(
      (q) => !q.answered || (q.answer && q.answer.delivery !== 'accepted'),
    );
    const key = JSON.stringify([pending, value.presentations]);
    if (questionKey === key) return;
    const previous = $('chat-questions').dataset.ids || '';
    questionKey = key;
    const ids = pending.map((q) => q.request_id);
    $('chat-questions').dataset.ids = JSON.stringify(ids);
    $('chat-questions').replaceChildren(
      ...pending.map((question) => {
        const card = document.createElement('article');
        card.className = 'chat-question';
        card.dataset.request = question.request_id;
        const source = document.createElement('strong');
        source.textContent = question.source_name || 'A vessel';
        card.append(source);
        const presentation = value.presentations?.[question.request_id];
        const text = document.createElement('p');
        text.textContent = question.answered
          ? {
              recorded: 'Your answer is saved. Waiting for delivery.',
              failed: 'Your answer is saved, but could not be delivered.',
              uncertain: 'Your answer is saved. Delivery is unconfirmed.',
            }[question.answer?.delivery] || 'Your answer is saved.'
          : presentation?.text || 'A question is being prepared…';
        card.append(text);
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Original';
        details.append(summary);
        const original = document.createElement('p');
        original.textContent = question.message;
        details.append(original);
        card.append(details);
        return card;
      }),
    );
    if (initialized && ids.some((id) => !previous.includes(id))) setOpen(true);
  }
  async function update(value) {
    if (thread && value.status.thread_id && thread !== value.status.thread_id) {
      lastSequence = 0;
      messages.length = 0;
      $('chat-messages').replaceChildren();
      releaseAudio();
    }
    thread = value.status.thread_id || thread;
    renderQuestions(value);
    const previousVoice = status.voice;
    status = value.status;
    window.voyagerAstronaut?.setBusy(status.phase === 'ready' && Boolean(status.busy));
    if (status.phase === 'failed' || (previousVoice === 'on' && status.voice === 'off'))
      releaseAudio();
    for (const event of value.events || []) {
      if (event.seq <= lastSequence) continue;
      lastSequence = event.seq;
      if (event.type === 'message') {
        addMessage(event.data);
        if (event.data.role === 'user' && event.data.id === requestId) {
          uncertain = false;
          issue = null;
          requestId = null;
          pendingText = null;
          $('chat-text').value = '';
        }
      }
      if (initialized && event.type === 'tool') window.voyagerAstronaut?.toolBeat();
      if (event.type === 'turn-completed' && event.data.status !== 'completed') {
        issue = 'Voyager did not complete that reply. It was not retried.';
        feedback(issue);
      }
      if (
        view === 'avatar' &&
        event.type === 'voice-sdp' &&
        peer &&
        (!voiceClient || voiceClient === event.data.client_id)
      ) {
        voiceClient = event.data.client_id;
        try {
          await peer.setRemoteDescription({ type: 'answer', sdp: event.data.sdp });
        } catch (error) {
          releaseAudio();
          issue = error.message;
          feedback(issue);
          await api.stopVoice();
        }
      }
      if (event.type === 'voice-error') {
        releaseAudio();
        feedback(event.data.message || 'Voice could not connect.');
        if (view === 'avatar') await api.stopVoice();
      }
    }
    initialized = true;
    render();
  }
  function accepted(value) {
    if (value?.error) throw Object.assign(Error(value.error), { code: value.code });
    return value;
  }
  async function startVoice(fixture = null) {
    if (view !== 'avatar' || docked) throw Error('Voice belongs to the current dock.');
    accepted(await api.selectAppVoice());
    output.muted = Boolean(fixture);
    peer = new RTCPeerConnection();
    const sender = peer.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    if (!fixture) {
      microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      await sender.replaceTrack(microphone.getAudioTracks()[0]);
    }
    peer.ontrack = (event) => {
      output.srcObject = event.streams[0] || new MediaStream([event.track]);
      output.play().catch((error) => feedback(error.message));
    };
    peer.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(peer?.connectionState)) {
        releaseAudio();
        issue = 'Voice disconnected. Press the soundwave to reconnect.';
        feedback(issue);
        api.stopVoice();
      }
    };
    const channel = peer.createDataChannel('oai-events');
    channel.onmessage = (event) => {
      let type;
      try {
        type = JSON.parse(event.data).type;
      } catch {
        return;
      }
      const activity = {
        'input_audio_buffer.speech_started': ['human', true],
        'input_audio_buffer.speech_stopped': ['human', false],
        'output_audio_buffer.started': ['assistant', true],
        'output_audio_buffer.stopped': ['assistant', false],
        'output_audio_buffer.cleared': ['assistant', false],
        'response.audio.delta': ['assistant', true],
        'response.output_audio.delta': ['assistant', true],
        'response.audio.done': ['assistant', false],
        'response.output_audio.done': ['assistant', false],
        'response.done': ['assistant', false],
      }[type];
      if (activity && voiceActivity.get(activity[0]) !== activity[1]) {
        voiceActivity.set(...activity);
        api.voiceActivity(...activity);
      }
    };
    await peer.setLocalDescription(await peer.createOffer());
    const result = accepted(await api.startVoice(peer.localDescription.sdp));
    voiceClient = result.client_id;
    const deadline = Date.now() + 30000;
    while (peer && peer.connectionState !== 'connected') {
      if (Date.now() > deadline) throw Error('Voice did not connect.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!peer) throw Error('Voice stopped before connecting.');
    return sender;
  }
  if (view === 'avatar') {
    toggle.addEventListener('pointerdown', (event) => event.stopPropagation());
    toggle.onclick = async (event) => {
      event.stopPropagation();
      if (changingVoice) return;
      changingVoice = true;
      issue = null;
      render();
      try {
        if (docked) {
          releaseAudio();
          accepted(
            await api.nativeVoice(
              docked,
              !(vesselVoice.target === docked && vesselVoice.state === 'on'),
            ),
          );
        } else if (peer || status.voice === 'on') {
          releaseAudio();
          accepted(await api.stopVoice());
        } else await startVoice();
      } catch (error) {
        releaseAudio();
        issue = error.message;
        feedback(issue);
        await api.stopVoice();
      } finally {
        changingVoice = false;
        render();
        toggle.blur();
      }
    };
    window.addEventListener('beforeunload', releaseAudio);
  }
  if (view === 'panel') {
    $('chat-expand').onclick = () => setOpen(disclosure.dataset.open !== 'true');
    $('chat-retry').onclick = () => $('chat-form').requestSubmit();
    $('chat-form').onsubmit = async (event) => {
      event.preventDefault();
      if (status.busy && !uncertain) return;
      const text = uncertain ? pendingText : $('chat-text').value.trim();
      if (!text) return;
      issue = null;
      setOpen(true);
      requestId ||= crypto.randomUUID();
      $('chat-send').disabled = true;
      try {
        pendingText = text;
        accepted(await api.chat(text, requestId));
        uncertain = false;
        requestId = null;
        pendingText = null;
        $('chat-text').value = '';
      } catch (error) {
        uncertain = !['invalid_input', 'busy', 'not_found', 'forbidden'].includes(error.code);
        if (!uncertain) {
          requestId = null;
          pendingText = null;
        }
        issue = error.message;
        feedback(`${issue}${uncertain ? ' Your message was not automatically retried.' : ''}`);
      }
      render();
    };
  }
  api.onState?.((value) => {
    docked = value.docked;
    nativeSupported = value.sessions?.find((s) => s.id === docked)?.kind === 'codex';
    vesselVoice = value.service?.voice || {};
    if (docked) releaseAudio();
    render();
  });
  api.onConversation(update);
  api.conversationReady().then(update);
  window.voyagerConversation = {
    startVoice,
    releaseAudio,
    status: () => status,
    messages: () => [...messages],
    stream: () => output.srcObject,
  };
})();
