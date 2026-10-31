(() => {
  const id = new URL(location.href).searchParams.get("portal");
  const version = new URL(location.href).searchParams.get("v");
  const pending = new Map();
  const changed = new Set();
  let sequence = 0;
  let failed = false;
  let loaded = false;
  let readySent = false;
  function ready() {
    setTimeout(() => {
      if (loaded && !failed && !pending.size && !readySent) {
        readySent = true;
        send({ op: "ready" });
      }
    }, 0);
  }
  const send = (value) =>
    parent.postMessage(
      { topic: "voyager-portal", portal: id, version, ...value },
      "*",
    );
  function request(op, input = {}) {
    const request = String(++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(request);
        reject(Error("Portal request unconfirmed. It was not retried."));
      }, 15000);
      pending.set(request, { resolve, reject, timer });
      send({ op, input, request });
    });
  }
  window.portal = {
    read: () => request("inspect"),
    write: (data, expected) => request("update", { data, expected }),
    action: (kind, input) => request("action", { kind, input }),
    onChange: (listener) => {
      changed.add(listener);
      return () => changed.delete(listener);
    },
  };
  window.addEventListener("message", (event) => {
    if (
      event.source !== parent ||
      event.data?.topic !== "voyager-portal" ||
      event.data.portal !== id
    )
      return;
    const message = event.data;
    if (message.op === "changed") {
      for (const listener of changed) listener();
      return;
    }
    const entry = pending.get(message.request);
    if (!entry) return;
    pending.delete(message.request);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(Error(message.error));
    else entry.resolve(message.result);
    ready();
  });
  window.addEventListener(
    "error",
    (event) => {
      if (!event.message && event.target?.tagName !== "SCRIPT") return;
      failed = true;
      send({
        op: "failed",
        error: event.message || "A script failed to load.",
      });
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) => {
    failed = true;
    send({
      op: "failed",
      error: String(event.reason?.message || event.reason),
    });
  });
  window.addEventListener("load", () => {
    loaded = true;
    ready();
  });
  window.addEventListener("pointermove", (event) =>
    send({
      op: "pointer",
      x: event.clientX,
      y: event.clientY,
      buttons: event.buttons,
    }),
  );
  window.addEventListener("pointerdown", () => send({ op: "focus" }));
})();
