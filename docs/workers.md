# One worker, its own native terminal

This increment adds one service-owned Codex app server. Your existing registered lead can call Voyager's CLI to launch it, submit a task and read its events. A separate terminal runs Codex's own interface as a client of that server. Closing the terminal leaves Voyager and the worker server running.

This uses Codex 0.162.0's [remote terminal interface](https://learn.chatgpt.com/docs/cli/reference) over a private Unix socket. It does not implement a terminal emulator, adopt an existing CLI process, relay PTY output or depend on Herdr/tmux. Other harnesses need their own integration and proof.

## Try it

Build and start the service as described in [the service guide](service.md). The service uses `codex` from its PATH for newly launched workers. If needed, set `VOYAGER_CODEX_BIN` to the absolute installed native Codex executable when starting **Voyager**. Authentication and model selection stay with the user's native Codex configuration; Voyager never copies credentials.

Every Voyager worker creation requests **YOLO**: `approvalPolicy: never` and
`sandbox: danger-full-access`. The owned server process now starts with matching
defaults. This permits commands without the command sandbox or approval prompts.
The [named-instance experiment](instances.md) verified an actual terminal-entered
turn and service call with that policy. The earlier external lead's read-only
turn below remains a separate unresolved case. The tested Codex 0.162.1 remote
resume rejects permission CLI flags. This prototype has one launch policy; a
user-selectable alternative belongs to a later app increment. Registration does
not intentionally change an external session's permissions. The lead must itself
have permission to call Voyager's local socket.

With an existing lead registration:

```sh
target/debug/voyager --state "$VOYAGER_STATE" launch PARENT_SESSION worker-001 "$PWD" \
  "Please use no tools and change no files. Reply with: Worker connected."
```

The returned `session_id` identifies the worker. `state: running` refers to its process; `initial_request.state: accepted` acknowledges task submission. Read the recorded turn outcome to establish completion. The parent ID is an attribution supplied by a local caller, not cryptographic proof of which agent made the request.

`launch` includes the worker's assigned task. Its accepted turn supplies native
history before attachment. To create an empty conversation without a parent or
setup task, use [the named-instance flow](instances.md); it materializes native
history by setting the chosen name instead.

In a separate terminal:

```sh
target/debug/voyager --state "$VOYAGER_STATE" attach WORKER_SESSION
```

Or open a new Ghostty window from a graphical session:

```sh
ghostty --gtk-single-instance=false --title="Voyager worker" \
  -e "$PWD/target/debug/voyager" --state "$VOYAGER_STATE" attach WORKER_SESSION
```

`launch` starts the worker; `attach` uses the terminal where it is called. A
headless agent can launch work without a display. `open WORKER_SESSION ghostty`
now requests a native window through the same service boundary. The explicit
Ghostty command above is also possible. Either opening path needs the caller's
normal graphical-session environment; process launch alone does not prove a
visible window.

The native interface displays history and handles its own input. Detach by closing its window or using Codex's `/quit`; repeat `attach` to reconnect to that same live worker. Keep Voyager running. Voyager requests YOLO at worker creation; `attach` only executes the native resume command and does not select permissions. Voyager does not answer native approval requests on an agent's behalf.

Inspect activity or send another task:

```sh
target/debug/voyager --state "$VOYAGER_STATE" list
target/debug/voyager --state "$VOYAGER_STATE" watch --pretty
target/debug/voyager --state "$VOYAGER_STATE" send WORKER_SESSION task-002 "Your next task"
```

Repeated launch IDs with identical inputs return the stored launch; changed inputs conflict. A second live worker is refused in this increment. Closing a viewer never issues stop. To end the worker explicitly:

```sh
target/debug/voyager --state "$VOYAGER_STATE" stop-worker WORKER_SESSION
target/debug/voyager --state "$VOYAGER_STATE" stop
```

`stop-worker` terminates the process group Voyager created for that worker server. It is not a task-cancellation acknowledgement: unfinished task outcomes remain uncertain without native evidence. Cleanup of commands that independently escape that process group is not proved. Ordinary `stop` refuses while the owned server is alive, even if it is idle. External sessions are never valid `stop-worker` targets.

## Worker skill

[voyager-worker](../skills/voyager-worker/SKILL.md) describes the existing CLI
workflow for an agent. It checks current control, launches one bounded task and,
when requested, opens the worker's native terminal. It introduces no executable
wrapper or new service API. It does not grant permissions or discover an
arbitrary running terminal.

Install the skill directory in your harness's skill location. For Codex, from
the repository root, this links the maintained source into the user skill catalog:

