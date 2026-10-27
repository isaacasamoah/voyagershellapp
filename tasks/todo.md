# Tasks: proactive recovery of existing Codex Vessels

[Plan](plan.md). Owning spec: conversation-resume reconnect follow-up, with its
panel consumer. Spec and plan approved by Isaac, 26 October. The K1 background
recovery implementation and its additional owner-approved correction passed
fresh review with no Required finding. Earlier stopped reviews remain evidence.
Isaac approved completing the remaining reconnect work before the small panel
refinement on 27 October. K2 reached final re-review, which resolved both original Rust findings and
retained the intermittent native voice-start concern. Isaac accepted the viewer
recovery on 27 October and explicitly deferred that voice investigation. This
named acceptance decision permits merge and K3; it does not claim the voice fault
is fixed. K3 is now in progress on feat/reconnect-retry. Earlier C1–C3 completion remains in Git history.

The native GitHub stack contains [service restart](https://github.com/isaacasamoah/voyagershellapp/pull/55),
[native capture loss](https://github.com/isaacasamoah/voyagershellapp/pull/56) and
[bounded initial connection and shared proof](https://github.com/isaacasamoah/voyagershellapp/pull/58).
The two native journeys passed on the same selected package. Full acceptance is
9,863 lines against 9,881 exercised production lines, including all 817 temporary
helper lines. No threshold or assertion was weakened. Remaining native Open and
surviving-viewer control coverage continues in the approved K2 journey. These
results authorize no main merge, installation or owner runtime restart.

## K1: background Vessel recovers automatically

### R01: restore a verified managed-runtime connection

- [x] Add the child/checked-process alternative and automatic recovery of the current saved generation, without starting another runtime or requiring idle state.
- [x] Renew credentials at the current runtime's existing locator; restore capture and explicit managed controls under current policy.
- [x] Start with failing service regressions for service loss, connection loss and current-generation identity. Keep unrelated processes and native settings unchanged.

Likely owners: src/worker.rs, src/service.rs, src/authority.rs, tests/service.rs
and the existing provider fixture if needed. Split a larger implementation into
small tasks within this same vertical journey rather than shipping a scaffold.

### R02: prove and review background recovery

- [x] Extend the maintained native runner with service restart ownership and a small reusable reconnect journey. Do not duplicate launcher or cleanup code.
- [x] Prove same process/thread/runtime generation, fresh bound CLI context, continued active work, ordinary Open/Stop, and known-different refusal in disposable state.
- [x] Pass relevant checks, size inventory, fresh Rust/general review and at most one corrective pass plus re-review.

Likely owners: desktop/test/run-native-proof.py, desktop/test/native-proof.cjs,
one reconnect journey, and existing service tests. Depends on R01. This completes
K1; no dependent product work starts with a Required review finding unresolved.

## K2: recover the terminal that survived

### R03: reconnect the original native viewer

- [x] Recover checked terminal/frontend/window identities from existing native discovery; reuse the current runtime handle rather than fabricating a Child.
- [x] Make ordinary Open/background and explicit Stop work without creating a duplicate viewer; leave position, focus and avatar arrangement unchanged.
- [x] Keep actual closed, visible and unverified window observations distinct, with a failure regression for lost in-memory viewer state.

Likely owners: src/service.rs, src/service/lifecycle.rs, src/terminal.rs and existing
lifecycle tests. Depends on K1.

### R04: prove and review viewer recovery

- [x] Use the same reconnect journey with a surviving viewer and one closed during the outage. Verify exact native identities and no automatic viewer creation.
- [x] Drive background/Open, a new dock and voice attachment, then Stop on the real candidate; confirm the unrelated control process stays untouched. Both passing journeys and the intermittent voice failure are retained.
- [x] Complete checks, size inventory, one corrective pass and final re-review. Both Rust findings are resolved. Isaac accepted K2 with the remaining native voice-start concern explicitly deferred on 27 October.

Likely owners: the existing reconnect journey and shared native actions, plus the
owning lifecycle documentation. Depends on R03; completes K2.

## K3: usable retries and subtle status

### R05: expose retry through the existing owner boundary

- [x] Add the named owner Retry connection operation and CLI path, using the automatic verification routine and current observed generation.
- [x] Join an active attempt, permit a new check after a known failure, and cancel admission for a changed or removed record. Never replay uncertain work.
- [x] Prove transient failure, eventual recovery and concurrent/stale requests with the existing service fixture.

Likely owners: src/service.rs, src/bin/voyager.rs and existing service tests.
Depends on K1 and K2.

### R06: present recovery in the current interface

- [x] Add the thin named desktop call in the existing bridge and a menu Retry connection action. Keep progress subtle, keyboard accessible and local to the Vessel.
- [x] Keep recovering Vessels visible, preserve focus and avoid attention-only dead ends. Confirmed exits use Previous vessels and explicit Resume.
- [ ] Keep normal native actions, current styling, free placement and the separate name-only-row request unchanged.

Likely owners: desktop/src/instances.cjs, main.cjs, preload.cjs, ui/renderer.js and
ui/hierarchy.js. UI/bridge regressions stay in their existing fixtures. Depends
on R05. Keep bridge and rendering edits as small tasks inside this single PR.

### R07: complete native fallback proof and final review

- [ ] Drive transient loss and Retry connection in the actual panel. Check accurate reasons, no extra prompts, focus, and recovery while the native agent is active.
- [ ] Preserve all accepted Resume/panel journeys. Record timings, executable identities, whole acceptance inventory and verified cleanup.
- [ ] Complete fresh review, one corrective pass/re-review at most, readable PR body and the build/skills walkthrough before owner inspection.

Likely owners: the shared reconnect journey, existing renderer tests, README and
owning lifecycle document. Depends on R06; completes K3.

## Final checkpoint

- [ ] All approved acceptance journeys pass on one selected package and bundled service.
- [ ] All Required findings resolved within the approved correction limit; no check or constraint weakened.
- [ ] Main, installed app, owner's current runtime and The Climb remain untouched unless later explicitly authorized.

## K2 accepted with a deferred follow-up, 27 October

Isaac reviewed the [build walkthrough](https://github.com/isaacasamoah/voyagershellapp/pull/59),
noted the intermittent native voice-start failure and explicitly chose to address
it later. He requested merging the accepted work and proceeding to retry and the
small panel changes. That decision supersedes the earlier acceptance stop for
this named issue only. The independent review and failing receipt remain evidence.
No native voice fix or general relaxation of the review budget is claimed.

Both original Rust findings are resolved. Three independent negative controls
discriminate their regressions. All ordinary Rust tests, strict Clippy, ten
reconnect cases, 104 desktop tests and formatting pass. The tested implementation
and documentation revisions passed GitHub checks.

The same packaged app and bundled service passed surviving-window and
closed-during-outage journeys, including original runtime/conversation identity,
viewer position, service Open, panel Open/Background/Stop, native voice startup
and an unrelated sleep process left alive. Cleanup is confirmed. The R02 ordinary
Open coverage carried into K2 is proved. An earlier run's native voice-start
receipt remains uncertain despite the unchanged passing repeat.

The final inventory counts 9,275 maintained and 1,149 temporary helper lines,
10,424 combined, against 10,449 exercised production lines. The 25-line margin
passes without dropping prior helpers or weakening assertions. The canonical
Obsidian walkthrough links both reviews, exact inventory and native evidence.

Deferred reference: investigate intermittent native voice startup in a newly
opened terminal. Preserve its uncertain receipt; do not replay the shortcut or
claim the failure resolved. This is not an additional executable K3 task. K3
retries connection verification, not native voice toggles or agent work.

Merge is requested. Installation and owner-app restart remain separate decisions.
