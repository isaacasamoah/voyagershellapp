const api = window.voyager;
const $ = (id) => document.getElementById(id);
let state;
let focused;
const terminals = new Map();
const avatar = $("voyager-avatar");
const dimensionDock = $("dimension-avatar");
let toastTimer;
let floatingAvatar = false;
let renderVersion = 0;
let portalTypes = [];
const voiceControl = $("voice");

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
    dimension:
      state.view === "home"
        ? state.home
        : realm.dimensions.find((item) => item.id === realm.activeDimension),
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
    if (!view || !view.node.isConnected || view.attached || view.connecting)
      continue;
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
  const terminalView = terminals.get(portal.terminal);
  if (terminalView) terminalView.portal = portal.id;
  const wrapper = element("section", "portal");
  wrapper.dataset.portal = portal.id;
  wrapper.setAttribute("aria-label", `${portal.title} portal`);
  wrapper.addEventListener("pointerdown", () => focusPortal(portal.id));
  const head = element("header", "portal-header");
  const holder = element("div", "portal-dock");
  holder.dataset.dock = `portal:${portal.terminal || portal.id}`;
  const spot = button("Bring Voyager here", "◇", () => {}, "dock-spot");
  spot.ondblclick = () =>
    act("dock", { id: `portal:${portal.terminal || portal.id}` }).catch(
      () => {},
    );
  spot.onkeydown = (event) => {
    if (event.key === "Enter")
      act("dock", { id: `portal:${portal.terminal || portal.id}` }).catch(
        () => {},
      );
  };
  holder.append(spot);
  head.append(
    holder,
    element("span", "portal-title", portal.title),
    element("span", "terminal-id", portal.terminal || portal.type),
  );
  const actions = element("div", "portal-actions");
  actions.append(
    button("Split this portal side by side", "◫", () =>
      choosePortal(portal.id),
    ),
    button("Split this portal top and bottom", "⬒", () =>
      choosePortal(portal.id, "vertical"),
    ),
    button("Move this portal", "↗", () => movePortal(portal)),
    button("Hide this portal, keep process running", "×", () =>
      act("hide", { id: portal.id }),
    ),
  );
  const title = head.querySelector(".portal-title");
  title.draggable = true;
  title.title = "Drag to another portal header to move beside it";
  title.ondragstart = (event) => {
    event.dataTransfer.setData("application/x-voyager-portal", portal.id);
    document.body.classList.add("moving-portal");
  };
  title.ondragend = () => document.body.classList.remove("moving-portal");
  head.ondragover = (event) => {
    if (event.dataTransfer.types.includes("application/x-voyager-portal")) {
      event.preventDefault();
      head.classList.add("drop-here");
    }
  };
  head.ondragleave = () => head.classList.remove("drop-here");
  head.ondrop = (event) => {
    event.preventDefault();
    head.classList.remove("drop-here");
    const id = event.dataTransfer.getData("application/x-voyager-portal");
    if (id && id !== portal.id)
      act("move", { id, target: portal.id, position: "right" }).catch(() => {});
  };
  head.append(actions);
  const anchor = element("div", "portal-avatar-anchor");
  anchor.dataset.avatarPortal = portal.terminal || portal.id;
  const definition = window.portalFrames.definition(portal.type || "terminal");
  const body =
    definition?.renderer === "terminal" && terminalView
      ? terminalView.node
      : element("div", "web-portal");
  if (body.classList.contains("web-portal")) body.dataset.webPortal = portal.id;
  wrapper.append(head, body, anchor);
  return wrapper;
}

