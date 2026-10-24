# Tasks: reliable everyday use of Voyager

Status: Draft for review, 24 October 2026. Nothing has started or passed. The [plan](plan.md) explains the design, source findings, risks and real-test setup. These checkboxes are the task and checkpoint status for this initiative.

Read each task's governing specification before implementation. The tasks below use the plan's Rust checks, desktop checks and real-test commands. Focused commands are additional checks, not replacements for required formatting, regression tests or builds. All real desktop/provider commands require the authorized setup in the plan. A task's file list is a scope estimate; if it grows beyond five files or one focused session, split it before proceeding.

## Docking recovery

Governing spec: [docking-recovery](../SPEC-docking-recovery.md). Build this capability first.

### D01: use the same eligibility checks for hover and drop

- [ ] D01 complete.

Make the available-to-dock signal and the drop action agree about which terminal is supported. Remove implicit external registration from the drop path and keep service control authorization authoritative.

Acceptance:
- A running, connected, registered and verified managed target can proceed; external, ambiguous, disconnected or replaced targets get a readable refusal. Covers D1-D3.
- Drop repeats the identity checks after hover. Refusal changes no registration, authority or external process.
- Checking, ready and refused results are explicit and use the same rules.

Verification: `node --test desktop/test/binding.test.cjs`; `cargo test --locked --test service`; desktop and Rust checks. Demonstrate refusal with a supported terminal executable that belongs to an external agent, not only with an obviously unsupported application.

Dependencies: approved plan. Likely files: `desktop/src/binding.cjs`, `desktop/src/main.cjs`, `desktop/test/binding.test.cjs`, `src/control.rs`, `tests/service.rs`. Scope: medium, up to five files.

### D02: make placement success mean the avatar is visible

- [ ] D02 complete.

Give the placement path an explicit result and gate success feedback on the current accepted attachment and verified placement. Extract only a small helper if needed to test the asynchronous decisions.

Acceptance:
- Hidden, failed or superseded placement cannot play a success sound. A valid placement plays it once. Covers D1 and D4.
- A delayed reply from an old attempt cannot move the avatar or select an agent; failed attachments are released.
- Record bounded timing stages for drop, acceptance, placement and sound scheduling without recording private content. Scheduling is not labelled audible proof.

Verification: `node --test desktop/test/control.test.cjs desktop/test/docking.test.cjs`; desktop checks. `docking.test.cjs` is a planned new test file. Its regression must detect the current return-after-hide path and a late reply arriving after a new attempt.

Dependencies: D01. Likely files: `desktop/src/main.cjs`, new `desktop/src/docking.cjs`, new `desktop/test/docking.test.cjs`, `desktop/test/control.test.cjs`, `desktop/src/ui/renderer.js`. Scope: medium, up to five files.

### Checkpoint D-A

- [ ] D01-D02 tests and builds pass, with a demonstrated failing comparison.
- [ ] Review the eligibility and placement evidence with the owner before continuing.

### D03: restore visible controls when the target is lost

- [ ] D03 complete.

Undock when the target becomes covered or unusable. Make Applications recovery release the attachment and show both controls on the current display, independently of terminal state.

Acceptance:
- Covering, minimising, closing or moving the target off the workspace restores the floating avatar without stopping its agent or capture. Covers D5.
- Applications recovery works while docked and after failure, and remains visible through refresh. Keyboard recovery still works. Covers D6.
- Ending control stops native voice through the existing coordinator, does not start the private microphone, and does not delay visual recovery while voice state is uncertain. Covers D7.

Verification: `node --test desktop/test/docking.test.cjs desktop/test/control.test.cjs`; desktop checks; use the candidate manually for recovery and voice routing. Extend the existing visibility proof to retain the recovery observations.

Dependencies: checkpoint D-A. Likely files: `desktop/src/main.cjs`, `desktop/test/docking.test.cjs`, `desktop/test/visibility-proof.cjs`, `docs/desktop.md`. Scope: medium, up to four files.

### D04: prove docking and recovery on the real desktop

- [ ] D04 complete.

Extend the existing polish proof and record the real journey with both supported terminal viewers. Keep the evidence limits explicit.

Acceptance:
- D1-D7 have recorded outcomes, including actual pointer actions, target loss and independent recovery, for xterm and Ghostty. Unsupported combinations are disclosed rather than counted as passes.
- At least 19 of 20 unobstructed docks are audible within two seconds; at least 19 of 20 recovery trials show both controls within one second. Every trial recovers correctly, and all slow or failed trials are retained.
- Evidence identifies the app/service executables, display backend, target identities and timing stages through audible sound completion. Cleanup affects only the test's resources.

