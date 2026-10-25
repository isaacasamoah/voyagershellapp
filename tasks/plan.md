# Plan: return to a stopped conversation

Status: owner approved build, 25 October 2026. Execute in dependency order with
one independent review, at most one corrective pass, and another review per increment. Governing [specification](../SPEC-conversation-resume.md).
The [task list](todo.md) owns completion. Follow [CONSTRAINTS.md](../CONSTRAINTS.md)
and the installed application-proof reference.

## What the owner will be able to do

Select a previously managed, confirmed stopped Codex conversation and resume its
saved history under the same Voyager identity. It starts idle. Opening a terminal
and sending a new instruction remain separate actions. Unknown state never means
stopped. Missing or unverifiable settings keep Resume unavailable with a reason.

This planning branch starts from the merged docking baseline and the reviewed
build rules. The voice integration must be incorporated before implementation so
this branch uses the accepted shared desktop runner. The unfinished voice plan
remains in its existing branch; this plan does not close or replace those tasks.

## Source findings and decisions

The current worker starts a new thread and supplies permissive settings directly.
It cannot be reused unchanged for Resume. The store currently links one worker
launch to one logical session, so another run needs separate records.

Use one transaction after schema version 3 to add runtime records keyed by
Vessel ID and runtime generation, plus versioned nonsecret resume settings.
A generation identifies one run of the same agent. Preserve original workers,
launch inputs, operation receipts and events. Do not rewrite an old launch as a
new one. Record each runtime attempt's operation, state and endpoint. Admit at
most one current or unresolved attempt for a Vessel in the same transaction
that records its immutable request. An interrupted attempt consumes its generation;
it must not become eligible merely because its process cannot be found.

Save verified effective settings when observed: working folder, model/provider,
approval policy/reviewer, sandbox or named permission profile, and compatible
workflow settings. Include their provider/version provenance. Store no credentials
or copied conversation content. Legacy records get a stable baseline generation
only after recorded stop evidence and absence of conflicts are verified. Otherwise
keep them inspectable and explain why Resume is unavailable.

The live child process, not a stored PID, proves ownership. Reuse the existing
credential issuer, which revokes the old credential before issuing another.
Keep current valid assignments and Fleet placement. A new event-capture generation
must reject delayed events from the previous connection.

## Gate A: verify the provider before product implementation

