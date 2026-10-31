(() => {
  let peer;
  let microphone;
  let startingVoice = false;
  let voiceRequested = false;
  let generation = 0;
  let startup;
  let cleanupError;
  let providerStop;
  function releaseVoice() {
    microphone?.getTracks().forEach((track) => track.stop());
    microphone = null;
    peer?.close();
    peer = null;
    $("voice").setAttribute("aria-pressed", "false");
    $("voice").setAttribute("aria-label", "Start voice");
    $("voice").title = "Start voice";
    $("voice").dataset.connection = "closed";
  }

  function stopProviderVoice() {
    if (providerStop) return providerStop;
    if (!voiceRequested) return Promise.resolve();
    voiceRequested = false;
    providerStop = call("voice-stop")
      .catch((error) => {
        cleanupError = error.message;
        $("chat-state").textContent =
          `Voice stop unconfirmed. ${error.message}`;
      })
      .finally(() => {
        providerStop = null;
      });
    return providerStop;
  }

  api.on("conversation", async (event) => {
    if (event.type === "error") {
      releaseVoice();
      await stopProviderVoice();
    }
    if (event.type === "sdp" && peer) {
      try {
        await peer.setRemoteDescription({ type: "answer", sdp: event.sdp });
        $("voice").setAttribute("aria-pressed", "true");
        $("voice").setAttribute("aria-label", "Stop voice");
        $("voice").title = "Stop voice";
        $("chat-state").textContent = "Connecting audio…";
      } catch (error) {
        releaseVoice();
        notify(error.message);
        await stopProviderVoice();
      }
    }
    if (event.type === "voice-error" || event.type === "voice-closed") {
      cleanupError = null;
      voiceRequested = false;
      releaseVoice();
      $("chat-state").textContent = event.text || "Voice stopped";
    }
  });
  $("voice").onclick = async () => {
    if (startingVoice || cleanupError) return;
    if (peer) {
      releaseVoice();
      await stopProviderVoice();
      return;
    }
    const current = ++generation;
    let settled;
    startup = new Promise((resolve) => {
      settled = resolve;
    });
    startingVoice = true;
    $("voice").disabled = true;
    $("chat-state").textContent = "Connecting voice…";
    try {
      microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation) {
        releaseVoice();
        return;
      }
      peer = new RTCPeerConnection();
      peer.ontrack = (event) => {
        $("voice-output").srcObject = event.streams[0];
      };
      peer.onconnectionstatechange = () => {
        if (peer) $("voice").dataset.connection = peer.connectionState;
        if (peer?.connectionState === "connected")
          $("chat-state").textContent = "Voice connected";
        if (
          peer &&
          ["failed", "disconnected", "closed"].includes(peer.connectionState)
        ) {
          releaseVoice();
          stopProviderVoice();
          $("chat-state").textContent = "Voice disconnected";
        }
      };
      microphone
        .getTracks()
        .forEach((track) => peer.addTrack(track, microphone));
      peer.createDataChannel("oai-events");
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== "complete")
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 1800);
          peer.addEventListener("icegatheringstatechange", () => {
            if (peer?.iceGatheringState === "complete") {
              clearTimeout(timeout);
              resolve();
            }
          });
        });
      if (current !== generation) {
        releaseVoice();
        return;
      }
      voiceRequested = true;
      await call("voice", { sdp: peer.localDescription.sdp });
    } catch (error) {
      releaseVoice();
      $("chat-state").textContent = error.message;
      await stopProviderVoice();
    } finally {
      startingVoice = false;
      $("voice").disabled = false;
      settled();
    }
  };
  api.on("voice-reset", async ({ id }) => {
    generation++;
    if (startingVoice) await startup;
    releaseVoice();
    await stopProviderVoice();
    await api.call("voice-stopped", { id, error: cleanupError });
  });
  api.on("voice-toggle", () => $("voice").click());
  const report = () =>
    api
      .call("voice-state", {
        pressed: $("voice").getAttribute("aria-pressed") === "true",
        connection: $("voice").dataset.connection || "closed",
        disabled: $("voice").disabled,
        text: $("chat-state").textContent,
      })
      .catch(notify);
  new MutationObserver(report).observe($("voice"), { attributes: true });
  new MutationObserver(report).observe($("chat-state"), {
    childList: true,
    subtree: true,
  });
  window.addEventListener("beforeunload", releaseVoice);
})();
