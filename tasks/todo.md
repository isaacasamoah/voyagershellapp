# Tasks: voice acknowledgement and result handoff

Status: active, 25 October 2026. Docking merged and its completed tasks remain in
Git history. The owner approved this module's plan and the full build/review run.
The [plan](plan.md) owns the approach and commands; [the spec](../SPEC-voice-handoff.md)
owns V1-V8. No voice task is complete yet.

## Preparation: reuse the native proving fixture

- [x] Consolidate the active conversation and return-position journeys around one
  runner and shared input, waiting, evidence and cleanup. Preserve existing checks.
- [x] Demonstrate native parity and record before/after test-line counts. Commit
  the fixture refactor separately from behavior. Record remaining historical debt.

Likely files: desktop/test/native-proof.cjs, the existing conversation and
return-position journeys, and their launch wiring. Keep the shared API small.
Verification: existing native journeys, desktop tests and formatting. Dependencies:
none. This preparation changes test infrastructure, not product voice behavior.

Preparation evidence: 90 desktop tests and formatting pass. Fresh private
return-position and conversation journeys pass with matching launch/finish hashes
and clean app/service exit. The latter retains synthetic input and muted output.
The shared driver, launcher, two journeys and input/audio/manifest helpers total
562 physical lines. The review must map those costs to the exercised production
functions; this inventory alone is not a coverage claim.

## V01: hear acknowledgement and the inspection answer

- [ ] A real private voice inspection request produces a short acknowledgement and
  the actual result through Codex's native automatic handoff. The answer is readable.
- [ ] The acknowledgement-disabled comparison distinguishes missing acknowledgement
  from a slow answer. Record correlated native events and recorded output.
- [ ] Focused failing regression, full relevant checks, native journey and
  fresh-context review pass. At most one correction followed by re-review.

Likely files: src/service/conversation.rs, tests/conversation_server.py,
tests/conversation.rs and the shared native conversation journey. Dependencies:
fixture preparation. Keep client-managed handoffs disabled. Covers V1 and the
acknowledgement part of V2. Scope: one complete inspection journey.

## V02: receive truthful progress and one final outcome

- [ ] Slow work reports only observed progress. Refusal, failure, interruption and
  finishing without an answer remain distinguishable. No action is resubmitted.
- [ ] Duplicate native items produce one visible final item; native voice speaks
  it at most once. Preserve request/turn/item association and public messages only.
- [ ] Failing regressions, native failure comparison, relevant full checks and
  fresh-context review pass within the one-correction limit.

Likely files: private conversation service, UI, their existing tests and shared
journey. Dependencies: V01. Covers V2-V4. If native speech deduplication cannot be
proved, stop for the specified design decision rather than adding an announcer.

## Checkpoint V-A

- [ ] V01-V02 are proved and independently reviewed. Record audio content, timings,
  identity evidence, test budget and limitations before continuing.

## V03: keep results through interruption and reconnects

- [ ] Real microphone interruption defers speech. A newer request cannot receive
  an older request's answer as its own. Keep the earlier result in history.
- [ ] Disconnect/reconnect retires the old voice generation without replaying old
  audio or work. The backing runtime survives and its result remains readable.
- [ ] Delayed-event and lease tests, actual microphone/output journey and independent
  review pass within the one-correction limit. Unproved physical input stays open.

Likely files: existing service/client/UI voice path, its tests and shared journey.
Dependencies: V-A. Covers V4-V6. Scope: one interrupted request through recovery.

## V04: retain results when audio fails and preserve destinations

- [ ] Audio failure leaves the answer visible with useful feedback. The service
  remains responsive and the backing runtime continues.
- [ ] Private app, managed Codex and Bash select their existing voice destinations.
  A private answer never enters a Vessel conversation. No private auto-microphone.
- [ ] Focused failure tests, native routing journey, full relevant checks and fresh
  review pass within the one-correction limit.

Likely files: existing conversation UI/client, their tests and shared native journey.
Dependencies: V03. Covers V7-V8. Do not change native terminal voice policy.

## Final checkpoint

- [ ] Build the package and prove V1-V8 on its app and bundled service.
- [ ] Record all 20 delegated requests and meet the approved audible timing targets.
  Report speech-detection delay and excluded human-speaking time separately.
- [ ] All required checks, test-budget accounting, independent reviews and verified
  cleanup pass. Retain failed attempts and known limits. No silent exceptions.
- [ ] Present the complete module and skill report for owner review. Do not merge,
  install or restart the main app without that separately authorized decision.
