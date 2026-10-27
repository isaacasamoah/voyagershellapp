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

Scoped development runs use a separate helper owned by the authorizing service.
Their candidate service/profile has its own process maps; cleanup goes through
that service's existing lifecycle operations. A runner receipt does not prove a
successful test or completed cleanup. [Development run contract](development-tests.md).

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

## Saved-conversation recovery gate

The recovery experiment uses Codex 0.164.0 with a disposable legacy-history thread.
It proves the provider boundary, not a Voyager Resume operation or panel journey.
The production operation is not implemented yet. Run the opt-in provider check
with a fresh private directory:

```sh
VOYAGER_RESUME_PROOF_STATE=/tmp/NEW_PRIVATE_RESUME_PROOF \
  cargo test --locked --test native_resume -- --include-ignored --nocapture
```

This check reuses Voyager's native Codex transport. It is separate from the
maintained desktop runner because no recovery UI exists at this gate. Later
resume-and-open journeys extend that runner rather than adding another app launcher.

A new provider process must inspect `thread/goal/get` before loading. Only an
explicit null goal permits this first increment. A missing field, provider error,
or any saved goal, including a paused or completed one, refuses before loading.
This conservative first policy preserves the goal rather than changing it. The
preflight must leave `thread/loaded/list` empty. Reopening a thread already loaded
in the same provider can ignore settings overrides, so that case cannot prove
settings preservation for a replacement runtime.

The supported first settings snapshot is versioned and records observed values:

| Provider result | Recovery use |
| --- | --- |
| `model`, `modelProvider` | Nonempty exact strings. Do not enable model fallback. |
| `cwd` | Canonical existing directory, equal to the saved effective directory. |
| `approvalPolicy`, `approvalsReviewer` | Required recognized values, retained exactly. |
| `sandbox` | Required recognized effective restrictions. The real gate currently proves read-only without network access. Convert that policy to its documented request mode, then compare the returned effective policy. |
| `activePermissionProfile` | Required field. The real gate proves explicit null only. Named/custom profiles remain unsupported until their effective restrictions and provenance can be reproduced and verified. Never combine `permissions` with `sandbox`. |
| `runtimeWorkspaceRoots`, `instructionSources`, `reasoningEffort` | Record observed nonsecret workflow provenance. The experiment does not prove arbitrary custom workspace, instruction, environment, plugin or tool overrides. Unsupported/missing workflow provenance makes a record ineligible, rather than inventing defaults. |
| Executable/version and snapshot version | Preserve the provider that produced the values and validate compatibility before use. A changed or unverified provider is not silently accepted. |

The later adapter must validate presence and types before comparing snapshots.
Two absent values are not matching settings. It must check the returned thread
identity and explicit idle status, then reject unexpected turn starts or active
status. Five seconds of quiet in this experiment is bounded evidence for these
threads, not a universal guarantee about provider automation. Resume submits no
turn; a later explicit instruction proves context recall separately.

The schema change is additive and transactional after version 3. Add a runtime
ledger keyed by `(session_id, generation)`, with immutable originating operation,
endpoint, observed state and provider provenance. Keep the original workers and
launch operations unchanged. Add a separate versioned verified-settings record.
Use a partial unique index to exclude two starting/running/uncertain attempts for
one Vessel. Allocate the next generation and save the immutable operation in one
immediate transaction before spawning. Roll back the transaction on any admission
failure. A consumed uncertain generation cannot be retried through another ID.

On service startup, retain confirmed stops but mark interrupted running/start
records unknown or uncertain. Stored PIDs establish no ownership. A live child
is the only source of running ownership. New capture generations exclude delayed
events; fresh credentials revoke earlier credentials. Completed operation receipts
remain historical evidence and must not overwrite fresh liveness observations.
A legacy baseline is permitted only with confirmed stop evidence and no conflicting
operation; missing verified settings still makes Resume unavailable. A later
installation needs a closed-service database backup before migration. Rollback of
an executable alone cannot undo a schema change or discard newer history.

Refine R01 into two complete behaviours before implementation. First make lifecycle
observations truthful and save verified settings when a new managed runtime starts.
That slice changes `store.rs`, `worker.rs`, service list presentation, and focused
service/provider fixtures. Second add owner-only Resume through lifecycle admission,
the new worker-start mode and operation completion. It requires the same store and
worker boundary plus lifecycle/service routing and the existing authority policy.
Keep that source map explicit in the plan; do not replace it with a storage-only
or transport-only slice that cannot demonstrate observable behaviour.

