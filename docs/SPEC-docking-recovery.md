# Spec: truthful docking and avatar recovery

Module id: `docking-recovery`. Project: VoyagerShellApp. Draft for review, 24 October 2026.
The [capability map](SPEC.md) is approved. This specification is proposed behavior, not implemented behavior or permission to change the running app.

## Objective and scope

The owner can dock onto a supported managed terminal, understand a refusal, and recover Voyager's controls without restarting an agent. This is a retained increment of the tracer-bullet build. It does not implement general terminal adoption or repair Ghostty's rendering internals.

The [source inspection](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/main.cjs) found different hover/drop checks, limited implicit external registration, and a path that hides the avatar when its target is obscured. These explain possible failure paths; they do not prove the chronology of the reported incident.

## Behavior and boundary contract

1. Discovery may observe any window. An eligible target must resolve to exactly one currently running, connected, registered, service-managed Vessel and its supported viewer. Verify the live process identity and window identity. A title, historical ownership label or matching folder is insufficient. Existing caller permissions still apply.
2. Hover shows checking while identity is unresolved. It shows the eligible cue only after those checks pass. Ineligible terminals get a neutral refusal cue and a short reason. Dropping revalidates the same rules because state can change after hover.
3. The desktop requests the existing service control attachment with the resolved Vessel, window, process identities and a fresh dock generation. The service remains the authority. No drop implicitly registers or adopts an external process.
4. The desktop declares docking successful only after attachment is accepted and the marker is confirmed visible at the intended target in the current generation. Then it requests one success sound. Sound is feedback, not evidence of voice activation or completed agent work.
5. Refusal, placement failure or stale identity restores a visible floating avatar and an explanation. Release any attachment created for the failed attempt. A late response from an older generation cannot reposition the avatar, select an agent or play a sound.
6. If a successfully docked target becomes obscured, minimised, unavailable or moves off the active workspace, undock to a visible floating avatar. Keep the agent running and preserve capture. This deliberately simple first behavior avoids an invisible attachment that can keep hiding the controls. Reattachment requires another deliberate dock.
7. Show Voyager through Applications always reveals the panel and floating avatar on the current display. It clears the visual binding and releases control through the existing path. It works independently of the target terminal and keyboard shortcut. It never starts a replacement agent.

A refused or ended dock does not automatically start the private microphone. Native voice stops through the existing coordinator when its control attachment ends. Losing voice confirmation must not block restoring the visible controls; show the unresolved voice state separately.

The existing `dock` input remains unchanged. Internally, eligibility has an explicit ready, checking or refused result with a reason. Placement reports placed, failed or superseded; merely returning from a placement function is not success. These are typed internal results, not a new plugin interface or general capability service. Invalid control responses, mismatched generations and malformed window data refuse at the boundary.

General terminal adoption remains future product work. This approved interim scope prevents the current UI from implying that baseline is available. Registration and process ownership remain separate.

## Source ownership, stack and style

Rust 2024 and the existing Electron 44.7.0 / Node 24 JavaScript client remain. No new dependency or TypeScript conversion is required.

- `desktop/src/main.cjs` owns drag, docking, visibility and Applications recovery; `desktop/src/binding.cjs` owns terminal identity matching.
- `desktop/src/control.cjs` holds the control connection; `src/control.rs` validates it. `src/service/voice.rs` retains voice selection ownership.
- `src/terminal.rs` and `src/window_layout.rs` retain native platform operations. Geometry and OS details do not enter lifecycle ownership rules.
- Existing context owners are [lifecycle](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/lifecycle.md), [voice](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/voice.md) and [desktop](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/desktop.md). Update their actual behavior with implementation.

Follow [CONTRIBUTING](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/CONTRIBUTING.md). Use small explicit functions and comment-free changed source. This existing boundary check in [control.cjs](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/control.cjs) illustrates the required distinction between a reply and accepted attachment:

```javascript
if (!result?.active || result.attachment?.generation !== request.generation)
  throw Error('Control attachment was not accepted');
```

## Commands

Run from the selected worktree root when implementation is authorized:

```sh
cargo build --locked --bins
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
npm --prefix desktop ci
npm --prefix desktop run format:check
npm --prefix desktop test
node --test desktop/test/binding.test.cjs desktop/test/control.test.cjs
```

These normal checks do not prove native placement or sound. Live launch commands belong in the later plan, pinned to the selected app, service, display and authorized test state. Never clear caller identity to make a test launch succeed.

## Success criteria and verification

| Id | Case and required evidence |
|---|---|
| D1 | A verified managed target gets the eligible cue, one accepted control generation, a visible correctly placed avatar and one heard success sound. Record each stage separately. |
| D2 | An ordinary external terminal, including one that matches the viewer allowlist, is refused. Registration count, authority and external process state remain unchanged; no success sound occurs. |
| D3 | Stop the target or replace its frontend between hover and drop. Revalidation refuses the old identity and keeps Voyager visible. |
| D4 | Inject placement failure, a delayed older attachment reply and control disconnect. No stale binding or late success sound survives; unrelated terminals remain untouched. |
| D5 | Cover, minimise and close the target, switch workspaces, and change monitor/scale geometry. Each loss of a usable target restores a visible floating avatar without stopping the agent. |
| D6 | Trigger Applications recovery while docked and after a failed placement. The panel and avatar stay visible after subsequent refreshes. Keyboard recovery remains available too. |
| D7 | Dock Codex, dock Bash and undock. The existing voice destination rules remain correct, without duplicate microphones or a false claim that voice is active. |

Extend Node binding/control tests and Rust control-boundary fixtures where their behavior changes. Add a native integration check for actual app visibility and sound. Each failing scenario must first fail against the previous behavior or a deliberately invalid fixture. No coverage percentage is substituted for these journeys.

For live evidence, run app and service from the same intended candidate, record their executable identities and display backend, then verify the packaged build before rollout. Test both supported viewer choices and disclose any unsupported combination. Record monotonic times for drop, service acceptance, confirmed placement, audible sound onset and sound completion. Audio scheduling alone does not prove audible playback.

Proposed usability targets for review: in 20 unobstructed trials on the development Fedora desktop, at least 19 reach audible dock feedback within two seconds of drop. In 20 recovery trials, at least 19 reveal both controls within one second. Every trial must recover correctly; record all slow and failed trials. These are proposed local acceptance budgets, not measured results or a cross-platform guarantee.

Retain bounded diagnostics for generation, target identity, eligibility, control, placement and recovery reason. Keep terminal contents, credentials and private reasoning out of diagnostics. Test artifacts stay outside committed source; executable probes stay with their owning source or temporary test output.

## Boundaries and review decisions

Always preserve the agent runtime on undock, revalidate identity before control, and report uncertainty honestly. Seek review before expanding this scope to external adoption, changing authority or adding a platform framework. Never infer ownership from registration, send input by desktop focus, or restart a service to hide a failed dock.

Review the simple undock-on-occlusion behavior and the proposed timing budgets. The missing incident trace remains an evidence limit; this spec requires testing those failure paths without asserting that each occurred in the original incident.
