# Plan: recover existing Codex Vessels without interrupting native work

Module: conversation-resume, proactive-reconnection follow-up. The panel consumes
its recovery result. Isaac approved the spec on 26 October and specified a minimal,
subtle interface with no new restrictions on ordinary terminal or agent behavior.
This plan is for review. [Tasks](todo.md). [Constraints](../CONSTRAINTS.md).
The completed C1–C3 plan and tasks remain in Git history before this revision.

## Outcome

The service checks previously managed Codex Vessels after restart or loss of their
native connection. It reconnects the verified existing runtime, restores capture
and ordinary controls, and keeps the same Vessel, thread and runtime generation.
It works while the agent is idle or active. Recovery neither submits a task nor
changes native configuration, window placement, focus or free-undocking behavior.

Use the current row, typography and menu. Temporary Reconnecting feedback is
subtle and announced accessibly. A failed check exposes Retry connection in the
existing menu and puts its concise explanation with that Vessel. Do not add a
banner, new settings page, checkbox, approval prompt or arbitrary workload limit.
Needs attention must have a supported user remedy. Do not report a window closed
merely because the new service has no viewer handle.

## Decisions grounded in the current implementation

### Keep one explicit representation of the current managed runtime

Worker currently requires Process(Child). Add a checked existing-process variant
alongside Child, with the small operations already needed: identify, observe exit
and request explicit stop. Keep a normal Child for ordinary launches. Do not add
a provider framework, another daemon, tmux or a separate ownership registry.

On Fedora the existing dependencies already expose Linux process descriptors.
Open and retain a descriptor for the actual socket peer, verify user, executable,
process start identity, native thread and generation, and use that anchored handle
for exit observation and explicit signals. Validate the expected managed process
group before using the descriptor's process-group signal operation. This avoids
checking a PID and later signalling a possibly reused numeric process group.
A recovered non-child has observable exit, not a reapable Child exit code.