Verification: the plan's docking commands and manual/recorded audio checks; `node --check desktop/test/polish-proof.cjs`; desktop checks after harness changes. Compare the revised behavior with a deliberate rejected target and a failed placement.

Dependencies: D03. Likely files: `desktop/test/polish-proof.cjs`, `docs/desktop.md`, `docs/voice.md`. Scope: medium, up to three files. Raw evidence stays outside Git.

### Checkpoint D-B

- [ ] Docking meets D1-D7 and both timing targets on the tested Fedora setup; limits and cleanup are recorded.
- [ ] Review the real result with the owner before starting voice work.

## Voice handoff

Governing spec: [voice-handoff](../SPEC-voice-handoff.md).

### V01: enable the built-in acknowledgement

- [ ] V01 complete.

Use the supported Codex acknowledgement setting and explicit user-facing response instructions. Retain native automatic return and the existing permissions and model choices.

Acceptance:
- A delegated request enables `delegationAckFiller: true`; client-managed handoffs remain disabled. Direct conversation does not gain an unnecessary extra acknowledgement. Covers V1-V2.
- Instructions ask for truthful acknowledgement, observed progress and actual outcomes. They do not expose reasoning or invent started/completed work.
- No second announcer, new tool, permission expansion or extra completion-only model call is introduced.

Verification: `cargo test --locked --test conversation`; Rust checks. The provider fixture checks the outgoing configuration and instructions. This does not count as proof that speech was heard.

Dependencies: checkpoint D-B. Likely files: `src/service/conversation.rs`, `tests/conversation.rs`, `tests/conversation_server.py`. Scope: medium, up to three files.

### V02: keep public events attached to the correct request

- [ ] V02 complete.

Validate and associate acknowledgements, progress and results using the existing request, native turn/item and voice-generation identifiers.

Acceptance:
- Repeated final events become one response; unknown or old associations cannot announce another request's completion. Covers V4.
- Failed, interrupted and empty turns retain their actual outcome. A receipt is not promoted to a success answer. Covers V3.
- A client disconnect does not repeat work; readable results remain associated with the original turn. Covers V5.

Verification: `cargo test --locked --test conversation`; `node --test desktop/test/conversation.test.cjs`; Rust and desktop checks. Test reversed arrival order, duplicates, superseded requests, failure, empty completion and disconnect.

Dependencies: V01. Likely files: `src/service/conversation.rs`, `desktop/src/conversation.cjs`, `tests/conversation.rs`, `tests/conversation_server.py`, `desktop/test/conversation.test.cjs`. Scope: medium, up to five files.

### Checkpoint V-A

- [ ] V01-V02 controlled tests pass and demonstrate rejection of duplicate or wrong-request results.
- [ ] Review the event contract and test evidence with the owner before continuing.

### V03: preserve results when speech is interrupted or unavailable

- [ ] V03 complete.

Make the existing conversation UI show final text and useful status while respecting interruptions, lost voice leases and playback failure.

Acceptance:
- While the user speaks, queued updates wait. A superseded result stays in history without an unsolicited late announcement. Covers V4 and V6.
- Missing audio, denied playback and lease loss leave readable results, stop only audio as required and never resend commands on reconnect. Covers V5-V7.
- Private conversation, docked Codex and Bash retain their separate voice destinations; private results never enter a Vessel. Covers V8.

Verification: `node --test desktop/test/conversation.test.cjs`; desktop checks; a real microphone interruption check on the candidate, recorded again comprehensively in V04.

Dependencies: checkpoint V-A. Likely files: `desktop/src/ui/conversation.js`, `desktop/src/conversation.cjs`, `desktop/test/conversation.test.cjs`, `docs/harness-runtime.md`. Scope: medium, up to four files.

### V04: prove acknowledgement and return speech are heard

- [ ] V04 complete.

Extend the existing conversation proof for timing and request association, then test audible output and interruption on the actual candidate.

Acceptance:
- V1-V8 pass with real-provider evidence where required. Repeat the same request with acknowledgement disabled to distinguish missing acknowledgement from slow completion.
- At least 19 of 20 successful delegated requests meet both approved voice timing targets. All 20 deliver the correct result without duplicates or wrong-request speech; speech-detection delay and user-speaking exclusions are reported separately.
- Heard or captured output confirms audio. Silent playback and decoded packets alone are not counted as acceptance. A native delivery limitation is reported for design review rather than hidden behind a custom fallback.

