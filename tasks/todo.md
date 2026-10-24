# Tasks: recoverable docking

Status: D01 complete on the candidate branch, 24 October 2026. D02 is next. No merge or installed-app update has occurred.

Governing specification: [docking-recovery](../SPEC-docking-recovery.md). The [plan](plan.md) owns the approach, candidate setup and test commands. This is the only active task list. Voice, resume and panel work remain outside it.

Each slice includes implementation, tests, a real candidate demonstration and the relevant behavior documentation. The likely files are estimates, not a reason to divide a behavior into separate technical layers. If a slice grows beyond one focused session or roughly five files, divide it into smaller complete behaviors before proceeding. Follow the existing build/Git skills and Definition of Done; the process is unchanged.

## D01: refuse an unsupported dock clearly

- [x] D01 complete.

Make hover and drop agree about whether the target can be docked. Show a short reason when it cannot, and leave the floating controls available. This delivers the complete refusal journey, rather than only a reusable validation helper.

Acceptance:

- An ordinary external terminal refuses even when it uses a supported viewer. It receives no implicit registration, authority change or success sound. A verified running, connected, registered managed target remains eligible. Covers D2 and the eligibility part of D1.
- Stop the target or replace its terminal client after hover. Drop rechecks live identities, refuses the changed target and leaves Voyager visible with a reason. Covers D3.
- Hover shows checking until identity is established. Both paths use the same eligibility rules and retain the existing service permission boundary.

Verification:

- Run `node --test desktop/test/binding.test.cjs desktop/test/control.test.cjs` and the plan's desktop checks. Run `cargo test --locked --test service` for the existing control-boundary regressions; use full Rust checks if Rust code changes.
- Show that the new refusal tests detect the old implicit-registration or stale-target behavior, or a deliberately invalid fixture.
- On the real candidate, hover and drop onto a disposable external terminal, a valid managed terminal and a target changed between hover and drop. Record the cues/reasons, visible controls and before/after registration state. The valid target is a comparison, not proof that D02's placement/sound requirements are already met.

Completion evidence, 24 October 2026:

- The main-process regression first detected implicit registration and acceptance of a replacement client. A later live failure produced a failing regression for losing the hovered window before release. All now pass.
- All 50 desktop tests, desktop formatting, the candidate binary build and all 24 service-boundary tests pass. Rust source did not change.
- The real candidate app and service ran from this implementation worktree in fresh private state. Native-pointer journeys passed with xterm and Ghostty: external refusal without registration/control/success sound requests, managed acceptance, and visible refusal after the managed target stopped during hover. Both viewers were stopped and their isolated services shut down.
- The maintained reproduction is `desktop/test/docking-proof.cjs`, invoked with `--proof-docking`; see the desktop guide. Private receipts, screenshots and executable hashes are linked from the owning Obsidian status, outside Git. Screenshots confirm readable refusal and eligible cues. No renderer errors were recorded.
- The valid-target comparison does not pass D02. An earlier run reproduced hidden placement with accepted control and a sound request. Acoustic timing, voice, other operating systems and packaged behavior remain unproved.

Dependencies: the owner approved the revised plan for this build trial.

Original estimate: `desktop/src/binding.cjs`, `desktop/src/main.cjs`, `desktop/test/binding.test.cjs`, `desktop/test/control.test.cjs`, `docs/desktop.md`. The plan records the actual files needed for visible feedback and native proof.

Estimated scope: medium, up to five files. Keep current service control authorization unchanged. If inspection finds a service defect requiring a Rust change, revise this slice's scope explicitly rather than moving the authorization decision into the UI.

## D02: complete a valid dock visibly and audibly

- [ ] D02 complete.

Take the eligible target through accepted control attachment, confirmed visible placement and one success sound. Handle failed placement and late replies within the same journey.

Acceptance:

- A valid dock has one accepted current attachment, a correctly placed visible avatar and one heard sound. Record the stages separately. Covers D1.
- Placement failure, a control disconnect or a late reply from an older attempt cannot move/select the wrong target, play a late sound or leave an obsolete attachment. Restore visible floating controls and release failed attachments. Covers D4.
- Add bounded timing evidence while building this behavior, through audible onset/completion. Do not call scheduled audio a measured audible result.

Verification:

- Run `node --test desktop/test/binding.test.cjs desktop/test/control.test.cjs` and the plan's desktop checks. Add deterministic placement/late-reply cases to the control tests, extracting a small testable function from the owning file only if needed; do not create a framework.
- Demonstrate that the hidden-avatar return path or a deliberately failed placement fails the new acceptance check.
- On the real candidate, perform a valid dock, a failed placement and a delayed/invalidated attempt. Hear or record the success sound and verify there is none for failures. Extend `desktop/test/polish-proof.cjs` with these observations and run it after extension using the plan's command. Record initial timing trials now; complete the approved batch at the final checkpoint.

