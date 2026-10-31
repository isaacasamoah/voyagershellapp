const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  protocol,
  net,
  shell,
  Menu,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { PortalLibrary } = require("./portal-library.cjs");
const { PortalHost } = require("./portal-host.cjs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "voyager-portal",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
const { Core } = require("./core.cjs");
const { Workspace } = require("./workspace.cjs");

const session = process.env.VOYAGER_WORKSPACE_SESSION || "voyager-workspace";
const profile = path.join(app.getPath("appData"), session);
app.setPath("userData", profile);
if (!app.requestSingleInstanceLock()) app.quit();
let win;
let desktop;
let floating = false;
let drag;
let stoppingVoice;
let voiceStopSequence = 0;
let voice = { pressed: false, connection: "closed", disabled: false };
let core;
let workspace;
let library;
let portalHost;
let companion;
let ready;
let quitting = false;
let quitRequest;
function quitVoyager() {
  if (!quitRequest)
    quitRequest = (async () => {
      try {
        await ready;
      } catch (error) {
        if (core?.child?.pid && !core.info)
          throw Error(`Core startup outcome unconfirmed: ${error.message}`);
      }
      publish("connection", { phase: "stopping" });
      companion?.close();
      library?.close();
      if (core?.info) await core.rpc("server.stop");
      quitting = true;
      core?.close();
      app.quit();
      return true;
    })().catch((error) => {
      publish("connection", {
        phase: "disconnected",
        error: `Quit outcome unconfirmed: ${error.message}`,
      });
      throw error;
    });
  return quitRequest;
}
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitVoyager().catch((error) =>
    publish("connection", { phase: "disconnected", error: error.message }),
  );
});
const streams = new Map();
const publish = (topic, value) => {
  for (const window of [win, desktop])
    if (window && !window.isDestroyed()) window.webContents.send(topic, value);
};

function present() {
  publish("avatar-state", {
    floating,
    voice,
    focus: workspace?.state?.realms?.length
      ? workspace.focus()
      : { kind: "starting", label: "Workspace unavailable" },
  });
}

function floatAvatar(point) {
  if (!floating) {
    const bounds = win.getContentBounds();
    const cursor = screen.getCursorScreenPoint();
    const x = point ? bounds.x + point.x - 13 : cursor.x - 60;
    const y = point ? bounds.y + point.y - 13 : cursor.y - 60;
    const area = screen.getDisplayNearestPoint({
      x: Math.round(x),
      y: Math.round(y),
    }).workArea;
    desktop.setPosition(
      Math.round(Math.max(area.x, Math.min(area.x + area.width - 120, x))),
      Math.round(Math.max(area.y, Math.min(area.y + area.height - 120, y))),
    );
    floating = true;
  }
  desktop.showInactive();
  present();
}