Verification: the plan's voice commands, manual microphone trial and audio evidence; `node --check desktop/src/conversation-proof.cjs`; desktop checks after harness changes.

Dependencies: V03. Likely files: `desktop/src/conversation-proof.cjs`, `docs/harness-runtime.md`, `docs/voice.md`. Scope: medium, up to three files.

### Checkpoint V-B

- [ ] Voice meets V1-V8 and the audible timing targets; failed or unsupported cases are explicit.
- [ ] Review the real voice result with the owner before starting resume work.

## Conversation resume

Governing spec: [conversation-resume](../SPEC-conversation-resume.md).

### R01: prove the saved-settings and idle-resume contract

- [ ] R01 complete.

Write a bounded, opt-in provider test before building the product resume path. Use disposable conversations to establish exactly which saved settings can be preserved and whether resume stays idle, including persisted automation.

Acceptance:
- Record the installed provider/schema version and compare effective settings before stop and after resume. Verify saved model/provider, working folder, approval routing and sandbox/profile without permissive defaults. Covers the provider prerequisites of R1, R2 and R5.
- Resume the saved thread without sending a turn. Establish that it stays idle; then explicitly query a saved marker. Determine how unsupported goals/automation can be rejected without starting work or clearing state.
- Document the supported settings/profile combinations and the minimal stored fields in `docs/lifecycle.md`. If safe idle resume or settings preservation cannot be established, stop before R02-R08 and return the limitation for review.

Verification: add and run the plan's `provider_resume_contract` ignored test. Read the installed generated schema and compare the real responses. The test is an experiment, not a product feature or approval to change existing agents.

Dependencies: checkpoint V-B and explicit approval of this real-provider trial within the reviewed plan. Likely files: new `tests/native_resume.rs`, `docs/lifecycle.md`. Scope: small, up to two files.

### R02: preserve runtime history and verified resume settings

- [ ] R02 complete.

Implement the transactional storage design in the plan, keeping each Vessel's original launch evidence and recording successive runtime generations separately. Save nonsecret effective settings from actual provider responses.

Acceptance:
- Existing sessions, names, assignments, events and original launch inputs survive migration. Runtime history and verified resume metadata have explicit ownership and validation. Covers R1-R2 prerequisites.
- Legacy records get a stable baseline only with verified stop/exit evidence and no conflicting operation. Missing settings stay unavailable, not defaulted. Covers R5.
- Failed migration rolls back, future schemas refuse before writes, and disposable pre-migration data remains usable for rollback verification.

Verification: `cargo test --locked --test service`; Rust checks. Extend migration and interruption fixtures, including an uncertain legacy worker and a confirmed stopped worker.

Dependencies: R01 passed, with its settings/storage findings reviewed before this migration. Likely files: `src/store.rs`, `src/worker.rs`, `tests/service.rs`, `tests/worker_server.py`, `docs/lifecycle.md`. Scope: medium, up to five files.

### Checkpoint R-A

- [ ] The provider supports the tested idle/settings contract; migration preserves evidence and passes rollback checks.
- [ ] Review the provider limitations and schema diff with the owner before continuing.

### R03: report lifecycle state and Resume availability

- [ ] R03 complete.

Add the service's lifecycle and resume observations to permitted list/detail results. Use live ownership for running state and durable stop evidence for stopped state.

Acceptance:
- Starting, running, stopped, unknown and external remain distinct, with a valid generation or null. Window and capture observations remain separate.
- Resume availability explains unsupported kind, external ownership, removed registration, running/uncertain state, missing settings/thread/folder and forbidden access. Covers R5 and R9.
- After service restart, confirmed stopped records remain eligible where settings permit, while previously live or uncertain records remain blocked. Covers R2.

Verification: `cargo test --locked --test service`; Rust checks. Compare live, background, stopped, removed, external and interrupted records through the real service protocol, not only helper functions.

Dependencies: checkpoint R-A. Likely files: `src/service.rs`, `src/service/lifecycle.rs`, `src/store.rs`, `tests/service.rs`, `docs/lifecycle.md`. Scope: medium, up to five files.

### R04: start a new owned runtime for the saved thread

- [ ] R04 complete.

Extend worker startup with an explicit resume path separate from new-thread creation. Use R01's verified settings mapping and a fresh owned child and capture connection.

