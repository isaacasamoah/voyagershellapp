# Instance lifecycle

The Rust service owns lifecycle decisions. The panel and CLI call the same
operations. Registration, runtime, window and docking are separate state.
See the [CLI reference](service.md#commands) for command syntax.

## Actions

| Action | Runtime | Native window | Registration |
| --- | --- | --- | --- |
| Create / launch | Starts an owned instance | Opens by default; `--background` skips it | Starts capture |
| Rename | Unchanged | Unchanged | Same identity and capture; display name changes |
| Open | Keeps the same runtime | Focuses or reopens its viewer | Unchanged |
| Background | Keeps working | Closes the owned viewer | Capture continues |
| Stop | Stops the owned runtime | Closes its viewer; `--runtime-only` skips explicit close | Retained |
| Remove | Unchanged | Unchanged | Ends future capture and instruction routing |
| Stop and remove | Stops, then closes | Closure is confirmed before removal | Deregisters; history remains |
| Register again | Keeps existing work | Unchanged | Resumes future capture explicitly |

Creation validates an existing absolute folder, kind and short name. `create`
starts without a task; `launch` requires an active parent and submits one task.
An accepted task is not a completed task.

Active `list` excludes removed instances; `--include-removed` returns history.
Removed live owned instances remain in the panel's Unregistered section so their
owner can open or stop them. Stopped-and-removed instances disappear from the
panel. Removal neither deletes events nor stops children.

## Receipts and retries

Every action has an immutable request ID and input set. Results distinguish
`pending`, `completed`, `partial` and `uncertain`, with observed runtime, window,
registration and effects. The service returns promptly; the CLI polls
`operation REQUEST_ID`. Electron remains asynchronous.

Repeating identical inputs with the same ID returns the saved result. Changed
inputs fail. An uncertain action is not replayed automatically. Failed opening
can be repaired by a new `open` on the same instance, without launching another
runtime. Restart marks unfinished actions uncertain and never restores ownership.

## Window and process ownership

A live `Child` establishes process ownership; stored PIDs do not. External
registrations may be removed, but owned open/background/stop actions refuse them.
The daemon refuses shutdown while any owned runtime is live, including removed
instances.

Stop signals the exact owned runtime, observes exit, and may escalate within its
process group after two seconds. Bash receives HUP so it can forward it to jobs;
independently disowned or escaped processes are outside this contract.

Each viewer has its own child and the exact mapped X11 window ID. Mapping requires
one window belonging to the live child; ambiguous or unidentified windows fail.
For Bash, opening also waits for the shell viewer's connection; a terminal error
window alone does not confirm attachment. Absolute executable paths must exist
and be executable before the viewer starts. Codex window mapping does not prove a
completed agent turn.
Focus uses `_NET_ACTIVE_WINDOW` and confirms the request, not keyboard focus.
Close uses `_NET_CLOSE_WINDOW`; completion means that mapped window is gone.
Ghostty may remain resident afterward. A known closed viewer can be reopened
without restarting the runtime; an unidentified opening is not guessed away.

The service records its Voyager executable path at startup and uses that path
for Bash viewers and each instance's `VOYAGER_BIN`. Replacing the build artifact
at the same path does not change it to Linux's ` (deleted)` process label. The
replacement must remain a compatible CLI; removing it produces a failed open,
not a new runtime. A service restart is still required to load changed service code.

At startup the service also resolves Codex through `PATH`, or the explicit
`VOYAGER_CODEX_BIN` path, and retains the canonical executable path for both
launching and terminal identification. The panel receives that same path through
`attach-info`; it does not interpret a command name relative to its checkout.
Missing Codex leaves Bash and the service available; agent creation reports its
failure without registering an instance.

Voyager launches dedicated Ghostty XWayland clients with
`--confirm-close-surface=false`. Closing that viewer detaches from service-owned
work. Global settings and external terminals are untouched. See
[Ghostty's configuration](https://ghostty.org/docs/config/reference#confirm-close-surface).

## Native viewer selection

`viewer.rs` owns the small typed choice of Ghostty and xterm, their executable
identities and launch arguments. `terminal.rs` owns Linux/X11 window operations
and verified PTY input; `window_layout.rs` owns native placement. Runtime creation,
capture and explicit stop remain service lifecycle operations. This is a portable
boundary in the design, not a macOS, Windows or native Wayland implementation.

Ghostty remains the default. `create --terminal xterm` or `open ID xterm` selects
the alternate viewer. The panel has the same choice during creation and under
**Open viewer** for a background instance. Background the existing viewer before
changing its kind; a live viewer is never silently replaced. The service retains
the chosen viewer for that instance during its lifetime, including background
and reopen. The private assistant's open action uses that retained choice.
Restart does not restore process ownership or this in-memory preference.

Supported executable paths are `/usr/bin/ghostty` and `/usr/bin/xterm`; this slice
retains the existing Linux executable allowlist rather than accepting arbitrary
terminal commands. The service advertises those identities to desktop discovery.
xterm uses its per-window `resizeByPixel` resource so native layout can honor pixel
rectangles rather than rounding to character cells. See the
[xterm manual](https://invisible-island.net/xterm/manpage/xterm.html).

Open request identity includes the non-default viewer. Legacy Ghostty request
inputs remain unchanged so a saved request cannot become a fresh effect after an
upgrade. A known failed creation/open can reopen the same runtime with an explicit
new viewer request. An unacknowledged creation cannot change viewer under the same
request. Neither case resubmits an agent task.

A failed display query means an unknown window, not confirmed closure. Observation
and receipt snapshots retain that uncertainty instead of terminating the service
loop. A child whose known window cannot be queried stays recorded. This containment
is separate from the GTK frame-feedback freeze; it does not repair Ghostty rendering.

## Capture cutoff

Removal commits its cutoff and `session.removed` event in one transaction; failed
writes roll back. Observations must match an active registration and its capture
generation. Late or queued content cannot resume recording after removal.
Administrative lifecycle events may still describe stopped or removed work.

Codex re-registration creates a fresh observation connection without importing
snapshot turns. Bash requires a clean idle prompt with no pending command,
partial input or incomplete hook frame. Its removed-period buffer is discarded.
Opening a window never implicitly registers it.

## Implementation boundaries

`service.rs` owns the store and runtime/window maps. Private `service/lifecycle.rs`
progresses typed actions; `service/native.rs` progresses native requests. Startup
helpers return connections and metadata without mutating the store. Waiting
phases advance between capture passes, keeping other instances responsive.
JSON stays at protocol and storage boundaries.

The private socket is locked, bounded and same-UID checked. SQLite migrations are transactional; version two adds agent authority while
preserving existing lifecycle state. Version three moves display names into sessions;
original launch names remain immutable inputs for retry receipts. Unsupported newer
schemas are refused before writes.
PTY ioctl calls use live descriptors and valid pointers. Post-fork setup uses
async-signal-safe calls only; inherited hook descriptor nine is intentional.
Uncertain or incomplete shell writes are never replayed, and human typeahead
remains protected. Rust's `Child` does not stop a process merely when dropped;
Voyager's runtime owner handles cleanup explicitly.

## Native checks

Normal Cargo/Electron tests use fixtures and real PTYs without model calls.
The binary-replacement regression checks viewer paths, bound CLI access and
missing-file failure. A separate real Ghostty/Bash check exercises replacement,
same-runtime reopen and a failing client command without a false success:

```sh
VOYAGER_NATIVE_SHELL_DIR="$(mktemp -u /tmp/voyager-shell-XXXXXXXX)" \
  cargo test --locked --test native_shell_viewer -- --ignored --nocapture
```

Use a fresh private directory on a graphical Linux session. It saves `proof.json`
there and stops its own shell and service. It does not exercise a model turn or voice.

The opt-in xterm fixture runs the actual launch, identity, placement and PTY-input
code on the desktop. It compiles a disposable stdin program with `cc`, verifies
stale identity refusal and one F8 write, checks 12 minimise/restore cycles with
changing window pixels, and closes only its own viewer:

```sh
VOYAGER_VIEWER_PROOF_DIR="$(mktemp -u /tmp/voyager-viewer-XXXXXXXX)" \
  cargo test --locked --test native_viewer -- --ignored --nocapture
```

It requires xterm and xdotool. Its `proof.json` is private evidence. It does not
start a service or model, prove microphone handling, or measure app docking/sound.
The unavailable-display unit regression retains unknown windows after child exit.
Full service tests also cover background viewer selection, invalid choices, retry
identity and failed-open runtime preservation. Bound instance callers cannot start
a disposable service; run those tests through normal CI or an owner environment
without changing the caller identity.

The [panel lifecycle proof](../desktop/README.md#lifecycle-experiment) uses two
real Bash/Ghostty instances. It checks menu hit testing, background/reopen,
already-closed viewers, stop, capture cutoff, re-registration, and row removal.

The separate Codex check uses real native tasks, managed and external capture,
background completion, same-runtime reopen, removal and stop refusal:

```sh
VOYAGER_NATIVE_PROOF_DIR="$HOME/.local/share/voyager-native-lifecycle-proof" \
  cargo test --locked --test native_lifecycle -- --ignored --nocapture
```

Use a fresh private directory. Physical gestures, menu readability and sound
still require a person. These lifecycle checks do not establish other platforms, voice handoff or
crash/reboot recovery. [Authority checks](authority.md#checks) cover the separate
bound-identity and hierarchy contract.

The service sleeps only after an idle accept pass when no external Codex observer
is present. Queued requests still advance capture and lifecycle between replies,
but do not each pay the idle 50 ms delay. This matters for docking and placement,
which perform several named reads before attaching. The service-boundary burst
regression distinguishes queued responsiveness from idle polling; it is not a
measurement of native window mapping or voice startup.

## Terminal rendering investigation

The opt-in native probe opens only its own disposable Ghostty window and prints
numbered frames from a Python child. It verifies the window's process identity,
cycles minimise/restore/resize, and compares raw rendered pixels while checking
the independent writer heartbeat. It saves its result and terminal stderr outside
the repository and closes its own window. A stalled screen with an advancing
heartbeat is reported as a failure, not a completed agent task.

```sh
cargo build --locked --bin voyager-windows
python3 desktop/test/native-window-probe.py --probe "$PWD/target/debug/voyager-windows"
python3 desktop/test/native-window-probe.py --probe "$PWD/target/debug/voyager-windows" --resize-only
```

Run from a graphical Linux session with Ghostty, xdotool and ImageMagick's
`import` installed. The window takes focus during the test. The second command
is a known-different control that omits minimisation. Neither command starts a
Voyager service, reads existing terminal content or exercises docking/voice.

On Fedora 43 with Ghostty 1.1.3, GTK 4.20.4 and Mutter 49.4, minimise/restore
cycles reproduced a stalled screen while the terminal and writer remained alive.
Resize-only cycles stayed responsive in the sampled run. Removing direct mapping,
slowing the cycle and selecting Cairo did not reliably prevent the stall. These
observations locate a reproducible failure outside Voyager, but do not prove the
cause of every reported freeze. No graphics workaround or automatic restart is
enabled. For a managed Vessel, explicit Background followed by Open replaces its
viewer while preserving its runtime and capture; stopping the Vessel has different
semantics. A live native check is still required before claiming this freeze fixed.
