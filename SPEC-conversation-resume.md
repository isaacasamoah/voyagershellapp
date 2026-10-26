# Spec: explicitly resume a saved conversation

Module id: `conversation-resume`. Project: VoyagerShellApp. Approved by the owner, 24 October 2026. Implementation authorized by the owner, 25 October 2026.
The [capability map](SPEC.md) is approved. This document owns the resume contract consumed by [current-work-panel](SPEC-current-work-panel.md). The owner approved this specification and requested planning. The owner approved the implementation plan, 25 October 2026.

## Approved revision, 26 October 2026

The earlier build restored and compared saved settings. Isaac has replaced that
product decision: new Codex Vessels and resumed conversations use the current
Codex model and effort configuration. YOLO remains the permission default unless
the user explicitly changes that launch default. Model and effort controls in
Voyager are deferred. This revision records that decision and proposes its
acceptance checks. It supersedes the earlier requirements to reproduce an old
settings snapshot. C1–C3 have passed their bounded review and test run. The reconnection follow-up below is approved; its implementation plan is ready for review.

## Proposed follow-up: reconnect a surviving Vessel

Approved by Isaac, 26 October 2026. Isaac chose proactive recovery after the
service-loss investigation. These recovery rules supersede conflicting
first-increment limits below. This section extends the completed Resume increment;
it does not change the running application. It supersedes the earlier deferral of
verified reconnection for the scope below. Resume still requires a confirmed stop.

### Desired experience

Keep the existing minimal, subtle interface and normal native behavior. Recovery
must not demand an idle agent, stop an active turn, alter native permissions,
change model/effort settings or introduce a confirmation dialog for ordinary work.
Voyager augments the terminal and agent; it does not impose an extra operating
policy on them. Identity checks establish which saved runtime to reconnect, not
whether the user's native work is acceptable.

Voyager should recover its connection when the agent is still running. The owner
should not need to diagnose a service restart or move an otherwise healthy Vessel
out of Needs attention. Check eligible saved Vessels automatically when the service
starts, and recheck when a known native connection is lost. Keep the service and
panel responsive while these checks run.

The first scope is registered Codex Vessels that Voyager previously launched or
resumed. Include existing saved records where the service can verify the required
identity. Do not restrict recovery to Vessels created after this change merely
because the older record uses a different storage shape.

1. Keep the Vessel visible in Vessels while checking its connection. Show
   Reconnecting, not a demand for user attention. Preserve its name and placement.
2. Check the saved native endpoint and conversation against the current runtime
   generation. Verify the actual peer process and user, not a title or saved PID
   alone. Recheck that the registration and generation still match before applying
   the result. One Vessel has at most one recovery attempt in progress.
3. When the existing runtime is verified, reconnect it. Keep its Vessel ID, native
   conversation and runtime generation. Do not start a process or replace the live
   conversation with a newly loaded copy. Provider calls used to reattach must
   preserve the existing thread and submit no work. Preserve the runtime's current
   model, effort and permissions.
4. Restore capture and supported managed-Vessel controls under current service
   policy. This includes Open/background, explicit Stop, and eligibility for a new
   dock and voice attachment. Establish a valid way to observe and control this
   existing managed runtime; do not fabricate a child handle or treat a new
   registration as process ownership. Renew credentials rather than reviving old
   tokens or temporary grants. Assignments and Fleet placement do not change.
5. Mark the capture discontinuity, then accept new events through a new capture
   connection. Old turns remain history. Reconnection must not repeat a task or
   make a historical result appear newly completed.
6. Leave the avatar and existing windows where they are. Reconnection makes a new
   dock possible; it does not restore an expired dock, start voice, open a viewer
   or change the owner's current focus automatically.

### When a connection cannot yet be restored

Use the existing service deadlines. Try transient failures again with a bounded
retry policy, without a tight loop or several concurrent attempts. Explain a
failed check once its deadline expires; do not leave Reconnecting indefinitely.
Offer Retry connection beside that Vessel. The button runs the same verification
path, not a replacement launch. A manual retry cannot duplicate an active attempt.

If the original runtime's exit is confirmed, stop retrying that runtime. Present
it in Previous vessels and let the owner explicitly Resume the saved conversation
through the existing operation. Failure to contact a socket is not proof of exit.
A changed process, mismatched conversation or insufficient identity evidence must
leave unrelated processes untouched and explain which check failed.

