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
  constructor(core, cwd, publish, library) {
    this.core = core;
    this.library = library;
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
    this.state.hidden ||= {};
    if (this.library && !this.state.home) {
      const portals = await Promise.all(
        ["workspace-status", "inbox", "orbit"].map((type) =>
          this.library.create(type, this.cwd),
        ),
      );
      this.state.home = {
        id: "home",
        name: "Home",
        root: {
          id: randomUUID(),
          axis: "horizontal",
          ratio: 0.55,
          children: [
            portals[0],
            {
              id: randomUUID(),
              axis: "vertical",
              ratio: 0.6,
              children: portals.slice(1),
            },
          ],
        },
      };
    }
    this.indexProcesses();
    this.state.dock = this.dockId(this.state.dock);
    if (!this.state.realms.length)
      await this.action("realm", { name: "Voyager", cwd: this.cwd });
    return this.state;
  }

  places() {
    return [
      ...this.state.realms.flatMap((realm) =>
        realm.dimensions.map((dimension) => ({ realm, dimension })),
      ),
      ...(this.state.home
        ? [
            {
              realm: { id: "workspace", name: "Workspace", cwd: this.cwd },
              dimension: this.state.home,
            },
          ]
        : []),
    ];
  }

  dimension(id) {
    if (id === "home" && this.state.home)
      return this.places().find((item) => item.dimension.id === id);
    for (const realm of this.state.realms) {
      const dimension = realm.dimensions.find((item) => item.id === id);
      if (dimension) return { realm, dimension };
    }
    throw Error("Dimension no longer exists.");
  }

  portal(id) {
    for (const { realm, dimension } of this.places()) {
      const portal = leaves(dimension.root).find(
        (item) => item.id === id || item.terminal === id,
      );
      if (portal) return { realm, dimension, portal };
    }
    const hidden =
      this.state.hidden?.[id] ||
      Object.values(this.state.hidden || {}).find(
        (item) => item.portal.terminal === id,
      );
    if (hidden)
      return {
        ...this.dimension(hidden.dimension),
        portal: hidden.portal,
        hidden: true,
      };
    throw Error("Portal no longer exists.");
  }

  containsPortal(id) {
    const focus = this.focus();
    const { realm, dimension, portal } = this.portal(id);
    return (
      focus.kind === "home" ||
      (focus.kind === "portal"
        ? focus.portal
          ? focus.portal === portal.id
          : focus.terminal === portal.terminal
        : focus.kind === "realm"
          ? focus.realm === realm.id
          : focus.dimension === dimension.id)
    );
  }

  indexProcesses() {
    this.state.members ||= {};
    for (const { realm, dimension } of this.places())
      for (const portal of leaves(dimension.root))
        if (portal.terminal)
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
      if (!this.state.members[id.slice(7)]) this.portal(id.slice(7));
    } else {
      const portal = this.portal(id).portal;
      return `portal:${portal.terminal || portal.id}`;
    }
    return id;
  }

  focus() {
    const id = this.state.dock;
    if (id === "home") return { kind: "home", id, label: "Whole workspace" };
    const [kind, key] = id.split(":");
    if (kind === "realm") {
      const realm = this.state.realms.find((item) => item.id === key);
      return { kind, id, realm: key, label: `Voyage · ${realm.name}` };
    }
    if (kind === "dimension") {
      const { realm, dimension } = this.dimension(key);
      return {
        kind,
        id,
        realm: realm.id,
        dimension: key,
        label: `Fleet · ${dimension.name}`,
      };
    }
    const member = this.state.members[key];
    if (member)
      return { kind, id, terminal: key, ...member, label: `Vessel · ${key}` };
    const { realm, dimension, portal } = this.portal(key);
    return {
      kind,
      id,
      portal: portal.id,
      terminal: portal.terminal,
      realm: realm.id,
      dimension: dimension.id,
      label: `Vessel · ${portal.title}`,
    };
  }

  focusDescriptor() {
    const focus = this.focus();
    const place = focus.dimension ? this.dimension(focus.dimension) : null;
    const realm =
      place?.realm || this.state.realms.find((item) => item.id === focus.realm);
    const dimension = place?.dimension;
    const portal =
      dimension &&
      leaves(dimension.root).find((item) =>
        focus.portal
          ? item.id === focus.portal
          : item.terminal === focus.terminal,
      );
    return {
      ...focus,
      revision: this.version,
      path: [
        "Workspace",
        realm?.name,
        dimension?.name,
        focus.kind === "portal" && (portal?.title || focus.label),
      ].filter(Boolean),
    };
  }

  includes(terminal) {
    if (!terminal) return false;
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
      home: focus.kind === "home" ? this.state.home : undefined,
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
                this.containsPortal(portal.id),
              ),
            })),
        })),
    };
  }

  checkAction(kind, input) {
    const focus = this.focus();
    if (focus.kind === "home" || kind === "dock" || kind === "sidebar") return;
    let allowed = false;
    if (["split", "hide", "restart", "show-portal", "move"].includes(kind))
      allowed =
        this.containsPortal(input.id) &&
        (!input.target || this.containsPortal(input.target));
    if (["portal", "layout-save", "layout-load", "ratio"].includes(kind)) {
      const target = this.dimension(input.dimension);
      allowed =
        focus.kind !== "portal" &&
        ((focus.kind === "realm" && focus.realm === target.realm.id) ||
          (focus.kind === "dimension" &&
            focus.dimension === target.dimension.id));
    }
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
    if (kind === "move" && input.dimension) {
      const target = this.dimension(input.dimension);
      allowed =
        this.containsPortal(input.id) &&
        ((focus.kind === "realm" && focus.realm === target.realm.id) ||
          (focus.kind === "dimension" &&
            focus.dimension === target.dimension.id));
    }
    if (kind === "rename") {
      const realm = this.state.realms.find((item) => item.id === input.id);
      const place = this.places().find(
        (item) => item.dimension.id === input.id,
      );
      allowed = realm
        ? focus.kind === "realm" && focus.realm === realm.id
        : place
          ? (focus.kind === "realm" && focus.realm === place.realm.id) ||
            (focus.kind === "dimension" &&
              focus.dimension === place.dimension.id)
          : this.containsPortal(input.id);
    }
    if (kind === "reorder" && input.entity === "dimension")
      allowed =
        focus.kind === "realm" &&
        this.dimension(input.id).realm.id === focus.realm &&
        this.dimension(input.target).realm.id === focus.realm;
    if (kind === "select-dimension")
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

  async shell(cwd, title = "Shell", argv, type = "terminal") {
    if (this.library && !argv) return this.library.create(type, cwd);
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
      this.state.view = "dimension";
      return;
    }
    if (kind === "select-realm") {
      if (!this.state.realms.some((realm) => realm.id === id))
        throw Error("Realm no longer exists.");
      this.state.activeRealm = id;
      this.state.view = "dimension";
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
      this.state.view = "dimension";
      return;
    }
    if (kind === "select-dimension") {
      const { realm } = this.dimension(id);
      if (id === "home") {
        this.state.view = "home";
        return;
      }
      this.state.activeRealm = realm.id;
      realm.activeDimension = id;
      this.state.view = id === "home" ? "home" : "dimension";
      return;
    }
    if (kind === "split") {
      const { realm, dimension, portal } = this.portal(id);
      const next = await this.shell(
        input.cwd || realm.cwd,
        input.name || "Shell",
        input.argv,
        input.type,
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
      const { realm, dimension, portal } = this.portal(id);
      this.state.hidden ||= {};
      this.state.hidden[id] = {
        realm: realm.id,
        dimension: dimension.id,
        portal,
      };
      dimension.root = replace(dimension.root, id, null);
      return;
    }
    if (kind === "restart") {
      const { realm, dimension } = this.portal(id);
      const previous = this.portal(id).portal;
      if (!previous.terminal)
        throw Error("This portal has no backend to start.");
      const status = await this.core.rpc("terminal.get", {
        terminal: previous.terminal,
      });
      if (status.state === "live") throw Error("This shell is still running.");
      const next = this.library
        ? await this.library.startProcess(previous, realm.cwd)
        : await this.shell(realm.cwd);
      dimension.root = replace(dimension.root, id, next);
      if (this.state.dock === `portal:${previous.terminal}`)
        this.state.dock = `portal:${next.terminal}`;
      return;
    }
    if (kind === "home") {
      this.state.view = "home";
      this.state.dock = "home";
      this.state.sidebar = true;
      return;
    }
    if (kind === "portal") {
      const { realm, dimension } = this.dimension(input.dimension);
      const portal = await this.library.create(input.type, realm.cwd);
      dimension.root = dimension.root
        ? {
            id: randomUUID(),
            axis: input.axis || "horizontal",
            ratio: 0.5,
            children: [dimension.root, portal],
          }
        : portal;
      return;
    }
    if (kind === "show-portal") {
      const { realm, dimension, portal, hidden } = this.portal(id);
      if (hidden) {
        dimension.root = dimension.root
          ? {
              id: randomUUID(),
              axis: "horizontal",
              ratio: 0.5,
              children: [dimension.root, portal],
            }
          : portal;
        delete this.state.hidden[portal.id];
      }
      if (dimension.id === "home") this.state.view = "home";
      else {
        this.state.activeRealm = realm.id;
        realm.activeDimension = dimension.id;
        this.state.view = "dimension";
      }
      return;
    }
    if (kind === "move") {
      const source = this.portal(id);
      const position = input.position || "right";
      if (!["left", "right", "top", "bottom"].includes(position))
        throw Error("Choose left, right, top or bottom.");
      if (!!input.target === !!input.dimension)
        throw Error("Choose one destination Fleet or Vessel.");
      const target = input.target
        ? this.portal(input.target)
        : this.dimension(input.dimension);
      if (source.hidden || target.hidden)
        throw Error("Reveal the Vessel before moving it.");
      if (source.portal.id === target.portal?.id) return;
      const destination = target.portal || target.dimension.root;
      if (!target.portal && source.dimension.id === target.dimension.id) return;
      source.dimension.root = replace(
        source.dimension.root,
        source.portal.id,
        null,
      );
      const before = ["left", "top"].includes(position);
      const children = before
        ? [source.portal, destination]
        : [destination, source.portal];
      const next = destination
        ? {
            id: randomUUID(),
            axis: ["top", "bottom"].includes(position)
              ? "vertical"
              : "horizontal",
            ratio: 0.5,
            children,
          }
        : source.portal;
      target.dimension.root = target.portal
        ? replace(target.dimension.root, target.portal.id, next)
        : next;
      if (target.dimension.id === "home") this.state.view = "home";
      else {
        this.state.activeRealm = target.realm.id;
        target.realm.activeDimension = target.dimension.id;
        this.state.view = "dimension";
      }
      return;
    }
    if (kind === "reorder") {
      const items =
        input.entity === "realm"
          ? this.state.realms
          : input.entity === "dimension"
            ? this.dimension(id).realm.dimensions
            : null;
      if (!items) throw Error("Choose Voyages or Fleets to reorder.");
      const source = items.find((item) => item.id === id);
      const target = items.find((item) => item.id === input.target);
      if (!source || !target)
        throw Error("Reorder items within their existing navigation group.");
      if (input.after !== undefined && typeof input.after !== "boolean")
        throw Error("Choose before or after the navigation target.");
      if (source === target) return;
      items.splice(items.indexOf(source), 1);
      items.splice(items.indexOf(target) + (input.after ? 1 : 0), 0, source);
      return;
    }
    if (kind === "layout-save") {
      const { dimension } = this.dimension(input.dimension);
      this.library.saveLayout(name, dimension.id, dimension.root);
      return;
    }
    if (kind === "layout-load") {
      const { realm, dimension } = this.dimension(input.dimension);
      const root = this.library.loadLayout(input.file, dimension.id);
      const restored = leaves(root);
      for (const portal of restored) {
        let existing;
        try {
          existing = this.portal(portal.id);
        } catch (error) {
          if (!/no longer exists/.test(error.message)) throw error;
        }
        if (existing && existing.dimension.id !== dimension.id)
          throw Error("A saved portal now belongs to another dimension.");
      }
      this.state.hidden ||= {};
      for (const portal of leaves(dimension.root))
        if (!restored.some((item) => item.id === portal.id))
          this.state.hidden[portal.id] = {
            realm: realm.id,
            dimension: dimension.id,
            portal,
          };
      for (const portal of restored) delete this.state.hidden[portal.id];
      dimension.root = root;
      return;
    }
    if (kind === "show") {
      const existing = this.places()
        .flatMap(({ dimension }) => leaves(dimension.root))
        .concat(
          Object.values(this.state.hidden || {}).map((item) => item.portal),
        )
        .find((item) => item.terminal === input.terminal);
      if (existing) return this.mutate("show-portal", { id: existing.id });
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
      this.state.view = "dimension";
      return;
    }
    if (kind === "ratio") {
      const { dimension } = this.dimension(input.dimension);
      function resize(node) {
        if (!node) return;
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
      if (target) target.name = name.trim();
      else this.portal(id).portal.title = name.trim();
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
