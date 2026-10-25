# Tasks: voice acknowledgement and result handoff

Status: fixture preparation accepted after the additional owner-authorized correction
and fresh review, 25 October 2026. Docking is merged. The owner approved this
module's full build/review sequence. The [plan](plan.md) owns the approach;
[the spec](../SPEC-voice-handoff.md) owns V1-V8. No voice behavior is complete yet.

## Preparation: reuse the native proving fixture

- [x] Consolidate conversation and return-position around one runner and shared
  input, waiting, evidence and cleanup. Preserve existing assertions.
- [x] Demonstrate native parity and record complete test-line counts. Commit the
  fixture refactor separately from behavior. Record historical migration debt.

The owner authorized one extra corrective pass after the initial correction
missed pointer-helper exit confirmation. The driver now waits for closure before
publishing its final result. Unconfirmed closure fails; journey and cleanup
errors are both retained. The failing control rejects the previous implementation.
Independent review accepts normal exit, confirmed fallback, stalled exit,
journey failure, combined failure and nonzero exit cases.

The actual package and bundled service passed conversation parity and both
minimise/close recovery cases. Helper/app/service shutdown was confirmed and
candidate hashes matched. The first packaged drag attempt failed to find an
eligible target. The unchanged package passed with a diagnostic observer, whose
timing effect is unmeasured. That first failure remains unexplained. The main
error handler also drops structured cleanup fields while retaining failure text.
Both are recorded advisories, not further corrections in this pass.

All 90 desktop tests, formatting and candidate CI pass. The final independent
budget audit counts 603 maintained native lines, 284 temporary review/observer
lines and 1,965 ordinary test lines: 2,852 against 3,090 distinct exercised
production lines. Shared functions/helpers count once. Historical helper
revisions remain disclosed separately. This is the audited preparation scope,
not a claim about every repository test. No assertions were removed or code
padded. The earlier provisional production count had a 100-line arithmetic error.

Conversation parity uses synthetic input and muted output. It does not prove
voice acknowledgement, audible final answers or human interruption. Historical
unrelated fixture entry points remain migration debt. The installed runtime is
unchanged. [Shared fixture PR](https://github.com/isaacasamoah/voyagershellapp/pull/30).

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