Do not put a Vessel in Needs attention merely because the service lost its own
connection. Reserve that group for a specific problem with an available user
remedy. If the system still cannot determine what happened, explain that directly
and retain Retry connection and readable details. Do not imply that inspecting,
renaming or removing a Vessel repairs its connection.

### Service and panel contract

Keep process observation, management connection, capture and window observation
separate. Expose a small additive recovery result with checking, connected or
disconnected state, a readable reason when needed, and whether retry is available.
The service owns eligibility and recovery; Electron and the CLI present the same
result. Exact field names and storage changes belong in the reviewed plan.

An empty in-memory viewer list means the new service has not verified a viewer.
It must not report a closed window on that basis. Resolve a surviving viewer from
its native identity. Otherwise report its window state as unverified. Finding a
window alone does not establish ownership of its runtime.

This extends the earlier rule that running requires a child of the current
service. A verified reconnection can restore management of a runtime Voyager
already created. A stored PID alone still cannot establish that authority.
Uncertain task and operation receipts remain uncertain unless their own outcome
is established. Verifying a live runtime does not retroactively prove that an
interrupted instruction completed.

### Acceptance journeys

Use the maintained service fixtures and native app runner. Keep one shared setup;
do not add another standalone recovery test system. Count all acceptance helpers
under CONSTRAINTS.md and retain its test-size and review limits.

| Case | Required result |
|---|---|
| The service ends while a managed Codex Vessel and its terminal remain alive | Restart the selected service. It automatically verifies and reconnects the same runtime. The same conversation, process identity and runtime generation remain. Capture and supported controls work, with no new turn or replacement process. Check both an idle runtime and one doing a controlled task; reconnection must not interrupt or resend that task. The panel needs no user intervention. |
| The surviving runtime has no viewer, or its viewer closes during the outage | Reconnection does not open a window. A later explicit Open attaches to that runtime. Window state follows actual observation. |
| A native endpoint is temporarily unavailable | Checks stay bounded and responsive. Failure has a readable reason and working Retry connection. A later successful check reconnects once. |
| The prior runtime has genuinely exited | Confirm exit, show Previous vessels, and allow explicit Resume. Reconnection itself starts nothing. |
| A saved endpoint, peer or thread no longer matches, or a registration changes during the check | Do not attach, signal an unrelated process, overwrite a newer generation or revive a removed registration. Explain the failed check. |
| Service loss interrupts an instruction or lifecycle operation | Keep its recorded evidence and unresolved outcome. Reconnecting the runtime never resends that work or invents completion. |

Prove the first case with the actual candidate app, bundled service and native
Codex, including an existing eligible saved Vessel. Verify a new dock and voice
attachment, Open/background and explicit Stop against the reconnected runtime.
Keep a separately owned process unchanged as the known-different case. Record the
outage, verification, reconnection and user-ready timings, executable identities
and cleanup. Native conversation reads alone do not prove restored management.

No product decision remains open for this bounded scope. Before implementation,
the plan must explain how the current and legacy records establish runtime
identity, how the recovered runtime is monitored and controlled without its old
child handle, and how retry/credential changes stay inside current service policy.

## Objective and scope

The owner can explicitly return to a confirmed stopped, previously managed Codex conversation, preserving its saved history and Voyager identity. The new runtime starts idle. Reopening a terminal, resuming a conversation and submitting work remain distinct actions.

The [worker source inspection](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/src/worker.rs) found that worker creation starts a fresh thread and existing re-registration requires a live endpoint. Neither is a managed stopped-conversation resume operation. A retained registration does not establish a running agent or continued capture.

First scope is active registrations for previously managed Codex conversations, initiated by the local owner through the panel or CLI. The private owner conversation may expose the same named action for an explicit user request. Ordinary Vessel callers gain no new permission. Removed records remain readable but cannot be resumed implicitly; restoring their registration needs separate explicit behavior outside this increment. Bash offers existing new-shell creation, not restoration of old jobs or shell state.

## User journey and invariants

