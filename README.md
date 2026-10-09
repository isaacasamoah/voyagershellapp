# Voyager Shell

An experiment in connecting the coding agents you already use to a local Rust service: orchestration, persistent work, and an evidence-based memory of what happened.

Keep your terminal. Keep your agent's interface. Voyager should help those agents work together and carry context between sessions.

We are building in small increments: try a real workflow, use it ourselves, document what failed, and change the next increment from that experience. This repository is public so others can learn with us and help shape it.

## Starting boundary

The background service and the interface are separate. The service connects agents, owns the work it launches, and records attributed events. An experimental Electron client provides the Voyager avatar, docking and a small status panel.

Connecting an existing agent is different from taking ownership of its process. Hooks can provide events and tools without replacing the agent's interface. Live persistence requires the original process to keep running; restarting from saved conversation is recovery. Our first experiment tests cooperative transfer from an existing terminal owner. It does not establish that an ordinary terminal currently exposes that integration.

This is not a new terminal UI or a tmux integration. We are learning from the process ownership in Herdr and tmux, and from Pi's structured events. We are writing our own small service, without copying those applications.

## First experiments

1. Test a terminal handing an already-running process's PTY connection to a Rust receiver, including a shutdown-policy counterexample.
2. Collect synthetic structured events alongside that process and prove a collector failure leaves it running.
3. Take the measured boundary to one real terminal/harness integration. Then prove interactive detach/reconnect and correctly attributed tasks through that adapter.
4. Add the existing avatar/docking design as a client of the same service.
5. Use the event evidence to build and retrieve personal knowledge; add explicit team sharing later.

Persistence initially means surviving client disconnect. It does not mean preserving processes across a daemon crash, reboot or machine migration.

## Status

A minimal Rust service now registers an existing Codex app-server thread, launches one local Codex worker, and records future conversation/lifecycle events in a private SQLite database. The worker has a service-owned app server; its native terminal interface can disconnect and reconnect independently. The existing lead session remains externally owned.

Read [running the service](docs/service.md) and [the worker experiment](docs/workers.md) for commands and measured limits. A CLI watcher offers JSONL or readable You/Agent output. Registering an existing lead requires its app server's local Unix socket; arbitrary standalone CLI adoption remains unsupported.

The [desktop experiment](docs/desktop.md) adds the astronaut, a compact glass
panel and plain agent connection status. It recognises already-open dedicated
Ghostty XWayland windows for a registered worker by native process/session identity. It does not yet
attach arbitrary existing terminals, support native Wayland docking, or build a
knowledge graph.

The earlier [mechanism experiments](docs/experiments.md) remain reproducible: cooperative PTY handoff and independent synthetic capture. They do not establish arbitrary live-terminal adoption.

## Try the experiments

On Linux with Rust, a C linker and Python 3 installed:

```sh
git clone https://github.com/isaacasamoah/voyagershellapp.git
cd voyagershellapp
cargo test --locked
```

The tests create disposable local processes, sockets and synthetic records, then clean them up. They make no model calls, need no credentials or root privileges, and do not attach to existing sessions. Cargo downloads the locked dependencies on the first build. macOS support is still to be proved.

The service is written in Rust. Python is only the independent process fixture used to test it. Read the [experiment walkthrough and limits](docs/experiments.md) before running the low-level probe commands manually.

Read [what we are learning](docs/research.md) and [how to contribute](CONTRIBUTING.md). Small experiments and evidence are welcome, especially reports of what a native harness actually exposes.
