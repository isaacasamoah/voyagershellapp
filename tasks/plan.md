# Plan: recoverable docking

Status: D01-D05 passed independent review and packaged verification. D05 used one corrective build. Ready for owner review; owner acceptance and rollout remain separate decisions.

## Scope and outcome

Implement only [docking-recovery](../SPEC-docking-recovery.md). The owner can dock onto a verified supported terminal, hear success only when docking is actually visible, understand a refusal, and recover the controls without restarting an agent.

The four approved specifications remain unchanged. The initiative order remains docking, voice, resume, then panel. The [task list](todo.md) contains only the four docking slices. [Later-capability notes](future-capability-notes.md) preserve useful investigation from the superseded combined plan; they are reference material, not an active build queue. After docking is complete and reviewed, prepare the voice plan using what we learned.

## Build complete behaviors

Each slice includes the source changes, regression tests, current-behavior documentation and a real candidate check needed to demonstrate its outcome. Do not create separate database, API, UI or test phases. Small helpers may support a slice, but creating a helper is not a completed user outcome.

| Slice | What the owner can do afterward | Required contrast | Spec cases |
|---|---|---|---|
| D01 | See and understand why an unsupported or changed target cannot be docked. | An ordinary external terminal using a supported viewer still refuses; a verified managed target remains available. | D2, D3; eligibility part of D1 |
| D02 | Complete a valid dock with the avatar visible and one audible confirmation. | Failed placement and late replies never create success feedback or leave an obsolete attachment. | D1, D4 |
| D03 | Keep using Voyager when a docked target becomes covered or unavailable. | Losing a target restores the floating avatar while the agent and capture continue. | D5, D7 |
| D04 | Open Voyager through Applications to recover both controls, independently of the terminal. | Recovery works after failed placement and remains visible through later refreshes. | D6, D7 |

D01 and D02 form the first review checkpoint. D03 and D04 form the second. Final verification repeats the combined docking cases and timing trials on the packaged candidate. It verifies the same capability; it is not a separate implementation project.

A slice stays open until its own real journey is observed. A unit test or accepted service command alone is not enough. If the work grows, split by a smaller complete behavior, not by technical layer merely to meet a file-count target. Keep the current system working between slices.

## Existing code to build on