1. Show Resume only when service eligibility permits it. The action opens the saved conversation and its viewer without continuing the old task. A background but running Vessel offers Open instead. Detailed wording belongs in the secondary details, not a paragraph on every row.
2. The owner selects Resume. Record one immutable operation intent before starting a process. Recheck eligibility at execution; a stale UI cannot cause a second runtime.
3. Start a new service-owned Codex runtime for the same saved native thread. Verify that the provider returns that identity and an idle conversation before reporting success. Do not substitute `thread/start`, fork history or send a turn on failure. If persisted automation or a goal would start work on resume and the adapter cannot load it idle, refuse with an explanation; do not silently clear that goal or continue it.
4. Preserve logical Vessel ID, name, current valid assignments, Fleet placement and historical events. Create fresh runtime and capture generations and credentials. Revalidate present authority; do not revive old credentials, temporary grants or dock authority.
5. Keep the saved working directory and use its current Codex model and effort settings. Preserve the user's native workflow. Launch in YOLO unless the user explicitly changed that launch default. A configuration change since the previous run must not block Resume. Do not restore an old settings snapshot. Let Codex report actual invalid configuration or startup failures with a readable explanation.
6. Capture new events after the successful resume boundary and record the gap. Historic turns loaded by the provider remain history; they cannot appear as freshly completed work.
7. After runtime success, the panel may issue the existing Open operation as a distinct explicit step of the requested Resume-and-open journey. A viewer failure leaves the resumed agent running and offers Open again. It never starts another runtime.

The original Resume operation establishes ownership for its actual new child. Verified reconnection is the separate proposed extension described above. Persisted PID values are not ownership. A prior confirmed stop/exit and no conflicting current managed operation are required. Lost ownership, a pending earlier start or uncertainty about the old runtime blocks resume. A service restart preserves a previously confirmed stop but must not convert previously running or uncertain work into eligible stopped work. An unresolved legacy record offers Inspect with the recorded state and reason; the original increment did not add automatic ownership recovery. The proposed reconnection follow-up above extends that limit only for a verified surviving runtime. This increment does not detect every independently opened copy of a saved thread outside Voyager; retain provider conflicts and do not claim global uniqueness.

## Current configuration at startup

New Codex Vessels and Resume follow the same startup rules. Read current user and
project model and effort settings when starting each runtime. Do not cache them
until the service restarts. Preserve Voyager's fresh bound identity and existing
service authority without replacing the user's coding workflow.

YOLO means no approval prompts and full access for the Codex runtime. It is the
default for both new launch and Resume. Honor a different launch default only
when the user explicitly selects one. Do not replace this default with Codex's
global approval or sandbox settings, or with the stopped thread's old permissions.
Provider permissions and Voyager's authority to manage Vessels remain separate.
For this increment, launch and Resume always select YOLO. The owner approved
deferring permission-default controls during the C1 corrective pass. No permission
mode environment variable, checkbox or per-Resume permissions form is included.

For Resume, keeping history does not mean keeping the former model or effort.
Use current model and effort settings even when Codex would otherwise restore an
older thread-specific value. Verify the effective result against the current
startup selection, including the chosen launch permission default, not the saved
snapshot. Do not assume that omitting resume parameters
will apply current defaults; prove that behavior with the installed provider.

Changing configuration files, instruction files or the provider version is not
by itself a reason to refuse. A provider that cannot start or cannot return the
requested conversation still reports its actual failure. The saved thread must
load idle, preserve its identity and wait for a new instruction.

Missing historic model, effort or configuration fingerprints do not make an older
record ineligible. Its thread identity, working directory and confirmed stop
remain necessary. A recorded process ID alone is still insufficient evidence.
Model and effort controls, Voyager-specific model defaults and a settings repair
editor are deferred. No second model configuration store is part of this
correction. Permission-default controls are also deferred; current model and
effort selection must not become a permission-policy migration.

## Service contract

The following names and fields are proposed additions. Existing operations keep their current behavior and response shapes.

| Interface | Input | Result |
|---|---|---|
| Existing owner list/detail | Existing selection and permission rules | Add a `lifecycle` observation and `resume` eligibility object to each relevant record. |
| New `resume-instance` operation | `request_id`, `session_id`, `expected_runtime_generation` | Existing lifecycle receipt envelope, with action `resume-instance`, the same logical session ID and the new runtime generation when known. |
| Existing operation lookup | The immutable request ID | The saved pending or final receipt. Reading it never replays the operation. |

`expected_runtime_generation` is the generation observed when the owner chose Resume. For an eligible legacy record, the service supplies a stable baseline generation after validating its recorded stop evidence. An unverified record cannot invent that baseline.

The additive `lifecycle` object has `runtime` equal to `starting`, `running`, `stopped`, `unknown` or `external`, and a nullable `runtime_generation`. Existing separate window and capture fields remain authoritative for their own observations. `running` means the current service owns a live runtime; `stopped` means exit is confirmed with no conflicting runtime. `external` makes no process-ownership claim. Missing observations are unknown, never stopped.