function layoutView(node, dimensionId) {
  if (!node) {
    const empty = element("div", "empty-workspace");
    empty.append(
      element("h2", "", "Room for something new."),
      element("p", "", "Your processes keep running when a view closes."),
      button("New portal", "Open a portal", () => choosePortal()),
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
      window.portalFrames.position();
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

function presentFocus(focus) {
  if (!state || !focus) return;
  document.body.dataset.voyagerFocus = focus.kind;
  document.body.dataset.voyagerFloating = String(floatingAvatar);
  const id = focus.id;
  for (const node of document.querySelectorAll(".realm, .dimension")) {
    const scope = node.dataset.realm ? "realm" : "dimension";
    const focusedHere = `${scope}:${node.dataset[scope]}` === id;
    node.closest(".scope-row").classList.toggle("voyager-focused", focusedHere);
    node
      .closest(".scope-row")
      .querySelector(".scope-dock")
      .setAttribute("aria-pressed", String(focusedHere));
  }
  for (const node of document.querySelectorAll(".portal")) {
    const here = node.querySelector(".portal-dock").dataset.dock === id;
    node.classList.toggle("voyager-focused", here);
    node.querySelector(".dock-spot").setAttribute("aria-pressed", String(here));
  }
  $("home").setAttribute("aria-pressed", String(focus.kind === "home"));
  $("chat-focus").textContent = focus.label;
  $("scope-label").textContent =
    `${focus.label}${avatar.dataset.outOfView === "true" ? " · Go there ↗" : ""}`;
  $("scope-label").onclick = () => {
    if (focus.portal) act("show-portal", { id: focus.portal }).catch(() => {});
    else if (focus.terminal)
      act("show", { terminal: focus.terminal }).catch(() => {});
    else if (focus.dimension)
      act("select-dimension", { id: focus.dimension }).catch(() => {});
    else if (focus.realm)
      act("select-realm", { id: focus.realm }).catch(() => {});
    else act("home").catch(() => {});
  };
  $("avatar-chat").title = `Text chat · ${focus.label}`;
  $("chat-toggle").title = `Text chat · ${focus.label}`;
  $("chat-text").placeholder =
    focus.kind === "home"
      ? "What shall we work on?"
      : `Message Voyager · ${focus.label}`;
  const fullAvatar =
    avatar.dataset.place === "portal" && avatar.dataset.outOfView !== "true";
  const host = fullAvatar
    ? avatar
    : state.sidebar
      ? $("home-controls")
      : $("workspace-controls");
  if (voiceControl.parentElement !== host) host.prepend(voiceControl);
  voiceControl.hidden = floatingAvatar;
}

api.on("avatar-state", (event) => {
  floatingAvatar = event.floating;
  presentFocus(event.focus);
});

async function render(value) {
  const version = ++renderVersion;
  window.voyagerIdentity?.beforeLayout();
  state = value;
  const { realm, dimension } = active();
  for (const portal of allLeaves(dimension.root))
    if (
      portal.terminal &&
      window.portalFrames.definition(portal.type || "terminal")?.renderer ===
        "terminal" &&
      !terminals.has(portal.terminal)
    )
      await createTerminal(portal);
  if (version !== renderVersion) return;
  document.body.classList.toggle("sidebar-collapsed", !state.sidebar);
  $("realms").replaceChildren(
    ...state.realms.map((item, index) => {
      const node = button(
        item.name,
        "",
        () => act("select-realm", { id: item.id }),
        `realm ${state.view !== "home" && item.id === realm.id ? "active" : ""}`,
      );
      node.dataset.realm = item.id;
      node.append(
        element("span", "realm-glyph", ["◈", "▧", "◇", "▱"][index % 4]),
        element("span", "realm-name", item.name),
        element("span", "realm-count", String(item.dimensions.length)),
      );
      node.ondblclick = () => rename(item);
      const spot = element("button", "scope-dock", "◇");
      spot.type = "button";
      const scope = node.classList.contains("realm") ? "realm" : "dimension";
      spot.title = `Dock Voyager in ${item.name}`;
      spot.setAttribute("aria-label", spot.title);
      const summon = (event) => {
        event.stopPropagation();
        act("dock", { id: `${scope}:${item.id}` }).catch(() => {});
      };
      spot.onclick = summon;
      spot.ondblclick = (event) => event.stopPropagation();
      spot.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          summon(event);
        }
      };
      const row = element("div", "scope-row");
      row.append(node, spot);
      return row;
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
      node.dataset.dimension = item.id;
      node.append(
        element("span", "dimension-mark", "⌑"),
        element("span", "", item.name),
      );
      node.ondblclick = () => rename(item);
      const spot = element("button", "scope-dock", "◇");
      spot.type = "button";
      const scope = node.classList.contains("realm") ? "realm" : "dimension";
      spot.title = `Dock Voyager in ${item.name}`;
      spot.setAttribute("aria-label", spot.title);
      const summon = (event) => {
        event.stopPropagation();
        act("dock", { id: `${scope}:${item.id}` }).catch(() => {});
      };
      spot.onclick = summon;
      spot.ondblclick = (event) => event.stopPropagation();
      spot.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          summon(event);
        }
      };
      const row = element("div", "scope-row");
      row.append(node, spot);
      return row;
    }),
  );
  $("breadcrumb").textContent = state.view === "home" ? "Home" : realm.name;
  $("home").classList.toggle("active", state.view === "home");
  const selectedTab = $("dimensions").querySelector(".dimension.active");
  if (selectedTab) selectedTab.before(dimensionDock);
  else $("dimensions").prepend(dimensionDock);
  $("context").textContent =
    `${realm.cwd.replace(/^\/home\/isaac|^\/Users\/isaac/, "~")}  /  ${dimension.name}`;
  $("portals").replaceChildren(layoutView(dimension.root, dimension.id));
  const everyPortal = state.realms
    .flatMap((realm) =>
      realm.dimensions.flatMap((dimension) => allLeaves(dimension.root)),
    )
    .concat(
      allLeaves(state.home?.root),
      Object.values(state.hidden || {}).map((item) => item.portal),
    )
    .map((portal) => ({ ...portal, type: portal.type || "terminal" }));
  window.portalFrames.sync(everyPortal);
  const [scope, key] = state.dock.split(":");
  const dock =
    state.dock === "home"
      ? $("avatar-home")
      : scope === "realm"
        ? document.querySelector(`[data-realm="${key}"] .realm-glyph`)
        : scope === "dimension"
          ? document.querySelector(`[data-dimension="${key}"] .dimension-mark`)
          : document.querySelector(`[data-avatar-portal="${key}"]`);
  (dock || dimensionDock).append(avatar);
  avatar.dataset.outOfView = String(!dock);
  avatar.dataset.place =
    scope === "portal" && dock
      ? "portal"
      : state.dock === "home"
        ? "home"
        : "dimension";
  const focus = await call("focus");
  if (version !== renderVersion) return;
  presentFocus(focus);
  $("avatar").title =
    `${focus.label}. Click to minimize. Pull to change focus.`;
  window.voyagerIdentity?.place();
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
      const input = element(field.options ? "select" : "input");
      if (field.options)
        for (const option of field.options) {
          const node = element("option", "", option.label);
          node.value = option.value;
          input.append(node);
        }
      Object.assign(input, {
        name: field.name,
        value: field.value || field.options?.[0]?.value || "",
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

async function choosePortal(id, axis = "horizontal") {
  const values = await ask(
    "Open a portal",
    [
      {
        name: "type",
        label: "What would you like here?",
        value: "terminal",
        options: portalTypes.map((type) => ({
          value: type.id,
          label: type.name,
        })),
      },
    ],
    "Open",
  );
  if (values)
    await act(id ? "split" : "portal", {
      id,
      dimension: active().dimension.id,
      type: values.type,
      axis,
    });
}

async function movePortal(portal) {
  const targets = allLeaves(active().dimension.root).filter(
    (item) => item.id !== portal.id,
  );
  if (!targets.length)
    return notify("Open another portal to move this one beside it.");
  const values = await ask(
    "Move this portal",
    [
      {
        name: "target",
        label: "Beside",
        options: targets.map((item) => ({ value: item.id, label: item.title })),
      },
      {
        name: "position",
        label: "Place",
        options: ["left", "right", "top", "bottom"].map((value) => ({
          value,
          label: value,
        })),
      },
    ],
    "Move",
  );
  if (values) await act("move", { id: portal.id, ...values });
}

async function showLayouts() {
  const catalog = await call("portal", { action: "catalog" });
  const dimension = active().dimension;
  $("dialog-title").textContent = `${dimension.name} layouts`;
  const rows = catalog.layouts
    .filter((item) => item.owner === dimension.id || item.error)
    .map((item) => {
      const row = element("div", "process-row");
      row.append(
        element(
          "span",
          "",
          item.error ? `${item.file}: ${item.error}` : item.name,
        ),
      );
      if (!item.error)
        row.append(
          button("Restore this layout", "Restore", async () => {
            $("dialog").close();
            await act("layout-load", {
              dimension: dimension.id,
              file: item.file,
            });
          }),
        );
      return row;
    });
  const save = button(
    "Save current layout",
    "Save current layout…",
    async () => {
      $("dialog").close();
      const values = await ask(
        "Save this layout",
        [{ name: "name", label: "Layout name", value: dimension.name }],
        "Save",
      );
      if (values) {
        await act("layout-save", {
          dimension: dimension.id,
          name: values.name,
        });
        notify("Layout saved. Processes keep their identities.");
      }
    },
  );
  for (const item of Object.values(state.hidden || {}).filter(
    (item) => item.dimension === dimension.id,
  )) {
    const row = element("div", "process-row");
    row.append(
      element("span", "", `${item.portal.title} · hidden`),
      button("Reopen this portal", "Reopen", async () => {
        $("dialog").close();
        await act("show-portal", { id: item.portal.id });
      }),
    );
    rows.push(row);
  }
  $("dialog-body").replaceChildren(
    element(
      "p",
      "dialog-hint",
      "Restores this dimension's arrangement. Running processes stay running; ended processes stay ended.",
    ),
    ...rows,
  );
  $("dialog-actions").replaceChildren(save);
  $("dialog").showModal();
}

async function showPackages() {
  const catalog = await call("portal", { action: "catalog" });
  $("dialog-title").textContent = "Portal packages";
  const rows = catalog.types.map((type) => {
    const row = element("div", "process-row");
    const text = element("div");
    text.append(
      element("strong", "", type.name),
      element("small", "", type.error || type.description || type.renderer),
    );
    row.append(
      text,
      button(`Uninstall ${type.name}`, "Uninstall", async () => {
        await call("portal", { action: "uninstall", type: type.id });
        $("dialog").close();
        await showPackages();
      }),
    );
    return row;
  });
  for (const type of catalog.removed) {
    const row = element("div", "process-row");
    row.append(
      element("span", "", `${type} · uninstalled`),
      button(`Restore ${type}`, "Restore", async () => {
        await call("portal", { action: "restore", type });
        $("dialog").close();
        await showPackages();
      }),
    );
    rows.push(row);
  }
  $("dialog-body").replaceChildren(
    element(
      "p",
      "dialog-hint",
      "Trusted local packages. Edit these files while Voyager runs. Uninstall keeps portal data, layouts and processes for restoration.",
    ),
    ...rows,
  );
  $("dialog-actions").replaceChildren(
    button("Open package folder", "Open folder", () => call("portal-folder")),
  );
  $("dialog").showModal();
}

$("new-portal").onclick = () => choosePortal().catch(() => {});
$("layouts").onclick = () => showLayouts().catch(() => {});
$("portal-packages").onclick = () => showPackages().catch(() => {});
api.on("portal-library", (event) => {
  portalTypes = event.types;
  window.portalFrames.changed(event);
  if (!state) return;
  render(state).catch((error) => notify(error.message));
});

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
$("home").onclick = () => act("home").catch(() => {});
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
new ResizeObserver(() =>
  requestAnimationFrame(() => {
    fitVisible();
    window.portalFrames.position();
  }),
).observe($("portals"));
call("boot")
  .then(async (boot) => {
    $("connection").innerHTML = '<span class="status-dot"></span>Running';
    $("core-version").textContent = `Herdr Core ${boot.core.version}`;
    portalTypes = boot.portals;
    window.portalFrames.catalog(portalTypes);
    await render(boot.state);
    const refresh = async () => {
      try {
        const result = await api.call("processes");
        const live = result.terminals.filter(
          (terminal) => terminal.state === "live",
        );
        for (const portal of allLeaves(active().dimension.root)) {
          const node = document.querySelector(
            `.portal[data-portal="${portal.id}"]`,
          );
          const terminal = result.terminals.find(
            (item) => item.address === portal.terminal,
          );
          const actions = node?.querySelector(".portal-actions");
          const ended =
            portal.terminal &&
            window.portalFrames.definition(portal.type)?.renderer === "web" &&
            terminal?.state !== "live";
          const existing = actions?.querySelector(".start-backend");
          if (ended && actions && !existing)
            actions.prepend(
              button(
                "Start this portal's backend",
                "Start backend",
                () => act("restart", { id: portal.id }),
                "start-backend",
              ),
            );
          if (!ended) existing?.remove();
        }
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
