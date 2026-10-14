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

The service supports several managed instances and requests YOLO at worker
creation. It includes the initial task so the native conversation can be resumed.
Do not stop an existing worker to free capacity without the user's instruction.

Read the saved operation result. `session_id` identifies the new worker;
`runtime: running` describes its process, `state: completed` describes the launch
action, and `initial_request.state: accepted` acknowledges task submission.
Read `events` for the resulting turn and any errors before claiming completion.
If the reply is lost or uncertain, inspect `list` and `events`; do not invent a
new launch ID or resubmit the task. Repeating the same launch ID and identical
inputs returns its receipt without deliberately starting another worker.
If current control changed, report the stale-control refusal; do not silently
acquire a new generation and act for a different controller.

## Native interface and lifecycle

`launch` opens the worker's native Ghostty interface after task acceptance.
Do not call `open` again as part of the normal launch. When the user explicitly
asks for background-only work or no terminal, append `--background` to `launch`.
An explicit request to show the interface still means the normal default launch.

If opening fails, the operation result may retain a real running instance.
Inspect `operation REQUEST_ID` and `list`; do not make a replacement launch ID.
A deliberate repair uses `open WORKER_SESSION ghostty --request-id OPEN_ID` to
reopen the same instance. A lost acknowledgement reuses the same ID and inputs.
Opening requests focus when that owned window is already open. Leave docking
and control transfer to the person.

Report launch outcome, task outcome and terminal state separately. Undocking or
closing the terminal leaves work and capture running. `background WORKER_SESSION`
closes the viewer while work continues. `stop-instance WORKER_SESSION` stops the
owned runtime and closes its viewer; `--runtime-only` explicitly requests only
runtime shutdown. `remove WORKER_SESSION` deregisters future capture and
instructions, preserving history; `--stop` stops and closes first. These actions
never promise survival of a daemon crash or reboot.