Provider protocol references are the [official app-server guide](https://learn.chatgpt.com/docs/app-server)
and [persisted-goal guide](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex).
Generated schemas identify available fields; only the opt-in run establishes the
observed settings and idle behaviour above. Missing or incompatible settings,
unsupported profiles and unverified workflow customizations must remain readable
refusals in the eventual product.


## Runtime observations and saved settings

Schema version 4 adds `runtime_generations` without rewriting original workers,
launch operations or events. A newly registered owned runtime starts at generation
1. Verified stopped/exited legacy workers receive baseline 0 only when migration
finds no pending or uncertain operation for their Vessel. This baseline alone does
not establish that the settings needed for Resume exist.

The owner list reports a `lifecycle` object separately from window and capture
observations. Running requires the current service's live child. An external
registration makes no ownership claim. A confirmed recorded stop survives restart;
previously running records become unknown. Removing a registration does not change
these process facts. This increment supplies observations, not a Resume action.

Worker startup retains a versioned subset of the provider's effective response
only when its required fields and ordinary field types are present. The native
initialize response supplies provider-version provenance, avoiding another process
just to ask for a version. Missing observations leave the snapshot absent and do not prevent a later
explicit Resume using current configuration. The snapshot contains no
conversation content, credentials, instructions text or account information. Named
profiles are not supported by this first snapshot format. Later Resume must validate
recognized values and compatibility before use; saving an observation does not
make it eligible by itself.

The optional real-provider boundary check uses the existing service fixture and
its normal owned-child cleanup. It creates one background Codex, records its list
state/settings, explicitly stops it, and restarts only its disposable service.
Run it with an authenticated provider and a fresh evidence directory:

```sh
VOYAGER_NATIVE_RESUME_PROVIDER=/absolute/path/to/codex \
VOYAGER_NATIVE_RESUME_EVIDENCE=/tmp/NEW_OBSERVATION_EVIDENCE \
  cargo test --locked --test service \
  native_runtime_observations_retain_settings_after_confirmed_stop -- --exact --ignored
```

This is real service/API evidence, not a terminal, panel interaction or a working
Resume journey. The later full-module application check must still use the shared
desktop runner and the selected package.


## Owner-requested Resume

`resume-instance` accepts the immutable request ID, Vessel ID and observed
`expected_runtime_generation`. Only the local owner may request it. List responses
add `resume` availability beside the separate `lifecycle` observation. Missing
historic settings do not prevent Resume when identity, directory and confirmed
stop evidence remain available. Reading an
old operation receipt never establishes that its earlier runtime is still live.

The owner CLI uses `resume-instance SESSION_ID REQUEST_ID OBSERVED_GENERATION`.
Read the generation from a fresh list response. Resume leaves the terminal closed;
use a separate `open SESSION_ID xterm` or `open SESSION_ID ghostty` afterward.
Close the previous viewer first, or the service refuses with `viewer_still_open`.
This prevents an old viewer from being reported as attached to a new runtime.
`operation REQUEST_ID` returns the current saved receipt immediately, even when
it records pending, partial or uncertain work. Inspecting a failed result is not
another attempt. Action commands still fail when their own effects fail.

The maintained native runner has a `resume` journey. It checks a retained old
window, idle reopening, an explicit saved-marker answer, fresh instance-bound
capabilities, failed Open followed by successful Open, and closing/reopening the
same runtime's viewer. Its attachment observation matches the terminal child and
native frontend to the new service endpoint. It does not measure docking or audio.

The lifecycle owner's `resume.rs` submodule validates admission and progresses the
operation. The store atomically saves the operation and allocates the next runtime
generation before spawning. Concurrent starts are excluded. A new owned child
opens the same saved native thread after checking persisted goal state and selecting current configuration. It must
report idle, retain verified effective settings and start no turn. Capture advances
to a new generation and discards initialization/history notifications. Original
worker launch records, current assignments, names and Fleet placement remain intact.

Fresh credentials revoke the previous runtime's credentials. The old temporary
development grant is removed. Current service policy still decides access; Resume
neither changes rank nor restores docking authority. Opening a terminal remains a
separate operation. This slice supplies the service operation, not its later CLI
or panel controls.

### Current startup configuration

New launch and Resume read current project-aware Codex model and effort settings
when their runtime starts. An old configuration fingerprint, provider-version
string or missing historic settings snapshot does not block Resume. The saved
Vessel directory, native thread identity and confirmed stop remain required.
Current configuration lookup and provider I/O run in the existing startup thread,
not the service loop. Existing deadlines, receipt identity and failure cleanup
remain unchanged.

YOLO is selected explicitly for both new launch and Resume: never ask for
approval and use full access. The proposed permission-mode selector was removed
at the owner's request; permission-default controls remain deferred. This policy
controls native tool permissions, not Voyager rank, assignment, process ownership
or who may request Resume.

The adapter reads config/read for the saved directory and applies the selected
model and effort explicitly to thread/start or thread/resume. If either is unset,
it uses model/list to obtain the provider's current model defaults. It does not
assume that bare thread/resume replaces old thread-specific values. YOLO is passed as the native :danger-full-access permission profile, without a
legacy sandbox parameter. The response profile is an object; verify its id and
full-access sandbox rather than comparing that object with a string.

Startup verifies the returned current model, effort, directory and explicit
permission selection. It still checks the saved thread identity, idle state and
absence of an automatic turn. A failure after a possible load remains uncertain;
no new request ID can replay it. Invalid current configuration and provider errors
remain readable failures rather than causes to substitute another conversation.

Nonsecret effective settings are retained as version-two observations for
inspection, without instruction text or configuration fingerprints. They describe
what ran rather than deciding whether a later run may start. A successfully
resumed generation records its own effective observation. Old version-one records
remain readable and are not rewritten as evidence of current process ownership.
Capture updates can refresh or invalidate this observation without disabling a
future explicit Resume after a confirmed stop.

The ordinary fixtures verify current selection, explicit YOLO, absent historic settings, invalid current configuration and
unrelated configuration edits. The shared native
resume journey can use VOYAGER_PROOF_CURRENT_CONFIG=1. Its runner copies account
authentication into a private disposable Codex home, writes its own model/effort
configuration, changes those values after Stop and verifies the actual resumed
settings. It does not edit the owner's global configuration. The original marker,
idle, credential, viewer and cleanup checks remain in that one journey.

Failure cleanup retains its actual owned child and advances between service passes.
It sends TERM, observes exit, and escalates only that process group after the
existing two-second stop interval. A confirmed refusal before any load produces a
partial receipt with a stopped runtime. If loading may have happened, the result
is uncertain and cannot be retried through a different request ID. Interrupted
service operations remain uncertain after restart. No process is recovered from
a saved PID or restored automatically.


Supported `thread/settings/updated` observations refresh the verified snapshot for
the current capture generation. An incomplete, unsupported or incompatible change
makes the observation unavailable. Unexpected capture loss and registration removal
also discard that derived snapshot. Old capture generations cannot update it.
An unexpected owned-process exit invalidates the snapshot before closing capture,
even when a preceding ordinary message hides a later settings update. History and
the confirmed exit remain inspectable. Explicit owner Stop retains the existing
saved-settings path; reopening still verifies the settings returned by Codex.

The controlled provider experiment showed why permission overrides were unsafe:
settings changed through the native interface may be newer than startup metadata.
It also produced mixed shutdown/persistence observations. Those remain private
evidence; they do not justify assuming that every acknowledged native change is
durable. The complete service proof verifies both ordinary saved permissions and
a read-only change observed by Voyager. Unsupported or mismatched restoration
fails before the agent accepts new work. It never claims a universal native
persistence guarantee.

When no external discovery connection exists, the service waits on its two request
listeners for up to the existing 50 ms quiet interval. Socket readiness wakes it
immediately. It no longer adds a full fixed sleep between consecutive desktop
reads. The existing 400 ms queued-read regression remains unchanged. This uses
nix 0.31.3's [poll primitive](https://docs.rs/nix/0.31.3/nix/poll/fn.poll.html)
and handles an interrupted wait by returning to observation. Other wait errors
remain failures. Enabling the existing dependency's `poll` feature adds no package.

## Resume failure verification

The maintained process fixture can use a selected packaged service through
`VOYAGER_SERVICE_TEST_BIN=/absolute/package/resources/bin/voyager`. It defaults
to the current Cargo build. Its CLI helper uses that same executable. The authority
fixture accepts the same selection for credential and temporary-grant checks.

The focused failure cases hold provider startup at a known point. Two simultaneous
requests admit one runtime. Losing the client reply leaves the service free to
finish; receipt lookup returns pending immediately and later returns the same
completed result. Killing the disposable service after the provider receives Resume
preserves uncertainty on restart and blocks a new request. The held simulated
provider exits itself when its parent disappears; the test never recovers ownership
from its PID.

A confirmed stop remains resumable after restart with name, supervisor and Fleet
unchanged. Missing folders and missing or unexpected native threads fail without
creating a replacement conversation. Removed, external, stopped Bash and already
running records produce distinct refusals. Another running agent and the external
server stay responsive. Old capture generations cannot insert new completion
events; repeating a current event also cannot duplicate it.

These process cases complement the shared real Codex `resume` application journey.
They establish controlled failure ordering, not native provider behavior in every
failure mode or platform. The provider journey proves saved context, idle loading,
fresh bound capabilities and independent viewer attachment. Permission and legacy
migration checks remain part of the ordinary service and authority suites.

Before any future installation migrates existing state, explicitly stop owned
runtimes, stop the service and wait for confirmed exit. Copy the closed
`events.sqlite` to a private backup directory and retain the prior executable.
Do not copy a live database file or treat an executable rollback as a schema
rollback. A restore must preserve any newer history rather than overwrite it.


## Reconnecting an existing managed Codex runtime

The reconnect follow-up checks the latest runtime generation and its completed
launch or Resume receipt. It never spawns a replacement or submits a turn. A
background check connects to the saved same-user native socket and obtains the
actual peer PID. Its process must match the receipt, the managed process group,
the endpoint and the credential locator injected at launch. The native server
must already have the recorded thread loaded. The subscription uses only
threadId and excludeTurns, preserving current native settings and active work.

New receipts retain observed process start identity and executable path. Older
completed receipts are supported through the other checks, without inventing old
start evidence. A Linux pidfd pins the checked process during admission and later
exit observation. pidfd_open returns an owned descriptor, converted once after a
successful syscall. Polling that descriptor observes exit without inventing a
child exit code. Explicit Stop uses pidfd_send_signal with the process-group flag
only after checking that the peer is its group leader. That flag requires Linux
6.9; normal child launch keeps its existing path. Failure or cancellation drops
the new connection and descriptor without signalling the existing process.

Provider I/O runs outside the service loop. Initialization and every verification
RPC share one absolute deadline. A cancelled or timed-out check retains its result
receiver until its connection is relinquished, so a retry cannot overlap it. A
registration change cancels subscription before it starts, or rejects the result
at admission if that subscription was already pending. Admission rechecks registration,
capture generation and the current runtime record, then records a capture gap and
advances capture identity while retaining runtime generation. Same-service loss
retains its owned child and credential. A service restart renews credentials at
the current runtime operation's existing private locator. The file is written to
a private temporary path and renamed atomically. Old credentials and temporary
dock grants stay invalid. Reconnection neither opens a viewer nor restores a dock.

The shared native proof has a reconnect journey. Its outer runner retains orphaned
disposable provider children, restarts only its own service and cleans up through
anchored process handles. It never uses the owner's existing Vessel as a fixture.


The earlier review reproduced a blocking initial connection that could leave
recovery waiting beyond its deadline. That finding is closed by the additional
correction below. The previous stopped review remains historical evidence.
Surviving-viewer recovery and panel retry remain separate planned capabilities.


The owner-approved additional correction makes the initial recovery socket
nonblocking. Queue-full retries release their descriptor and wait briefly outside
the service loop, checking cancellation and the original deadline before each
attempt. A pending connect uses writable readiness and SO_ERROR. The native
handshake also progresses without blocking, so partial HTTP bytes cannot renew
its absolute deadline. The existing pinned nix and tungstenite primitives are
used directly, without a dependency or timeout increase. Ordinary native launch
keeps its existing transport behavior. The native connect contract follows
[connect(2)](https://man7.org/linux/man-pages/man2/connect.2.html).

Resume and reconnect use one maintained successful-turn assertion in the native
runner. It checks the selected turn's completion status and error flag, and its
expected assistant text when supplied. Each journey retains its own user actions,
identity, credential and cleanup assertions. Both journeys must pass on the same
packaged candidate before accepting this consolidation.


The additional correction passed fresh general and BeautifulRust review. The same
queue-full reproduction fails the earlier revision and passes the correction.
Nine reconnect cases, normal checks, the packaged legacy-runtime journey and the
packaged Resume journey pass. Arbitrarily fragmented WebSocket messages after the
handshake remain an existing transport review limit; this result does not claim
new absolute bounds for that broader case. The measured initial connection and
handshake correction adds no native permission or workflow restriction.

## Candidate follow-up: surviving native viewers

The reconnect-viewer candidate uses a saved viewer operation as a discovery lead,
not proof of ownership. In the existing recovery thread it checks the actual
same-user terminal executable and process start, retains a Linux process handle,
verifies its unique native window and one direct native client with the current
runtime's exact executable and attach arguments. A changed identity, ambiguous
client or failed display query leaves window state unknown. It does not start a
viewer to hide an uncertain observation. Capture recovery can succeed independently
of viewer discovery. The result is admitted only with the original current runtime
and capture generation, alongside the existing recovery admission check.

The viewer process is either the original Child or a checked existing process.
The latter never fabricates a Child or signals a stored PID. Linux process-handle
polling observes its exit without claiming it can reap a non-child. Explicit Stop
continues through the existing managed runtime handle. Viewer focus and close use
the existing native window checks and X11 requests. Dropping the viewer record
neither stops the agent nor kills the surviving viewer.

A successful discovery retains its actual viewer kind, so Open focuses that same
window. A confirmed absent window permits ordinary Open to create a viewer for the
same runtime. An unverified saved viewer remains unknown with a readable reason;
it is not reported closed or silently duplicated. This is Fedora/X11 behavior,
not evidence for native Wayland or another operating system. Native proving and
independent review remain pending for this candidate.
