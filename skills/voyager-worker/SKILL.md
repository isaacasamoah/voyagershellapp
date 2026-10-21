---
name: voyager-worker
description: Launch one real Codex worker through an existing Voyager service under its bound instance hierarchy, with a native terminal by default. Does not install Voyager, adopt external terminals, change ranks or relax permissions.
---

# Start a Voyager worker

Use the existing CLI from VOYAGER_BIN and private state from VOYAGER_STATE. Keep
VOYAGER_CALLER=instance and VOYAGER_SESSION_CONTEXT in the native tool environment.
The context locator is nonsecret; its file contains the private instance token.
Never print, copy or inspect that file. Missing or stale identity refuses access;
never remove the caller environment or use the owner socket as a fallback.

Run `capabilities`, `status` and `list`. Obtain the caller session ID from the
capability actor and the task's existing absolute directory from the user. Do
not guess among services, infer rank from a name, claim a dock, or register a
different session to acquire authority.

Creation defaults to Crew. A standing supervisor creates only its next lower
rank, assigned to itself: Admiral must explicitly select Commodore, Commodore
must select Captain, Captain may use Crew. A docked agent may also create
unassigned Crew. Undocking removes temporary cross-instance command rights and
does not make that new Crew a direct report. Bare Bash is rankless.

Choose and retain one request ID and pass values as separate quoted arguments:

```sh
"$VOYAGER_BIN" --state "$VOYAGER_STATE" \
  launch "$PARENT_SESSION" "$REQUEST_ID" "$WORKER_CWD" "$TASK" --rank "$RANK"
```

PARENT_SESSION is the bound caller, and RANK is the explicitly intended rank.
When acting for the current human dock, include `--control "$GENERATION"` before
`launch` to preserve its freshness precondition. The service also binds docked
agent mutations to the current generation automatically. A changed attachment
is a refusal, not permission to acquire a replacement generation and retry.

The default opens a native Ghostty viewer after task submission. Append
`--background` only when the user requests background work or no terminal. Do
not call open again as part of ordinary launch. If opening fails, inspect the
saved instance and deliberately repair it with `open SESSION ghostty
--request-id OPEN_ID`; do not create a replacement worker.

Read the saved result: session_id identifies the worker; runtime describes the
process; state describes launch; initial_request.state accepted describes task
submission. Check turn.completed and actual results before claiming completion.
Read `operation REQUEST_ID` after an uncertain response. The same ID and inputs
retrieve the existing result; do not invent a replacement ID or replay work.

`send TARGET REQUEST MESSAGE` delegates to a direct report, or another permitted
registered target while docked. Idle delivery starts a turn; busy delivery steers
the exact observed active turn without interruption or new-turn fallback.
`adjudicate TARGET REQUEST accept|revise|resolve MESSAGE [--about TASK]` records a
decision and attempts delivery. `escalate REQUEST MESSAGE [--about TASK]` sends a
question to the assigned supervisor, otherwise the owner. `report REQUEST
MESSAGE` records own status without starting a turn. Native harness subagents
remain under that harness, with no separate Voyager rank or credential.

Background closes a viewer while work continues. Stop-instance stops that owned
runtime and closes its viewer; runtime-only is explicit. Undock and removal do
not kill direct reports. Rank changes, assignment, removal and daemon shutdown
remain owner operations. The service is the policy authority; this skill grants
no rights and does not bypass native tool restrictions or OS permissions.

While docked, `fleets` reads visual groups and `move-vessel VESSEL FLEET|none`
moves a Vessel with its assigned descendants. Include `--control GENERATION`
when acting for the human. Fleet membership changes no rank or supervisor.
Undocking removes this Fleet-editing permission.
