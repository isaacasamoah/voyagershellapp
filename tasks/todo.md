# Tasks: proactive recovery of existing Codex Vessels

[Plan](plan.md). Owning spec: conversation-resume reconnect follow-up, with its
panel consumer. Spec and plan approved by Isaac, 26 October. All items below
are unstarted; earlier C1–C3 completion remains in Git history.

## K1: background Vessel recovers automatically

### R01: restore a verified managed-runtime connection

- [ ] Add the child/checked-process alternative and automatic recovery of the current saved generation, without starting another runtime or requiring idle state.
- [ ] Renew credentials at the current runtime's existing locator; restore capture and explicit managed controls under current policy.
- [ ] Start with failing service regressions for service loss, connection loss and current-generation identity. Keep unrelated processes and native settings unchanged.

Likely owners: src/worker.rs, src/service.rs, src/authority.rs, tests/service.rs
and the existing provider fixture if needed. Split a larger implementation into
small tasks within this same vertical journey rather than shipping a scaffold.

### R02: prove and review background recovery

- [ ] Extend the maintained native runner with service restart ownership and a small reusable reconnect journey. Do not duplicate launcher or cleanup code.
- [ ] Prove same process/thread/runtime generation, fresh bound CLI context, continued active work, ordinary Open/Stop, and known-different refusal in disposable state.
- [ ] Pass relevant checks, size inventory, fresh Rust/general review and at most one corrective pass plus re-review.

Likely owners: desktop/test/run-native-proof.py, desktop/test/native-proof.cjs,
one reconnect journey, and existing service tests. Depends on R01. This completes
K1; no dependent product work starts with a Required review finding unresolved.

## K2: recover the terminal that survived

### R03: reconnect the original native viewer

- [ ] Recover checked terminal/frontend/window identities from existing native discovery; reuse the current runtime handle rather than fabricating a Child.
- [ ] Make ordinary Open/background and explicit Stop work without creating a duplicate viewer; leave position, focus and avatar arrangement unchanged.
- [ ] Keep actual closed, visible and unverified window observations distinct, with a failure regression for lost in-memory viewer state.

Likely owners: src/service.rs, src/service/lifecycle.rs, src/terminal.rs and existing
lifecycle tests. Depends on K1.

### R04: prove and review viewer recovery

- [ ] Use the same reconnect journey with a surviving viewer and one closed during the outage. Verify exact native identities and no automatic viewer creation.
- [ ] Drive background/Open, a new dock and voice attachment, then Stop on the real candidate; confirm the unrelated control process stays untouched.
- [ ] Pass checks, size inventory and fresh review, with one corrective pass and re-review at most.

Likely owners: the existing reconnect journey and shared native actions, plus the
owning lifecycle documentation. Depends on R03; completes K2.

## K3: usable retries and subtle status

### R05: expose retry through the existing owner boundary

- [ ] Add the named owner Retry connection operation and CLI path, using the automatic verification routine and current observed generation.
- [ ] Join an active attempt, permit a new check after a known failure, and cancel admission for a changed or removed record. Never replay uncertain work.
- [ ] Prove transient failure, eventual recovery and concurrent/stale requests with the existing service fixture.

Likely owners: src/service.rs, src/bin/voyager.rs and existing service tests.
Depends on K1 and K2.

### R06: present recovery in the current interface

- [ ] Add the thin named desktop call in the existing bridge and a menu Retry connection action. Keep progress subtle, keyboard accessible and local to the Vessel.
- [ ] Keep recovering Vessels visible, preserve focus and avoid attention-only dead ends. Confirmed exits use Previous vessels and explicit Resume.
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
