# One worker, its own native terminal

This increment adds one service-owned Codex app server. Your existing registered lead can call Voyager's CLI to launch it, submit a task and read its events. A separate terminal runs Codex's own interface as a client of that server. Closing the terminal leaves Voyager and the worker server running.

This uses Codex 0.162.0's [remote terminal interface](https://learn.chatgpt.com/docs/cli/reference) over a private Unix socket. It does not implement a terminal emulator, adopt an existing CLI process, relay PTY output or depend on Herdr/tmux. Other harnesses need their own integration and proof.

## Try it

Build and start the service as described in [the service guide](service.md). The service uses `codex` from its PATH for newly launched workers. If needed, set `VOYAGER_CODEX_BIN` to the absolute installed native Codex executable when starting **Voyager**. It uses the current user's existing Codex authentication/configuration; Voyager never copies credentials or changes model/approval settings.

With an existing lead registration:

```sh
target/debug/voyager --state "$VOYAGER_STATE" launch PARENT_SESSION worker-001 "$PWD" \
  "Please use no tools and change no files. Reply with: Worker connected."
```

The returned `session_id` identifies the worker. `state: running` refers to its process; `initial_request.state: accepted` acknowledges task submission. Read the recorded turn outcome to establish completion. The parent ID is an attribution supplied by a local caller, not cryptographic proof of which agent made the request.

The launch includes its initial task because, in the tested Codex version, a new empty thread could not yet be resumed by the native terminal client. The first accepted turn supplies that native session history.

In a separate terminal:

```sh
target/debug/voyager --state "$VOYAGER_STATE" attach WORKER_SESSION
```

Or open a new Ghostty window from a graphical session:

```sh
ghostty --gtk-single-instance=false --title="Voyager worker" \
  -e "$PWD/target/debug/voyager" --state "$VOYAGER_STATE" attach WORKER_SESSION
```

Window creation belongs to the desktop client/caller. `launch` starts the worker, and `attach` uses the terminal where it is called. A headless agent can launch work without needing a display. The Ghostty command requires the caller's normal graphical-session environment; an acknowledged process launch alone is not proof that a window is visible.

The native interface displays history and handles its own input and approvals. Detach by closing its window or using Codex's `/quit`; repeat `attach` to reconnect to that same live worker. Keep Voyager running. The worker may wait for a native approval; this service never approves requests automatically.

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