Acceptance:
- Resume uses the saved native thread ID and verifies the returned identity and idle state. It never falls back to start/fork or sends a task. Covers R1 and R5.
- Provider waits run outside the main service loop under existing deadlines. Invalid responses, missing settings or unsafe automation produce failures rather than permissive fallback.
- The adapter reports the new runtime and capture metadata without pretending a stored PID is ownership or rewriting the old launch inputs.

Verification: add focused worker tests with the controlled provider; `cargo test --locked --lib worker`; `cargo test --locked --test service`; Rust checks. Include wrong-thread and active-on-resume responses. The worker test filter is to be populated by this task, not treated as success if it runs zero tests.

Dependencies: R03. Likely files: `src/worker.rs`, `src/codex.rs`, `tests/worker_server.py`, `tests/service.rs`. Scope: medium, up to four files. This is a bounded prerequisite for the public operation in R05.

### Checkpoint R-B

- [ ] Lifecycle observations and the saved-thread adapter pass the supported and refusal cases without changing existing creation behavior.
- [ ] Review the ownership/settings evidence with the owner before exposing Resume.

### R05: expose one owner-only Resume operation

- [ ] R05 complete.

Connect the adapter to the service lifecycle state machine with an immutable request ID, expected generation and atomic per-Vessel operation claim.

Acceptance:
- The owner can resume an eligible stopped conversation through the service; non-owner requests refuse. The logical Vessel/thread stays the same and the new runtime starts without a viewer or task. Covers R1, R7 and R9.
- Repeated identical requests return their receipt; changed inputs conflict; concurrent different requests cannot start two runtimes. Covers R3.
- Completion requires live ownership, idle saved thread, fresh identity credentials and connected capture. Failure or uncertainty preserves the actual outcome.

Verification: `cargo test --locked --test service`; `cargo test --locked --test authority`; Rust checks. Use races and disconnects through the service boundary, including a stale generation and a docked non-owner caller.

Dependencies: checkpoint R-B. Likely files: `src/service/lifecycle.rs`, `src/actions.rs`, `src/service.rs`, `src/authority.rs`, `tests/service.rs`. Scope: medium, up to five files.

### R06: expose Resume through the CLI and current capabilities

- [ ] R06 complete.

Add the narrow owner CLI request and reflect the service's permission decision in capabilities. Keep ordinary Vessel callers unable to resume other or former runtimes.

Acceptance:
- Document an explicit CLI command carrying session ID, request ID and expected generation. It retrieves pending/final receipts without replaying startup and uses existing error envelopes.
- Old runtime credentials and expired temporary grants refuse; no docking, rank or assignment creates an owner permission. Covers R7.
- Open remains a separate operation. No private assistant tool is added in this first implementation; the specification permits but does not require one.

Verification: `cargo test --locked --test authority`; `cargo test --locked --test service`; Rust checks. Exercise valid owner CLI input, invalid generation, old identity and non-owner capability output.

Dependencies: R05. Likely files: `src/bin/voyager.rs`, `src/service/authority_ops.rs`, `tests/authority.rs`, `tests/service.rs`, `docs/service.md`. Scope: medium, up to five files.

### Checkpoint R-C

- [ ] The owner service/CLI journey works, rejects stale or unauthorized requests, and leaves existing actions working.
- [ ] Review the permission and idempotency evidence with the owner before failure hardening.

### R07: preserve uncertain outcomes and reject old capture events

- [ ] R07 complete.

Exercise the full operation under client loss, service interruption and delayed events. Repair only the owning boundaries exposed by those tests.

Acceptance:
- A disconnected client can retrieve the service's completed result. Service termination before a final outcome leaves the operation uncertain after restart; neither lookup nor a new request ID replays it. Covers R4.
- New capture uses a fresh generation. Late old events and loaded historical turns cannot create fresh task completions. Covers R8.
- A failed Open leaves the resumed runtime running. Unknown state never triggers automatic restoration, and unrelated processes remain untouched. Covers R6 and R9.

Verification: `cargo test --locked --test service`; Rust checks. Control the failure points with the provider fixture, retain final receipts across restart, and include an unrelated live process as the negative control.

Dependencies: checkpoint R-C. Likely files: `src/store.rs`, `src/service/lifecycle.rs`, `src/worker.rs`, `tests/service.rs`, `tests/worker_server.py`. Scope: medium, up to five files.

### R08: prove the complete resume journey with real Codex

- [ ] R08 complete.

