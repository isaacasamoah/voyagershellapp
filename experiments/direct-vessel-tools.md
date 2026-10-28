# Native Vessel tool callback experiment

This unmerged experiment asks whether a managed Codex Vessel can call Voyager
through its existing native app-server connection, without invoking the Voyager
CLI or an MCP server for the operation. It is not a production tool integration.

`VOYAGER_DIRECT_TOOL_PROBE` enables two argument-free experimental tools on newly
created Codex threads. The worker queues native tool requests. The service binds
each request to that worker's registered Vessel and current capture generation,
then uses its normal authorization and dispatch. The model cannot supply its own
actor. The capability read must return that Vessel's Crew identity. A rank change
against a nonexistent target is an owner-only negative case and must be refused.
Replies use the native provider connection; the service never waits on its own
socket from its main loop. The tools do not edit project files.

Use a fresh private test state and the real installed Codex terminal client.
The helper `direct_vessel_tools.py STATE setup` creates one service-owned Vessel
without a viewer. Run the returned native attachment command in a terminal with
an initial instruction to call `voyager_identity` and `voyager_owner_probe` once
each, report the results, and stop. It must not use shell tools or write files.
The PTY hosts the actual Codex client, not a simulated model or replacement UI.

`direct_vessel_tools.py STATE observe` records results outside Git. Success needs
the correct caller, expected refusal, no command-execution tool and a native
`turn.completed` without an error. A completed creation receipt alone is not
success. Permit at most two short native turns, 180 seconds each, and stop after
an uncertain outcome without resubmitting the task or replacing the Vessel.
Use `direct_vessel_tools.py STATE cleanup` only for this owned experiment.

The second possible turn may originate from Voyager to distinguish callback
routing by initiating client. Native-client evidence does not prove reconnect,
Resume, Ghostty placement, Electron behavior or a latency improvement. Claude
Code testing is deferred until the user has subscription/access.

The source baseline is [the direct-choice trial](https://github.com/isaacasamoah/voyagershellapp/pull/64).
The version-sensitive mechanism is documented in
[Codex app-server](https://learn.chatgpt.com/docs/app-server#dynamic-tool-calls-experimental).
Keep the callback tool envelope matched to the installed protocol schema.

## Observed result

On 29 October 2026, one real Codex 0.165.0 terminal-client turn passed both probes
on Linux. The capabilities reply identified the correct Crew Vessel; the
owner-only probe returned `forbidden`. The service captured two dynamic tool
calls, no command-execution tool, and `turn.completed` with `has_error: false`.
The native client reported the returned identity and expected refusal. No second
turn was needed. Detaching the terminal left the managed runtime running; explicit
cleanup then stopped that runtime and its disposable service.

This supports the two probe operations for a freshly created managed Vessel and
an actual native-client turn in a PTY. It does not establish a general tool
catalog, effectful operations, recovery, OS/terminal coverage or faster startup.
The experiment remains behind its explicit flag and is not installed or merged.
Account-local receipts and native outputs stay outside the public repository.
