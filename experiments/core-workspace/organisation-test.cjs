const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Workspace } = require("./workspace.cjs");

function fixture() {
  const workspace = new Workspace(
    {
      rpc: async (method) => {
        assert.equal(method, "doc.set");
        return { version: workspace.version + 1 };
      },
    },
    "/tmp",
    () => {},
  );
  workspace.state = {
    dock: "home",
    sidebar: true,
    activeRealm: "r1",
    view: "dimension",
    realms: [
      {
        id: "r1",
        name: "One",
        activeDimension: "d1",
        dimensions: [
          {
            id: "d1",
            name: "First",
            root: {
              id: "p1",
              title: "Shell",
              type: "terminal",
              terminal: "t1",
              config: { font: 14 },
            },
          },
          {
            id: "d2",
            name: "Second",
            root: { id: "p2", title: "Notes", type: "notes" },
          },
        ],
      },
      {
        id: "r2",
        name: "Two",
        activeDimension: "d3",
        dimensions: [{ id: "d3", name: "Empty", root: null }],
      },
    ],
  };
  workspace.indexProcesses();
  return workspace;
}

test("renaming and navigation ordering preserve existing identities", async () => {
  const w = fixture();
  await w.action("rename", { id: "p1", name: "Build" });
  assert.equal(w.portal("p1").portal.title, "Build");
  await w.action("reorder", { entity: "realm", id: "r2", target: "r1" });
  await w.action("reorder", { entity: "dimension", id: "d2", target: "d1" });
  assert.deepEqual(
    w.state.realms.map((x) => x.id),
    ["r2", "r1"],
  );
  assert.deepEqual(
    w.state.realms[1].dimensions.map((x) => x.id),
    ["d2", "d1"],
  );
  assert.equal(w.state.activeRealm, "r1");
  assert.equal(w.portal("p1").portal.terminal, "t1");
});

test("moving terminal and web Vessels across Fleets preserves their complete payload and pinned focus", async () => {
  const w = fixture();
  const before = structuredClone(w.portal("p1").portal);
  w.state.dock = "portal:t1";
  await w.action("move", { id: "p1", dimension: "d3" });
  assert.deepEqual(w.portal("p1").portal, before);
  assert.equal(w.dimension("d1").dimension.root, null);
  assert.equal(w.focusDescriptor().dimension, "d3");
  assert.deepEqual(w.focusDescriptor().path, [
    "Workspace",
    "Two",
    "Empty",
    "Shell",
  ]);
  w.state.dock = "home";
  await w.action("move", { id: "p2", target: "p1", position: "left" });
  assert.equal(w.portal("p2").dimension.id, "d3");
  assert.equal(w.dimension("d3").dimension.root.children[0].id, "p2");
  assert.equal(w.state.activeRealm, "r2");
});

test("invalid and separately out-of-scope destinations or sources cannot change placement", async () => {
  for (const [input, scoped] of [
    [{ id: "p1", dimension: "missing" }, false],
    [{ id: "p1", target: "p2", position: "diagonal" }, false],
    [{ id: "p1", dimension: "d2" }, true],
    [{ id: "p2", dimension: "d1" }, true],
  ]) {
    const w = fixture();
    w.state.dock = "dimension:d1";
    const before = structuredClone(w.state);
    await assert.rejects(w.action("move", input, scoped));
    assert.deepEqual(w.state, before);
    assert.equal(w.version, 0);
  }
});
