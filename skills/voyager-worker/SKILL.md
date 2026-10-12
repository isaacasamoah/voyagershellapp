---
name: voyager-worker
description: Launch one real Codex worker through an existing Voyager service, give it a bounded task, and open its native terminal by default unless the user requests background-only work. Use when the user asks the docked lead to start a worker or session. Does not install Voyager, register arbitrary terminals, or change agent permissions.
---

# Start a Voyager worker

Use the existing Voyager CLI. The service owns the worker; its terminal is a
separate client. Keep the user's native agent interface.

## Resolve the request

Obtain the CLI executable and private service directory from the user's context
or `VOYAGER_BIN` and `VOYAGER_STATE`. Do not guess among running services. Obtain
the worker's working directory and initial task; create a directory only when
that is part of the requested work. Treat these as paths/data, not shell code.

Run `status` and `list` with that CLI and state directory. For a request to launch
from the docked lead, require a current `control` attachment and a connected
parent registration. Use that attachment's `session_id` and `generation`.
If the user identified a different parent, stop and explain the mismatch.
These IDs record attribution and current control; they do not authenticate the
calling agent. Do not dock or register a different session to make the check pass.

If the native agent cannot access the socket or working directory, report the
actual failure and stop. A setup label of YOLO is not evidence of this turn's
permissions. This skill does not relax permissions or retry outside the harness.

## Launch once

Choose a request ID for this launch and retain it with the task, directory and
parent. Pass the values as separate arguments:

```sh
"$VOYAGER_BIN" --state "$VOYAGER_STATE" --control "$GENERATION" \
  launch "$PARENT_SESSION" "$REQUEST_ID" "$WORKER_CWD" "$TASK"
```

The current service supports one live worker and requests YOLO at worker
creation. It includes the initial task so the native conversation can be resumed.
Do not stop an existing worker to free capacity without the user's instruction.

Read the receipt. `session_id` identifies the new worker; `state: running` refers
to its process, and `initial_request.state: accepted` acknowledges task submission.
Read `events` for the resulting turn and any errors before claiming completion.
If the reply is lost or uncertain, inspect `list` and `events`; do not invent a
new launch ID or resubmit the task. Repeating the same launch ID and identical
inputs returns its receipt without deliberately starting another worker.
If current control changed, report the stale-control refusal; do not silently
acquire a new generation and act for a different controller.

## Open the native interface by default

For a request to start a worker or session, open its native terminal after the
initial task is accepted. Skip opening the terminal when the user explicitly
asks for a background process, background-only work, or no terminal. An explicit
request to show the terminal still applies even when the task runs in the
background. Do not ask for separate confirmation to open the default interface.

After the initial task is accepted, use `attach-info WORKER_SESSION` to inspect
the native connection. `attach WORKER_SESSION` replaces its calling process, so
run it in a new terminal client, never in the lead's tool-execution terminal.
For the currently supported desktop binding, use a dedicated Ghostty XWayland
window from an available graphical environment:

```sh
GDK_BACKEND=x11 ghostty --gtk-single-instance=false --title="Voyager worker" \
  -e "$VOYAGER_BIN" --state "$VOYAGER_STATE" attach "$WORKER_SESSION"
```

Launch the window independently of the tool call. If a graphical environment is
unavailable, report that the worker exists and provide the attach command for
the user to run. Do not open a duplicate window on retry. Verify the visible
window or ask the user to confirm it; a process launch is not visual proof.
Leave docking and control transfer to the user.

Report the worker, submission/outcome, and terminal state separately. Undocking
or closing the terminal leaves the service-owned worker running. Stopping it is
a separate explicit `stop-worker WORKER_SESSION` action. This does not promise
survival of a service crash or reboot.
