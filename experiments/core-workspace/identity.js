(() => {
  const shell = $("voyager-avatar");
  const handle = $("avatar");
  let drag;
  let previousDock;
  let audio;
  let audioReady = Promise.resolve();
  let relocating = false;

  function warmAudio() {
    audio ||= new AudioContext();
    if (audio.state === "suspended")
      audioReady = audio.resume().catch((error) => notify(error.message));
  }

  async function tone(kind) {
    if (!audio) return;
    await audioReady;
    if (audio.state !== "running") return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    const [from, to] = kind === "dock" ? [310, 620] : [620, 310];
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + 0.16);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    window.dispatchEvent(
      new CustomEvent("voyager-dock-sound", {
        detail: { kind, from, to, duration: 0.2, at: performance.now() },
      }),
    );
  }

  function minimize() {
    const rect = shell.getBoundingClientRect();
    return call("minimize", { x: rect.x, y: rect.y });
  }

  function positionChat() {
    shell.dataset.chat = $("chat").hidden ? "closed" : "open";
  }

  function place() {
    if (drag) return;
    shell.style.left = "";
    shell.style.top = "";
    shell.dataset.dragging = "false";
    shell.dataset.hovered = "false";
    if (
      previousDock !== undefined &&
      previousDock !== state.dock &&
      !shell.hidden
    )
      tone("dock");
    if (
      previousDock !== undefined &&
      previousDock !== state.dock &&
      state.dock !== "home"
    )
      window.voyagerChat?.open(false);
    previousDock = state.dock;
    positionChat();
  }

  function clearPreview() {
    document
      .querySelectorAll("[data-dock-target]")
      .forEach((node) => delete node.dataset.dockTarget);
  }

  function targetAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    const home = hit?.closest("#home-dock, #home");
    if (home) return { id: "home", node: $("home-dock") };
    const dimension = hit?.closest(".dimension");
    if (dimension)
      return {
        id: `dimension:${dimension.dataset.dimension}`,
        dimension: dimension.dataset.dimension,
        node: dimension,
      };
    const realm = hit?.closest(".realm");
    if (realm) return { id: `realm:${realm.dataset.realm}`, node: realm };
    const portal = hit?.closest(".portal");
    if (portal)
      return {
        id: portal.querySelector(".portal-dock").dataset.dock,
        node: portal,
      };
    return null;
  }

  function restoreOrigin(current) {
    current.parent.append(shell);
    shell.dataset.place = current.place;
    shell.style.left = "";
    shell.style.top = "";
    shell.dataset.dragging = "false";
  }

  function cancel() {
    if (!drag) return;
    const current = drag;
    drag = null;
    if (handle.hasPointerCapture(current.pointer))
      handle.releasePointerCapture(current.pointer);
    restoreOrigin(current);
    clearPreview();
    if (current.moved) tone("dock");
    positionChat();
  }

  handle.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    warmAudio();
    const rect = shell.getBoundingClientRect();
    drag = {
      pointer: event.pointerId,
      started: performance.now(),
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      parent: shell.parentElement,
      place: shell.dataset.place,
      dock: state.dock,
      moved: false,
    };
    handle.setPointerCapture(event.pointerId);
  };

  window.addEventListener(
    "pointermove",
    (event) => {
      if (!drag) {
        if (shell.dataset.place !== "portal") return;
        const rect = shell.getBoundingClientRect();
        shell.dataset.hovered = String(
          !event.buttons &&
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom,
        );
        return;
      }
      if (event.pointerId !== drag.pointer) return;
      if (
        !drag.moved &&
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <= 7
      )
        return;
      if (!drag.moved) {
        drag.moved = true;
        relocating = true;
        document.body.append(shell);
        shell.dataset.dragging = "true";
        handle.setPointerCapture(event.pointerId);
        relocating = false;
        tone("undock");
      }
      shell.style.left = `${Math.max(0, Math.min(innerWidth - shell.offsetWidth, event.clientX - drag.offsetX))}px`;
      shell.style.top = `${Math.max(0, Math.min(innerHeight - shell.offsetHeight, event.clientY - drag.offsetY))}px`;
      clearPreview();
      const target = targetAt(event.clientX, event.clientY);
      if (target) target.node.dataset.dockTarget = "true";
      positionChat();
    },
    true,
  );

  window.addEventListener(
    "pointerup",
    async (event) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const target = drag.moved ? targetAt(event.clientX, event.clientY) : null;
      const moved = drag.moved;
      const clicked = !moved && performance.now() - drag.started < 350;
      const origin = drag.dock;
      const current = drag;
      drag = null;
      if (handle.hasPointerCapture(event.pointerId))
        handle.releasePointerCapture(event.pointerId);
      restoreOrigin(current);
      clearPreview();
      if (clicked) {
        tone("undock");
        await minimize().catch(() => {});
        return;
      }
      if (!moved) return;
      if (!target) {
        tone("dock");
        positionChat();
        return;
      }
      try {
        if (target.dimension)
          await act("select-dimension", { id: target.dimension });
        await act("dock", { id: target.id });
        if (target.id === origin) tone("dock");
      } catch (error) {
        positionChat();
      }
    },
    true,
  );

  handle.onclick = (event) => {
    if (event.detail === 0) {
      tone("undock");
      minimize().catch(() => {});
    }
  };
  handle.onpointercancel = cancel;
  handle.onlostpointercapture = (event) => {
    if (
      drag &&
      drag.pointer === event.pointerId &&
      !relocating &&
      !handle.hasPointerCapture(event.pointerId)
    )
      cancel();
  };
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.isTrusted &&
        (event.key === "Enter" ||
          event.key === " " ||
          event.ctrlKey ||
          event.metaKey)
      )
        warmAudio();
    },
    true,
  );
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (drag) {
      event.preventDefault();
      cancel();
    } else if (!$("chat").hidden) window.voyagerChat.open(false);
  });
  window.addEventListener("pointerdown", warmAudio, true);
  window.addEventListener("resize", positionChat);
  new ResizeObserver(positionChat).observe(shell);

  document.addEventListener("dragover", (event) => {
    if (!event.dataTransfer.types.includes("application/x-voyager-avatar"))
      return;
    const target = targetAt(event.clientX, event.clientY);
    clearPreview();
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    target.node.dataset.dockTarget = "true";
  });
  document.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget) clearPreview();
  });
  document.addEventListener("drop", async (event) => {
    const token = event.dataTransfer.getData("application/x-voyager-avatar");
    if (!token) return;
    event.preventDefault();
    const target = targetAt(event.clientX, event.clientY);
    clearPreview();
    if (!target) return;
    try {
      warmAudio();
      await call("dock-desktop", { token, id: target.id });
    } catch (error) {
      positionChat();
    }
  });
  let wasFloating = false;
  api.on("avatar-state", (event) => {
    if (wasFloating && !event.floating) tone("dock");
    wasFloating = event.floating;
    if (event.floating) window.voyagerChat?.open(false);
  });
  window.voyagerIdentity = { place, positionChat, beforeLayout: cancel };
  if (typeof state !== "undefined" && state) place();
})();