```sh
mkdir -p "$HOME/.codex/skills"
ln -s "$PWD/skills/voyager-worker" "$HOME/.codex/skills/voyager-worker"
```

Do not replace an existing installation without inspecting it. Supply the CLI
path and private state directory in the agent's task context, or through
`VOYAGER_BIN` and `VOYAGER_STATE` in its actual execution environment. Do not
assume a terminal's environment reaches a separately running agent server.
Keep private paths, conversation IDs and credentials out of the shared skill.

Invoke `$voyager-worker` with a working directory and initial task. Refresh the
harness's skill catalog if needed. Catalog discovery and format validation do
not prove a successful launch; verify the service's receipt and turn events.

The initial skill passed format validation and was discovered as enabled by the
running native Codex server's `skills/list` with `forceReload`. Its first live
worker launch is still pending the permission check below.

## Earlier manual run: external lead permission failure

The 11 October fresh lead's setup turn recorded `never` approvals and
`danger-full-access`. Subsequent turns entered through its native terminal
recorded `read-only`. Its attempt to call Voyager's `status` failed with
`Operation not permitted`; no worker was launched in this run. Earlier successful
worker experiments below remain historical evidence, not proof of this launch.

The transition that changed the effective policy has not yet been isolated.
Check a real tool call from the native interface after correcting its permissions,
then retry the same bounded worker request. Neither a YOLO launch request nor an
attachment response alone proves the policy of the next terminal-entered turn.

## Persistence boundary

Voyager retains the child process, observer connection and native thread identity while terminal clients come and go. Parent/session/request/turn IDs link the resulting records. The initial capture policy remains unchanged: text and lifecycle metadata, not tool arguments/results or terminal bytes. The native UI can display its own richer history independently of Voyager's capture policy.

A normal service error runs owned-child cleanup; abrupt termination can leave a worker unobserved. On service restart, previous starting/running launches become `unknown`; the service does not trust saved PIDs, kill possible replacements, replay prompts or silently restore ownership. Unknown launches block further launches until explicitly investigated. Automatic recovery, retention pruning, concurrent worker fleets and a complete task result/cancellation API remain later increments. Socket directories and private records persist until explicitly removed after shutdown. There is no OS service installer yet.

## Measured on 9 October 2026

On Fedora 43 and Codex 0.162.0:

1. An existing registered Codex agent invoked the new `launch` CLI and received its worker identity and accepted initial request.
2. The worker read a harmless fixture and returned `VOYAGER_WORKER_42`. Its own Codex terminal showed the conversation.
3. During a second task, the dedicated Ghostty window process was terminated. Its native Codex frontend exited. The separately owned worker server kept the same PID and process start time, completed its delayed command, and returned `VOYAGER_DETACHED_42` while that window was absent.
4. A fresh native terminal client reattached to the same thread. Its rendered terminal transcript contained both results. A Ghostty client was also reopened for the user; desktop screenshot access was denied, so exact desktop appearance still needs user confirmation.
5. The lead agent retrieved both results through Voyager's event CLI and reported both completed turns. A readable event watcher was left available alongside the native worker window.

The native shell printed an existing startup warning about a read-only shell-environment directory; inspection of its expanded transcript showed the delayed command's marker and successful completion. No shell profile or permission setting was changed to suppress that warning.

The disposable worker test provides the known-different arm: explicit stop during a second task ends the server without manufacturing a successful turn. It also proves duplicate-launch reuse, rejection of another concurrent worker, parent linking and continued access to the unrelated external server. This is one local integration, not a claim of arbitrary CLI adoption or crash/reboot survival.

## YOLO default verified on 11 October 2026

On Fedora and Codex 0.162.1, a selected demo lead in YOLO mode invoked Voyager's `launch` command. The new worker successfully called Voyager's `status` command and returned the requested marker. Both native transcripts recorded `danger-full-access` and `never`. After opening their separate Ghostty clients, native session responses still reported those permissions, and the desktop adapter recognized both exact terminal/session identities.

The earlier read-only lead could not reach Voyager's socket. Passing permission overrides to `thread/resume` did not change that already-loaded thread; a new turn with explicit `sandboxPolicy: {type: dangerFullAccess}` and `approvalPolicy: never` did. That was an explicitly authorized demo setup change, not part of registration. Remote terminal resume rejected a YOLO CLI flag, so attachment keeps its original arguments and inherits the server-side policy. The temporary test worker was explicitly stopped before reloading the corrected service; a fresh lead-launched worker and its terminal were then verified and left available.

The worker fixture rejects missing or different launch policies. The service test also checks that native attachment contains no unsupported permission override, while the external-registration test continues to require unchanged permissions. Physical dragging, the docked overlay and the final visual feel remain separate user checks.
