const { randomUUID } = require("node:crypto");

function leaves(node) {
  if (!node) return [];
  return node.children ? node.children.flatMap(leaves) : [node];
}

function replace(node, id, next) {
  if (!node) return null;
  if (node.id === id) return next;
  if (!node.children) return node;
  const children = node.children
    .map((child) => replace(child, id, next))
    .filter(Boolean);
  return children.length === 1 ? children[0] : { ...node, children };
}

class Workspace {
  constructor(core, cwd, publish) {
    this.core = core;
    this.cwd = cwd;
    this.publish = publish;
    this.version = 0;
    this.queue = Promise.resolve();
  }

  async load() {
    const doc = await this.core.rpc("doc.get", { name: "voyager-workspace" });
    this.version = doc.version;
    this.state = doc.value || {
      realms: [],
      activeRealm: null,
      sidebar: true,
      dock: "home",
    };
    if (!this.state.realms.length)
      await this.action("realm", { name: "Voyager", cwd: this.cwd });
    return this.state;
  }

  dimension(id) {
    for (const realm of this.state.realms) {
      const dimension = realm.dimensions.find((item) => item.id === id);
      if (dimension) return { realm, dimension };
    }
    throw Error("Dimension no longer exists.");
  }

  portal(id) {
    for (const realm of this.state.realms) {
      for (const dimension of realm.dimensions) {
        const portal = leaves(dimension.root).find((item) => item.id === id);
        if (portal) return { realm, dimension, portal };
      }
    }
    throw Error("Portal no longer exists.");
  }

  async shell(cwd, title = "Shell", argv) {
    const terminal = await this.core.rpc("terminal.run", {
      argv: argv || ["/bin/bash", "--noprofile", "--norc"],
      cwd,
      no_parent: true,
      keep: false,
      labels: { workspace: "voyager" },
      env: {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "Voyager",
        PS1: "\\[\\e[38;5;103m\\]\\W\\[\\e[0m\\] \\n\\[\\e[38;5;147m\\]❯\\[\\e[0m\\] ",
      },
    });
    return { id: randomUUID(), terminal: terminal.address, title };
  }

  action(kind, input = {}) {
    const next = this.queue.then(async () => {
      if (this.blocked) throw this.blocked;
      const candidate = Object.create(this);
      candidate.state = structuredClone(this.state);
      try {
        await candidate.mutate(kind, input);
      } catch (error) {
        if (/unconfirmed|disconnected|closed/.test(error.message))
          this.blocked = error;
        throw error;
      }
      let saved;
      try {
        saved = await this.core.rpc("doc.set", {
          name: "voyager-workspace",
          value: candidate.state,
          version: this.version,
        });
      } catch (error) {
        this.blocked = Error(
          "Layout save unconfirmed. Reopen the viewer to reconcile. Processes were not retried.",
        );
        throw this.blocked;
      }
      this.state = candidate.state;
      this.version = saved.version;
      this.publish(this.state);
      return this.state;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async mutate(kind, input) {
    const { id, name } = input;
    if (kind === "realm") {
      const cwd = input.cwd || this.cwd;
      const realm = {
        id: randomUUID(),
        name: name || "New realm",
        cwd,
        dimensions: [],
      };
      const portal = await this.shell(cwd);
      const dimension = { id: randomUUID(), name: "Workbench", root: portal };
      realm.dimensions.push(dimension);
      realm.activeDimension = dimension.id;
      this.state.realms.push(realm);
      this.state.activeRealm = realm.id;
      return;
    }
    if (kind === "select-realm") {
      if (!this.state.realms.some((realm) => realm.id === id))
        throw Error("Realm no longer exists.");
      this.state.activeRealm = id;
      return;
    }
    if (kind === "dimension") {
      const realm = this.state.realms.find(
        (item) => item.id === this.state.activeRealm,
      );
      const portal = await this.shell(realm.cwd);
      const dimension = {
        id: randomUUID(),
        name: name || "Untitled",
        root: portal,
      };
      realm.dimensions.push(dimension);
      realm.activeDimension = dimension.id;
      return;
    }
    if (kind === "select-dimension") {
      const { realm } = this.dimension(id);
      this.state.activeRealm = realm.id;
      realm.activeDimension = id;
      return;
    }
    if (kind === "split") {
      const { realm, dimension, portal } = this.portal(id);
      const next = await this.shell(
        input.cwd || realm.cwd,
        input.name || "Shell",
        input.argv,
      );
      dimension.root = replace(dimension.root, id, {
        id: randomUUID(),
        axis: input.axis === "vertical" ? "vertical" : "horizontal",
        ratio: 0.5,
        children: [portal, next],
      });
      return;
    }
    if (kind === "hide") {
      const { dimension } = this.portal(id);
      dimension.root = replace(dimension.root, id, null);
      return;
    }
    if (kind === "restart") {
      const { realm, dimension } = this.portal(id);
      const previous = this.portal(id).portal;
      const status = await this.core.rpc("terminal.get", {
        terminal: previous.terminal,
      });
      if (status.state === "live") throw Error("This shell is still running.");
      dimension.root = replace(dimension.root, id, await this.shell(realm.cwd));
      return;
    }
    if (kind === "show") {
      const terminal = await this.core.rpc("terminal.get", {
        terminal: input.terminal,
      });
      for (const existingRealm of this.state.realms) {
        const existing = existingRealm.dimensions.find((item) =>
          leaves(item.root).some((leaf) => leaf.terminal === terminal.address),
        );
        if (existing) {
          this.state.activeRealm = existingRealm.id;
          existingRealm.activeDimension = existing.id;
          return;
        }
      }
      const realm = this.state.realms.find(
        (item) => item.id === this.state.activeRealm,
      );
      const portal = {
        id: randomUUID(),
        title: terminal.name || "Shell",
        terminal: terminal.address,
      };
      const dimension = {
        id: randomUUID(),
        name: input.name || "Process",
        root: portal,
      };
      realm.dimensions.push(dimension);
      realm.activeDimension = dimension.id;
      return;
    }
    if (kind === "ratio") {
      const { dimension } = this.dimension(input.dimension);
      function resize(node) {
        if (node.id === id)
          node.ratio = Math.max(0.15, Math.min(0.85, input.ratio));
        node.children?.forEach(resize);
      }
      if (!Number.isFinite(input.ratio))
        throw Error("Invalid divider position.");
      resize(dimension.root);
      return;
    }
    if (kind === "rename") {
      if (typeof name !== "string" || !name.trim() || name.length > 80)
        throw Error("Use 1–80 characters.");
      const target =
        this.state.realms.find((realm) => realm.id === id) ||
        this.state.realms
          .flatMap((realm) => realm.dimensions)
          .find((dim) => dim.id === id);
      if (!target) throw Error("Item no longer exists.");
      target.name = name.trim();
      return;
    }
    if (kind === "dock") {
      if (!["home", "dimension"].includes(id)) this.portal(id);
      this.state.dock = id;
      if (id === "home") this.state.sidebar = true;
      return;
    }
    if (kind === "sidebar") {
      this.state.sidebar = !this.state.sidebar;
      this.state.dock = this.state.sidebar ? "home" : "dimension";
      return;
    }
    throw Error("Unknown workspace action.");
  }
}

module.exports = { Workspace, leaves };
