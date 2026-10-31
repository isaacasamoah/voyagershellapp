const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Core } = require("./core.cjs");
const { Workspace } = require("./workspace.cjs");
const { Companion } = require("./companion.cjs");

test("real Core keeps programs alive across viewer detach and isolates sessions", async () => {
  const session = `voyager-proof-${process.pid}`;
  const core = new Core(session);
  await core.open();
  try {
    const started = await core.rpc("terminal.run", {
      argv: ["/bin/bash", "--noprofile", "--norc"],
      no_parent: true,
      keep: false,
    });
    const id = started.address;
    let output = "";
    const stream = await core.attach(id, 80, 24, (kind, data) => {
      if (kind === 0) {
        output += data.toString();
      }
    });
    core.frame(stream.channel, 0, Buffer.from("printf 'REAL_CORE_λ\\n'\r"));
    await assertEventually(() => output.includes("REAL_CORE_λ\r\n"));
    const frames = [];
    const write = core.child.stdin.write.bind(core.child.stdin);
    core.child.stdin.write = (data) => {
      frames.push(Buffer.from(data));
      return write(data);
    };
    core.detach(stream.channel);
    assert.ok(
      frames.some(
        (frame) => frame.readUInt32LE(0) === stream.channel && frame[4] === 2,
      ),
      "detach must send CLOSE on the actual transport",
    );
    const afterDetach = await core.rpc("terminal.get", { terminal: id });
    assert.equal(afterDetach.state, "live");
    assert.equal(afterDetach.pid, started.pid);
    let reattached = "";
    await core.attach(id, 90, 30, (kind, data) => {
      if (kind === 0) reattached += data.toString();
    });
    await assertEventually(() => reattached.includes("REAL_CORE_λ"));
    await assert.rejects(
      core.rpc("terminal.get", { terminal: "not-a-voyager-terminal" }),
    );
    await core.rpc("terminal.kill", { terminal: id });
    assert.equal(
      (await core.rpc("terminal.get", { terminal: id })).state,
      "finished",
    );
  } finally {
    await core.rpc("server.stop", {}).catch((error) => {
      if (!/closed/.test(error.message)) throw error;
    });
    core.close();
  }
});

test("a failed layout save cannot leak into a later saved action", async () => {
  let saves = 0;
  const workspace = new Workspace(
    {
      rpc: async () => {
        saves++;
        throw Error("save rejected");
      },
    },
    "/tmp",
    () => assert.fail("uncommitted state published"),
  );
  workspace.state = {
    sidebar: true,
    dock: "home",
    activeRealm: "r",
    realms: [{ id: "r", activeDimension: "d", dimensions: [] }],
  };
  await assert.rejects(workspace.action("sidebar"), /save unconfirmed/);
  assert.equal(workspace.state.sidebar, true);
  assert.equal(workspace.state.dock, "home");
  await assert.rejects(
    workspace.action("dock", { id: "home" }),
    /save unconfirmed/,
  );
  assert.equal(saves, 1);
});

test("known chat rejection releases busy, uncertain delivery stays gated without replay", async () => {
  const events = [];
  const companion = new Companion(
    {
      focusDescriptor: () => ({
        kind: "home",
        id: "home",
        revision: 0,
        path: ["Workspace"],
      }),
    },
    "/tmp",
    (event) => events.push(event),
  );
  let calls = 0;
  companion.rpc = async () => {
    calls++;
    throw Object.assign(Error("not accepted"), { rejected: true });
  };
  await assert.rejects(companion.send("hello"), /not accepted/);
  assert.equal(companion.busy, false);
  assert.ok(events.some((event) => event.type === "refused"));
  companion.rpc = async () => {
    calls++;
    throw Error("outcome unconfirmed");
  };
  await assert.rejects(companion.send("hello"), /unconfirmed/);
  assert.equal(companion.busy, true);
  assert.equal(calls, 2);
  assert.ok(events.some((event) => event.type === "error"));
});

async function assertEventually(condition) {
  const until = Date.now() + 8000;
  while (!condition() && Date.now() < until)
    await new Promise((r) => setTimeout(r, 50));
  assert.ok(condition(), "real terminal output did not arrive");
}

test("late frames after detach are discarded rather than retained as a future attachment", () => {
  const core = new Core("voyager-late-frame-proof");
  core.framed = true;
  let frame;
  core.child = {
    stdin: {
      write: (value) => {
        frame = value;
      },
    },
  };
  core.channels.set(7, () => assert.fail("detached viewer received output"));
  core.detach(7);
  core.frame(7, 0, Buffer.from("late output"));
  core.buffer = frame;
  core.consume();
  assert.equal(core.early.size, 0);
  assert.equal(core.channels.size, 0);
});

