const status = document.querySelector('#status');
const messages = document.querySelector('#messages');
const voiceStatus = document.querySelector('#voice-status');
const audio = document.querySelector('#audio');
let peer;
let microphone;
let activeVoice = false;
let voiceError;
let audioContext;
let outgoing;
let playbackContext;
let analyser;
let proving = false;
let response;
let received;
const voiceEvents = [];

function message(who, text) {
  const line = document.createElement('p');
  const label = document.createElement('strong');
  label.textContent = `${who}: `;
  line.append(label, document.createTextNode(text));
  messages.append(line);
  messages.scrollTop = messages.scrollHeight;
}

function waitUntil(test, milliseconds) {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + milliseconds;
    const timer = setInterval(() => {
      try {
        const value = test();
        if (value) {
          clearInterval(timer);
          resolve(value);
        } else if (performance.now() >= deadline) {
          clearInterval(timer);
          reject(new Error('Observation timed out'));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 50);
  });
}

window.voyager.onEvent(async (value) => {
  if (value.event === 'item/completed' && value.params.item?.type === 'agentMessage') {
    received = value.params.item.text;
    message('Voyager', received);
  }
  if (value.event === 'turn/completed') {
    if (value.params.turn.status === 'completed') response?.resolve(received);
    else response?.reject(new Error(`Turn ${value.params.turn.status}`));
    response = undefined;
  }
  if (value.event === 'runtime-closed') status.textContent = 'Runtime disconnected';
  if (value.event.startsWith('thread/realtime/')) {
    if (value.event === 'thread/realtime/error') {
      voiceError = value.params.message;
      voiceStatus.textContent = `Voice unavailable: ${voiceError}`;
      microphone?.getTracks().forEach((track) => track.stop());
      peer?.close();
      activeVoice = false;
      document.querySelector('#voice').textContent = '〰 Start voice';
    }
    if (value.event === 'thread/realtime/sdp') {
      try {
        await peer.setRemoteDescription({ type: 'answer', sdp: value.params.sdp });
      } catch (error) {
        voiceError = error.message;
      }
    }
    if (value.event === 'thread/realtime/started') activeVoice = true;
    if (value.event === 'thread/realtime/transcript/done')
      message(value.params.role === 'user' ? 'You' : 'Voyager', value.params.text);
    const observation = { event: value.event };
    if (value.params.message) observation.message = value.params.message;
    if (value.params.version) observation.version = value.params.version;
    if (value.params.sdp) observation.sdp_received = true;
    if (proving && value.event === 'thread/realtime/transcript/done') {
      observation.role = value.params.role;
      observation.text = value.params.text;
    }
    voiceEvents.push(observation);
    await window.voyager.observe(observation);
  }
});

async function chat(text) {
  if (response) throw new Error('Wait for the current answer');
  message('You', text);
  received = undefined;
  const completed = new Promise((resolve, reject) => {
    response = { resolve, reject };
  });
  completed.catch(() => {});
  try {
    await window.voyager.chat(text);
  } catch (error) {
    response = undefined;
    throw error;
  }
  return Promise.race([
    completed,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('No completed answer after 90 seconds')), 90000),
    ),
  ]);
}

