# Plan: current model settings and a compact Resume flow

Module order: conversation-resume, then current-work-panel. The owner approved
both revised specifications and the build/review/restart sequence on 26 October.
The owner approved the concrete C1–C3 breakdown on 26 October. The previous completed panel plan
remains in Git history. [Task list](todo.md). [Constraints](../CONSTRAINTS.md).

## What changes

New launch and Resume use current Codex model and effort settings. Changed config
fingerprints no longer block startup. YOLO remains the default. A previous Vessel
has one primary Resume action, with viewer choice and details in its secondary
menu. Removed vessels have a separate menu-selected view without a checkbox.

Keep identity, history, ownership checks, fresh credentials, immutable receipts,
idle Resume and separate Open operations. Do not change service authority,
restore uncertain processes, add a model-settings UI or install/merge this work.

## C1: resume with current model and effort

Start with a failing service regression for changed configuration and missing
historic settings. Read current project-aware model and effort at runtime startup
and apply them explicitly to new and resumed threads. Do not compare previous
configuration fingerprints. Validate the returned thread identity, effective
startup selection and idle state. Retain the current schema and historical records.

Keep YOLO for new launch and Resume. The owner approved removing the proposed
VOYAGER_CODEX_LAUNCH_MODE option during the C1 corrective pass. Permission-default
controls are deferred. Select YOLO explicitly for each native thread, including
when current Codex configuration or the stopped thread used narrower permissions.
Do not infer native trust policy or add a permissions editor.

Primary files: src/worker.rs, src/worker/settings.rs,
src/service/lifecycle/resume.rs, tests/worker_server.py, tests/service/resume.rs.
Read store/capture consumers before changing snapshot semantics. Update owning
lifecycle docs and the existing shared resume journey as necessary.

Prove current model/effort, default YOLO overriding old/current native permission settings,
known-different unrelated config edit, absent historic settings, preserved thread,
idle load and unchanged disconnect/uncertain-operation refusals. The real Codex
journey uses a private disposable configuration rather than editing the user's
global configuration. Independent Rust review follows the general review and new
BeautifulRust skills. One correction pass and re-review are allowed.

## C2: resume from one compact row

Depends on C1. Start with a failing renderer expectation. Keep the Vessel name
legible, show compact secondary metadata, put one Resume action in the row and
reuse its viewer choice. Move optional viewer selection and details into the
existing menu. Pending state announces Resuming, prevents duplicate submission,
and checks the original receipt. Preserve current operation identities and focus.

Primary files: desktop/src/ui/renderer.js, history.js, style.css,
desktop/test/renderer.test.cjs, desktop/test/resume-proof.cjs. Update owning docs.
Drive Resume and secondary choices through the actual candidate panel. Prove same
thread, no automatic task, single runtime, viewer failure recovery and keyboard
access. Review once, allow one correction pass, then re-review if required.

## C3: quiet history controls and local feedback

Depends on C2. Replace the history checkbox with a secondary menu action opening
Removed vessels and a Back to previous vessels action. Preserve normal ordering,
scrolling, batches and the caller's place. Switching views changes no registration.
Keep failures beside their Vessel across refresh, with full error/receipt details
available on demand. Keep service-connection warnings at panel level.

Primary files: desktop/src/ui/history.js, renderer.js, index.html,
desktop/test/renderer.test.cjs, desktop/test/panel-proof.cjs. Keep CSS changes in
its owner if needed. Prove exact included/excluded history membership, no checkbox,
keyboard operation, scrolling, failure refresh and unchanged service records.
Review once, allow one corrective pass, then re-review if required.

## Checks and restart

For Rust run cargo fmt --check, cargo test --locked and
cargo clippy --locked --all-targets -- -D warnings. For desktop run
npm --prefix desktop run format:check and npm --prefix desktop test. Build with
npm --prefix desktop run package:linux and use its exact app and bundled service
for the shared real-Codex panel/history journeys. Record native input limits.

Reuse maintained fixtures. Count all acceptance tests, shared helpers and one-off
proving code against the production code actually exercised. Keep each PR focused
and in the native GitHub stack if needed; use the existing five-part plain-language
PR description. Do not suppress checks or remove unrelated acceptance coverage.

After all slices pass review, inspect the live test service and active operations.
If idle with no owned work, close only the verified test app/service, retain its
closed-state backup and restart the exact reviewed package with the same short
persistent state path. If owner work is active, preserve it and arrange a handoff
before restarting. Leave one test app with visible controls and ready conversation.
The main app and The Climb preservation remain untouched.

## Parallel skills review

A separate reviewer audits the installed BeautifulRust wrappers, pinned originals,
references and project fit. Record the report in the canonical Obsidian home.
Add project instructions requiring rust-best-practices during Rust implementation
and rust-review alongside general review for current and future Rust builds.
Project rules and unchanged checks take precedence over upstream sample presets.
