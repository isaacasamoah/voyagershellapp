const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { Core } = require("./core.cjs");
const { Workspace } = require("./workspace.cjs");

const session = process.env.VOYAGER_WORKSPACE_SESSION || "voyager-workspace";
const profile = path.join(app.getPath("appData"), session);
app.setPath("userData", profile);
if (!app.requestSingleInstanceLock()) app.quit();
let win;
let core;
let workspace;
let companion;
let ready;
let quitting = false;
const streams = new Map();
const publish = (topic, value) => {
  if (win && !win.isDestroyed()) win.webContents.send(topic, value);
};

app.on("second-instance", () => {
  win?.restore();
  win?.focus();
});
app.on("window-all-closed", () => {
  companion?.close();
  core?.close();
  app.quit();
});

app.whenReady().then(async () => {
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
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionCheckHandler(
    (contents, permission) =>
      contents === win.webContents && permission === "media",
  );
  win.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback) =>
      callback(contents === win.webContents && permission === "media"),
  );
  win.on("minimize", () => publish("native-window", { minimized: true }));
  win.on("restore", () => publish("native-window", { minimized: false }));
  core = new Core(session);
  core.on("disconnected", (error) =>
    publish("connection", {
      phase: quitting ? "stopped" : "disconnected",
      error,
    }),
  );
  workspace = new Workspace(
    core,
    process.env.VOYAGER_WORKSPACE_CWD || path.resolve(__dirname, "../.."),
    (value) => publish("workspace", value),
  );
  ready = core.open().then(() => workspace.load());
  ready.catch((error) =>
    publish("connection", { phase: "disconnected", error: error.message }),
  );
  ipcMain.handle("voyager", async (event, method, input = {}) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw Error("Unknown workspace client.");
    await ready;
    if (method === "boot")
      return { state: workspace.state, core: core.info, session };
    if (method === "action") return workspace.action(input.kind, input.input);
    if (method === "choose-folder") {
      const picked = await dialog.showOpenDialog(win, {
        properties: ["openDirectory"],
      });
      return picked.canceled ? null : picked.filePaths[0];
    }
    if (method === "minimize") {
      win.minimize();
      return true;
    }
    if (method === "window-state") return { minimized: win.isMinimized() };
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
      companion?.close();
      companion = null;
      return true;
    }
    if (method === "chat" || method === "voice" || method === "voice-stop") {
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
    if (method === "quit") {
      quitting = true;
      publish("connection", { phase: "stopping" });
      companion?.close();
      await core.rpc("server.stop");
      core.close();
      app.quit();
      return true;
    }
    throw Error("Unknown Voyager action.");
  });
  await win.loadFile(path.join(__dirname, "index.html"));
});
