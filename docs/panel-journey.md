# Panel creation journey — 12 October 2026

**Locally proved, with a human gesture check still open.** The tested increment
starts Voyager, creates a real Codex instance and managed Bash from the panel,
records their work, changes control through docking and preserves the shell
when its native window closes. This is not proof of arbitrary terminal discovery.

## Intent and decisions

1. A person uses **+** to create either Codex or Terminal · Bash, with a name and
   working folder. Creation registers/captures before interaction and opens a
   native Ghostty window. The service owns execution; Electron owns presentation.
2. Dock selects the current human command surface; undock releases it while work
   and capture continue. Bare Bash is a workspace an agent can use, not a model.

The service exposes these operations once, through its Unix socket/CLI. The panel
and agent use that surface. No captain/crew role system, knowledge graph, terminal
picker or automatic restart was added. Ghostty/XWayland is the first supported
launcher. Bash has one explicit prompt/capture profile; other profiles are not
claimed to work. The small PTY transport exists only for that shared shell; Codex
still uses its own app server and remote native interface.

This follows the prototype principle: preserve the real difficulty in the
smallest complete journey. A fixture server is regression evidence, never a
substitute for a real Codex or desktop result.

## Observations

Actor: test operator using Electron's real renderer controls and native Ghostty
windows on Fedora, with Codex 0.162.1. The desktop was driven programmatically;
this is separate from Isaac checking physical gestures and appearance.

| Setup and action | Observation and decision |
| --- | --- |
| Start the app with an empty private state directory | A separate Rust service starts with zero registrations. |
| Choose a nonexistent folder in the form | Creation fails and the registry stays empty. Correcting the folder then works. |
| Create Navigator (Codex) and Workbench (Bash) through the form | Two real native windows, two registrations and connected capture; no hidden setup prompt and no initial control claim. |
| Enter a shell variable in Workbench, then ask Navigator to read it through Voyager | Native Codex tool calls invoke `shell-exec` on the existing shell. `printf` returns `human` with exit 0; attributed shell events and the captured Codex reply agree. |
| Inspect those actual native Codex turns | Both record `never` approval and `danger-full-access`. A YOLO label alone was not the check. |
| Run the opt-in control proof against the two new native clients | Codex dock, undock and Bash dock are recorded; stale release cannot clear the new attachment. Clicking toggles the panel at its saved location without releasing control. These are programmatic main/renderer operations, not a physical drag claim. |
| Close Electron | Same service instance, both registered runtimes and capture remain active. |
| Submit a delayed command, close Workbench's Ghostty process before completion | Same Bash PID finishes and returns `DETACHED:human`, with exit 0 and both instances still capturing. Its closed frontend releases control. |
| Reopen Workbench using its panel arrow | New real Ghostty client reconnects to the same Bash; the native window displays the previous output and a usable prompt. |

A live failure changed the implementation: inheriting `VOYAGER_BIN` and
`VOYAGER_STATE` into the Codex server did not put them in its core-only tool
environment. The launcher now sets those two values through Codex's native
`shell_environment_policy.set`, leaving global configuration and credentials
alone. The successful native tool calls happened after that correction.

Desktop keyboard injection initially lost focus and produced incomplete test
commands. Those failures remain in the private capture, including exit 127.
They were not counted as successful shared-state proof. A later complete export
and native Codex request produced the successful result above. No failed request
was silently declared complete or erased.

## Regression checks and limits

Rust: formatting, strict Clippy, twelve service tests and eight earlier disposable
process cases. The real Bash test covers shared variables/folders, partial human
input, partial typeahead during work, command outcomes, close/reopen and explicit
stop during an active job. Multiple owned Codex processes are checked independently
against protocol fixtures. Electron: formatting and eight tests covering identity,
control socket lifetime, duplicate clicks and opening retries.

Private native receipts, screenshots, service records and transcripts stay outside
Git. The public repository contains the implementation, test fixtures and this
account of what was observed.

**Remaining human check:** create your own instance, physically pull the astronaut
onto it, hover, click, undock and redock, and judge the sounds and feel. The prior
opaque-terminal interaction was user-tested; this new combined journey still
needs that check. Other terminals, shell customizations, macOS, native Wayland,
arbitrary CLI discovery, voice handoff and service crash/reboot recovery remain
outside the demonstrated boundary.

## Follow-up — bring an existing terminal forward

At this earlier checkpoint, the panel arrow called the same `open` operation for both reopening and
activation. With two real managed Bash/Ghostty windows on Fedora, window B was
made active first, then `open` for A changed the window manager's active-window
property to A. Window IDs, shell PID, registration count and control state did
not change; no duplicate client or runtime was created. A stopped instance's
open was refused. This exercises the real backend/desktop operation. The arrow was subsequently replaced by the instance card; current behaviour
is defined in [Vessels and fleets](fleets.md).

The isolated service and both test terminals were explicitly stopped afterward.
The current voice-test service was not restarted or upgraded. Formatting, the
12 service tests, 8 process cases, strict Clippy and 8 Electron tests pass.
