# Voyager Shell

Voyager connects native coding agents and terminals to a local Rust service.
Electron provides a floating astronaut and a small control panel. Your agent keeps
its own interface; Voyager manages the work it starts and records what happens.

We build small, real experiments, try them ourselves, and share the results here.

## Vision

Let’s go together. We’re building voyagershell to make room for agent-to-agent,
agent-to-human and human-to-human collaboration alongside a strong solo dev flow.

The direction is shared, dynamic knowledge graphs that connect what a team learns,
decides and builds, with native messaging to keep people and agents in conversation.
As that knowledge evolves, collaborators should be able to find relevant context,
follow its evidence and stay aware of changes that affect their work.

This is the vision we’re exploring through small experiments. The prototype below
is our starting point, and we’d love to build toward it with other developers.

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
- Agent messages wait for idle by default. Explicit `send ... --steer` appends
  an update to an active native turn without cancelling it.
- This experiment branch includes an opt-in [collaboration trial](docs/collaboration-trial.md):
  real Jev/Sol extraction, evidence-linked knowledge, subscriptions and a live inspector.
- A separate [structural topics experiment](docs/structural-topics.md) scans Rust
  and Electron modules and replays source events through Jev for independent
  topic membership. It does not change the live collaboration pipeline.

The tested platform is Fedora with dedicated Ghostty XWayland windows. Ordinary
`codex` launches, tabs, other terminals, macOS and native Wayland are not supported
by the current matcher. Registration does not transfer ownership of an external
process. Persistence covers client disconnection, not daemon crashes or reboots.

Enforced captain/crew permissions, urgency-based delivery policy, automatic native
voice and shared multi-user graphs remain future work. Voyager is an experimental prototype.

## Try it

See [native instances](docs/instances.md) for setup, then use the panel's **+**.
The [desktop guide](docs/desktop.md) describes docking and gestures.
The [lifecycle contract](docs/lifecycle.md) defines each action and its result.
The [CLI reference](docs/service.md#commands) exposes the same operations to scripts
and agents; the [worker skill](skills/voyager-worker/SKILL.md) teaches that workflow.

## Checks

This experiment branch also contains a browser-based
[collaboration visual proposal](docs/collaboration-experiment.md). It illustrates
the extraction flow and a proposed five-worker comparison using example data.
The separate [live trial](docs/collaboration-trial.md) runs the real service pipeline;
the five-worker comparison has not been performed.

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