Dependencies: D01.

Likely files: `desktop/src/main.cjs`, `desktop/src/control.cjs`, `desktop/test/control.test.cjs`, `desktop/test/polish-proof.cjs`, `docs/desktop.md`.

Estimated scope: medium, up to five files. The useful result is the complete dock and its failure handling, not the extraction of a helper or installation of instrumentation.

## Checkpoint D-A

- [ ] D01-D02 pass their controlled regressions and real candidate journeys. Applicable checks/builds pass, and observed evidence is linked outside Git.
- [ ] Review refusal, visible placement and actual sound with the owner before continuing.

## D03: recover when a docked target becomes unusable

- [ ] D03 complete.

While the owner is docked, turn target loss into a visible floating avatar without restarting or stopping the agent. Preserve voice routing through the existing coordinator.

Acceptance:

- Cover, minimise or close the target, switch workspaces, and change monitor arrangement/scaling. Whenever the target becomes unusable, the floating avatar returns. Reattachment requires a new deliberate dock. Covers D5.
- The same agent and event capture continue. Ending its control attachment stops native voice without starting the private microphone; uncertain voice confirmation does not block visible recovery. Covers D7.
- A later refresh or old reply cannot hide the recovered controls or restore the obsolete attachment. Record recovery timing from the triggering action.

Verification:

- Run `node --test desktop/test/control.test.cjs desktop/test/conversation.test.cjs`, the plan's desktop checks and the existing service control regressions. Use full Rust checks if a Rust boundary needs a change.
- Exercise the covered-target failure before the fix or in a deliberately invalid fixture.
- Run the actual cover/minimise/close, workspace and monitor/scale journeys on the candidate. Check service identity and capture before/after. Dock Codex, dock Bash and undock to demonstrate the existing voice destination rules. Extend the polish proof as part of this slice; retain manual/audio observations where automated receipts cannot prove the result.

Dependencies: checkpoint D-A.

Likely files: `desktop/src/main.cjs`, `desktop/test/control.test.cjs`, `desktop/test/polish-proof.cjs`, `docs/desktop.md`, `docs/voice.md`.

Estimated scope: medium, up to five files. Native voice policy and private voice handoff behavior remain unchanged.

## D04: recover both controls through Applications

- [ ] D04 complete.

Give the owner an independent recovery action that brings the panel and floating avatar onto the current display even when docking or placement has failed.

Acceptance:

- Opening the candidate through its separately named Applications launcher releases the attachment and shows both controls while docked and after failed placement. It does not depend on the terminal or keyboard shortcut and starts no replacement agent. Covers D6.
- Both controls remain visible after refresh. Existing keyboard recovery still works. Agent/capture continuity and native/private voice rules remain correct. Covers D6-D7.
- The recovery path is included in the real visibility proof and its measured outcome is retained. The temporary launcher exercises the candidate's executable and private state, never the installed app.

Verification:

- Run `node --test desktop/test/control.test.cjs desktop/test/conversation.test.cjs` and the plan's desktop checks. Add repeated-recovery and stale-refresh regression cases alongside the behavior change.
- Extend `desktop/test/visibility-proof.cjs` and check it with `node --check desktop/test/visibility-proof.cjs`. Use the plan's candidate setup and actually select the temporary Applications launcher while docked and after a controlled placement failure. Repeat with keyboard recovery; record identities to prove no runtime was replaced.
- Run the complete D1-D7 journey with xterm and Ghostty. Complete the timing batches and packaged check below before requesting capability acceptance.

Dependencies: D03.

Likely files: `desktop/src/main.cjs`, `desktop/test/control.test.cjs`, `desktop/test/visibility-proof.cjs`, `docs/desktop.md`.

Estimated scope: medium, up to four files. The separately named launcher is a temporary test artifact, not a change to the installed Applications entry.

## Checkpoint D-B: accept the docking capability

- [ ] All D1-D7 cases have evidence from the selected candidate, including both supported viewers and the refusal/failure controls. No required case is waived because a fixture passed.
- [ ] The approved Fedora timing batches pass: at least 19 of 20 unobstructed docks are audible within two seconds, and at least 19 of 20 recoveries reveal both controls within one second. Every trial recovers correctly. Record slow and failed trials, the viewer used, and any unsupported combinations.
- [ ] Applicable full Rust and desktop checks pass. Run `npm --prefix desktop run package:linux`, then repeat the combined docking/recovery cases and timing batches on the actual packaged app and bundled service in fresh private state. Record executable paths/hashes, display/audio setup, outcomes, limits and cleanup evidence.
- [ ] Review the packaged docking result with the owner. The next planning cycle is voice handoff; no voice, resume or panel tasks become active automatically. Merge, installation, restart and release remain separate decisions.