Extend the opt-in test from R01 to use the actual Voyager service and CLI. Verify fresh creation, explicit stop, resume and separate viewer opening on disposable records.

Acceptance:
- R1-R9 have evidence at the appropriate level. The real test proves saved context, unchanged Vessel/thread, new runtime/credentials, verified settings and idle-before-query, including resume after a confirmed stop and service restart.
- Viewer failure and subsequent Open use the same resumed runtime. Historical and late events do not duplicate work, and assignments/Fleet placement remain unchanged.
- Record executable/provider identities and timings, clean up only owned test resources, and update the lifecycle documentation with actual supported behavior and limits.

Verification: the plan's `managed_resume_journey` ignored test and manual viewer check; Rust checks after harness changes. Preserve raw evidence outside Git.

Dependencies: R07. Likely files: `tests/native_resume.rs`, `docs/lifecycle.md`, `docs/service.md`. Scope: medium, up to three files.

### Checkpoint R-D

- [ ] Resume meets R1-R9, with real-provider evidence and no unproved claim of recovery or global thread uniqueness.
- [ ] Review the result with the owner before building the dependent panel journey.

## Current-work panel

Governing spec: [current-work-panel](../SPEC-current-work-panel.md).

### P01: place each agent in the right group

- [ ] P01 complete.

Replace registration-only filtering with the approved service-state categories. Keep running background agents and removed-but-running agents accessible.

Acceptance:
- Every approved category has one actionable row in the correct location, including Unregistered and disconnected external agents. Covers P1 and P5.
- Lost/stale service observations produce a persistent warning and disable actions needing fresh state, without declaring agents stopped. Older services show Resume unavailable. Covers P7.
- Show an accurate contextual supervisor label when the captain is outside the visible set, without a duplicate movable row. Filtering writes no assignment, Fleet, registration or history changes. Covers P6.

Verification: `node --test desktop/test/renderer.test.cjs desktop/test/hierarchy.test.cjs`; desktop checks. Include the old stopped-but-visible row as the comparison and a removed running record that would otherwise match the general running rule.

Dependencies: checkpoint R-D. Likely files: `desktop/src/ui/renderer.js`, `desktop/src/ui/hierarchy.js`, `desktop/test/renderer.test.cjs`, `desktop/test/hierarchy.test.cjs`, `docs/fleets.md`. Scope: medium, up to five files.

### P02: make previous agents fit and scroll naturally

- [ ] P02 complete.

Add the collapsed count, bounded history area, small local batches and Load more using the panel's existing measured layout.

Acceptance:
- A short list fits naturally; a longer list scrolls within available height without hiding other controls or growing beyond the display. Removed records follow the same behavior. Covers P2 and P9.
- Ordering is stable, missing activity timestamps are explicit, Load more preserves position, and expanding history starts no process.
- Keyboard, wheel and trackpad scrolling work; the scrollbar is subtle but discoverable and the focused row remains visible. Covers P8.

Verification: `node --test desktop/test/renderer.test.cjs`; desktop checks; real-panel checks at constrained width/height and with short/long lists. Record the chosen batch-sizing behavior rather than reintroducing an arbitrary 50-row target.

Dependencies: P01. Likely files: `desktop/src/ui/renderer.js`, `desktop/src/ui/style.css`, `desktop/src/ui/index.html`, `desktop/test/renderer.test.cjs`, `docs/fleets.md`. Scope: medium, up to five files.

### Checkpoint P-A

- [ ] Categories, bounded history and keyboard behavior pass, with stored records unchanged by disclosure.
- [ ] Review the actual panel interaction with the owner before adding Resume controls.

### P03a: expose a narrow desktop Resume call

- [ ] P03a complete.

Add a narrow preload/main-process call for Resume and use the existing lifecycle receipt flow. Keep the renderer limited to this named operation.

Acceptance:
- Validate session, request and expected generation, then call the service's Resume operation. Repeated intent retrieves the same receipt rather than generating another request. Supports P3-P4.
- Preserve known failure, pending and uncertain outcomes for the UI. Do not convert a missed reply into a fresh startup or invent eligibility.
- Existing Open remains a separate call. The renderer cannot invent permissions or issue arbitrary service requests.

Verification: `node --test desktop/test/instances.test.cjs`; desktop checks. Test stale eligibility, duplicate calls and receipt retrieval against the service contract.

Dependencies: checkpoint P-A. Likely files: `desktop/src/instances.cjs`, `desktop/src/preload.cjs`, `desktop/src/main.cjs`, `desktop/test/instances.test.cjs`. Scope: medium, up to four files.

