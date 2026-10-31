const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

class Core extends EventEmitter {
  constructor(session) {
    super();
    if (!/^voyager-[a-z0-9-]+$/.test(session))
      throw Error("Use a dedicated Voyager session.");
    this.session = session;
    this.sequence = 0;
    this.pending = new Map();
    this.channels = new Map();
    this.early = new Map();
    this.buffer = Buffer.alloc(0);
    this.framed = false;
  }

  async open() {
    const env = { ...process.env, HC_SESSION: this.session };
    delete env.HC_TERMINAL_ID;
    this.child = spawn(
      process.env.VOYAGER_HC || "hc",
      ["connect", "--session", this.session],
      {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", () =>
      this.fail(Error("Core connection closed. No command was retried.")),
    );
    this.child.stderr.on("data", (data) =>
      this.emit("diagnostic", data.toString().slice(0, 2048)),
    );
    this.child.stdout.on("data", (data) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      try {
        this.consume();
      } catch (error) {
        this.fail(error);
        this.child.kill();
      }
    });
    this.info = await this.rpc("hello", { framed: true, generation: 1 });
    return this.info;
  }

  consume() {
    if (!this.framed) {
      const end = this.buffer.indexOf(10);
      if (end < 0) {
        if (this.buffer.length > 1024 * 1024)
          throw Error("Core handshake too large.");
        return;
      }
      const message = JSON.parse(this.buffer.subarray(0, end).toString());
      this.buffer = this.buffer.subarray(end + 1);
      this.framed = Boolean(message.result?.framed);
      this.message(message);
      if (!this.framed) throw Error("Core did not accept framed protocol.");
    }
    while (this.buffer.length >= 9) {
      const channel = this.buffer.readUInt32LE(0);
      const kind = this.buffer[4];
      const length = this.buffer.readUInt32LE(5);
      if (length > 16 * 1024 * 1024) throw Error("Core frame too large.");
      if (this.buffer.length < 9 + length) break;
      const data = this.buffer.subarray(9, 9 + length);
      this.buffer = this.buffer.subarray(9 + length);
      if (channel === 0 && kind === 0)
        this.message(JSON.parse(data.toString()));
      else if (this.channels.has(channel))
        this.channels.get(channel)(kind, data);
      else if (this.early.has(channel) && (kind === 0 || kind === 2)) {
        const queued = this.early.get(channel);
        if (queued.length >= 512)
          throw Error("Unclaimed terminal stream overflow.");
        queued.push([kind, data]);
        this.early.set(channel, queued);
      }
    }
  }

  message(message) {
    if (message.id === undefined) return this.emit("event", message);
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(Error(message.error.message));
    else {
      if (pending.method === "terminal.attach")
        this.early.set(message.result.channel, []);
      pending.resolve(message.result);
    }
  }

  rpc(method, params = {}) {
    if (!this.child || this.child.exitCode !== null || this.child.killed)
      return Promise.reject(Error("Core is disconnected."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`${method}: outcome unconfirmed. It was not retried.`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer, method });
      const payload = Buffer.from(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      );
      if (this.framed) this.frame(0, 0, payload);
      else this.child.stdin.write(Buffer.concat([payload, Buffer.from("\n")]));
    });
  }

  frame(channel, kind, data = Buffer.alloc(0)) {
    if (this.child.stdin.destroyed) return;
    const header = Buffer.alloc(9);
    header.writeUInt32LE(channel, 0);
    header[4] = kind;
    header.writeUInt32LE(data.length, 5);
    this.child.stdin.write(Buffer.concat([header, data]));
  }

  async attach(terminal, cols, rows, receive) {
    const result = await this.rpc("terminal.attach", {
      terminal,
      cols,
      rows,
      history: 1000,
      display: { bg: "#111316", fg: "#cdd0d6", cursor: "#c4b5fd", cell: null },
    });
    this.channels.set(result.channel, receive);
    for (const [kind, data] of this.early.get(result.channel) || [])
      receive(kind, data);
    this.early.delete(result.channel);
    return result;
  }

  credit(channel, length) {
    const data = Buffer.alloc(4);
    data.writeUInt32LE(length);
    this.frame(channel, 1, data);
  }

  detach(channel) {
    this.frame(channel, 2);
    this.channels.delete(channel);
    this.early.delete(channel);
  }

  fail(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.emit("disconnected", error.message);
  }

  close() {
    for (const channel of this.channels.keys()) this.detach(channel);
    this.child?.stdin.end();
    this.child?.kill();
  }
}

module.exports = { Core };
