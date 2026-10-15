# Voyager Shell

Voyager connects native coding agents and terminals to a local Rust service.
Electron provides a floating astronaut and a small control panel. Your agent keeps
its own interface; Voyager manages the work it starts and records what happens.

We build small, real experiments, try them ourselves, and share the results here.

## Current prototype

- **+** creates a named Codex instance or persistent Bash terminal in Ghostty.
  Creation registers it and starts capture. Native windows open by default.
- **↗** focuses an existing window or reopens the same running instance.
- **⋯** offers background, stop, remove, and stop-and-remove. Removal ends future
  capture and instruction routing; historical events remain.
- Docking selects the human control attachment. Undocking or closing Electron
  leaves agents and capture running. The terminal marker fades until hovered.
- Codex sessions launched by Voyager use YOLO. External sessions keep their
  existing permissions. Bash commands share the human's shell state.
- Agent messages can start a turn only while the target is idle. Active-turn
  steering is not implemented.

The tested platform is Fedora with dedicated Ghostty XWayland windows. Ordinary
`codex` launches, tabs, other terminals, macOS and native Wayland are not supported
by the current matcher. Registration does not transfer ownership of an external
process. Persistence covers client disconnection, not daemon crashes or reboots.

Captain/crew authority, supervisor priority, automatic native voice, knowledge
extraction and shared graphs are later work. Voyager is an experimental prototype.

The [desktop whiteboard experiment](docs/whiteboard.md) adds collapsible drawing
controls to the glass panel, with direct text editing, group selection and a
native Snip action that adds desktop images on Fedora GNOME. This branch also
adds an opt-in `whiteboard-read` CLI and skill: an image-capable agent can inspect
a fresh picture of the board and discuss it in the conversation. Agent editing,
MCP tools and board persistence are still planned.


## Try it

See [native instances](docs/instances.md) for setup, then use the panel's **+**.
The [desktop guide](docs/desktop.md) describes docking and gestures.
The [lifecycle contract](docs/lifecycle.md) defines each action and its result.
The [CLI reference](docs/service.md#commands) exposes the same operations to scripts
and agents; the [worker skill](skills/voyager-worker/SKILL.md) teaches that workflow.

## Checks

On Linux, install Rust, a C linker and Python 3.11+. Then:

```sh
git clone https://github.com/isaacasamoah/voyagershellapp.git
cd voyagershellapp
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

For Electron, use Node 24:

```sh
cd desktop
npm ci
npm run format:check
npm test
```

Normal checks use disposable fixtures and real PTYs, without a desktop or model
account. [Native checks](docs/lifecycle.md#native-checks) open real windows;
the separate Codex test uses the installed account. Programmatic checks do not
replace a person trying gestures and sound.

## Source map

| Location | Responsibility |
| --- | --- |
| `src/` | Rust service, runtime ownership, capture and storage |
| `src/bin/` | CLI and X11 window helper |
| `desktop/src/` | Electron main, window binding, preload and local UI |
| `tests/`, `desktop/test/` | Contract tests and opt-in native checks |
| `docs/` | Contracts, run guides and evidence |
| `skills/` | Agent instructions for the CLI |

The [desktop source map](desktop/README.md) explains its process boundaries.
Python supports experiments; the service runtime is Rust. We learn from Herdr,
tmux and Pi without using them as Voyager's backend or copying their code.

Read [the research](docs/research.md) and [contribution guide](CONTRIBUTING.md).
Reports of real workflows, failures and integration limits are welcome.
