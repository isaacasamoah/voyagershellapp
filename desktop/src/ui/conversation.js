(() => {
  const api = window.voyager;
  const view = new URLSearchParams(location.search).get('view');
  const $ = (id) => document.getElementById(id);
  const toggle = $('voice-toggle');
  const disclosure = $('conversation');
  const output = $('voice-output');
  let peer;
  let microphone;
  let voiceClient;
  let changingVoice = false;
  let status = { phase: 'starting', voice: 'off' };
  let lastSequence = 0;
  let thread;
  let requestId;
  let uncertain = false;
  let issue = null;
  const messages = [];

  function feedback(message) {
    $('chat-status').textContent = message || '';
    $('chat-status').hidden = !message;
    toggle.title = message || (status.voice === 'on' ? 'Stop voice' : 'Start voice');
  }
  function releaseAudio() {
    microphone?.getTracks().forEach((track) => track.stop());
    microphone = null;
    peer?.close();
    peer = null;
    voiceClient = null;
  }
  function render() {
    toggle.disabled = changingVoice || status.phase !== 'ready';
    toggle.setAttribute('aria-pressed', String(status.voice === 'on'));
    toggle.setAttribute('aria-label', status.voice === 'on' ? 'Stop voice' : 'Start voice');
    $('chat-send').disabled = status.phase !== 'ready' || status.busy || uncertain;
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
    $('chat-unread').hidden = disclosure.open;
  }
  async function update(value) {
    if (thread && value.status.thread_id && thread !== value.status.thread_id) {
      lastSequence = 0;
      messages.length = 0;
      $('chat-messages').replaceChildren();
      releaseAudio();
    }
    thread = value.status.thread_id || thread;
    const previousVoice = status.voice;
    status = value.status;
    if (status.phase === 'failed' || (previousVoice === 'on' && status.voice === 'off'))
      releaseAudio();
    for (const event of value.events || []) {
      if (event.seq <= lastSequence) continue;
      lastSequence = event.seq;
      if (event.type === 'message') addMessage(event.data);
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
    render();
  }
  function accepted(value) {
    if (value?.error) throw Object.assign(Error(value.error), { code: value.code });
    return value;
  }
  async function startVoice(fixture = null) {
    if (view !== 'avatar') throw Error('Voice belongs to the avatar.');
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
    peer.createDataChannel('oai-events');
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
        if (peer || status.voice === 'on') {
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
    disclosure.addEventListener('toggle', () => {
      if (disclosure.open) $('chat-unread').hidden = true;
    });
    $('chat-form').onsubmit = async (event) => {
      event.preventDefault();
      if (uncertain || status.busy) return;
      const text = $('chat-text').value.trim();
      if (!text) return;
      issue = null;
      requestId ||= crypto.randomUUID();
      $('chat-send').disabled = true;
      try {
        accepted(await api.chat(text, requestId));
        requestId = null;
        $('chat-text').value = '';
      } catch (error) {
        uncertain = !['invalid_input', 'busy', 'not_found', 'forbidden'].includes(error.code);
        if (!uncertain) requestId = null;
        issue = error.message;
        feedback(`${issue}${uncertain ? ' Your message was not automatically retried.' : ''}`);
      }
      render();
    };
  }
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
