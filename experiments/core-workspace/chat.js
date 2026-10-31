(() => {
  let peer;
  let microphone;
  let startingVoice = false;
  let sending = false;
  let voiceRequested = false;
  const messages = new Map();

  function openChat(open = $("chat").hidden) {
    $("chat").hidden = !open;
    $("chat-toggle").setAttribute("aria-pressed", String(open));
    if (open) $("chat-text").focus();
    requestAnimationFrame(fitVisible);
  }

  function message(role, text, id) {
    if (!text) return;
    $("messages").querySelector(".chat-intro")?.remove();
    let node = id && messages.get(id);
    if (!node) {
      node = element("div", `message ${role}`);
      $("messages").append(node);
      if (id) messages.set(id, node);
      while ($("messages").children.length > 100)
        $("messages").firstChild.remove();
      if (messages.size > 100) messages.delete(messages.keys().next().value);
    }
    node.textContent = text;
    $("messages").scrollTop = $("messages").scrollHeight;
  }

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

  async function stopProviderVoice() {
    if (!voiceRequested) return;
    voiceRequested = false;
    try {
      await call("voice-stop");
    } catch (error) {
      $("chat-state").textContent = `Voice stop unconfirmed. ${error.message}`;
    }
  }

  api.on("conversation", async (event) => {
    if (event.type === "message") message(event.role, event.text, event.id);
    if (event.type === "delta") {
      const previous = messages.get(event.id)?.textContent || "";
      message("assistant", previous + event.text, event.id);
    }
    if (event.type === "status") $("chat-state").textContent = event.text;
    if (event.type === "ready")
      $("chat-state").textContent = "Voyager is with you";
    if (event.type === "tool") {
      $("messages").querySelector(".chat-intro")?.remove();
      const line = element(
        "div",
        "tool-line",
        `${event.success ? "✓" : "×"} ${event.action || event.name}`,
      );
      $("messages").append(line);
      $("chat-state").textContent = event.success
        ? "Checking the result…"
        : "That action could not complete";
    }
    if (event.type === "complete") {
      sending = false;
      $("send").disabled = false;
      $("chat-state").textContent =
        event.status === "completed"
          ? "Ready when you are"
          : event.error || `Request ${event.status}. Nothing was retried.`;
    }
    if (event.type === "error") {
      $("chat-state").textContent = event.text;
      $("send").disabled = true;
      releaseVoice();
      await stopProviderVoice();
      $("reconnect").hidden = false;
    }
    if (event.type === "refused") {
      sending = false;
      $("send").disabled = false;
      $("chat-state").textContent = event.text;
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
      voiceRequested = false;
      releaseVoice();
      $("chat-state").textContent = event.text || "Voice stopped";
    }
  });

  $("open-chat").onclick = () => openChat(true);
  $("chat-toggle").onclick = () => openChat();
  $("close-chat").onclick = () => openChat(false);
  $("composer").onsubmit = async (event) => {
    event.preventDefault();
    const text = $("chat-text").value.trim();
    if (!text || sending) return;
    if (new TextEncoder().encode(text).length > 8192) {
      notify("Use a message under 8192 bytes.");
      return;
    }
    sending = true;
    $("send").disabled = true;
    $("chat-state").textContent = "Connecting Voyager…";
    try {
      await call("chat", { text });
      $("chat-text").value = "";
    } catch (error) {
      $("chat-state").textContent = error.message;
      if ($("send").disabled) $("reconnect").hidden = false;
    }
  };
  $("chat-text").onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("composer").requestSubmit();
    }
  };
  $("voice").onclick = async () => {
    if (startingVoice) return;
    if (peer) {
      releaseVoice();
      await stopProviderVoice();
      return;
    }
    startingVoice = true;
    $("voice").disabled = true;
    $("chat-state").textContent = "Connecting voice…";
    try {
      microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      voiceRequested = true;
      await call("voice", { sdp: peer.localDescription.sdp });
    } catch (error) {
      releaseVoice();
      $("chat-state").textContent = error.message;
      await stopProviderVoice();
    } finally {
      startingVoice = false;
      $("voice").disabled = false;
    }
  };
  $("reconnect").onclick = async () => {
    releaseVoice();
    await stopProviderVoice();
    try {
      await call("chat-reset");
      sending = false;
      $("send").disabled = false;
      $("reconnect").hidden = true;
      $("chat-state").textContent =
        "New conversation. Previous requests were not replayed.";
    } catch (error) {
      $("chat-state").textContent = error.message;
    }
  };
  window.addEventListener("beforeunload", releaseVoice);
})();