async function startVoice(proof = false) {
  voiceError = undefined;
  activeVoice = false;
  peer = new RTCPeerConnection();
  const transceiver = peer.addTransceiver('audio', { direction: 'sendrecv' });
  outgoing = transceiver.sender;
  if (!proof) {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    await transceiver.sender.replaceTrack(microphone.getAudioTracks()[0]);
  }
  audio.muted = proof;
  peer.ontrack = (event) => {
    audio.srcObject = event.streams[0] || new MediaStream([event.track]);
    if (proof) {
      playbackContext = new AudioContext();
      playbackContext.resume();
      analyser = playbackContext.createAnalyser();
      const gain = playbackContext.createGain();
      gain.gain.value = 0;
      playbackContext.createMediaStreamSource(audio.srcObject).connect(analyser);
      analyser.connect(gain).connect(playbackContext.destination);
    }
    audio.play().catch((error) => {
      voiceStatus.textContent = `Audio playback: ${error.message}`;
    });
  };
  const channel = peer.createDataChannel('oai-events');
  channel.onmessage = (event) => {
    try {
      const value = JSON.parse(event.data);
      const observation = { data_channel_event: value.type };
      if (value.transcript) observation.transcript = value.transcript;
      if (value.delta && /transcript|text/.test(value.type)) observation.delta = value.delta;
      if (value.error?.message) observation.error = value.error.message;
      voiceEvents.push(observation);
      window.voyager.observe(observation);
    } catch (_) {}
  };
  voiceStatus.textContent = 'Connecting voice…';
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await window.voyager.startVoice(peer.localDescription.sdp);
  await waitUntil(() => {
    if (voiceError) throw new Error(voiceError);
    return peer.connectionState === 'connected' && activeVoice;
  }, 30000);
  voiceStatus.textContent = proof
    ? 'Voice connected · microphone off for automated test'
    : 'Listening · speak naturally';
  document.querySelector('#voice').textContent = 'Stop voice';
  return { connection: peer.connectionState, microphone: !proof };
}

async function stopVoice() {
  microphone?.getTracks().forEach((track) => track.stop());
  peer?.close();
  await window.voyager.stopVoice();
  activeVoice = false;
  voiceStatus.textContent = 'Microphone off';
  document.querySelector('#voice').textContent = '〰 Start voice';
}

document.querySelector('#chat').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#text');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  document.querySelector('#send').disabled = true;
  try {
    await chat(text);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    document.querySelector('#send').disabled = false;
  }
});
document.querySelector('#voice').addEventListener('click', async () => {
  try {
    if (activeVoice) await stopVoice();
    else await startVoice();
  } catch (error) {
    voiceStatus.textContent = error.message;
    microphone?.getTracks().forEach((track) => track.stop());
    peer?.close();
  }
});
window.voyager
  .ready()
  .then((value) => {
    status.textContent = `Online · ${value.model}`;
  })
  .catch((error) => {
    status.textContent = error.message;
  });
window.runExperimentProof = async (fixture) => {
  proving = true;
  const result = { text: {}, voice: {} };
  try {
    result.text.answer = await chat('Reply exactly: Voyager has its own conversation.');
    result.text.pass = result.text.answer === 'Voyager has its own conversation.';
    result.voice = await startVoice(true);
    if (fixture) {
      audioContext = new AudioContext();
      await audioContext.resume();
      const bytes = Uint8Array.from(atob(fixture), (character) => character.charCodeAt(0));
      const buffer = await audioContext.decodeAudioData(bytes.buffer);
      const destination = audioContext.createMediaStreamDestination();
      await outgoing.replaceTrack(destination.stream.getAudioTracks()[0]);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      source.start();
      result.voice.input = { type: 'synthetic speech fixture', seconds: buffer.duration };
    }
    const end = performance.now() + 30000;
    let stats;
    let peak = 0;
    while (performance.now() < end) {
      if (voiceError) throw new Error(voiceError);
      const report = await peer.getStats();
      for (const item of report.values()) {
        if (item.type === 'inbound-rtp' && item.kind === 'audio')
          stats = {
            bytes_received: item.bytesReceived,
            packets_received: item.packetsReceived,
            samples_received: item.totalSamplesReceived,
            audio_energy: item.totalAudioEnergy,
          };
      }
      if (analyser) {
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      }
      if (peak > 0.001) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    result.voice.audio = stats;
    result.voice.decoded_peak = peak;
    result.voice.events = voiceEvents;
    result.voice.audio_received = Boolean(peak > 0.001);
    result.voice.human_microphone_proved = false;
    result.voice.audible_playback_proved = false;
    result.voice.full_duplex_proved = false;
    await stopVoice();
    await audioContext?.close();
    await playbackContext?.close();
  } catch (error) {
    result.error = error.message;
    result.voice.events = voiceEvents;
    microphone?.getTracks().forEach((track) => track.stop());
    peer?.close();
  }
  proving = false;
  return result;
};
