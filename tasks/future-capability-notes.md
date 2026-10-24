# Reference notes for later capabilities

Status: Planning reference only, 24 October 2026. These notes preserve useful investigation and design candidates from the superseded combined plan. They are not an approved implementation plan or an active task list. Recheck the source and provider version before using them.

The active [plan](plan.md) and [task list](todo.md) cover docking recovery only. After docking is complete and reviewed, plan [voice handoff](../SPEC-voice-handoff.md), then [conversation resume](../SPEC-conversation-resume.md), then the [current-work panel](../SPEC-current-work-panel.md), in the approved order. Each capability gets its own planning and review cycle. Implementation slices are tasks inside that capability's plan, not additional plans.

The earlier combined plan and its task breakdown remain in Git history. None of its tasks was executed or completed. Do not treat its old task IDs or future test commands as an active build queue.

## Source findings to recheck

- `src/service/conversation.rs` disables delegation acknowledgement and receives native turn/item events. The existing UI owns microphone and playback.
- `src/worker.rs` creates a fresh thread with permissive launch defaults. The store links a Vessel to one worker launch; resume needs successive runtimes without rewriting launch evidence.
- `desktop/src/ui/renderer.js` filters mainly by registration. The preload bridge has no history-read method yet. Panel layout already measures actual content and caps its height to the display.

## Design candidates and evidence limits

### Voice

Enable `delegationAckFiller: true`, retain native automatic return and keep client-managed handoffs disabled. Carry the existing request, turn, item and voice-generation identifiers through public events. Validate events, preserve their actual completion status and suppress repeated or outdated announcements. Keep final text readable even when audio cannot play.

Do not use a timer to invent progress or introduce a separate model call to announce completion. If native delivery cannot meet the approved cases, stop at the voice checkpoint with the measured limitation and revise the design.

### Resume storage and process ownership

Propose one transactional schema migration after the current version 3:

| Record | Responsibility |
|---|---|
| Existing sessions | Keep the stable Vessel ID, saved native thread ID, name, rank, supervisor and capture generation. Update the current native endpoint only after the replacement runtime is validated. |
| Existing workers and launch operations | Retain the original launch inputs and attribution. Do not turn an old launch request into a new one or reuse its credentials. |
| New per-Vessel runtime records | Key each run by Vessel ID and runtime generation. Record its originating operation, observed start/stop state, endpoint and process evidence. Enforce at most one current or unresolved runtime attempt per Vessel. Stored PIDs remain evidence, never ownership. |
| New per-Vessel resume metadata | Store a versioned, nonsecret snapshot of verified effective settings and their source runtime/provider version. Missing evidence leaves Resume unavailable. |
| Existing operations and events | Retain immutable request inputs and saved receipts. Claim the operation and the Vessel's new runtime attempt in one transaction before spawning. Advance capture generation for the new connection so delayed old events cannot become new work. |

Keep the service's live process maps as the sole proof of ownership. On restart, previously confirmed stops remain confirmed. Previously running or unfinished starts become unknown or uncertain, not resumable. For a legacy record, assign a stable baseline generation only after matching trustworthy recorded stop/exit evidence and excluding a conflicting operation. Do not infer stop from a missing process lookup.

Persist settings when they are observed, not guessed from current defaults at resume time. Capture the effective working folder, model/provider, approval routing and sandbox or named permission profile, plus compatible workflow settings needed to reproduce the thread. Preserve fresh Voyager identity injection while retaining compatible user instructions. Store no credentials or copied transcripts in this metadata. If a profile has changed or its effective restrictions cannot be reproduced, refuse with a readable reason.

The migration must preserve older records and receipts, roll back on failure and reject an unsupported future schema before writes. Test against disposable database copies. Rolling back a binary after a schema upgrade is not enough: retain an untouched pre-migration database copy for any later authorized deployment, and never restore it over a live runtime or silently discard newer work.

### What is verified about Codex, and what still needs proof

The installed CLI reported 0.164.0 during planning. Generated experimental JSON schemas were inspected without starting a server. `ThreadResumeParams` accepts the saved thread ID and settings overrides. `ThreadResumeResponse` returns effective model, provider, working folder, approval policy/reviewer, sandbox and optional active permission profile. `thread/read` does not return that full effective-settings response, so it is not sufficient by itself to fill missing legacy metadata.

Use the saved `threadId` with `thread/resume`; do not use a new thread, fork, replacement history or rollout-path override as a fallback. `excludeTurns: true` limits returned history; it does not prove that persisted automation is disabled. The [official app-server documentation](https://learn.chatgpt.com/docs/app-server) describes resume and read as separate operations and documents persisted goals. A future resume feasibility check must prove settings preservation and idle behavior with the installed provider before the product resume path is built. If a goal or automation cannot be checked without starting work, that record is unsupported for this increment. Do not clear the goal or increase permissions to make it pass.

The generated schema also retains the acknowledgement and native handoff controls used by the voice design. These observations establish protocol fields, not successful runtime behavior. Preserve versioned evidence and rerun the checks if the provider changes before implementation.

### Panel

Use the new service lifecycle and resume observations for classification. Handle removed-but-running records as Unregistered before applying the general running presentation, so the more specific approved rule is not hidden by the broader one. A service disconnect makes existing rows last-known information rather than stopped agents.

Keep Previous agents collapsed initially. Measure the space left for its history area; let short lists fit naturally and long lists scroll internally. Size small local batches for that area, keep Load more reachable, and preserve focus and scroll position. Do not grow the native window by total record count or add a server paging API. Details need a new narrow desktop call to the existing bounded service event reads; the current preload bridge has no history call. Use safe text rendering and explicit gap labels.

The panel submits one Resume request, retrieves its receipt using the same ID, refreshes runtime state, and only then sends a distinct Open request. A failed window open cannot start another runtime. Filtering must not write assignments or Fleet locations.

## Verification material to reuse when planning

The existing conversation proof is `desktop/src/conversation-proof.cjs`, selected by `--proof-conversation`. It uses silent playback, so a later voice plan still needs heard or recorded audio and real microphone interruption evidence. The acknowledged request and the result must be correlated; a silent fixture pass is not audible acceptance.

Resume needs a dedicated opt-in real-provider test. Preserve the distinction between a provider-only check of saved settings and idle behavior, and a later full Voyager service/CLI journey. The earlier draft suggested `tests/native_resume.rs`, but that file and its commands do not exist yet. Schema generation during investigation did not start a provider or prove resume behavior.

The existing owner-run `desktop/test/service-lifecycle-proof.cjs` is a starting point for panel tests, not proof of the new behavior. A future panel plan must add real saved-conversation resume, removed-but-running agents and reconnect checks. Add a narrow desktop history call to the existing bounded service API rather than an arbitrary RPC interface.

Keep later plans focused on complete behaviors. For resume, avoid a long sequence of database, adapter and API tasks that cannot demonstrate a usable path until the end. A bounded provider experiment may precede implementation because it resolves whether the approved behavior is possible. Then deliver the smallest supported resume journey before extending failure handling and compatibility.

After all capabilities are complete, plan a combined packaged check across docking, voice, resume and panel behavior. That future integration review does not authorize installation, main-service restart or release.
