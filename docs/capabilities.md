# What Voyager Shell can do

This reference describes the experimental local build in
[the accepted viewer-recovery revision](https://github.com/isaacasamoah/voyagershellapp/tree/abb9fe0a24653302434f803a9a278edd97bb8369).
It groups available actions by task. The owning guides define exact inputs,
permissions, and failure behavior. Native evidence is limited to the Linux,
provider, and terminal combinations described in [the README](../README.md).

A **Vessel** is a registered agent or terminal. A **Fleet** is a local grouping of
Vessels. A running runtime, an open viewer, connected capture, and a completed task
are separate observations.

## Create and manage work

| Action                        | Effect and entry point                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create an agent               | Panel **+** or `create codex` starts a managed Codex conversation, registers it, starts capture, and opens a viewer by default. Creation alone submits no task.             |
| Create a terminal             | Panel **+** or `create shell` starts persistent Bash with shared working directory, variables, and shell state. Bash has no agent rank.                                     |
| Launch delegated work         | `launch` creates a separate managed agent and submits its initial instruction. Acknowledgement is distinct from completed work.                                             |
| Choose a viewer               | Select Ghostty or xterm at creation. `open` or **Open viewer** can select a viewer after backgrounding the existing one.                                                    |
| Open or bring forward         | Click a Vessel card or use `open`. Focuses its verified existing viewer or opens a new attachment to the same runtime.                                                      |
| Minimise                      | Retains the terminal client and runtime. Selecting another Vessel may minimise other managed viewers.                                                                       |
| Background                    | Vessel menu or `background` closes the owned viewer while runtime and capture continue.                                                                                     |
| Rename                        | Vessel menu or `rename` changes its display name without changing runtime identity.                                                                                         |
| Stop                          | Vessel menu or `stop-instance` stops the selected owned runtime and closes its viewer by default. `--runtime-only` skips the explicit viewer-close request.                 |
| Remove                        | Vessel menu or `remove` ends future capture and routing, retaining history and any running runtime.                                                                         |
| Stop and remove               | Vessel menu or `remove --stop` stops and closes before deregistration.                                                                                                      |
| Register again                | `register-instance` explicitly restores future capture for a retained removed instance. It imports no removed-period history.                                               |
| Resume a stopped conversation | Previous vessels **Resume**, or owner `resume-instance`, starts an eligible saved Codex conversation without submitting work. Viewer opening is separate.                   |
| Recover a surviving runtime   | Background checks verify a previously managed Codex runtime and reconnect to it without replacing it or replaying a task. Verified surviving viewers can also be recovered. |
| Browse earlier work           | Previous vessels exposes bounded saved events; Removed vessels has a separate history view. Unknown process state is kept distinct from a confirmed stop.                   |

See [creation](instances.md), [lifecycle](lifecycle.md), and
[the Resume specification](../SPEC-conversation-resume.md). Manual retry and later
panel changes have separate work records; they are not implied by this baseline.
Reconnection never restores an old dock or proves a previously failed voice path
is fixed. Crash and reboot survival are not general guarantees.

## Organize and select Vessels

| Action                            | Effect and entry point                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create, rename, or remove a Fleet | Panel Fleet controls or owner `create-fleet`, `rename-fleet`, and `remove-fleet`. Removing a Fleet returns members to Vessels without stopping them.  |
| Move work into a Fleet            | Creation form, drag/drop, or authorized `move-vessel`. Moving a supervisor carries assigned descendants, including ones previously grouped elsewhere. |
| Arrange related windows           | Click a Fleet name to surface its running Vessels in the provided tiling layout.                                                                      |
| Inspect the command hierarchy     | Expand rank rows to see assigned reports. Groups and sorting derive from service assignments.                                                         |
| Dock the astronaut                | Drag it onto a supported running, connected, managed Vessel. Hover and drop verify target identity. Unsupported targets refuse visibly.               |
| Undock                            | Pull the astronaut away or use the documented keyboard action. Accepted work and capture continue while temporary docking authority ends.             |
| Recover the controls              | Rejected or lost targets reveal floating controls. Launching Voyager again provides an independent way to show the interface.                         |

[Fleet behavior](fleets.md) and [docking](desktop.md) have separate contracts.
Fleet membership and window placement never grant instruction authority.

## Coordinate agents and shells

| Action                       | Effect and entry point                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect allowed actions      | `capabilities` reports bound identity, rank, direct reports, and current permitted scope.                                                                      |
| Choose rank and assignment   | Owner panel controls, `rank`, and `supervise` select Admiral, Commodore, Captain, or Crew and explicit direct relationships. Bash stays rankless.              |
| Delegate downward            | A standing supervisor may create the next lower rank assigned to itself and instruct direct reports. Rank alone grants no peer or skipped-level access.        |
| Send an instruction          | Authorized `send` starts an idle turn or steers the exact observed active turn. It does not silently interrupt, replay, or fall back to another turn.          |
| Use temporary dock authority | The currently docked agent may perform the permitted cross-Vessel actions. Docking neither promotes rank nor grants private-conversation access.               |
| Report status                | `report` records the caller's own non-instructive status without starting a turn elsewhere.                                                                    |
| Escalate a question          | `escalate` routes to the assigned supervisor or records a question for the owner. It grants no upward instruction authority.                                   |
| Record a decision            | `adjudicate` records accept, revise, or resolve and attempts native delivery. Recording and delivery have separate outcomes.                                   |
| Answer an owner question     | The app conversation presents the source question and forwards the actual human reply bound to that request. The model cannot invent approval.                 |
| Run a shell command          | Authorized `shell-exec` submits to the existing ready Bash session. `shell-read` reads bounded live output and readiness. Output is not durable event history. |
| Attach a native client       | `attach` and `shell-attach` connect a terminal to an existing managed runtime. Owner `attach-info` inspects attachment identity.                               |

Read [authority](authority.md) and [CLI syntax](service.md#commands) before scripting.
Agent callers use their bound native environment and stable request IDs. This is
cooperative authorization between local agents sharing one OS user, not isolation
from hostile processes with that user's OS access.

## Talk to Voyager

| Action                              | Effect and entry point                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat with the private app assistant | Use the panel composer or owner `chat`. Named tools inspect service state and administer Vessels and Fleets.                                                                                     |
| Inspect local context               | The private assistant can perform bounded read-only searches and reads of work files, transcripts, captured Codex events, and retained Bash output. Project changes can be delegated to Vessels. |
| Use app voice                       | The floating soundwave starts the private conversation's microphone/playback session when the native provider and account support it. Startup alone does not activate app voice.                 |
| Use native Codex voice              | Docking a managed Codex Vessel selects its native voice, with automatic activation enabled by default. Its soundwave controls that destination. Bash has no voice interface.                     |
| Stop or change voice                | Soundwave, undocking, and owner `voice app`, `voice none`, or `voice SESSION` follow the voice coordinator's destination rules. Closing Electron stops its audio attachment.                     |
| Read private conversation results   | Expand panel history or use owner `conversation` and `chat-operation`. History is bounded and in memory for the service lifetime.                                                                |

The private conversation is not a ranked Vessel and is unavailable to instance
callers. Its provider and history remain separate from Vessel capture. Read
[conversation setup](harness-runtime.md) and [voice limits](voice.md).
Voice availability, decoded audio, and a successful runtime turn do not establish
that a person heard an answer. A native voice-start failure remains deferred in
[the accepted recovery decision](../SPEC.md#this-build-branch).

## Inspect events and outcomes

| Action                           | Effect and entry point                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect service and Vessels      | `status` and `list`, with `--include-removed` for retained records. Owner `escalations` reads questions and reply outcomes.                                                             |
| Read saved operations            | `operation REQUEST_ID` retrieves a submission/lifecycle receipt. Retain the original request ID after an uncertain reply.                                                               |
| Read recorded events             | `events CURSOR` pages up to 100 events after an exclusive cursor. `watch` follows JSONL; `watch --pretty` prints a readable view. Reads remain caller-scoped.                           |
| Connect an external Codex server | Start with an explicit external socket, use `connection-info` and `discover`, then `register` a loaded thread. Registration observes future events without owning the external process. |

The capture policy records completed user/assistant text, turn outcomes, and tool
lifecycle metadata. It excludes private reasoning, tool payloads, old conversation
snapshots, and raw terminal output. Capture gaps are recorded when possible;
missing events are not reconstructed through automatic task replay.

Recorded events live in a private local SQLite database. Fleet metadata is stored
separately under the same service owner. Codex still communicates with its
configured model provider. Local event storage does not make model inference
offline. Voyage sharing and knowledge extraction are not implemented.
See [capture and retention](service.md#what-is-recorded).

## Run the service and development trials

| Action                  | Effect and entry point                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start or reconnect      | Opening Electron uses `start`. Headless `serve` runs in the foreground; `start` launches independently.                                                             |
| Close the desktop       | Quits Electron and releases its control/audio connections. Managed runtimes and capture remain running.                                                             |
| Stop Voyager            | Panel **Stop service** or owner `stop`. Refuses while managed Vessels remain alive, including removed ones. No login startup or automatic restoration is installed. |
| Grant a checkout trial  | Explicit owner `test-grant` authorizes one named agent to run a specific checkout in a fresh service/profile. `test-revoke` withdraws it.                           |
| Run and inspect a trial | Granted `test-start`, `test-runs`, `test-read`, and `test-stop` operate on the caller's authorized runs. The candidate uses a separate service and state.           |

[Development runs](development-tests.md) do not grant control of the installed app.
A runner receipt is separate from a passed native journey. Development tools,
model accounts, and private evidence are not required merely to read these docs.