### P03b: keep the same row through Resume and Open

- [ ] P03b complete.

Use the new desktop call to show the complete user journey without treating submission as success.

Acceptance:
- Eligible history offers Resume; it uses one request ID and moves the same Vessel row to Resuming. After success, refresh live state before sending the separate Open request. Covers P3.
- Double clicks, stale eligibility and lost replies cannot create a second runtime. Uncertainty goes to Needs attention; a failed Open offers another Open, not another Resume. Covers P4.
- Keep useful keyboard focus and a readable reason through each state change.

Verification: `node --test desktop/test/renderer.test.cjs`; desktop checks; focused real-service panel journey before P05's complete proof.

Dependencies: P03a. Likely files: `desktop/src/ui/renderer.js`, `desktop/test/renderer.test.cjs`. Scope: small, up to two files.

### P04: make saved details and history readable

- [ ] P04 complete.

Add a narrow preload/main-process read call to the existing bounded event API. Make permitted details/history accessible even when a main action is disabled.

Acceptance:
- Details show safe text, bounded event history, gaps and unavailable periods. No captured events is not labelled no work. Covers the history requirements of P2 and P8.
- The new read call validates the requested Vessel and cursor/limit and retains service read permissions. It exposes no arbitrary RPC or file access.
- Showing details, history or filtered groups does not move a branch, clear descendant Fleet membership or change authority.

Verification: `node --test desktop/test/renderer.test.cjs desktop/test/hierarchy.test.cjs`; desktop checks. Use hostile-looking text as data, an empty/gapped capture and a worker with separately assigned Fleet location.

Dependencies: P03b. Likely files: `desktop/src/main.cjs`, `desktop/src/preload.cjs`, `desktop/src/ui/renderer.js`, `desktop/test/renderer.test.cjs`, `docs/fleets.md`. Scope: medium, up to five files.

### Checkpoint P-B

- [ ] Panel Resume, failure states, readable details and supervisor context pass through the service boundary.
- [ ] Review the interaction and state evidence with the owner before final live acceptance.

### P05: prove the panel with the candidate service

- [ ] P05 complete.

Extend the existing panel lifecycle proof for real Codex resume, removed running agents and service loss. Complete physical input and display checks that a simulated renderer cannot prove.

Acceptance:
- P1-P9 have evidence, including real service/panel runs for P3, P5 and P7. Reconnection updates existing IDs without duplicate rows.
- Disclosure-only actions leave assignments, registration and event counts unchanged. Keyboard focus, internal scrolling and usable small displays are demonstrated.
- Screenshots establish presentation; service receipts and process observations establish lifecycle. Record both and clean up only this test's resources.

Verification: the plan's panel command after extending its script; `node --check desktop/test/service-lifecycle-proof.cjs`; desktop checks; manual keyboard, pointer, wheel and trackpad trials.

Dependencies: checkpoint P-B. Likely files: `desktop/test/service-lifecycle-proof.cjs`, `desktop/README.md`, `docs/fleets.md`. Scope: medium, up to three files.

## Combined candidate

### F01: verify the packaged journeys and prepare the review

- [ ] F01 complete.

Build the integrated candidate, package it and repeat the required journeys using the packaged app and its bundled service in fresh private state. Update actual-status documentation from the results.

Acceptance:
- All 33 specification cases have evidence linked to the selected revision, with the approved timing targets met and no unresolved required case hidden by a fixture pass.
- Packaged docking, private voice, saved-conversation resume and panel journeys work together. Evidence identifies installed-style executable paths, versions, display/audio setup and cleanup outcomes, without claiming installation occurred.
- The review describes observed results, limits and rollback requirements. The installed app/service and main branch remain unchanged until separate authorization.

Verification: full Rust and desktop checks, `npm --prefix desktop run package:linux`, then the plan's packaged real journeys. A failure returns to the owning task; it is not waived at this checkpoint.

Dependencies: P05 and all preceding capability checkpoints. Likely files: `README.md`, `docs/desktop.md`, `docs/harness-runtime.md`, `docs/lifecycle.md`, `docs/fleets.md`. Scope: medium, up to five documentation files; raw evidence stays outside Git.

### Checkpoint final

- [ ] P05 and F01 are verified; all task acceptance criteria and the project's Definition of Done are met at their applicable level.
- [ ] Review the result with the owner. Merge, installation, service restart and release remain separate decisions.
