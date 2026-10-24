# Plan: reliable everyday use of Voyager

Status: Draft for review, 24 October 2026. The four specifications are approved. This plan and its tasks are not yet approved for implementation.

## What this plan delivers

Make docking recoverable, make private voice acknowledge requests and return their results, let the owner resume a saved conversation safely, and make the panel show current work before previous agents. Keep the existing Rust service, Electron client and native terminals.

This is one active plan for the four capabilities in [SPEC.md](../SPEC.md). The [task list](todo.md) holds the detailed tasks and completion checkboxes. The first capability to build is docking recovery. No task has started.

| Order | Governing specification | Tasks | Result to demonstrate |
|---|---|---|---|
| 1 | [Docking recovery](../SPEC-docking-recovery.md) | D01-D04 | A valid dock is visible and audible; a failed or lost target leaves the controls accessible. |
| 2 | [Voice handoff](../SPEC-voice-handoff.md) | V01-V04 | The owner hears acknowledgement and the actual result, with readable history if audio fails. |
| 3 | [Conversation resume](../SPEC-conversation-resume.md) | R01-R08 | Resume opens the same saved conversation in a new owned runtime, idle and with verified settings. |
| 4 | [Current-work panel](../SPEC-current-work-panel.md) | P01-P05 | Running agents stay accessible; previous agents have useful history and a truthful Resume action. |
| 5 | All four | F01 | The packaged candidate passes the combined journeys without changing the installed app. |

The builder reads the selected task, its governing specification and its listed source files. It must not choose a spec by modification date or treat the index as the complete requirements.

## What the source inspection established