The additive `resume` object has `state` equal to `eligible`, `pending` or `unavailable`, a nullable `request_id`, and nullable `reason_code` and `reason`. Eligible records carry the expected generation through `lifecycle`. Initial reason codes include `unsupported_kind`, `external_owner`, `registration_removed`, `already_running`, `outcome_unknown`, `settings_unavailable`, `thread_unavailable`, `directory_unavailable` and `forbidden`. Eligibility is an observation, not a reservation or permission grant.

Validate caller, request ID, types, identity, generation and saved metadata at the service boundary. Use the existing error envelope with a stable code and readable message. Reusing a request ID with changed inputs is `request_conflict`. A different request for the same in-progress Vessel is `busy` and identifies the existing operation where authorized. Claim the request and per-Vessel operation atomically before spawning; no check-then-spawn race.

Receipts retain existing `pending`, `completed`, `partial` and `uncertain` meanings. Completed means the same saved thread is loaded idle, the owned runtime is live, fresh credentials are established and capture is connected. Known failed effects use the existing partial/error representation.

A client disconnect or missed reply does not itself make the service's operation uncertain. Once the service has accepted and recorded the request, it continues within existing deadlines and saves the outcome independently of the client connection. The client retrieves the receipt by the same request ID after reconnecting; retrieval never starts another runtime. Mark an operation uncertain when the service cannot establish its outcome after a possible effect, including an unresolved provider timeout or interruption by service termination. After restart, preserve known receipt evidence and mark unresolved interrupted operations uncertain; do not overwrite a recorded final outcome merely because its reply was lost. A new request ID cannot bypass unresolved state. An old completed receipt describes that earlier outcome, not current liveness; callers must refresh lifecycle observations before opening or labelling the agent running. Restart never automatically resumes a thread or restores ownership from a saved PID. The proposed follow-up above may reconnect a verified surviving runtime without starting another process.

Resume itself leaves the viewer closed. A successful runtime receipt and failed Open receipt must remain distinguishable to every caller. Suggested UI messages are "Conversation resumed; opening terminal" and "Conversation resumed, but the terminal could not open."

## Source ownership, stack and style

