# Spec: truthful docking and avatar recovery

Module id: `docking-recovery`. Project: VoyagerShellApp. Draft for review, 24 October 2026.
The [capability map](SPEC.md) is approved. This specification is proposed behavior, not implemented behavior or permission to change the running app.

## Objective and scope

The owner can dock Voyager onto a supported terminal that Voyager manages. If docking is unavailable, Voyager explains why. If the controls disappear or docking fails, the owner can bring them back without restarting the agent. This change becomes part of the continuing tracer-bullet build. It does not add support for taking over arbitrary terminals or fix how Ghostty draws its window.

The [source inspection](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/main.cjs) found that hovering and dropping use different checks. Some drops can register an external agent without a separate registration action. The code can also hide the avatar when another window covers its target. These are possible causes of failure, but the inspection did not establish which events caused the reported incident.

## Behavior and boundary contract

1. Voyager may inspect any window, but docking is allowed only when it identifies exactly one registered Vessel that the service manages, confirms that the agent is running and connected, and identifies its supported terminal viewer. Verify both the live process and the window. A matching title or folder, or an old record saying Voyager owned the process, is not enough. The caller must still have the required permissions.
2. While the owner hovers over a target, show that Voyager is checking it. Show the signal that docking is available only after the checks pass. Otherwise, show a neutral refusal signal and a short explanation. Repeat the same checks when the owner drops the avatar, because the target may have changed since the hover.
3. The desktop asks the service to attach control using the identified Vessel, window and process. Each attempt gets a new dock generation, an identifier that distinguishes it from earlier attempts. The service decides whether to accept the attachment. Dropping onto an external process must not silently register it or take responsibility for managing it.
4. Report successful docking only when the service has accepted the attachment and the avatar is confirmed visible at the intended target for that same attempt. Then request one success sound. The sound confirms docking; it does not prove that voice is active or that the agent has completed work.
5. If docking is refused, placement fails or the target identity is no longer valid, show the floating avatar and explain the problem. Release any control attachment created by the failed attempt. A late reply from an earlier attempt must not move the avatar, select an agent or play a sound.
6. If a docked target becomes covered, minimised, unavailable or moves off the active workspace, undock and show the floating avatar. Keep the agent running and keep capturing its events. This first version deliberately releases the attachment so it cannot keep hiding the controls. The owner must dock again to reattach.
7. Opening Voyager through Applications must always reveal the panel and floating avatar on the current display. Detach the avatar from its target and release control through the existing mechanism. This recovery action must work independently of the terminal and the keyboard shortcut. It must not start a replacement agent.

Refusing or ending a dock must not automatically start the private app conversation's microphone. When control attachment ends, stop the terminal's native voice through the existing voice coordinator. If Voyager cannot confirm the voice state, restore the visible controls anyway and show the voice uncertainty separately.

Keep the existing `dock` input unchanged. Inside the implementation, represent the eligibility check explicitly as ready, checking or refused, with a reason. Represent placement as placed, failed or superseded by a newer attempt. A placement function returning is not enough to report success. Use explicit types for these internal results; do not introduce a plugin interface or a general capability service. Reject docking if a control response is invalid, its generation does not match the attempt, or its window data is malformed.

Support for taking over externally started terminals remains future work. This approved interim scope stops the UI from suggesting that Voyager already supports it. Registering an agent does not transfer ownership of its process.

## Source ownership, stack and style

Keep Rust 2024 and the existing Electron 44.7.0 / Node 24 JavaScript client. This change requires no new dependency or TypeScript conversion.

- `desktop/src/main.cjs` owns drag, docking, visibility and Applications recovery; `desktop/src/binding.cjs` owns terminal identity matching.
- `desktop/src/control.cjs` holds the control connection; `src/control.rs` validates it. `src/service/voice.rs` continues to choose the voice destination.
- `src/terminal.rs` and `src/window_layout.rs` continue to handle operating-system operations. Window position and platform details must not determine whether Voyager owns a process.
- The existing behavior is documented in [lifecycle](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/lifecycle.md), [voice](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/voice.md) and [desktop](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/desktop.md). Update those documents when implementation changes that behavior.

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

These checks do not prove that a real window is placed correctly or that a sound is heard. The later plan must give the live launch commands and identify the app build, service build, display and authorized test state they use. Never remove the caller's identity to bypass a test-launch refusal.

## Success criteria and verification

| Id | Case and required evidence |
|---|---|
| D1 | Dock onto a verified target that Voyager manages. Check the signal that docking is available, one accepted control attachment for that attempt, the avatar visible in the correct position, and one success sound actually heard. Record each stage separately. |
| D2 | Try docking onto an ordinary externally started terminal, including a terminal application on the supported viewer list. Voyager refuses it without registering anything, changing authority, affecting the external process or playing a success sound. |
| D3 | Stop the target or replace its terminal client after hovering but before dropping. The drop checks must reject the old identity and leave Voyager visible. |
| D4 | Test placement failure, a delayed attachment reply from an earlier attempt, and a lost control connection. No obsolete attachment or late success sound may remain. Other terminals must be unaffected. |
| D5 | Cover, minimise and close the target; switch workspaces; change monitor arrangement and display scaling. Whenever these changes make the target unusable, Voyager must show the floating avatar without stopping the agent. |
| D6 | Open Voyager through Applications while docked and after a failed placement. The panel and avatar must appear and remain visible after later refreshes. The existing keyboard recovery must still work. |
| D7 | Dock onto Codex, dock onto Bash, and undock. Voice must follow the existing destination rules. Two microphones must not become active, and the UI must not claim voice is active without confirmation. |

Extend the Node binding/control tests and Rust control tests where behavior changes. Add a test using the real desktop app to check visibility and sound. For each failure scenario, first show that its test detects the problem in the previous behavior or in a deliberately invalid test setup. A test coverage percentage cannot replace evidence for the cases above.

For live testing, run the app and service from the same candidate revision. Record exactly which executables and display backend ran, and verify the packaged build before rollout. Test both supported terminal viewers and report any unsupported combination. Use a monotonic clock, which is unaffected by wall-clock adjustments, to time the drop, service acceptance, confirmed placement, the start of audible sound and its completion. Scheduling audio alone does not prove it was heard.

The proposed timing targets need review. In 20 unobstructed docking trials on the development Fedora desktop, at least 19 must produce audible docking feedback within two seconds of the drop. In 20 recovery trials, at least 19 must reveal both the panel and avatar within one second. Every trial must recover correctly. Record all slow and failed trials. These targets have not been measured and do not establish performance on other systems.

Keep a limited amount of diagnostic information covering the attempt's generation, target identity, eligibility, control attachment, placement and reason for recovery. Do not include terminal contents, credentials or private reasoning. Keep test results outside committed source. Keep executable test probes with their source or in temporary test output.

## Boundaries and review decisions

Undocking must leave the agent running. Recheck identity before attaching control, and say when an outcome is unknown. Review any proposal to adopt external agents, change authority or add a platform framework before implementing it.

Registration alone does not prove process ownership. Do not send input based on which desktop window has focus, or restart the service to conceal a failed dock.

The proposed behavior of undocking when another window covers the target, and the proposed timing targets, still need review. Test the failure cases described here, but do not claim they all occurred in the original incident. The evidence does not establish that sequence.
