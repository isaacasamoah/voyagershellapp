const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PortalLibrary } = require("./portal-library.cjs");
const { PortalHost } = require("./portal-host.cjs");
const { Workspace } = require("./workspace.cjs");
const { Core } = require("./core.cjs");

test("editable packages retain data through removal and reject stale writes and escaped paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "voyager-packages-"));
  const events = [];
  const library = new PortalLibrary(
    root,
    path.join(__dirname, "portal-defaults"),
    null,
    (event) => events.push(event),
  );
  try {
    const portal = await library.create("whiteboard", root);
    const before = library.read(portal.id);
    const after = library.write(
      portal.id,
      { nodes: [{ id: "idea", text: "Visible idea", x: 12, y: 30 }] },
      before.version,
    );
    assert.equal(after.data.nodes[0].text, "Visible idea");
    assert.throws(
      () => library.write(portal.id, {}, before.version),
      /changed/,
    );
    assert.throws(
      () => library.file("whiteboard", "../notes/view.html"),
      /inside/,
    );
    fs.symlinkSync(
      "/etc/hostname",
      path.join(root, "packages/whiteboard/escape"),
    );
    assert.throws(() => library.file("whiteboard", "escape"), /escapes/);
    library.uninstall("whiteboard");
    assert.throws(() => library.definition("whiteboard"), /not installed/);
    assert.deepEqual(library.read(portal.id), after);
    library.uninstall("whiteboard", true);
    assert.equal(library.definition("whiteboard").renderer, "web");
    const file = path.join(root, "packages/whiteboard/portal.json");
    const validManifest = fs.readFileSync(file, "utf8");
    fs.writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(validManifest), name: {} }),
    );
    library.scan();
    assert.equal(
      library.catalog().find((item) => item.id === "whiteboard").name,
      "Whiteboard",
    );
    fs.writeFileSync(file, "{");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(library.definition("whiteboard").renderer, "web");
    assert.match(library.errors.whiteboard, /JSON|property/i);
    assert.ok(
      events.some((event) =>
        event.files.some((name) => name.includes("portal.json")),
      ),
    );
    const layout = library.saveLayout("My space", "home", portal);
    assert.deepEqual(library.loadLayout(layout, "home"), portal);
    assert.throws(
      () => library.loadLayout(layout, "elsewhere"),
      /another dimension/,
    );
    assert.throws(
      () => library.saveLayout("bad", "home", { id: "bad", children: [] }),
      /Invalid/,
    );
  } finally {
    library.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("generic portal updates honor avatar focus and layout restore does not restart a stopped backend", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "voyager-portal-core-"));
  const core = new Core(`voyager-portals-${process.pid}`);
  await core.open();
  const library = new PortalLibrary(
    root,
    path.join(__dirname, "portal-defaults"),
    core,
    () => {},
  );
  try {
    const workspace = new Workspace(core, root, () => {}, library);
    await workspace.load();
    const host = new PortalHost(workspace, library);
    await assert.rejects(
      host.call({ action: "catalog" }, false, "bound-instance"),
      /bound/,
    );
    const realm = workspace.state.realms[0];
    const dimension = realm.dimensions[0].id;
    realm.dimensions.push({
      id: "sibling",
      name: "Private sibling",
      root: null,
    });
    library.saveLayout("Private sibling", "sibling", null);
    workspace.state.dock = `dimension:${dimension}`;
    assert.throws(
      () => workspace.checkAction("portal", { dimension: "sibling" }),
      /Outside/,
    );
    const scopedCatalog = await host.call({ action: "catalog" }, true);
    assert.ok(!scopedCatalog.layouts.some((item) => item.owner === "sibling"));
    assert.equal(scopedCatalog.root, undefined);
    workspace.state.dock = "home";
    await workspace.action("portal", { type: "backend-demo", dimension });
    const backend = workspace.dimension(dimension).dimension.root.children[1];
    let snapshot;
    const until = Date.now() + 5000;
    do {
      snapshot = await host.call({ action: "inspect", id: backend.id });
      if (!snapshot.data.backend)
        await new Promise((resolve) => setTimeout(resolve, 50));
    } while (!snapshot.data.backend && Date.now() < until);
    const actual = await (await fetch(snapshot.data.backend.url)).json();
    const process = await core.rpc("terminal.get", {
      terminal: backend.terminal,
    });
    assert.equal(actual.pid, process.pid);
    workspace.state.dock = `portal:${backend.id}`;
    await assert.rejects(
      host.call(
        {
          action: "update",
          id: workspace.state.home.root.children[0].id,
          data: {},
          expected: snapshot.version,
        },
        true,
      ),
      /outside/,
    );
    const updated = await host.call(
      {
        action: "update",
        id: backend.id,
        data: {
          ...snapshot.data,
          message: "Changed through the same contract",
        },
        expected: snapshot.version,
      },
      true,
    );
    assert.equal(
      (await (await fetch(snapshot.data.backend.url)).json()).message,
      updated.data.message,
    );
    library.uninstall("backend-demo");
    assert.equal(
      (await core.rpc("terminal.get", { terminal: backend.terminal })).pid,
      process.pid,
    );
    assert.equal(
      (await (await fetch(snapshot.data.backend.url)).json()).message,
      updated.data.message,
    );
    library.uninstall("backend-demo", true);
    await assert.rejects(
      host.call(
        { action: "source", type: "backend-demo", file: "view.html" },
        true,
      ),
      /whole-workspace/,
    );
    await assert.rejects(
      host.call(
        { action: "inspect", id: workspace.state.home.root.children[0].id },
        false,
        backend.id,
      ),
      /bound/,
    );
    workspace.state.dock = "home";
    await workspace.action("layout-save", { name: "Backend", dimension });
    await workspace.action("hide", { id: backend.id });
    assert.equal(
      (await core.rpc("terminal.get", { terminal: backend.terminal })).pid,
      process.pid,
    );
    await core.rpc("terminal.kill", { terminal: backend.terminal });
    const layout = library.layouts().find((item) => item.owner === dimension);
    await workspace.action("layout-load", { file: layout.file, dimension });
    assert.equal(
      workspace.portal(backend.id).portal.terminal,
      backend.terminal,
    );
    assert.equal(
      (await core.rpc("terminal.get", { terminal: backend.terminal })).state,
      "finished",
    );
    library.uninstall("backend-demo");
    assert.equal(
      (await core.rpc("terminal.get", { terminal: backend.terminal })).state,
      "finished",
    );
    library.uninstall("backend-demo", true);
    assert.equal(library.read(backend.id).data.message, updated.data.message);
    await workspace.action("restart", { id: backend.id });
    const restarted = workspace.portal(backend.id).portal;
    assert.equal(restarted.type, "backend-demo");
    assert.notEqual(restarted.terminal, backend.terminal);
    assert.equal(library.read(backend.id).data.message, updated.data.message);
  } finally {
    library.close();
    await core.rpc("server.stop").catch((error) => {
      if (!/closed/.test(error.message)) throw error;
    });
    core.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
