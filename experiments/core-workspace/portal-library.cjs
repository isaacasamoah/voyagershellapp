const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const validId = (id) =>
  typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);
const hash = (text) => createHash("sha256").update(text).digest("hex");

function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function treeValid(root) {
  const ids = new Set();
  const pending = root ? [root] : [];
  while (pending.length) {
    const node = pending.pop();
    if (!node || !validId(node.id) || ids.has(node.id))
      throw Error("Layout needs unique portal and split IDs.");
    ids.add(node.id);
    if (node.children) {
      if (
        node.children.length !== 2 ||
        !["horizontal", "vertical"].includes(node.axis) ||
        !Number.isFinite(node.ratio) ||
        node.ratio <= 0 ||
        node.ratio >= 1
      )
        throw Error("Invalid layout split.");
      pending.push(...node.children);
    } else if (!validId(node.type || "terminal"))
      throw Error("Invalid portal type.");
  }
  return root;
}

class PortalLibrary {
  constructor(root, defaults, core, notify) {
    this.root = root;
    this.core = core;
    this.notify = notify;
    this.packages = new Map();
    this.errors = {};
    this.revisions = new Map();
    this.lastData = new Map();
    for (const name of ["packages", "data", "layouts", ".uninstalled"])
      fs.mkdirSync(path.join(root, name), { recursive: true });
    if (!fs.existsSync(path.join(root, ".initialized"))) {
      for (const entry of fs.readdirSync(defaults)) {
        const destination = path.join(root, "packages", entry);
        if (!fs.existsSync(destination))
          fs.cpSync(path.join(defaults, entry), destination, {
            recursive: true,
            errorOnExist: true,
          });
      }
      atomic(path.join(root, ".initialized"), "1\n");
    }
    this.scan();
    this.changed = new Set();
    this.watcher = fs.watch(root, { recursive: true }, (_, file) => {
      if (!file || file.endsWith(".tmp")) return;
      this.changed.add(file);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const files = [...this.changed];
        this.changed.clear();
        const edited = new Set(
          files
            .filter((item) => item.startsWith(`packages${path.sep}`))
            .map((item) => item.split(path.sep)[1]),
        );
        for (const id of edited)
          this.revisions.set(id, (this.revisions.get(id) || 0) + 1);
        this.scan();
        this.notify({ files, types: this.catalog(), errors: this.errors });
      }, 100);
    });
  }

  scan() {
    const found = new Set();
    for (const entry of fs.readdirSync(path.join(this.root, "packages"), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      const id = entry.name;
      found.add(id);
      const previous = this.packages.get(id);
      try {
        const file = path.join(this.root, "packages", id, "portal.json");
        const text = fs.readFileSync(file, "utf8");
        if (Buffer.byteLength(text) > 1024 * 1024)
          throw Error("Manifest exceeds 1 MiB.");
        const definition = JSON.parse(text);
        if (
          definition.id !== id ||
          typeof definition.name !== "string" ||
          !definition.name.trim() ||
          !["terminal", "web"].includes(definition.renderer)
        )
          throw Error("Manifest needs matching id, name and renderer.");
        if (
          definition.argv &&
          (!Array.isArray(definition.argv) ||
            !definition.argv.length ||
            !definition.argv.every((arg) => typeof arg === "string"))
        )
          throw Error("argv must be a nonempty list of strings.");
        if (definition.renderer === "terminal" && !definition.argv)
          throw Error("Terminal types need argv.");
        this.packages.set(id, definition);
        if (definition.renderer === "web")
          this.file(id, definition.entry || "view.html");
        delete this.errors[id];
      } catch (error) {
        if (previous) this.packages.set(id, previous);
        else this.packages.delete(id);
        this.errors[id] = error.message;
      }
    }
    for (const id of this.packages.keys())
      if (!found.has(id)) this.packages.delete(id);
  }

  catalog() {
    return [...this.packages.values()]
      .map((item) => ({
        ...item,
        revision: this.revisions.get(item.id) || 0,
        error: this.errors[item.id],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  definition(id) {
    const item = this.packages.get(id);
    if (!item) throw Error(`Portal type ${id} is not installed.`);
    return item;
  }

  file(id, relative) {
    if (
      !validId(id) ||
      typeof relative !== "string" ||
      !relative ||
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).includes("..")
    )
      throw Error("Use a file inside this portal package.");
    const folder = fs.realpathSync(path.join(this.root, "packages", id));
    const file = fs.realpathSync(path.join(folder, relative));
    if (!file.startsWith(folder + path.sep))
      throw Error("Package file escapes its folder.");
    return file;
  }

  dataFile(id) {
    if (!validId(id)) throw Error("Invalid portal ID.");
    return path.join(this.root, "data", `${id}.json`);
  }

  seed(id, type) {
    const file = this.dataFile(id);
    if (!fs.existsSync(file))
      atomic(
        file,
        JSON.stringify(this.definition(type).seed || {}, null, 2) + "\n",
      );
  }

  read(id) {
    const text = fs.readFileSync(this.dataFile(id), "utf8");
    if (Buffer.byteLength(text) > 1024 * 1024)
      throw Error("Portal data exceeds 1 MiB.");
    try {
      const snapshot = { data: JSON.parse(text), version: hash(text) };
      this.lastData.set(id, snapshot);
      return snapshot;
    } catch (error) {
      const previous = this.lastData.get(id);
      if (!previous) throw error;
      return {
        ...previous,
        error: `Data edit is invalid. Showing the last valid state: ${error.message}`,
      };
    }
  }

  write(id, data, expected) {
    const file = this.dataFile(id);
    if (hash(fs.readFileSync(file, "utf8")) !== expected)
      throw Error("Portal data changed. Read it again before saving.");
    const text = JSON.stringify(data, null, 2) + "\n";
    if (Buffer.byteLength(text) > 1024 * 1024)
      throw Error("Portal data exceeds 1 MiB.");
    atomic(file, text);
    return this.read(id);
  }

  async create(type, cwd) {
    const definition = this.definition(type);
    const id = randomUUID();
    this.seed(id, type);
    const portal = { id, type, title: definition.name };
    return this.startProcess(portal, cwd);
  }

  async startProcess(portal, cwd) {
    const { id, type } = portal;
    const definition = this.definition(type);
    portal = { ...portal };
    if (definition.argv) {
      const folder = path.join(this.root, "packages", type);
      const argv = definition.argv.map((arg) =>
        arg
          .replaceAll("{data}", this.dataFile(id))
          .replaceAll("{package}", folder),
      );
      const terminal = await this.core.rpc("terminal.run", {
        argv,
        cwd: definition.renderer === "terminal" ? cwd : folder,
        no_parent: true,
        keep: false,
        labels: { workspace: "voyager", portal: id, type },
        env: {
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          VOYAGER_PORTAL_DATA: this.dataFile(id),
          VOYAGER_PROJECT_DIR: cwd,
        },
      });
      portal.terminal = terminal.address;
    }
    return portal;
  }

  source(type, name, text, expected) {
    const file = this.file(type, name);
    const current = fs.readFileSync(file, "utf8");
    if (text === undefined)
      return { name, text: current, version: hash(current) };
    if (hash(current) !== expected)
      throw Error("Portal source changed. Read it again before saving.");
    if (Buffer.byteLength(text) > 1024 * 1024)
      throw Error("Source exceeds 1 MiB.");
    atomic(file, text);
    return { name, version: hash(text) };
  }

  uninstall(type, restore = false) {
    if (!validId(type)) throw Error("Invalid portal type.");
    const installed = path.join(this.root, "packages", type);
    const removed = path.join(this.root, ".uninstalled", type);
    const from = restore ? removed : installed;
    const to = restore ? installed : removed;
    if (fs.existsSync(to))
      throw Error("That package destination already exists.");
    fs.renameSync(from, to);
    this.scan();
    this.notify({
      files: [`packages/${type}`],
      types: this.catalog(),
      errors: this.errors,
    });
    return { type, installed: restore, preservedData: true };
  }

  layouts() {
    return fs
      .readdirSync(path.join(this.root, "layouts"))
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        try {
          const value = JSON.parse(
            fs.readFileSync(path.join(this.root, "layouts", name), "utf8"),
          );
          treeValid(value.root);
          return [{ name: value.name, owner: value.owner, file: name }];
        } catch (error) {
          return [{ file: name, error: error.message }];
        }
      });
  }

  saveLayout(name, owner, root) {
    const file = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!validId(file))
      throw Error("Give the layout a name using letters or numbers.");
    treeValid(root);
    const filename = `${owner}-${file}.json`;
    atomic(
      path.join(this.root, "layouts", filename),
      JSON.stringify({ name, owner, root }, null, 2) + "\n",
    );
    return filename;
  }

  loadLayout(file, owner) {
    if (!/^[a-z0-9-]+\.json$/.test(file)) throw Error("Invalid layout file.");
    const value = JSON.parse(
      fs.readFileSync(path.join(this.root, "layouts", file), "utf8"),
    );
    if (value.owner !== owner)
      throw Error("This layout belongs to another dimension.");
    return treeValid(value.root);
  }

  close() {
    clearTimeout(this.timer);
    this.watcher.close();
  }
}

module.exports = { PortalLibrary, treeValid };