Planning uses the product source on the [specification branch](https://github.com/isaacasamoah/voyagershellapp/pull/24). Its documentation revisions clarify the specifications without changing product code. Before implementation, record the chosen revision and confirm these boundaries still apply.

- [Docking](../desktop/src/main.cjs) can hide the avatar inside `placeAboveTerminal()` and return without proving visible placement. The caller can then reach the success-sound path. Drop also contains an implicit external registration call. [Binding](../desktop/src/binding.cjs) already checks process start identity and window matching, so extend that boundary rather than creating another discovery system.
- [Private conversation](../src/service/conversation.rs) disables delegation acknowledgement and already receives native item and turn events. [The conversation UI](../desktop/src/ui/conversation.js) owns microphone and playback. Keep native result delivery rather than building a second announcer.
- [Worker startup](../src/worker.rs) always calls `thread/start` with permissive launch defaults. It cannot be reused unchanged for resume. [The store](../src/store.rs) has one worker launch per Vessel, durable operation receipts and separate capture generations. Resume needs a record of successive runtimes without rewriting original launch inputs.
- [The panel](../desktop/src/ui/renderer.js) filters primarily by registration. [Its layout](../desktop/README.md#vessels-and-fleets) already measures rendered content and scrolls at the display limit. Use those mechanisms for bounded history rather than estimating window size from agent count.
- The separate [desktop startup fix](https://github.com/isaacasamoah/voyagershellapp/pull/23) was still open when planning. Do not silently merge it into this work. Native tests must pass `--ozone-platform=x11` at Electron process startup and record the actual display backend. Decide any integration of that PR explicitly.

No app, service, microphone, model task or native test was launched while preparing this plan.

## Implementation choices for review

### Docking

Use one eligibility function for hover and drop. It returns checking, ready or refused with a reason, using the existing service observations and verified process/window identity. It must not depend on the new resume API, which is built later. The service still grants control; desktop checks do not grant rights.

Make placement return a result that distinguishes visible placement, failure and replacement by a newer attempt. Only visible placement for the accepted current attempt permits the success sound. Reuse the current generation checks to reject late replies. Recover to the floating avatar on target loss, and make Applications recovery independent of the terminal.

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

Use the saved `threadId` with `thread/resume`; do not use a new thread, fork, replacement history or rollout-path override as a fallback. `excludeTurns: true` limits returned history; it does not prove that persisted automation is disabled. The [official app-server documentation](https://learn.chatgpt.com/docs/app-server) describes resume and read as separate operations and documents persisted goals. R01 must prove settings preservation and idle behavior with the installed provider before the product resume path is built. If a goal or automation cannot be checked without starting work, that record is unsupported for this increment. Do not clear the goal or increase permissions to make it pass.

The generated schema also retains the acknowledgement and native handoff controls used by the voice design. These observations establish protocol fields, not successful runtime behavior. Preserve versioned evidence and rerun the checks if the provider changes before implementation.

### Panel

Use the new service lifecycle and resume observations for classification. Handle removed-but-running records as Unregistered before applying the general running presentation, so the more specific approved rule is not hidden by the broader one. A service disconnect makes existing rows last-known information rather than stopped agents.

Keep Previous agents collapsed initially. Measure the space left for its history area; let short lists fit naturally and long lists scroll internally. Size small local batches for that area, keep Load more reachable, and preserve focus and scroll position. Do not grow the native window by total record count or add a server paging API. Details need a new narrow desktop call to the existing bounded service event reads; the current preload bridge has no history call. Use safe text rendering and explicit gap labels.

The panel submits one Resume request, retrieves its receipt using the same ID, refreshes runtime state, and only then sends a distinct Open request. A failed window open cannot start another runtime. Filtering must not write assignments or Fleet locations.

## Order and checkpoints

Execute sequentially in the approved capability order. Docking and voice have no logical dependency on the new resume API, but they share desktop behavior and need separate live acceptance. The panel's complete Resume journey depends on R08. This plan does not select parallel agents or a Fleet.

| Group | Depends on | Human checkpoint |
|---|---|---|
| D01-D02 | Approved plan | Shared eligibility and truthful placement pass focused tests. |
| D03-D04 | Docking checkpoint 1 | Real docking/recovery, both viewers and audible timing pass. |
| V01-V02 | Docking complete | Acknowledgement and event association pass controlled tests. |
| V03-V04 | Voice checkpoint 1 | Real audible delivery, interruption and routing pass. |
| R01-R02 | Voice complete | Provider feasibility evidence and reversible storage change reviewed. R02 waits for R01's provider result. |
| R03-R04 | Resume checkpoint 1 | Eligibility and the saved-thread startup adapter pass controlled tests. |
| R05-R06 | Resume checkpoint 2 | The owner can call the complete service/CLI operation; other callers cannot. |
| R07-R08 | Resume checkpoint 3 | Failure recovery and real saved-conversation resume pass. |
| P01-P02 | Resume complete | Categories and bounded history are usable and preserve records. |
| P03a, P03b and P04 | Panel checkpoint 1 | Resume-and-open and readable details work through the panel. |
| P05 and F01 | Panel checkpoint 2 | Real panel and packaged combined journeys pass; ready for merge/release review. |

Every checkpoint in [todo.md](todo.md) includes a human review before the next group. No task is complete merely because its command was accepted or its tests compiled. Use the existing skill's task verification and the project's Definition of Done; this plan does not change the build skill's commit or completion procedure.

## Verification commands

Run from the selected checkout root. These commands are for future implementation; they were not run as behavior tests during planning.

**Rust checks** after Rust changes:

```sh
cargo build --locked --bins
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

**Desktop checks** after desktop changes:

```sh
npm --prefix desktop ci
npm --prefix desktop run format:check
npm --prefix desktop test
```

The task list adds focused commands. At checkpoints, run both applicable suites and the relevant real journey. Show that each new regression test fails with the old behavior or a deliberately invalid test setup. Do not lower a target or skip a required journey to report a pass.

### Real desktop setup

Run only after approval of the relevant task and its real-surface test. Use an ordinary authorized owner terminal for the commands below. A bound Voyager instance must instead retain its identity and use the scoped development-run route in [development-tests.md](../docs/development-tests.md). Never unset identity or use an owner RPC fallback to get a test running. If the existing runner cannot execute a required proof, record that limit and arrange the owner-run test; do not silently widen its permissions.

Build the checkout first. Use a fresh private state directory for each trial, keep it short enough for Unix socket paths, and run the candidate service and Electron from that same checkout. Example owner setup:

```sh
VOYAGER_TRIAL_STATE=$(mktemp -d /tmp/voyager-trial-XXXXXX)
export VOYAGER_TRIAL_STATE
./target/debug/voyager --state "$VOYAGER_TRIAL_STATE" start
```

Do not run this against installed state. The service may start its private provider runtime; real proofs can use model/account resources, microphone and desktop focus. An isolated directory does not isolate those resources.

**Docking:** D04 extends the existing polish proof for D1-D7 and timing observations. After it exists, run each viewer in a separate fresh trial:

```sh
VOYAGER_STATE="$VOYAGER_TRIAL_STATE" VOYAGER_PROOF_TERMINAL=xterm \
  ./desktop/node_modules/electron/dist/electron --ozone-platform=x11 ./desktop --expanded --proof-polish
```

Repeat with `VOYAGER_PROOF_TERMINAL=ghostty`. Use actual dragging, covering/minimising, workspace changes and Applications recovery as specified. For the Applications test, use a separately named temporary candidate launcher whose command retains this candidate executable and state directory; the installed Voyager launcher would exercise the wrong build. Record audio output or have the owner confirm the sound. The existing proof's silent input and scheduled audio are not sufficient.

**Voice:** V04 extends the existing conversation proof. Set `VOYAGER_TRIAL_AUDIO` to a disposable spoken test-request WAV and record the actual input/output devices:

```sh
VOYAGER_STATE="$VOYAGER_TRIAL_STATE" \
  VOYAGER_CONVERSATION_PROOF_DIR="$VOYAGER_TRIAL_STATE" \
  VOYAGER_CONVERSATION_PROOF_AUDIO="$VOYAGER_TRIAL_AUDIO" \
  ./desktop/node_modules/electron/dist/electron --ozone-platform=x11 ./desktop --expanded --proof-conversation
```

Then run the same candidate manually with `--expanded` and no proof flag for live microphone interruption and audible delivery. The current automated proof silences playback. V04 must retain automated ordering evidence and add heard or captured output evidence rather than call silent playback acceptance. Test acknowledgement disabled as the comparison case.

**Resume:** R01 and R08 add two ignored tests in a new `tests/native_resume.rs`. These are planned test names, not available commands yet:

```sh
VOYAGER_RESUME_PROOF_DIR="$VOYAGER_TRIAL_STATE" \
  cargo test --locked --test native_resume provider_resume_contract -- --ignored --nocapture
VOYAGER_RESUME_PROOF_DIR="$VOYAGER_TRIAL_STATE" \
  cargo test --locked --test native_resume managed_resume_journey -- --ignored --nocapture
```

Each test uses a separate fresh directory and only its own disposable processes. The provider-contract test needs no Voyager service from the setup above. The managed-journey test starts its own candidate service. Do not start a second service in the same directory. The tests must record idle-before-query, saved settings and identity, then send the explicit marker-check query. Failure cleanup must not kill an unverified process.

**Panel:** P05 extends the existing owner-run panel lifecycle script to cover P3, P5 and P7, including Codex resume. It must pass X11 at process startup:

```sh
VOYAGER_PANEL_LIFECYCLE_DIR="$VOYAGER_TRIAL_STATE" \
  node desktop/test/service-lifecycle-proof.cjs
```

This script manages its own service setup; use a fresh directory without the service-start command above. The existing script alone does not prove the new cases. Complete keyboard, wheel/trackpad, short-display and scrollbar checks with the real panel.

For each proof, record the source revision, executable paths and hashes, provider version, display backend, observed identities, timestamps, verdict and limits. Keep raw captures outside Git. Each harness records its own created resources and cleans them up through verified lifecycle operations. Inspect cleanup receipts; a finished runner is not proof that the journey passed. Never delete evidence or kill unrelated processes to clean up a failed run.

### Final packaged check

F01 runs `npm --prefix desktop run package:linux`, then uses the resulting packaged executable and bundled Rust binary against fresh private state. Repeat the required journeys on those exact executables. Record their paths/hashes in the evidence. Do not install the bundle, enable startup, restart main or merge automatically. Those remain separate owner decisions.

## Risks and remaining decisions

| Risk | How the plan handles it |
|---|---|
| A saved thread resumes with different permissions or starts persisted work | R01 proves the supported cases before product resume code. Unknown settings or unsafe automation make a record ineligible; no permissive fallback. |
| A new runtime overwrites original launch evidence | Separate runtime generations from immutable launch inputs; migrate transactionally and test legacy records. |
| Lost replies cause duplicate starts or speech | Stable operation/item IDs, service-owned receipts, explicit generation checks and failure tests. |
| The current display setup makes a good candidate invisible | Explicit X11 startup and executable evidence. Keep the separate startup PR visible as an integration decision. |
| Automated tests pass but sound, focus or scrolling is wrong | Require the specified real microphone, audio, pointer and panel checks at capability checkpoints. |
| History resizing causes jumps or nested scrolling problems | Test short displays, focused rows and Load more in the real panel before accepting the interaction. |

No new product decision is needed to write this plan. Before accepting R01, resolve the exact supported settings/profile combinations and how to detect unsafe persisted automation without starting it. Before live trials, identify the authorized caller and actual audio/display setup. These are explicit checks, not assumptions that the feature already works.

The approved local targets remain 19 of 20 docking trials audible within two seconds, 19 of 20 recovery trials visible within one second, and 19 of 20 successful voice requests acknowledged within one second of detected speech end and answered aloud within two seconds of backing-turn completion. All trials must meet the correctness requirements. These targets are acceptance requirements, not measurements already achieved.