This is a small native adapter, not a cross-platform claim. Do not add a new kernel
minimum to normal launch or restrict native work. A platform operation that is
actually unavailable must return its own readable failure. The current Fedora
host and pinned libc support the required primitives. Native proof must still
establish the complete stop and cleanup behavior before acceptance. Kernel
references: [process handles](https://man7.org/linux/man-pages/man2/pidfd_open.2.html)
and [anchored process-group signals](https://man7.org/linux/man-pages/man2/pidfd_send_signal.2.html).

### Use current generation evidence, including existing saved records

Read the latest runtime-generation record and its operation receipt. The original
workers.launch_id and workers.pid can describe an older generation after Resume.
Use the saved native endpoint and completed current operation to find the original
runtime. Codex transport already checks the actual peer user and exposes its PID.
Native loaded-thread/read checks confirm the saved conversation. Recheck current
registration and generation immediately before admitting the recovered connection.

Do not require today's Codex installation, model, configuration fingerprint or
permission defaults to equal the running runtime's settings. Those are not
reconnection eligibility criteria. Do not reject an active thread or require a
native draft, goal or task to be cleared. Read state without submitting work; use
the provider's existing-thread subscription while preserving that live state.

Existing records are not automatically excluded for missing a newly added field.
Use their current generation, receipt, endpoint and live evidence. The first native
journey must include a saved record created before this change. If its identity
cannot be established, retain the evidence and explain the particular failed
check. Do not launch a replacement to get around uncertainty.

### Refresh credentials at the locator the runtime already uses

The server received VOYAGER_SESSION_CONTEXT through its launch configuration.
For a resumed runtime that locator uses its current Resume operation ID, not its
original creation ID. Reissue only the current service's credential at that locator,
using a private temporary file and atomic replacement so native tools never read
half a file. Keep current assignments and policy; revoke any prepared credential
if admission loses its generation/registration race. Do not revive an old token.
A same-service connection loss does not justify unnecessary credential churn.

This corrects the current-identity selection needed by recovery. It does not add
permissions, a new approval step or a restriction on normal native tools.

### Keep the event loop and runtime behavior independent

Progress recovery through bounded pending work, one attempt per Vessel. Native
connection/initialization must not block the service loop. Reuse existing worker
startup polling and transport primitives where they fit. Do not reuse the part
that spawns a process or submits a task. A failed check releases only its own
connection/descriptor; it must not signal the existing runtime.

Use existing service deadlines, with retry delays after transient failure and
cancellation when the record changes. Manual Retry connection joins an in-flight
attempt or starts a fresh check after a known failure. It never replays uncertain
instructions or lifecycle effects. Record capture gaps, advance capture identity
for the new connection, and keep the runtime generation unchanged.

## Dependency order and vertical slices

Background recovery supplies the verified managed-runtime handle and credentials.
Viewer recovery then restores native window controls. Retry and presentation use
the same service operation. Work in that order, with no parallel implementation
on shared lifecycle files. Independent review can run against each frozen slice.

| Slice | Complete user journey | Tasks |
|---|---|---|
| K1 | A background Codex Vessel reconnects automatically after service loss or native connection loss. Its existing work and ordinary managed controls remain usable. | R01–R02 |
| K2 | A Vessel whose terminal survived service loss keeps that exact terminal available for Open/background, a new dock/voice attachment and explicit Stop. | R03–R04 |
| K3 | A transient failure recovers automatically or through Retry connection, with subtle status, truthful window state and no attention-only dead end. | R05–R07 |

Each slice includes implementation, maintained-fixture proof and independent
review before the next begins. Internal tasks keep their owning-file scope small;
ship the whole vertical journey in its PR, not disconnected plumbing. If a slice
approaches 1,000 changed lines, simplify it or split another complete behavior in
the native GitHub stack. Preserve the existing roughly 100/300-line preferences.

## Proving and review

Use the one maintained native runner. Add one small reconnect journey, shared by
all three slices, rather than copying setup per failure case. Let the existing
outer runner stop/restart its own service and keep ownership of every process it
must clean up. The app journey drives actual user controls; service observations
only corroborate them. Never use the owner's surviving Trial check as a disposable
fixture. A pre-change saved record is prepared within the private test setup.

Known-different cases include a separately owned process, changed endpoint/thread,
confirmed runtime exit and registration/generation change during recovery. Use
fixture barriers for deterministic failure ordering. Run both idle and controlled
active-turn recovery. Prove native CLI tools read the renewed bound context, the
same turn is not resubmitted, a new dock/voice attachment works and explicit Stop
ends only the selected managed runtime. Preserve the existing Resume and panel
journeys. Record timestamps through verification, connection and usable controls.

For Rust run cargo fmt --check, cargo test --locked and
cargo clippy --locked --all-targets -- -D warnings. For desktop run
npm --prefix desktop run format:check and npm --prefix desktop test. Package the
clean candidate with npm --prefix desktop run package:linux. Run the selected
package and its bundled service through desktop/test/run-native-proof.py using
the reconnect journey added to that runner. A checkout build is not runtime proof.

Use test-driven-development and incremental-implementation, rust-best-practices
for Rust, and rust-review alongside fresh-context code-review-and-quality.
Each slice gets one review, at most one corrective build, then re-review. Stop if
Required findings remain. Count all maintained and one-off proving code against
actually exercised production code. No suppression or threshold exception.

The whole-service BeautifulRust review is a separate proposal. Its unrelated
cleanup, input, receipt-storage and wider type changes do not silently expand this
plan. The current-generation credential correction is relevant to recovery.

## Completion and rollout

Keep plain five-part PR descriptions: before/after, verification, real-surface
proof, review and known limitations. Record actual skills used and their effect.
Update the owning lifecycle documentation, README actual status and Obsidian build
walkthrough after real behavior is proved. Keep one canonical task record here.

No main merge, installation, live service restart or adoption of the owner's
current runtime is authorized by this plan draft. Preserve that runtime and
The Climb. Prepare the final candidate for Isaac's inspection after review. Any
later authorized rollout must identify the exact app/service and active work.