app.on("second-instance", () => {
  win?.restore();
  win?.focus();
});
app.on("window-all-closed", () => {
  companion?.close();
  library?.close();
  core?.close();
  app.quit();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]),
  );
  win = new BrowserWindow({
    width: 1450,
    height: 940,
    minWidth: 740,
    minHeight: 520,
    title: "Voyager",
    backgroundColor: "#111316",
    autoHideMenuBar: true,
    icon: path.resolve(__dirname, "../../desktop/assets/idle.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  desktop = new BrowserWindow({
    width: 120,
    height: 120,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: "Voyager avatar",
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  for (const window of [win, desktop]) {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
  }
  win.webContents.on("will-frame-navigate", (event) => {
    try {
      const url = new URL(event.url);
      const instance = workspace.portal(url.hostname).portal;
      const definition = library.definition(instance.type || "terminal");
      if (
        event.isMainFrame ||
        url.protocol !== "voyager-portal:" ||
        url.pathname !== `/${definition.entry || "view.html"}` ||
        url.searchParams.get("portal") !== instance.id
      )
        event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    floatAvatar();
    win.hide();
  });
  desktop.on("close", (event) => {
    if (!quitting) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionCheckHandler(
    (contents, permission) =>
      contents === desktop.webContents && permission === "media",
  );
  win.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback) =>
      callback(contents === desktop.webContents && permission === "media"),
  );
  win.on("minimize", () => {
    floatAvatar();
    publish("native-window", { minimized: true });
  });
  win.on("restore", () => publish("native-window", { minimized: false }));
  core = new Core(session);
  core.on("disconnected", (error) =>
    publish("connection", {
      phase: quitting ? "stopped" : "disconnected",
      error,
    }),
  );
  library = new PortalLibrary(
    path.join(profile, "portals"),
    path.join(__dirname, "portal-defaults"),
    core,
    (value) => publish("portal-library", value),
  );
  protocol.handle("voyager-portal", async (request) => {
    try {
      const url = new URL(request.url);
      const instance = workspace.portal(url.hostname).portal;
      if (
        url.searchParams.has("portal") &&
        url.searchParams.get("portal") !== instance.id
      )
        throw Error("Portal URL does not match its bound instance.");
      const type = instance.type || "terminal";
      const relative = decodeURIComponent(url.pathname.slice(1));
      if (
        relative === "_voyager/client.js" ||
        relative === "_voyager/theme.css"
      ) {
        const file = relative.endsWith(".js")
          ? "portal-client.js"
          : "portal-theme.css";
        return net.fetch(pathToFileURL(path.join(__dirname, file)).href);
      }
      const definition = library.definition(type);
      const file = library.file(type, relative);
      if (relative === (definition.entry || "view.html")) {
        const extra =
          '<link rel="stylesheet" href="/_voyager/theme.css"><script src="/_voyager/client.js"></script>';
        const original = fs.readFileSync(file, "utf8");
        const html = /<head[^>]*>/i.test(original)
          ? original.replace(/<head[^>]*>/i, (match) => match + extra)
          : extra + original;
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy":
              "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: http://127.0.0.1:*; frame-src 'none'; object-src 'none'",
          },
        });
      }
      return net.fetch(pathToFileURL(file).href);
    } catch (error) {
      return new Response(error.message, { status: 404 });
    }
  });
  workspace = new Workspace(
    core,
    process.env.VOYAGER_WORKSPACE_CWD || path.resolve(__dirname, "../.."),
    (value) => {
      publish("workspace", value);
      present();
      companion?.refreshFocus();
    },
    library,
  );
  portalHost = new PortalHost(workspace, library);
  workspace.portalHost = portalHost;
  ready = core.open().then(() => workspace.load());
  ready.catch((error) =>
    publish("connection", { phase: "disconnected", error: error.message }),
  );
  ipcMain.handle("voyager", async (event, method, input = {}) => {
    const native = event.sender === desktop.webContents;
    const sender = native ? desktop.webContents : win.webContents;
    if (event.sender !== sender || event.senderFrame !== sender.mainFrame)
      throw Error("Unknown workspace client.");
    if (
      native &&
      ![
        "avatar-ready",
        "avatar-drag",
        "avatar-drop",
        "restore",
        "voice",
        "voice-stop",
        "voice-state",
        "voice-stopped",
      ].includes(method)
    )
      throw Error("Unknown avatar action.");
    if (
      !native &&
      [
        "voice",
        "voice-stop",
        "voice-state",
        "voice-stopped",
        "avatar-ready",
        "avatar-drag",
        "avatar-drop",
      ].includes(method)
    )
      throw Error("Only the speech surface owns audio.");
    if (method === "voice-stopped") {
      if (stoppingVoice?.id !== input.id)
        throw Error("Unknown speech cleanup.");
      clearTimeout(stoppingVoice.timer);
      const pending = stoppingVoice;
      stoppingVoice = null;
      if (input.error) pending.reject(Error(input.error));
      else {
        voice = { pressed: false, connection: "closed", disabled: false };
        present();
        pending.resolve(true);
      }
      return true;
    }
    if (method === "voice-reset") {
      if (!stoppingVoice) {
        const id = ++voiceStopSequence;
        const promise = new Promise((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                Error("Speech cleanup unconfirmed. The conversation was kept."),
              ),
            30000,
          );
          stoppingVoice = { id, resolve, reject, timer };
        });
        stoppingVoice.promise = promise;
        desktop.webContents.send("voice-reset", { id });
      }
      return stoppingVoice.promise;
    }
    if (method === "avatar-ready") {
      present();
      return true;
    }
    if (method === "restore") {
      win.show();
      win.restore();
      win.focus();
      return true;
    }
    if (method === "minimize") {
      floatAvatar(input);
      win.minimize();
      return true;
    }
    await ready;
    if (method === "boot")
      return {
        state: workspace.state,
        core: core.info,
        session,
        portals: library.catalog(),
      };
    if (method === "portal") return portalHost.call(input);
    if (method === "portal-frame")
      return portalHost.call(input, false, input.id);
    if (method === "portal-folder") {
      await shell.openPath(library.root);
      return library.root;
    }
    if (method === "focus") return workspace.focus();
    if (method === "voice-state") {
      voice = input;
      present();
      return true;
    }
    if (method === "voice-toggle") {
      if (stoppingVoice) throw Error("Speech is stopping.");
      desktop.webContents.send("voice-toggle");
      return true;
    }
    if (method === "avatar-drag") {
      if (
        !floating ||
        typeof input.token !== "string" ||
        input.token.length > 80
      )
        throw Error("No floating avatar to move.");
      drag = { token: input.token, docked: false };
      desktop.setOpacity(0);
      return true;
    }
    if (method === "avatar-drop") {
      if (drag?.token === input.token && !drag.docked) {
        const cursor = screen.getCursorScreenPoint();
        desktop.setPosition(cursor.x - 60, cursor.y - 60);
        desktop.setOpacity(1);
      }
      return true;
    }
    if (method === "dock-desktop") {
      if (!drag || drag.token !== input.token || drag.docked || !floating)
        throw Error("This avatar drag is no longer active.");
      const state = await workspace.action("dock", { id: input.id });
      drag.docked = true;
      floating = false;
      desktop.hide();
      desktop.setOpacity(1);
      present();
      return state;
    }
    if (method === "action") {
      const state = await workspace.action(input.kind, input.input);
      if (input.kind === "dock" || input.kind === "sidebar") {
        floating = false;
        desktop.hide();
        desktop.setOpacity(1);
        present();
      }
      return state;
    }
    if (method === "choose-folder") {
      const picked = await dialog.showOpenDialog(win, {
        properties: ["openDirectory"],
      });
      return picked.canceled ? null : picked.filePaths[0];
    }
    if (method === "window-state")
      return { minimized: win.isMinimized(), floating };
    if (method === "processes") return core.rpc("terminal.list", { all: true });
    if (method === "stop")
      return core.rpc("terminal.kill", { terminal: input.terminal });
    if (method === "attach") {
      if (streams.has(input.terminal)) core.detach(streams.get(input.terminal));
      const result = await core.attach(
        input.terminal,
        input.cols,
        input.rows,
        (kind, data) => {
          if (kind === 0)
            publish("terminal", {
              terminal: input.terminal,
              data: data.toString("base64"),
              bytes: data.length,
            });
          if (kind === 2)
            publish("terminal", {
              terminal: input.terminal,
              closed: data.toString(),
            });
        },
      );
      streams.set(input.terminal, result.channel);
      return result.terminal;
    }
    if (method === "terminal") {
      const channel = streams.get(input.terminal);
      if (!channel) throw Error("Portal is not attached.");
      if (input.kind === "input")
        core.frame(channel, 0, Buffer.from(input.data));
      else if (input.kind === "credit") core.credit(channel, input.bytes);
      else if (input.kind === "focus")
        core.frame(channel, 4, Buffer.from([input.active ? 1 : 0]));
      else if (input.kind === "resize") {
        const size = Buffer.alloc(4);
        size.writeUInt16LE(Math.max(2, Math.min(65535, input.cols)), 0);
        size.writeUInt16LE(Math.max(2, Math.min(65535, input.rows)), 2);
        core.frame(channel, 3, size);
      } else if (input.kind === "detach") {
        core.detach(channel);
        streams.delete(input.terminal);
      } else throw Error("Unknown terminal interaction.");
      return true;
    }
    if (method === "chat-reset") {
      if (
        stoppingVoice ||
        voice.pressed ||
        voice.disabled ||
        voice.connection === "connected"
      )
        throw Error("Stop speech before starting a new conversation.");
      companion?.close();
      companion = null;
      return true;
    }
    if (method === "chat" || method === "voice" || method === "voice-stop") {
      if (method === "voice-stop" && !companion) return true;
      if (method === "voice" && stoppingVoice)
        throw Error("Speech startup was canceled.");
      if (!companion) {
        const { Companion } = require("./companion.cjs");
        fs.mkdirSync(profile, { recursive: true });
        companion = new Companion(workspace, profile, (value) =>
          publish("conversation", value),
        );
      }
      await companion.open();
      if (method === "chat") return companion.send(input.text);
      if (method === "voice") return companion.voice(input.sdp);
      return companion.stopVoice();
    }
    if (method === "quit") return quitVoyager();
    throw Error("Unknown Voyager action.");
  });
  await desktop.loadFile(path.join(__dirname, "floating.html"));
  await win.loadFile(path.join(__dirname, "index.html"));
  present();
});
