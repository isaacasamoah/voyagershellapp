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
    this.indexProcesses();
    this.state.dock = this.dockId(this.state.dock);
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

  indexProcesses() {
    this.state.members ||= {};
    for (const realm of this.state.realms)
      for (const dimension of realm.dimensions)
        for (const portal of leaves(dimension.root))
          this.state.members[portal.terminal] = {
            realm: realm.id,
            dimension: dimension.id,
          };
  }

  dockId(id) {
    if (id === "home") return id;
    if (id === "dimension") {
      const realm = this.state.realms.find(
        (item) => item.id === this.state.activeRealm,
      );
      return `dimension:${realm.activeDimension}`;
    }
    if (id.startsWith("realm:")) {
      if (!this.state.realms.some((realm) => `realm:${realm.id}` === id))
        throw Error("Realm no longer exists.");
    } else if (id.startsWith("dimension:")) this.dimension(id.slice(10));
    else if (id.startsWith("portal:")) {
      if (!this.state.members[id.slice(7)])
        throw Error("Portal no longer exists.");
    } else return `portal:${this.portal(id).portal.terminal}`;
    return id;
  }

  focus() {
    const id = this.state.dock;
    if (id === "home") return { kind: "home", id, label: "Whole workspace" };
    const [kind, key] = id.split(":");
    if (kind === "realm") {
      const realm = this.state.realms.find((item) => item.id === key);
      return { kind, id, realm: key, label: `Realm · ${realm.name}` };
    }
    if (kind === "dimension") {
      const { realm, dimension } = this.dimension(key);
      return {
        kind,
        id,
        realm: realm.id,
        dimension: key,
        label: `Dimension · ${dimension.name}`,
      };
    }
    const member = this.state.members[key];
    return { kind, id, terminal: key, ...member, label: `Portal · ${key}` };
  }

  focusDescriptor() {
    const focus = this.focus();
    const realm = this.state.realms.find((item) => item.id === focus.realm);
    const dimension = realm?.dimensions.find(
      (item) => item.id === focus.dimension,
    );
    const portal =
      dimension &&
      leaves(dimension.root).find((item) => item.terminal === focus.terminal);
    return {
      ...focus,
      revision: this.version,
      path: [
        "Workspace",
        realm?.name,
        dimension?.name,
        focus.terminal && (portal?.title || focus.terminal),
      ].filter(Boolean),
    };
  }

  includes(terminal) {
    const focus = this.focus();
    const member = this.state.members[terminal];
    return (
      focus.kind === "home" ||
      (focus.kind === "portal"
        ? focus.terminal === terminal
        : !!member && member[focus.kind] === focus[focus.kind])
    );
  }

  context() {
    const focus = this.focus();
    return {
      authority: "owner",
      focus,
      realms: this.state.realms
        .filter((realm) => focus.kind === "home" || realm.id === focus.realm)
        .map((realm) => ({
          id: realm.id,
          name: realm.name,
          cwd: realm.cwd,
          dimensions: realm.dimensions
            .filter(
              (dimension) =>
                !focus.dimension || dimension.id === focus.dimension,
            )
            .map((dimension) => ({
              id: dimension.id,
              name: dimension.name,
              portals: leaves(dimension.root).filter((portal) =>
                this.includes(portal.terminal),
              ),
            })),
        })),
    };
  }

  checkAction(kind, input) {
    const focus = this.focus();
    if (focus.kind === "home" || kind === "dock" || kind === "sidebar") return;
    let allowed = false;
    if (["split", "hide", "restart"].includes(kind))
      allowed = this.includes(this.portal(input.id).portal.terminal);
    if (kind === "show") {
      const member = this.state.members[input.terminal];
      allowed =
        this.includes(input.terminal) &&
        member?.realm === this.state.activeRealm &&
        (focus.kind === "realm" ||
          this.state.realms.find((realm) => realm.id === member.realm)
            ?.activeDimension === member.dimension);
    }
    if (["dimension", "select-realm"].includes(kind))
      allowed =
        focus.kind === "realm" &&
        (input.id || this.state.activeRealm) === focus.realm;
    if (["select-dimension", "rename"].includes(kind))
      allowed =
        input.id === focus.realm ||
        input.id === focus.dimension ||
        (focus.kind === "realm" &&
          this.dimension(input.id).realm.id === focus.realm);
    if (!allowed)
      throw Error(
        `Outside Voyager's current focus (${focus.label}). Ask the owner before changing focus.`,
      );
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

  action(kind, input = {}, scoped = false) {
    const next = this.queue.then(async () => {
      if (this.blocked) throw this.blocked;
      const candidate = Object.create(this);
      candidate.state = structuredClone(this.state);
      try {
        if (scoped) candidate.checkAction(kind, input);
        await candidate.mutate(kind, input);
        candidate.indexProcesses();
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
      const member = this.state.members[terminal.address];
      const focus = this.focus();
      if (focus.kind !== "home" && member) {
        const { realm, dimension } = this.dimension(member.dimension);
        const portal = {
          id: randomUUID(),
          title: terminal.name || "Shell",
          terminal: terminal.address,
        };
        dimension.root = dimension.root
          ? {
              id: randomUUID(),
              axis: "horizontal",
              ratio: 0.5,
              children: [dimension.root, portal],
            }
          : portal;
        this.state.activeRealm = realm.id;
        realm.activeDimension = dimension.id;
        return;
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
      this.state.dock = this.dockId(id);
      if (id === "home") this.state.sidebar = true;
      return;
    }
    if (kind === "sidebar-show") {
      this.state.sidebar = true;
      return;
    }
    if (kind === "sidebar") {
      this.state.sidebar = !this.state.sidebar;
      this.state.dock = this.state.sidebar ? "home" : this.dockId("dimension");
      return;
    }
    throw Error("Unknown workspace action.");
  }
}

module.exports = { Workspace, leaves };
