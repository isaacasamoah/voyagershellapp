# Tasks: return to a stopped conversation

Status: owner approved build, 25 October 2026. The [plan](plan.md) owns design and commands; the
[specification](../SPEC-conversation-resume.md) owns R1-R9. Completed docking tasks
remain in Git history. The still-open voice tasks remain in the voice branch.

The owner approved an additional R01b corrective pass after the earlier review
stop. Its independent re-review passed. The unexpected-exit regression now catches
the former stale-settings behavior. R02 is next; no merge or installation is
included in this build authorization.

## R00: prove safe idle loading

- [x] Show saved history and restrictive effective settings survive reopening the
  same real Codex thread, with no new turn until an explicit instruction.
- [x] Check saved-goal and missing-settings cases without changing their meaning.
  Record the provider/version, setting map and known-different result.
- [x] Complete Gate A, the transactional schema design and focused file map, then
  complete independent review before product implementation. Stop if idle loading is unproved.

## R01a: reliable lifecycle observations and verified settings

- [x] Save verified effective settings and provider provenance when a managed
  runtime starts, preserving original launch and event history.
- [x] Show live-owned, confirmed stopped and unknown states through list/detail,
  including restart and legacy missing-settings cases. No Resume action yet.
- [x] Pass boundary checks and independent review within the five-file source map.

## R01b: resume through the owner service API

- [x] Record/admit one immutable request and generation atomically before spawning.
  Start the same saved conversation idle and preserve history and verified settings.
- [x] Confirm new owned runtime/capture/credentials while rejecting unsupported
  records, stale generations and non-owner callers. Keep the viewer separate.
- [x] Run focused boundary tests, real-provider corroboration and independent review.
  Covers core R1/R5/R7/R9. Keep each test's purpose and file scope explicit.

## R02: resume and open through the CLI

- [x] Provide the owner command and same-request receipt lookup. Open only after
  a fresh running observation. Verify the saved marker with a new explicit query.
- [x] Demonstrate a failed Open and successful later Open on the same process.
  Reopening a viewer must not create work or a second runtime. Covers R1/R6.
- [x] Extend the maintained native runner, record actual app/service identities and
  complete independent review. No separate feature-specific launcher.

## Checkpoint R-A

- [x] Gate A and the complete owner resume/open journey pass without permission
  increases, task replay or substitute conversations. Review before R03.

## R03: preserve outcomes through races and disconnects

- [ ] Separate focused cases cover same-ID reuse/conflict, competing requests and
  client disconnect with a continuing service. Covers R3/R4.
- [ ] Verify confirmed-stop restart, interrupted-service uncertainty, old-credential
  refusal and old-event rejection without affecting unrelated processes. Covers
  R2/R4/R7-R9. Historical completed receipts do not establish current liveness.
- [ ] Required checks, all R1-R9 package journeys and independent review pass.

## Final checkpoint

- [ ] Preserve schema migration/legacy-read evidence and the pre-migration backup
  procedure. Missing legacy settings remain inspectable and cannot resume.
- [ ] Record complete test/helper inventory, disjoint exercised production ranges
  and a relevant deliberately broken case that fails its check.
- [ ] Present results and remaining limits for owner acceptance. Do not install,
  restart the main service, or build another capability from this planning request.