The implementation branch starts from the [approved documentation branch](https://github.com/isaacasamoah/voyagershellapp/pull/24). The following observations describe the starting code and guided the slices:

- [Binding](../desktop/src/binding.cjs) already verifies process start identity, executable and window matching. Extend this rather than building another discovery system.
- [The desktop main process](../desktop/src/main.cjs) uses different hover/drop checks and can register an external agent during a drop. `placeAboveTerminal()` can hide the avatar and return, after which its caller can reach the success-sound path.
- [The control connection](../desktop/src/control.cjs) already checks attachment acceptance and generation. Keep the service authoritative and reject late results from earlier attempts.
- [Voice routing](../docs/voice.md) already separates private app voice, docked Codex voice and Bash. Docking changes must preserve those rules; private voice handoff improvements belong to the later capability.
- The separate [desktop startup fix](https://github.com/isaacasamoah/voyagershellapp/pull/23) was open during the earlier inspection. Recheck before implementation. Do not silently integrate it. Candidate tests must pass `--ozone-platform=x11` when starting Electron and record the actual display backend.

The missing incident trace remains a limitation. These source paths identify things to fix and test, not proof of every step in the original freeze incident.

## Implementation approach

Use one eligibility check for hover and drop, based on existing service observations and verified process/window identity. It returns checking, ready or refused with a short reason. It must not depend on the future resume API. Dropping repeats the check and does not implicitly register an external agent.

Give placement an explicit result: visibly placed, failed, or replaced by a newer attempt. Check that the accepted control attachment and visible placement belong to the same current attempt before requesting one success sound. Failed attempts release their attachment and restore the visible floating avatar. Preserve generation checks through every asynchronous step.

When a docked target becomes unusable, undock and show the floating avatar. Keep the runtime and event capture running. Stop native voice through the existing coordinator when control ends, without automatically starting the private microphone. Uncertain voice state must not delay restoring visible controls.

Applications recovery uses the existing second-instance path but explicitly releases the attachment and reveals the panel and floating avatar on the current display. It must work independently of the terminal or keyboard shortcut and must not create an agent.

Do not change runtime ownership, rank policy or the existing `dock` request shape. Keep native window operations in their current platform boundary. No new dependencies, TypeScript migration, platform framework or general terminal adoption are included.

## Verification for each slice

Follow the governing spec and the project's Definition of Done. Each new regression test must first detect the old behavior or a deliberately invalid test setup. Use small, bounded diagnostics without terminal contents, credentials or private reasoning.

Run from the selected worktree root. The task list records which checks have run for the selected increment.

```sh
npm --prefix desktop ci
node desktop/node_modules/electron/install.js
npm --prefix desktop run format:check
npm --prefix desktop test
```

Build the candidate Rust binaries for real desktop checks. If Rust code changes, also run all required Rust checks:

```sh
cargo build --locked --bins
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

The task list names focused tests. Run the relevant full checks at each checkpoint. Code examples, test fixtures and real desktop evidence answer different questions; none substitutes for the others.

## Real candidate checks

Run only after approval of this plan and its test scope. Use the same selected revision for app and service, with fresh private state and a separate desktop profile. Record their executable paths and hashes, source revision, provider version, viewer and display backend. Do not test new desktop code against the installed service and call that candidate proof.

An ordinary authorized owner terminal can use the commands below. A bound Voyager instance must keep its identity and use the scoped route in [development-tests.md](../docs/development-tests.md). If that runner cannot perform a required check, arrange the owner-run check rather than removing identity or using an owner RPC fallback.

For a fresh owner-run trial:

```sh
VOYAGER_TRIAL_STATE=$(mktemp -d /tmp/voyager-dock-XXXXXX)
export VOYAGER_TRIAL_STATE
./target/debug/voyager --state "$VOYAGER_TRIAL_STATE" start
VOYAGER_STATE="$VOYAGER_TRIAL_STATE" \
  ./desktop/node_modules/electron/dist/electron --ozone-platform=x11 ./desktop --expanded
```

This launches only the candidate against its private state. The service can start its private provider runtime. Real tests can use provider resources, microphone and desktop focus; a private state directory does not isolate those resources. Create only disposable test Vessels and record their identities. An external terminal used as a refusal control must also be a disposable test window, not an unrelated working session.

Each slice adds its real journey to the existing evidence as it is implemented. Extend the [polish proof](../desktop/test/polish-proof.cjs) for docking/placement observations and the [visibility proof](../desktop/test/visibility-proof.cjs) for independent recovery where useful. Do not postpone real checks until those harnesses cover every case.

After the relevant harness extensions, run the existing polish entry point in a separate fresh trial for each supported viewer:

```sh
VOYAGER_STATE="$VOYAGER_TRIAL_STATE" VOYAGER_PROOF_TERMINAL=xterm \
  ./desktop/node_modules/electron/dist/electron --ozone-platform=x11 ./desktop --expanded --proof-polish
```

Repeat with `VOYAGER_PROOF_TERMINAL=ghostty`. The existing proof alone does not establish the new requirements. Perform actual pointer drops, cover/minimise/close actions, workspace and monitor/scale changes, and audible checks. For Applications recovery, use a separately named temporary candidate launcher retaining the candidate executable and state directory. The installed launcher would test the wrong build. Remove only this temporary launcher after the test.

Measure drop, service acceptance, confirmed visible placement, audible sound onset and completion using a monotonic clock. A scheduled Web Audio event does not prove the sound was heard. Use listening or recorded output to confirm it. Start measurement with D02 and recovery measurement with D03; do not add instrumentation only after behavior is called complete.

At the final checkpoint, run 20 unobstructed docking trials and 20 recovery trials on the development Fedora desktop. At least 19 docking trials must produce audible feedback within two seconds of drop; at least 19 recovery trials must reveal both controls within one second. Every trial must recover correctly. Retain all slow and failed trials. Test both supported viewers and report the viewer used for each timing run and any unsupported combination. These are local acceptance targets, not cross-platform guarantees.

Keep raw evidence outside Git. The test records the resources it creates and cleans them up through verified lifecycle actions. Inspect cleanup outcomes separately from the test verdict. Do not kill an unverified process, delete useful failure evidence or restart main to recover a candidate test.

## Packaged docking check

After the four slices pass, run:

```sh
npm --prefix desktop run package:linux
```

Run the resulting packaged executable and bundled Rust service against fresh private state, record their exact paths/hashes, and repeat the combined docking/recovery checks and approved timing trials. This confirms the package contains the tested behavior. Do not install it, enable startup, restart main or merge automatically. Those remain separate owner decisions.

## Review checkpoints and risks

| Checkpoint | Evidence to review |
|---|---|
| After D01-D02 | Unsupported targets refuse clearly; a valid target docks visibly with one heard sound; stale/failed attempts cannot report success. Review unit/service regressions and real candidate results. |
| After D03-D04 | Target loss and Applications recovery leave controls usable, preserve the agent and capture, and keep voice routing correct. Review the full D1-D7 evidence, timing trials and packaged candidate results. |

The main risks are late asynchronous replies, window-state uncertainty, sound being scheduled but unheard, and accidentally exercising the installed build. The generation checks, explicit placement results and real-candidate evidence address them. Ghostty's separate rendering freeze is not repaired by this work; report it if it prevents a required journey from passing rather than claiming a fix.

The owner approved the capability behavior and timing targets. The owner authorized the first build trial after reviewing the vertical slices. After docking is complete and reviewed, prepare a separate active plan for voice. Retain later investigation as reference and use Git history to preserve this plan; do not overwrite unfinished work or invent an automatic archive policy.

## D01 implementation notes

The slice needs eight product/test files rather than the five-file estimate:
shared identity validation, main-process drag handling, candidate HTML/CSS,
the panel reason, binding tests, main-process regression tests and a native
pointer proof. These belong to the same refusal journey. Existing control-socket
code and service authorization remain unchanged. README and the owning desktop
guide describe the behavior; the plan and task list retain their existing roles.

The native proof exposed a lost-target case: closing the terminal during a drag
cleared the remembered target, so dropping showed no reason. A failing regression
test now guards the fix. An earlier run also reproduced the separate D02 case of
accepted control and a sound request while the avatar was hidden. D01's valid-target
comparison records that observation without treating it as placement acceptance.

`npm ci` installs this Electron package without its binary. The explicit installed
package's `install.js` supplies the pinned runtime. Native checks must verify that
binary exists before launch. Do not substitute the installed main app.

## Authorized completion run

On 24 October 2026 the owner requested the missing live external Codex test,
then a fresh-context sub-agent review using the review skill for every slice.
Continue through D01-D04 in dependency order without the intermediate human
checkpoint. Keep checkpoint evidence for the final owner review. Each slice may
have one corrective build after review. Re-review that correction; if required
issues remain, report them and stop rather than starting another correction or
building dependent slices. This instruction does not authorize merging,
installation, main-service restart or release. The final review remains human-owned.

## D02 implementation notes

D02 uses a small placement module so native stack checks and explicit outcomes
can be tested without adding another state framework to the main process.
The complete behavior also changes binding validation and control response
checks, with their existing tests. Native proof and output recording are test
code; no audio capture is added to the product. This exceeds the five-file
estimate because the same accepted-to-visible journey crosses those boundaries.
The in-memory attempt records are bounded to 32 and contain no terminal content.

The broader polish proof now resolves native windows by verified process identity,
because Codex can change its title after launch. It activates the intended window
before the unobstructed docking comparison. This does not change product discovery
or permit docking onto external agents.

## D03 implementation notes

The real workspace trial required a small change in the existing Rust X11 probe:
a mapped window is not necessarily on the current workspace. Workspace visibility
stays in that native boundary. Main-process refresh consumes its result and the
explicit placement result, releasing control and showing floating controls when
the target is lost. Electron display-change events also invalidate docking.

The native recovery helper and bounded monitor trial are test code. They extend
the existing polish journey without a new test service or product framework.
Their file scope exceeds the initial estimate because actual workspace and
monitor behavior could not be established by renderer fixtures alone.

## D04 implementation notes

Applications and keyboard recovery share one operation that releases control,
clears drag state and restores the existing controls. The requested panel anchor
is explicit so asynchronous native geometry cannot send the panel back to the
previous display. A small GNOME launch-context selector handles the stock
Applications grid, whose primary-monitor position is independent of stale
XWayland pointer observations. Keyboard recovery retains pointer-based placement.
Custom desktop extensions and other platforms need their own verification.

The final proof includes actual grid selection and repeated launches of that same
temporary entry. Keyboard verification uses a separate GNOME desktop and actual
XTest keys because the installed app already owns Ctrl+Alt+V. The isolated
session initializes real workspace state before launching the candidate; it does
not inject fake window metadata. The fresh-session missing-metadata failure is
retained as a limitation for review.

Native pointer scaling, packaged harness loading, audio timing batches and
candidate hashing are test support for the same user outcome. Their file scope
exceeds the initial estimate. No installed launcher, active shortcut or main
service is changed.

## Final candidate handoff

All four slices used one corrective product build and passed independent
re-review. The task list records technical completion and retains the owner
acceptance item. No later capability is active. The reviewed package contains
the same product source as the final documentation-only handoff revision.

The final Ghostty polish test required an unobstructed Bash target and a visible
panel for its final screenshot. Its original automatic sequence can cover the
positive-case target with its own recovered panel. That expected refusal and the
operator-assisted positive comparison are both retained. Improving that optional
fixture is separate from product review. Voice teardown uncertainty remains
visible in the evidence and is not represented as confirmed closure.

## D05: restore pre-dock floating positions

Isaac verified docking, undocking and external refusal, then requested that
minimising or closing a docked terminal restore the controls to their earlier
floating positions. Keep one in-memory snapshot for the current dock sequence.
Capture it before a drag moves the avatar, or before a direct dock. Carry it
through a target-to-target move. Automatic recovery uses the snapshot and the
existing display clamps. Explicit Applications recovery retains its current-display
behavior. This adds no persisted layout, process action or permission change.

Verify a failing regression before implementation, including a target transfer,
removed-display fallback, and a known-different deliberate repositioning. Then
run isolated native minimise/close trials with both viewers and verify the same
managed runtime survives. Independently review this refinement and use at most
one corrective product build if required. Keep the owner's running trial intact.

The D05 reviewer found an overlapping display-event race. The single corrective
build retains the pending origin until restoration completes or a new explicit
intent replaces it. The added regression first failed, then passed; a contrasting
new-position test confirms that a deliberate move supersedes the older recovery.

## Owner acceptance

On 24 October 2026 the owner confirmed the updated packaged trial works and
authorized merging docking to main, then building voice handoff. D01-D05 are
complete. Preserve this completed plan in Git before replacing the active plan
with the approved next module. Runtime installation and restart are separate.