Use Rust 2024, the existing SQLite store, Codex adapter and Electron 44.7.0 / Node 24. Add no dependency or generic lifecycle framework. [Official Codex documentation](https://learn.chatgpt.com/docs/app-server) supports resuming a stored thread by ID separately from starting a turn. Codex 0.163.0 schema inspection also found `excludeTurns`; actual runtime/settings behavior still needs native proof. Recheck the installed provider schema before implementation.

`src/service/lifecycle.rs` owns this operation; `src/worker.rs` starts the owned runtime; `src/service/native.rs` retains native request ownership; `src/store.rs` owns persistence. `src/actions.rs` defines typed phases. CLI wiring belongs in `src/bin/voyager.rs`; a private owner tool, if exposed, uses `conversation-tools.json` and `conversation_tools.rs` as a thin caller of the same operation. Read [lifecycle.md](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/lifecycle.md) and [authority.md](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/authority.md) before changing those boundaries.

Current workers have one unique session association. The implementation must retain immutable original launch/operation evidence while allowing successive runtime generations for the same Vessel. Plan the minimal transactional schema change and legacy-read behavior before coding it. Do not rewrite original launch inputs to make a new runtime look like the old process.

Follow [CONTRIBUTING](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/CONTRIBUTING.md). Meaningful phases use enums and `Result`; changed source stays comment-free. Existing [actions.rs](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/src/actions.rs) illustrates the style:

```rust
#[derive(Clone, Copy, PartialEq)]
pub enum Action {
    Open(crate::viewer::Kind),
    Background,
    Stop { close: bool },
    Remove { stop: bool },
    Register,
}
```

## Commands

From the selected worktree root, when implementation is authorized:

```sh
cargo build --locked --bins
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
npm --prefix desktop ci
npm --prefix desktop run format:check
npm --prefix desktop test
```

Extend `tests/service.rs`, `tests/worker_server.py` and authority fixtures as needed. Existing opt-in native lifecycle tests are not proof of this new operation. The later plan must provide a dedicated, authorized native resume test and its exact command. No new CLI syntax is represented as runnable yet.

## Success criteria and verification

| Id | Case and required evidence |
|---|---|
| R1 | Create a disposable conversation containing a marker, explicitly stop it and resume it. Logical Vessel and native thread IDs stay the same; owned process and credentials are new. The marker is available after an explicitly requested new query. No new turn starts merely from resume. |
| R2 | Repeat after service restart following a confirmed stop. Preserve history, name, valid assignments and Fleet placement. Use current Codex configuration, including after a configuration change while the service stays running. Previously live/uncertain records remain blocked. |
| R3 | Duplicate the same request and race two distinct requests. Exactly one new owned runtime starts. Changed input under one ID refuses. |
| R4 | Test both failures separately. Disconnect the requesting client after the service records the request, while startup is in progress; keep the service alive and let startup succeed. Reconnect and retrieve the completed receipt using the same request ID; exactly one runtime started. Separately, terminate the test service after a possible startup effect but before a final outcome is recorded. Restart it and verify that the unresolved operation is uncertain, its recorded evidence survives, and neither receipt lookup nor a new request ID starts another runtime. Neither case affects unrelated processes. |
| R5 | Test each failure: the saved conversation cannot be found, its working folder is missing, the current Codex configuration is invalid, or Codex cannot return the requested conversation. Explain the actual failure without creating another conversation. An older confirmed-stopped record remains eligible when its thread and directory are known, even if historic settings are absent. |
| R6 | Resume the agent successfully, then make opening its terminal window fail. The agent must remain running. Choosing Open again must connect a window to that same running agent. Closing and reopening the window must not send a task or continue earlier work. |
| R7 | Verify that credentials from the previous runtime and expired temporary permissions no longer grant access. Only the local owner can request Resume. Resuming must not bypass the service's current rules for who may manage or instruct the agent. |
| R8 | Deliver delayed events from the previous run's event connection. Voyager must not present them as activity from the new run. Loading saved conversation history must not report old task completions as newly completed work. |
| R9 | Verify that Resume refuses each unsupported case: a stopped Bash shell, an agent started outside Voyager's ownership, a registration that has been removed, and a Voyager-managed agent that is already running. These cases must not start a new runtime. Voyager must not send signals, such as stop or kill, to any unrelated process. |

Use controlled test processes to trigger failures at specific points in startup. Check that history and original receipts survive, current configuration is applied, and the service manages only the live child processes it actually started. Extend the maintained shared runner rather than creating another acceptance launcher.

Also test with real Codex. Create and stop a disposable conversation, change its
current configuration and Resume through the actual panel. The conversation and
Vessel IDs stay the same. The changed model and effort are effective, no turn
starts, and the viewer opens. A new Vessel must also use the changed defaults
without restarting the service. Change an unrelated configuration setting as a
known-different comparison; that edit must not block Resume either.

Use the existing disposable process fixtures to verify that new launch and Resume
both default to YOLO, even when global Codex approval or sandbox settings differ.
Verify that an old read-only thread and current read-only Codex config do not
replace this increment's explicit YOLO selection. Keep the original no-duplicate-runtime,
disconnect, uncertain-outcome and same-viewer journeys. Simulated responses alone
do not establish real Codex configuration behavior.

For each run, record the exact app and service builds and executable paths, the Codex version, the time until the agent is ready, and the time until its terminal window is connected. Record the observed Vessel, conversation, process, operation and generation identifiers so the results can be traced to the right run. Do not record credentials.

Keep the service responsive and retain its existing time limits. If an operation reaches a time limit and the service cannot determine what happened, record an uncertain outcome instead of repeating the operation. Passing requires evidence for the cases above; a test coverage percentage alone is not enough.

## Boundaries and review decisions

Resuming a conversation must preserve its original history and must not submit a task. The agent waits for an explicit instruction before doing more work.

Broader recovery behavior needs a separate review before implementation. This includes automatically restoring agents, taking responsibility for agents started outside Voyager, and adding Voyager-specific permission controls. Applying the current model and effort configuration while retaining the selected launch permission default is part of this revision.

An old process ID is not proof that Voyager owns the process now using that ID. Do not claim ownership from that number alone or kill a process that might be unrelated. Use YOLO unless the user explicitly changed the launch permission default. Do not override an explicit alternative or fall back to broader permissions after its failure. If the outcome of an earlier request is uncertain, do not issue a new request ID to bypass that uncertainty and try again.

For older records, require the saved conversation identity, directory and verified
stop evidence. Do not require obsolete configuration snapshots. Keep history
readable if another eligibility condition prevents Resume. Creating a new Vessel
remains a separate action, never a substitute for a failed Resume.

Restoring removed registrations and editing saved settings are outside this
increment. The implementation plan must establish how current Codex configuration
is applied on both new launch and Resume. The native proof must demonstrate the
effective values and idle behavior. No schema change, provider substitution or
new permission system is assumed by this revision.
