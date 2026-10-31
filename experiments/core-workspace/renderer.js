const api = window.voyager;
const $ = (id) => document.getElementById(id);
let state;
let focused;
const terminals = new Map();
const avatar = $("avatar");
let toastTimer;

function notify(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 6000);
}

async function call(method, input) {
  try {
    return await api.call(method, input);
  } catch (error) {
    notify(
      error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      ),
    );
    throw error;
  }
}

function act(kind, input = {}) {
  return call("action", { kind, input });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label, text, action, className = "") {
  const node = element("button", className, text);
  node.type = "button";
  node.title = label;
  node.setAttribute("aria-label", label);
  node.onclick = () => Promise.resolve(action()).catch(() => {});
  return node;
}

function allLeaves(node) {
  return !node ? [] : node.children ? node.children.flatMap(allLeaves) : [node];
}

function active() {
  const realm = state.realms.find((item) => item.id === state.activeRealm);
  return {
    realm,
    dimension: realm.dimensions.find(
      (item) => item.id === realm.activeDimension,
    ),
  };
}

function focusPortal(id, keyboard = false) {
  focused = id;
  document
    .querySelectorAll(".portal")
    .forEach((node) =>
      node.classList.toggle("focused", node.dataset.portal === id),
    );
  const portal = allLeaves(active().dimension.root).find(
    (item) => item.id === id,
  );
  const view = portal && terminals.get(portal.terminal);
  if (view?.attached) {
    api
      .call("terminal", {
        terminal: portal.terminal,
        kind: "focus",
        active: true,
      })
      .catch(notify);
    if (keyboard) view.term.focus();
  }
}

function fitVisible() {
  if (!state) return;
  for (const portal of allLeaves(active().dimension.root)) {
    const view = terminals.get(portal.terminal);
    if (!view?.attached || !view.node.isConnected || view.node.clientWidth < 10)
      continue;
    view.fit.fit();
    api
      .call("terminal", {
        terminal: portal.terminal,
        kind: "resize",
        cols: view.term.cols,
        rows: view.term.rows,
      })
      .catch(notify);
  }
}

