# Voyager Shell

An experiment in connecting the coding agents you already use to a local Rust service: orchestration, persistent work, and an evidence-based memory of what happened.

Keep your terminal. Keep your agent's interface. Voyager should help those agents work together and carry context between sessions.

We are building in small increments: try a real workflow, use it ourselves, document what failed, and change the next increment from that experience. This repository is public so others can learn with us and help shape it.

## What works today

- The Rust service registers a supported existing Codex app-server thread and
  records future conversation and lifecycle events in private SQLite storage.
- It launches one local Codex worker with a service-owned app server. The native
  terminal client can disconnect and reconnect while that worker keeps running.
- The Electron prototype shows a glass astronaut and a small panel of project
  names and connection dots. Click to toggle the panel, drag its background to
  move it, or pull the astronaut away and return it with paired sound cues.
- The desktop recognises dedicated Ghostty XWayland windows of an already
  registered worker by process and session identity. It can join that worker;
  dropping onto an arbitrary terminal does not yet register an agent.

Start with [running the service](docs/service.md), then [the worker
experiment](docs/workers.md) and [the desktop guide](docs/desktop.md).

This is a Linux prototype under active development. Native Wayland, arbitrary
running-CLI adoption, macOS behavior, knowledge extraction and team sharing
remain unproved or unimplemented. Persistence currently means surviving client
disconnect, not a daemon crash or reboot. The desktop's tested adapter requires
a dedicated Ghostty XWayland process; tabs and switching agent threads are not
supported.

## The boundary we are keeping

The background service and the interface are separate. The service connects agents, owns the work it launches, and records attributed events. An experimental Electron client provides the Voyager avatar, docking and a small status panel.

Connecting an existing agent is different from taking ownership of its process.
The existing lead remains externally owned. Closing Electron or undocking its
avatar only detaches the interface: it does not unregister a session or stop
work. The native agent remains the conversational interface.

This is not a new terminal UI or a tmux integration. We are learning from the process ownership in Herdr and tmux, and from Pi's structured events. We are writing our own small service, without copying those applications.

## Try the checks

On Linux with Rust, a C linker and Python 3 installed:

```sh
git clone https://github.com/isaacasamoah/voyagershellapp.git
cd voyagershellapp
cargo test --locked
```

The tests create disposable local processes, sockets and synthetic records, then clean them up. They make no model calls, need no credentials or root privileges, and do not attach to existing sessions. Cargo downloads the locked dependencies on the first build. macOS support is still to be proved.

For the desktop, install Node 24, then:

```sh
cd desktop
npm ci
npm run format:check
npm test
```

These desktop checks do not open windows or call a model. The separate
[live desktop proof](docs/desktop.md#limits-and-proof) uses a running service and
an existing supported worker terminal. It deliberately opens windows; do not
confuse its programmatic checks with a human testing the gestures.

## Find your way around

| Directory         | Responsibility                                                   |
| ----------------- | ---------------------------------------------------------------- |
| `src/`            | Rust service, capture, persistence, worker ownership and CLI     |
| `src/bin/`        | Service CLI entry point and read-only X11 window inventory       |
| `tests/`          | Disposable service tests and independent Python process fixtures |
| `desktop/src/`    | Electron main process, window binding and narrow preload API     |
| `desktop/src/ui/` | Local HTML, CSS and browser-side interface code                  |
| `desktop/test/`   | Binding tests and the explicit live desktop proof                |
| `docs/`           | Run guides, experiments, evidence and limitations                |

The [desktop developer guide](desktop/README.md) explains the small process
boundary and how to change the UI. Earlier [mechanism experiments](docs/experiments.md)
remain reproducible learning fixtures, separate from the application. Python is
used for those fixtures, not the Rust service runtime.

## Next experiment

Connect the actual avatar drop to registering or joining a supported native
session through the Rust service. First prove one exact window-to-session match,
then capture a conversation, detach the interface, and rejoin the same session.
Refuse an unrelated or ambiguous terminal. Registration must not pretend to take
ownership of an externally launched agent. Event-to-knowledge extraction follows
as a separate increment.

Read [what we are learning](docs/research.md) and [how to contribute](CONTRIBUTING.md). Small experiments and evidence are welcome, especially reports of what a native harness actually exposes.
