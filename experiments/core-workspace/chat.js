(() => {
  let sending = false;
  const messages = new Map();
  let focusReturn;

  function openChat(open = $("chat").hidden) {
    if (open && $("chat").hidden) focusReturn = document.activeElement;
    if (open && state && !state.sidebar) act("sidebar-show").catch(() => {});
    $("chat").hidden = !open;
    $("chat-toggle").setAttribute("aria-pressed", String(open));
    if (open) $("chat-text").focus();
    else if (focusReturn?.isConnected)
      focusReturn.focus({ preventScroll: true });
    $("avatar-chat").setAttribute("aria-expanded", String(open));
    window.voyagerIdentity?.positionChat();
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
    window.voyagerIdentity?.positionChat();
    $("messages").scrollTop = $("messages").scrollHeight;
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
      $("reconnect").hidden = false;
    }
    if (event.type === "refused") {
      sending = false;
      $("send").disabled = false;
      $("chat-state").textContent = event.text;
    }
  });

  $("open-chat").onclick = () => openChat(true);
  $("avatar-chat").onclick = () => openChat();
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
  $("voice").onclick = () => call("voice-toggle").catch(() => {});
  api.on("avatar-state", (event) => {
    $("voyager-avatar").hidden = event.floating;
    $("voice").setAttribute("aria-pressed", String(event.voice.pressed));
    $("voice").setAttribute(
      "aria-label",
      event.voice.pressed ? "Stop voice" : "Start voice",
    );
    $("voice").title = $("voice").getAttribute("aria-label");
    $("voice").dataset.connection = event.voice.connection;
    $("voice").disabled = event.voice.disabled;
    if (event.voice.text) $("chat-state").textContent = event.voice.text;
  });
  $("reconnect").onclick = async () => {
    try {
      await call("voice-reset");
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
  window.voyagerChat = { open: openChat };
})();