async function createTerminal(portal) {
  const node = element("div", "terminal");
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontSize: 13,
    lineHeight: 1.25,
    fontFamily: '"DejaVu Sans Mono", monospace',
    scrollback: 1000,
    theme: {
      background: "#111316",
      foreground: "#cdd0d6",
      cursor: "#c4b5fd",
      selectionBackground: "#53506a88",
      black: "#292c33",
      red: "#ed858b",
      green: "#a1c99c",
      yellow: "#dfc591",
      blue: "#97b3d6",
      magenta: "#bb9cda",
      cyan: "#8dbfc4",
      white: "#dedee3",
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  const view = { node, term, fit, attached: false, portal: portal.id };
  terminals.set(portal.terminal, view);
  term.onData((data) =>
    api
      .call("terminal", { terminal: portal.terminal, kind: "input", data })
      .catch(notify),
  );
  term.attachCustomKeyEventHandler((event) => {
    if (event.ctrlKey && event.shiftKey && event.code === "KeyC") {
      navigator.clipboard
        .writeText(term.getSelection())
        .catch((error) => notify(error.message));
      return false;
    }
    return !(
      event.ctrlKey &&
      ["KeyJ", "KeyK", "KeyB", "Digit1", "Backslash"].includes(event.code)
    );
  });
  return view;
}

async function attachVisible() {
  const { dimension } = active();
  for (const portal of allLeaves(dimension.root)) {
    const view = terminals.get(portal.terminal);
    if (!view.node.isConnected || view.attached || view.connecting) continue;
    view.connecting = true;
    try {
      if (!view.opened) {
        view.term.open(view.node);
        view.opened = true;
      }
      view.fit.fit();
      const terminal = await api.call("attach", {
        terminal: portal.terminal,
        cols: view.term.cols,
        rows: view.term.rows,
      });
      view.attached = terminal.state === "live";
      if (!view.attached) showEnded(portal.terminal);
    } catch (error) {
      showEnded(portal.terminal, error.message);
    } finally {
      view.connecting = false;
    }
  }
  fitVisible();
}

function showEnded(id, reason = "This process has ended.") {
  const view = terminals.get(id);
  if (!view) return;
  view.attached = false;
  const host = view.node.closest(".portal");
  if (!host || host.querySelector(".ended")) return;
  const notice = element("div", "ended");
  notice.append(
    element("span", "", reason),
    button("Start a new shell", "New shell", () =>
      act("restart", { id: view.portal }),
    ),
  );
  host.append(notice);
}

function portalView(portal) {
  terminals.get(portal.terminal).portal = portal.id;
  const wrapper = element("section", "portal");
  wrapper.dataset.portal = portal.id;
  wrapper.setAttribute("aria-label", `${portal.title} portal`);
  wrapper.addEventListener("pointerdown", () => focusPortal(portal.id));
  const head = element("header", "portal-header");
  const holder = element("div", "portal-dock");
  holder.dataset.dock = portal.id;
  const spot = button("Bring Voyager here", "◇", () => {}, "dock-spot");
  spot.ondblclick = () => act("dock", { id: portal.id }).catch(() => {});
  spot.onkeydown = (event) => {
    if (event.key === "Enter") act("dock", { id: portal.id }).catch(() => {});
  };
  holder.append(spot);
  head.append(
    holder,
    element("span", "portal-title", portal.title),
    element("span", "terminal-id", portal.terminal),
  );
  const actions = element("div", "portal-actions");
  actions.append(
    button("Split this portal side by side", "◫", () =>
      act("split", { id: portal.id }),
    ),
    button("Split this portal top and bottom", "⬒", () =>
      act("split", { id: portal.id, axis: "vertical" }),
    ),
    button("Hide this portal, keep process running", "×", () =>
      act("hide", { id: portal.id }),
    ),
  );
  head.append(actions);
  wrapper.append(head, terminals.get(portal.terminal).node);
  return wrapper;
}

function layoutView(node, dimensionId) {
  if (!node) {
    const empty = element("div", "empty-workspace");
    empty.append(
      element("h2", "", "Room for something new."),
      element("p", "", "Your processes keep running when a view closes."),
      button("Show running processes", "Open a process", showProcesses),
    );
    return empty;
  }
  if (!node.children) return portalView(node);
  const split = element("div", `split ${node.axis}`);
  const first = layoutView(node.children[0], dimensionId);
  const second = layoutView(node.children[1], dimensionId);
  first.style.flex = `${node.ratio} 1 0`;
  second.style.flex = `${1 - node.ratio} 1 0`;
  const divider = element("div", "divider");
  divider.tabIndex = 0;
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-label", "Resize portals");
  divider.setAttribute(
    "aria-orientation",
    node.axis === "horizontal" ? "vertical" : "horizontal",
  );
  divider.setAttribute("aria-valuenow", String(Math.round(node.ratio * 100)));
  let ratio = node.ratio;
  divider.onkeydown = (event) => {
    const change = ["ArrowLeft", "ArrowUp"].includes(event.key)
      ? -0.05
      : ["ArrowRight", "ArrowDown"].includes(event.key)
        ? 0.05
        : 0;
    if (change) {
      event.preventDefault();
      act("ratio", {
        id: node.id,
        dimension: dimensionId,
        ratio: ratio + change,
      }).catch(() => {});
    }
  };
  divider.onpointerdown = (event) => {
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");
    const rect = split.getBoundingClientRect();
    divider.onpointermove = (move) => {
      ratio = Math.max(
        0.15,
        Math.min(
          0.85,
          node.axis === "horizontal"
            ? (move.clientX - rect.left) / rect.width
            : (move.clientY - rect.top) / rect.height,
        ),
      );
      first.style.flex = `${ratio} 1 0`;
      second.style.flex = `${1 - ratio} 1 0`;
      fitVisible();
    };
    divider.onpointerup = () => {
      divider.onpointermove = null;
      document.body.classList.remove("resizing");
      act("ratio", { id: node.id, dimension: dimensionId, ratio }).catch(
        () => {},
      );
    };
  };
  split.append(first, divider, second);
  return split;
}

async function render(value) {
  state = value;
  const { realm, dimension } = active();
  for (const portal of allLeaves(dimension.root))
    if (!terminals.has(portal.terminal)) await createTerminal(portal);
  document.body.classList.toggle("sidebar-collapsed", !state.sidebar);
  $("realms").replaceChildren(
    ...state.realms.map((item, index) => {
      const node = button(
        item.name,
        "",
        () => act("select-realm", { id: item.id }),
        `realm ${item.id === realm.id ? "active" : ""}`,
      );
      node.append(
        element("span", "realm-glyph", ["◈", "▧", "◇", "▱"][index % 4]),
        element("span", "realm-name", item.name),
        element("span", "realm-count", String(item.dimensions.length)),
      );
      node.ondblclick = () => rename(item);
      return node;
    }),
  );
  $("dimensions").replaceChildren(
    ...realm.dimensions.map((item) => {
      const node = button(
        item.name,
        "",
        () => act("select-dimension", { id: item.id }),
        `dimension ${item.id === dimension.id ? "active" : ""}`,
      );
      node.append(
        element("span", "dimension-mark", "⌑"),
        element("span", "", item.name),
      );
      node.ondblclick = () => rename(item);
      return node;
    }),
  );
  $("breadcrumb").textContent = realm.name;
  $("context").textContent =
    `${realm.cwd.replace(/^\/home\/isaac|^\/Users\/isaac/, "~")}  /  ${dimension.name}`;
  $("portals").replaceChildren(layoutView(dimension.root, dimension.id));
  const dock =
    state.dock === "home"
      ? $("avatar-home")
      : state.dock === "dimension"
        ? $("dimension-avatar")
        : document.querySelector(`[data-dock="${state.dock}"]`);
  (dock || $("dimension-avatar")).append(avatar);
  avatar.classList.toggle("compact", state.dock !== "home");
  const visible = allLeaves(dimension.root);
  if (!visible.some((portal) => portal.id === focused))
    focused = visible[0]?.id;
  if (focused) focusPortal(focused);
  requestAnimationFrame(attachVisible);
}

function ask(title, fields, submit = "Create") {
  $("dialog-title").textContent = title;
  $("dialog-body").replaceChildren(
    ...fields.map((field) => {
      const label = element("label", "field", field.label);
      const input = element("input");
      Object.assign(input, {
        name: field.name,
        value: field.value || "",
        placeholder: field.placeholder || "",
        required: true,
      });
      label.append(input);
      if (field.name === "cwd")
        label.append(
          button(
            "Choose folder",
            "Browse…",
            async () => {
              const picked = await call("choose-folder");
              if (picked) input.value = picked;
            },
            "browse",
          ),
        );
      return label;
    }),
  );
  const confirm = element("button", "primary", submit);
  confirm.value = "ok";
  $("dialog-actions").replaceChildren(confirm);
  $("dialog").showModal();
  return new Promise((resolve) => {
    $("dialog").onclose = () =>
      resolve(
        $("dialog").returnValue === "ok"
          ? Object.fromEntries(new FormData($("dialog").querySelector("form")))
          : null,
      );
  });
}

async function rename(item) {
  const values = await ask(
    "Give it a name",
    [{ name: "name", label: "Name", value: item.name }],
    "Save",
  );
  if (values) await act("rename", { id: item.id, name: values.name });
}

async function showProcesses() {
  const result = await call("processes");
  $("dialog-title").textContent = "Your processes";
  const rows = result.terminals.map((terminal) => {
    const row = element("div", "process-row");
    const description = element("div");
    description.append(
      element(
        "strong",
        "",
        terminal.title || terminal.name || terminal.address,
      ),
      element(
        "small",
        "",
        `${terminal.address} · ${terminal.state} · ${terminal.cwd}`,
      ),
    );
    row.append(
      description,
      button("Open this process", "Open", async () => {
        $("dialog").close();
        await act("show", { terminal: terminal.address });
      }),
    );
    if (terminal.state === "live")
      row.append(
        button("Stop this process", "Stop", async () => {
          await call("stop", { terminal: terminal.address });
          $("dialog").close();
          notify("Process stopped.");
        }),
      );
    return row;
  });
  $("dialog-body").replaceChildren(...rows);
  $("dialog-actions").replaceChildren();
  $("dialog").showModal();
}

api.on("workspace", (value) =>
  render(value).catch((error) => notify(error.message)),
);
api.on("terminal", (event) => {
  const view = terminals.get(event.terminal);
  if (!view) return;
  if (event.data) {
    const data = Uint8Array.from(atob(event.data), (character) =>
      character.charCodeAt(0),
    );
    view.term.write(data, () =>
      api
        .call("terminal", {
          terminal: event.terminal,
          kind: "credit",
          bytes: event.bytes,
        })
        .catch(() => {}),
    );
  }
  if (event.closed) showEnded(event.terminal);
});
api.on("connection", (value) => {
  $("connection").textContent = value.phase;
  $("connection").dataset.phase = value.phase;
  if (value.error) notify(value.error);
});
$("avatar").onclick = () => call("minimize").catch(() => {});
$("home").onclick = () => act("dock", { id: "home" }).catch(() => {});
$("toggle-sidebar").onclick = () => act("sidebar").catch(() => {});
$("add-realm").onclick = async () => {
  const values = await ask("A new realm", [
    { name: "name", label: "Name", placeholder: "What are we exploring?" },
    { name: "cwd", label: "Starting folder", value: active().realm.cwd },
  ]);
  if (values) act("realm", values).catch(() => {});
};
$("add-dimension").onclick = () =>
  act("dimension", {
    name: `Dimension ${active().realm.dimensions.length + 1}`,
  }).catch(() => {});
$("split-horizontal").onclick = () =>
  focused && act("split", { id: focused }).catch(() => {});
$("split-vertical").onclick = () =>
  focused && act("split", { id: focused, axis: "vertical" }).catch(() => {});
$("processes").onclick = () => showProcesses().catch(() => {});
$("quit").onclick = () => call("quit").catch(() => {});
$("shortcuts").onclick = () =>
  notify(
    "Ctrl+B sidebar · Ctrl+J chat · Ctrl+\\ split · Ctrl+1 Home · Ctrl+Shift+C copy",
  );
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const actions = {
    KeyB: () => $("toggle-sidebar").click(),
    KeyJ: () => $("chat-toggle").click(),
    Digit1: () => $("home").click(),
    Backslash: () =>
      $(event.shiftKey ? "split-vertical" : "split-horizontal").click(),
    KeyK: () => $("shortcuts").click(),
  };
  if (actions[event.code]) {
    event.preventDefault();
    actions[event.code]();
  }
});
new ResizeObserver(() => requestAnimationFrame(fitVisible)).observe(
  $("portals"),
);
call("boot")
  .then(async (boot) => {
    $("connection").innerHTML = '<span class="status-dot"></span>Running';
    $("core-version").textContent = `Herdr Core ${boot.core.version}`;
    await render(boot.state);
    const refresh = async () => {
      try {
        const result = await api.call("processes");
        const live = result.terminals.filter(
          (terminal) => terminal.state === "live",
        );
        $("process-count").textContent =
          `${live.length} ${live.length === 1 ? "process" : "processes"} running`;
      } catch (error) {
        $("process-count").textContent = "Disconnected";
      }
    };
    await refresh();
    setInterval(refresh, 3000);
  })
  .catch((error) => {
    $("portals").textContent = error.message;
  });
