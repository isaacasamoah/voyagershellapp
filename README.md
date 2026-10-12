# Voyager Shell

An experiment in connecting the coding agents you already use to a local Rust service: orchestration, persistent work, and an evidence-based memory of what happened.

Keep your terminal. Keep your agent's interface. Voyager should help those agents work together and carry context between sessions.

We are building in small increments: try a real workflow, use it ourselves, document what failed, and change the next increment from that experience. This repository is public so others can learn with us and help shape it.

## What works today

- The Rust service registers a supported existing Codex app-server thread and
  records future conversation and lifecycle events in private SQLite storage.
- The panel's **+** creates a named Codex instance or a persistent Bash terminal
  and opens it in Ghostty. The Rust service starts independently when the app
  opens, registers the instance and begins capture before native interaction.
- Several instances can run together. Codex owns its native interface; a bare
  shell is a real interactive Bash behind a service-owned PTY. Human and agent
  commands use that same shell, including its current folder and variables.
  The native terminal can close and reopen while work continues.
- Voyager-launched Codex sessions default to YOLO: no command sandbox or approval
  prompts. Existing external sessions retain their own permissions. See the
  [instance guide](docs/instances.md) for measured behavior and limitations.
- The Electron prototype shows a glass astronaut and a small panel of project
  names and connection dots. Click to toggle the panel, drag its background to
  move it, or pull the astronaut away and return it with paired sound cues.
- Dropping the astronaut onto a supported Ghostty XWayland Codex client now
  registers its fixed native conversation, or rejoins its existing registration.
  Discovery alone does not start recording. The terminal marker is a faded overlay; hover to brighten and grab it.
  It no longer depends on terminal transparency. The panel becomes opaque on
  hover for readability. The opaque Ghostty hover-and-pull interaction has been tried on the
  current Fedora desktop; other terminals and desktops remain unproved.
- The service records one current control attachment and dock/undock events.
  A stale release cannot clear a newer attachment. Losing Electron releases
  control while capture and agents continue. The [control guide](docs/control.md)
  explains the behavior, command preconditions and voice setting's limits.

Start with [creating a native instance](docs/instances.md) or
[registering an existing session](docs/service.md), then [the worker
experiment](docs/workers.md) and [the desktop guide](docs/desktop.md).
The reusable [worker skill](skills/voyager-worker/SKILL.md) gives an agent the
existing CLI workflow; [installation and its current proof](docs/workers.md#worker-skill)
are documented separately from successful worker execution.

This is a Linux prototype under active development. Native Wayland, arbitrary
running-CLI adoption, macOS behavior, knowledge extraction and team sharing
remain unproved or unimplemented. Persistence currently means surviving client
disconnect, not a daemon crash or reboot. The desktop's tested adapter requires
a dedicated Ghostty XWayland process; tabs and switching agent threads are not
supported.

**The ordinary-terminal docking brief is not complete.** The demonstrated
binding requires a prepared Ghostty launch containing an explicit Codex server
address and conversation ID. Opening a terminal normally and typing `codex`
does not satisfy that matcher. Real registration and capture behind that setup
prove a mechanism, not the requested everyday docking workflow.

## The boundary we are keeping

The background service and the interface are separate. The service connects agents, owns the work it launches, and records attributed events. An experimental Electron client provides the Voyager avatar, docking and a small status panel.

Connecting an existing agent is different from taking ownership of its process.
The existing lead remains externally owned. Closing Electron or undocking its
avatar only detaches the interface: it does not unregister a session or stop
work. The native agent remains the conversational interface.

This is not a new terminal UI or a tmux integration. We are learning from the process ownership in Herdr and tmux, and from Pi's structured events. We are writing our own small service, without copying those applications.

## Try the checks

On Linux with Rust, a C linker and Python 3.11+ installed:

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
[live desktop proof](docs/desktop.md#checks-and-evidence) uses a running service and
an existing supported terminal. The registration proof makes a small, explicit
model request; the UI regression proof does not. Both open windows; do not
confuse its programmatic checks with a human testing the gestures.

## Find your way around

| Directory         | Responsibility                                                   |
| ----------------- | ---------------------------------------------------------------- |
| `src/`            | Rust service, capture, persistence, worker ownership, native window opening and CLI     |
| `src/bin/`        | Service CLI entry point and X11 inventory and placement of the calling avatar       |
| `tests/`          | Disposable service tests and independent Python process fixtures |
| `desktop/src/`    | Electron main process, window binding and narrow preload API     |
| `desktop/src/ui/` | Local HTML, CSS and browser-side interface code                  |
| `desktop/test/`   | Binding tests and the explicit live desktop proof                |
| `docs/`           | Run guides, experiments, evidence and limitations                |
| `skills/`         | Agent instructions for using the real service CLI               |

The [desktop developer guide](desktop/README.md) explains the small process
boundary and how to change the UI. Earlier [mechanism experiments](docs/experiments.md)
remain reproducible learning fixtures, separate from the application. Python is
used for those fixtures, not the Rust service runtime.

## Next experiment

Use the panel to create a Codex instance and a Bash terminal. Dock to choose the
command surface, ask Codex to use that shell, undock, then reopen the same shell.
The [instance guide](docs/instances.md) separates automated checks, native
observations and the remaining human gesture check.

Opening a terminal independently and typing `codex` remains a separate discovery
problem; [the investigation](docs/terminal-discovery.md) records that boundary.
Claude, other terminal launchers, roles, grouping, native voice handoff and
knowledge extraction remain later increments. The shared backend operations
leave room for those additions without making the current prototype depend on them.

Read [what we are learning](docs/research.md) and [how to contribute](CONTRIBUTING.md). Small experiments and evidence are welcome, especially reports of what a native harness actually exposes.
