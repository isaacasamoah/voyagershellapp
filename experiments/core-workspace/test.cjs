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
  workspace.state = { sidebar: true, dock: "home" };
  await assert.rejects(workspace.action("sidebar"), /save unconfirmed/);
  assert.deepEqual(workspace.state, { sidebar: true, dock: "home" });
  await assert.rejects(
    workspace.action("dock", { id: "home" }),
    /save unconfirmed/,
  );
  assert.equal(saves, 1);
});

test("known chat rejection releases busy, uncertain delivery stays gated without replay", async () => {
  const events = [];
  const companion = new Companion(null, "/tmp", (event) => events.push(event));
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
