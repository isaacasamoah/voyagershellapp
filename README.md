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

## Specification review

The [tracer-bullet usability specifications](SPEC.md) cover conversation
resume, current-work presentation, voice handoffs and docking recovery. The specifications are
approved. Docking recovery is accepted and merged, including returning the floating
controls to their pre-dock position. The active [implementation plan](tasks/plan.md) covers current startup settings and
a compact Resume flow after the reviewed saved-conversation and panel modules. This branch groups running,
uncertain and stopped records, reveals bounded saved history and offers an explicit
Resume-and-open journey. Owner acceptance, merge and installation remain separate.
The task list records each independent review and the input limits of native proof.

## Current build

Owner `list` responses distinguish a live owned runtime, a confirmed stop and
unknown process ownership. Managed starts retain a runtime generation and observed
nonsecret settings for later recovery. A service restart preserves a confirmed
stop and never restores ownership from a saved process number. The owner service
API can explicitly resume an eligible saved Codex conversation without submitting
work. The owner CLI exposes `resume-instance` with the observed generation and a
request ID. It keeps the same identity and leaves its terminal closed for a separate
Open. The previous viewer must be closed first. The panel uses those same service decisions. Vessels keeps running agents
visible with closed viewers; Previous vessels reveals stopped conversations and
saved events. Panel Resume checks current runtime identity before a separate Open. A worker names
its hidden supervisor, and keyboard focus follows meaningful controls through
state changes.
New launch and Resume use current Codex model and effort settings. Launch and Resume
select YOLO; permission-default controls remain deferred. Changed configuration or missing historic settings alone does not
block Resume. Confirmed stop, saved identity and an available directory remain
required. The compact Resume presentation is the next planned increment.

- **+** creates a named Codex instance or persistent Bash terminal in Ghostty or xterm.
  Creation registers it and starts capture. Choose a Fleet when one exists. Native
  windows open by default.
- Click a Vessel card to surface its terminal on half a display and minimise
  the others. Rank rows start collapsed; separate Fleets collect related vessels
  through drag/drop or a request to Voyager/the docked agent. Membership is visual
  organization and grants no authority. The panel and canvases size to their visible content.
  See [Vessels and fleets](docs/fleets.md).
- **⋯** offers rename, background, stop, remove, and stop-and-remove. Removal ends future
  capture and instruction routing; historical events remain.
- Docking requires a verified running, connected managed agent. Hover and drop
  check the same eligibility rules; external or changed targets refuse with a
  visible explanation and no implicit registration. Undocking or closing Electron
  leaves agents and capture running. The terminal marker fades until hovered.
- Codex sessions launched by Voyager use YOLO. External sessions keep their
  existing permissions. Bash commands share the human's shell state.
- Agent creation selects Admiral, Commodore, Captain or Crew, defaulting to Crew.
  Assigned supervisors delegate and adjudicate downward; agents escalate upward.
  Docking temporarily grants human command authority.
- Agent messages start an idle turn or steer the observed active turn. The service
  checks the bound caller; it never silently replays a failed or uncertain send.
- An owner can grant a named agent permission to run a specific development checkout
  in a fresh service/profile, inspect its result and request cleanup. Manual testing
  and the existing automated polish journey are separate modes. This experimental
  [development facility](docs/development-tests.md) does not grant control of the
  installed app and still requires a live graphical acceptance trial.

The packaged candidate has Fedora GNOME/XWayland evidence with dedicated Ghostty
and xterm windows. Native trials cover placement, target-loss recovery, voice
routing and recorded docking output. The task list preserves fixture setup and
voice teardown limits; owner acceptance remains open. Ordinary
`codex` launches, tabs, other terminals, macOS and native Wayland are not supported
by the current matcher. Registration does not transfer ownership of an external
process. Persistence covers client disconnection, not daemon crashes or reboots.
Rebuilding the executable at the same path preserves viewer and instance CLI paths.
Bash open receipts also wait for the viewer connection, not just a mapped terminal window.

Explicit supervisor preemption, knowledge extraction and shared graphs are later
work. Voyager is an experimental tracer-bullet build.

## Talk to Voyager

Voyager starts a private Codex runtime with the service. Type in the subtle chat
bar at the panel bottom, or press the avatar's soundwave to use voice. Named
service tools manage Vessels and Fleets. Escalations and replies use the same chat,
with the original request available behind disclosure.
The private assistant can search/read local work files and transcripts, inspect
captured Codex events and retained Bash output, and delegate changes to Vessels.
Local inspection is bounded and read-only; named orchestration controls remain available.
The conversation stays separate from terminal sessions and Vessel capture.
Docking selects native Codex voice by default; undocking stops it. The floating
soundwave uses the private app conversation. [Voice setup and limits](docs/voice.md).
Closing Electron stops voice while the runtime and work continue.
[Conversation setup and current limits](docs/harness-runtime.md).

## Try it

For a Linux bundle, see [install the Fedora prototype](docs/install-linux.md).
See [native instances](docs/instances.md) for setup, then use the panel's **+**.
Opening the app starts or reconnects to the service. Closing the panel leaves work
running. After stopping managed Vessels, use the small panel menu's **Stop service**
to shut Voyager down explicitly. Starting at login is not enabled.
The [desktop guide](docs/desktop.md) describes docking and gestures.
The [lifecycle contract](docs/lifecycle.md) defines each action and its result.
The [authority guide](docs/authority.md) explains ranks, assignment and agent tools.
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
