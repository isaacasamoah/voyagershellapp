(() => {
  const views = new Map();
  let types = new Map();
  const send = (frame, id, value) =>
    frame.contentWindow.postMessage(
      { topic: "voyager-portal", portal: id, ...value },
      `voyager-portal://${id}`,
    );

  function report(view, message) {
    view.error = message;
    const host = document.querySelector(`[data-web-portal="${view.id}"]`);
    if (host) {
      let notice = host.querySelector(".portal-error");
      if (!notice) {
        notice = document.createElement("div");
        notice.className = "portal-error";
        host.append(notice);
      }
      notice.textContent = message;
    }
  }

  function position() {
    for (const view of views.values()) {
      const host = document.querySelector(`[data-web-portal="${view.id}"]`);
      for (const frame of [view.frame, view.pending].filter(Boolean)) {
        frame.hidden = !host || !host.offsetWidth;
        if (!host) continue;
        const rect = host.getBoundingClientRect();
        Object.assign(frame.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
      }
    }
  }

  function load(portal, definition) {
    let view = views.get(portal.id);
    if (!view) {
      view = { id: portal.id, type: portal.type };
      views.set(portal.id, view);
    }
    if (view.revision === definition.revision) {
      if (view.error) report(view, view.error);
      return;
    }
    view.pending?.remove();
    clearTimeout(view.timer);
    view.revision = definition.revision;
    const frame = document.createElement("iframe");
    frame.className = "portal-frame";
    frame.dataset.portal = portal.id;
    frame.title = portal.title;
    frame.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-modals",
    );
    frame.setAttribute(
      "allow",
      "microphone 'none'; camera 'none'; clipboard-write 'none'",
    );
    frame.src = `voyager-portal://${portal.id}/${definition.entry || "view.html"}?portal=${portal.id}&v=${definition.revision}`;
    if (view.frame) frame.style.visibility = "hidden";
    view.pending = frame;
    document.body.append(frame);
    view.timer = setTimeout(() => {
      if (view.pending !== frame) return;
      report(view, "View startup unconfirmed. The previous view was kept.");
      frame.remove();
      view.pending = null;
    }, 15000);
  }

  window.addEventListener("message", async (event) => {
    const message = event.data;
    if (message?.topic !== "voyager-portal") return;
    const view = views.get(message.portal);
    const frame = [view?.frame, view?.pending].find(
      (item) => item && item.contentWindow === event.source,
    );
    if (
      !frame ||
      event.origin !== `voyager-portal://${view.id}` ||
      message.version !== new URL(frame.src).searchParams.get("v")
    )
      return;
    if (message.op === "failed") {
      report(
        view,
        `View error: ${message.error}. ${view.frame ? "Previous view retained." : "Edit the package to try again."}`,
      );
      if (frame === view.pending) {
        clearTimeout(view.timer);
        frame.remove();
        view.pending = null;
      }
      return;
    }
    if (message.op === "ready" && frame === view.pending) {
      clearTimeout(view.timer);
      view.frame?.remove();
      view.frame = frame;
      view.pending = null;
      frame.style.visibility = "";
      view.error = null;
      document
        .querySelector(`[data-web-portal="${view.id}"] .portal-error`)
        ?.remove();
      if (view.dataError) report(view, view.dataError);
      position();
      return;
    }
    if (message.op === "focus") {
      focusPortal(view.id);
      return;
    }
    if (message.op === "pointer") {
      const rect = frame.getBoundingClientRect();
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: rect.left + message.x,
          clientY: rect.top + message.y,
          buttons: message.buttons,
        }),
      );
      return;
    }
    if (
      !["inspect", "update", "action"].includes(message.op) ||
      typeof message.request !== "string"
    )
      return;
    try {
      const result = await api.call("portal-frame", {
        ...message.input,
        id: view.id,
        action: message.op,
      });
      if (message.op === "inspect") {
        view.dataError = result.error;
        if (result.error) report(view, result.error);
        else if (view.error?.startsWith("Data edit is invalid")) {
          view.error = null;
          document
            .querySelector(`[data-web-portal="${view.id}"] .portal-error`)
            ?.remove();
        }
      }
      send(frame, view.id, { request: message.request, result });
    } catch (error) {
      send(frame, view.id, { request: message.request, error: error.message });
    }
  });

  window.portalFrames = {
    catalog(value) {
      types = new Map(value.map((item) => [item.id, item]));
    },
    definition: (type) => types.get(type),
    sync(portals) {
      const existing = new Set(portals.map((portal) => portal.id));
      for (const [id, view] of views)
        if (!existing.has(id) || !types.has(view.type)) {
          clearTimeout(view.timer);
          view.frame?.remove();
          view.pending?.remove();
          views.delete(id);
        }
      for (const portal of portals) {
        const definition = types.get(portal.type);
        const host = document.querySelector(`[data-web-portal="${portal.id}"]`);
        if (!definition) {
          if (host)
            host.textContent = `${portal.type} is not installed. Restore the package to reopen this view. Its data and process are retained.`;
          continue;
        }
        if (definition.renderer === "web" && host) {
          const existing = views.get(portal.id);
          if (definition.error && existing) {
            report(existing, definition.error);
            continue;
          }
          load(portal, definition);
        }
      }
      position();
    },
    changed(event) {
      this.catalog(event.types);
      for (const view of views.values())
        if (event.files.some((file) => file === `data/${view.id}.json`)) {
          for (const frame of [view.frame, view.pending].filter(Boolean))
            send(frame, view.id, { op: "changed" });
        }
    },
    position,
  };
  new ResizeObserver(position).observe(document.documentElement);
})();