The generated Codex 0.164.0 schema accepts a saved thread ID and returns effective
settings. Its resume response includes an optional active permission profile.
The [official app-server documentation](https://learn.chatgpt.com/docs/app-server)
separates reading, resuming and starting work, and says a named permission profile
must not be combined with the legacy sandbox field. Use the saved thread ID;
never replace it with a new thread, fork, supplied history or rollout-path override.

`excludeTurns` controls returned history. It does not establish idle behaviour.
[Persisted goals can continue work](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex),
so the first task must verify safe inspection and idle loading before any product
resume path is built. If the installed provider cannot establish that a saved
conversation will remain idle without changing its goal or permissions, report
that limitation and stop for a design decision. Do not silently disable the goal.

Record the exact settings mapping and transactional migration in docs/lifecycle.md
at this checkpoint. The native settings/idle result is currently unproved. This
plan is not an implementation-ready claim about that capability.

## Ordered work

### R00: prove that a saved conversation can be reopened idle

Use a disposable provider conversation with a saved marker and non-default
restrictive settings. Reopen the same thread, inspect returned settings, and
observe that no turn starts until an explicit new instruction. Separately test a
saved active goal and missing settings. Keep this bounded experiment with the
application's maintained proof code; do not build a second application runner.

Acceptance: the thread identity and effective settings match; idle behaviour is
observed; unsafe or unsupported cases refuse without a substitute conversation.
Verification: compare against a deliberately changed setting or unexpected turn.
Likely files: a focused native-provider journey, the existing provider fixture,
and docs/lifecycle.md. Scope: small. Dependency: approved plan. Gate A must pass.

### R01a: show reliable runtime observations and retain verified settings

Save observed effective settings when a new managed Codex starts, together with
provider executable/version provenance. Add the transactional runtime ledger and
list/detail lifecycle observations. Existing stopped legacy records remain
inspectable; settings that cannot be verified leave Resume unavailable.

Acceptance: running requires a live owned child; confirmed stops remain stopped
after restart; unknown ownership never becomes stopped or eligible. Original launch
records and history remain unchanged. Verification: focused service-boundary cases
for creation, confirmed stop, restart and legacy missing settings. Likely files:
`src/store.rs`, `src/worker.rs`, `src/service.rs`, `src/codex.rs`,
`tests/service.rs` and `tests/worker_server.py`. The extra transport field retains
the provider version returned by initialize, avoiding a second version process.
Scope: four production files and two existing fixtures for one observable behaviour.
Dependency: R00 and its independent review. No Resume action is exposed yet.

### R01b: resume one verified stopped conversation through the owner service API

Add the owner-only request, atomic request/generation admission and the fresh
provider startup mode. Inspect the saved goal before loading, reject unsupported
settings, and verify the saved thread and idle state. Renew credentials/capture,
preserve name/assignments/Fleet placement and keep the viewer closed.

Acceptance: one new idle owned runtime under the same identity; failed or rejected
starts neither substitute a conversation nor grant broader access. Verification:
one focused service journey and named refusal cases, corroborated by R00.
Source map: runtime-ledger methods in `src/store.rs`, new startup mode in
`src/worker.rs`, operation admission/completion in `src/service/lifecycle.rs`,
request routing in `src/service.rs` and owner-only policy in `src/authority.rs`.
Focused service/provider fixtures supply the boundary cases. This is five production
files plus the two existing fixtures for one end-to-end service operation; do not
add unrelated UI/CLI or rank-policy work. If the diff approaches 1,000 changed
lines, simplify or use a native PR stack with R01a as the preceding reviewable
behaviour. Dependency: R01a. Covers core R1/R5/R7/R9.

### R02: resume through the CLI, then open the same running agent

Expose the owner command with request ID and expected generation. Retrieve the
saved operation result, then use the existing Open command independently. Verify
saved context by sending a new marker query only after the idle check.

Acceptance: the CLI reports the actual outcome; an Open failure leaves the agent
running; retrying Open or closing/reopening its viewer starts no second runtime
and submits no work. Verification: a named shared-runner `resume` journey using
real Codex and a deliberately failed viewer opening.
Likely files: src/bin/voyager.rs, desktop/test/native-proof.cjs, a small resume
journey, desktop/scripts/package-linux.cjs and docs/lifecycle.md. Scope: medium.
Dependency: R01b. Covers R1 and R6. Private voice-tool exposure is deferred.
Also test a runtime-only stop whose earlier terminal has not closed. Resume/Open
must not report that old window as attached to the new run. Resolve this through
a clear closed-viewer precondition or verified runtime-generation binding before
accepting the viewer journey. After the idle check, a new explicit marker query
and a read-only capabilities call must prove context recall and fresh bound
credentials, without printing credentials.

### R03: retain the right result through disconnects, repeats and service restart

Complete request deduplication, concurrent request exclusion and receipt recovery.
A lost client reply does not change an operation the service can still complete.
An interrupted service after a possible effect leaves uncertainty, not a retry.

Acceptance: duplicate requests create one runtime; confirmed stopped records can
resume after restart while uncertain records remain blocked; delayed old capture
and stale credentials cannot act as the new runtime. Verification: separate,
focused cases for each failure, not one long test that triggers all of them.
Likely files: src/store.rs, src/service/lifecycle.rs, tests/service.rs,
tests/worker_server.py and the shared resume journey. Scope: medium.
Dependency: R02. Covers R2-R4 and R7-R9. Reuse authority operations; changes to
rank policy need separate review rather than being added to this task unnoticed.

## Checkpoints, proof and review

After R00, review provider settings, idle evidence and the concrete storage/file
map before authorising product code. After R01-R02, demonstrate the whole owner
resume-and-open journey. After R03, run all R1-R9 cases on the selected package.
No production restart, automatic restoration or installation is part of this plan.

The planned real-app command, after the `resume` journey is implemented, is:

```sh
VOYAGER_PROOF_APP=/absolute/candidate/voyagershell \
  python3 desktop/test/run-native-proof.py /tmp/NEW_RESUME_STATE resume
```

This command is not available in the current runner yet. Use the normal desktop
session environment, preserve caller identity, record provider/build identities,
and retain native receipts and timings without credentials. Do not run parallel
pointer journeys on the same desktop. Test a selected app with its matching service.

Each test must name one behaviour and explain the failure it detects. Share
setup, keep files readable and avoid duplicate checks. Multiple assertions may
prove that behaviour. Inventory all tests and temporary helpers against the
production functions exercised, including normal regressions used for acceptance.
No source padding, compressed test strings or dropped assertions can meet the cap.

Rust changes require cargo fmt --check, cargo test --locked, and
cargo clippy --locked --all-targets -- -D warnings. Desktop changes require the
repository's desktop tests and format check. Build binaries before native proof.
Use a fresh independent review for each completed behaviour; propose the same
one-correction-and-re-review limit used in the voice trial. The owner approved this build. Preserve the explicit provider gate before product code.