test("avatar focus follows exact realm, dimension and process, including hidden views", async () => {
  const workspace = new Workspace(null, "/tmp", () => {});
  workspace.state = {
    dock: "home",
    realms: [
      {
        id: "r",
        name: "Studio",
        dimensions: [
          { id: "d", name: "Code", root: { id: "p", terminal: "t1" } },
          { id: "e", name: "Notes", root: { id: "q", terminal: "t2" } },
        ],
      },
    ],
  };
  workspace.indexProcesses();
  workspace.state.dock = workspace.dockId("dimension:d");
  assert.equal(workspace.includes("t1"), true);
  assert.equal(workspace.includes("t2"), false);
  assert.equal(workspace.context().realms[0].dimensions.length, 1);
  assert.throws(() => workspace.checkAction("split", { id: "q" }), /Outside/);
  assert.throws(() => workspace.dockId("realm:missing"), /no longer exists/);
  workspace.state.dock = workspace.dockId("p");
  workspace.state.realms[0].dimensions[0].root = null;
  workspace.indexProcesses();
  assert.equal(workspace.includes("t1"), true);
  assert.equal(workspace.includes("t2"), false);
  workspace.state.dock = workspace.dockId("realm:r");
  assert.equal(workspace.includes("t2"), true);
  workspace.state.dock = "home";
  assert.equal(workspace.includes("t2"), true);
});

test("showing a hidden focused process preserves its dimension and process", async () => {
  const workspace = new Workspace(
    {
      rpc: async (method) =>
        method === "terminal.get"
          ? { address: "t1", name: "Shell" }
          : { version: 2 },
    },
    "/tmp",
    () => {},
  );
  workspace.state = {
    dock: "dimension:d",
    activeRealm: "r",
    members: { t1: { realm: "r", dimension: "d" } },
    realms: [
      {
        id: "r",
        name: "Studio",
        activeDimension: "d",
        dimensions: [{ id: "d", name: "Code", root: null }],
      },
    ],
  };
  await workspace.action("show", { terminal: "t1" }, true);
  assert.equal(workspace.state.realms[0].dimensions.length, 1);
  assert.equal(workspace.state.realms[0].dimensions[0].root.terminal, "t1");
  assert.deepEqual(workspace.state.members.t1, { realm: "r", dimension: "d" });
});

test("each request carries explicit focus while human text stays unchanged", async () => {
  const workspace = new Workspace(null, "/tmp", () => {});
  workspace.version = 7;
  workspace.state = {
    dock: "home",
    realms: [
      {
        id: "r",
        name: "Studio",
        dimensions: [
          {
            id: "d",
            name: "Code",
            root: { id: "p", terminal: "t1", title: "Shell" },
          },
        ],
      },
    ],
  };
  workspace.indexProcesses();
  const companion = new Companion(workspace, "/tmp", () => {});
  companion.thread = "same-thread";
  const calls = [];
  companion.rpc = async (method, params) => {
    calls.push({ method, params });
    return {};
  };
  for (const dock of ["home", "realm:r", "dimension:d", "portal:t1"]) {
    workspace.state.dock = dock;
    companion.busy = false;
    await companion.send("What is here?");
    const request = calls.at(-1);
    assert.equal(request.params.threadId, "same-thread");
    assert.deepEqual(request.params.input, [
      { type: "text", text: "What is here?" },
    ]);
    const text = request.params.additionalContext["voyager.focus"].value;
    assert.ok(text.includes(JSON.stringify(dock)));
    assert.ok(text.includes('"revision":7'));
  }
  await companion.voice("test-sdp");
  assert.ok(
    calls.some(
      (call) =>
        call.method === "thread/realtime/start" &&
        call.params.initialItems[0].role === "developer",
    ),
  );
  workspace.state.dock = "realm:r";
  await companion.refreshFocus();
  const update = calls.at(-1);
  assert.equal(update.method, "thread/realtime/appendText");
  assert.equal(update.params.role, "developer");
  assert.ok(update.params.text.includes('"path":["Workspace","Studio"]'));
  assert.equal(calls.filter((call) => call.method === "turn/start").length, 4);
  const acknowledged = calls.length;
  workspace.version++;
  await companion.refreshFocus();
  assert.equal(calls.length, acknowledged);
  workspace.state.dock = "home";
  let failures = 0;
  companion.rpc = async () => {
    failures++;
    throw Error("context outcome unconfirmed");
  };
  await companion.refreshFocus();
  companion.busy = false;
  await assert.rejects(
    companion.send("Stay here"),
    /context outcome unconfirmed/,
  );
  await companion.refreshFocus();
  assert.equal(failures, 1);
});
