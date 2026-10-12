# Create an instance, then open its native terminal

The first backend increment creates one named Codex conversation without an
existing lead or initial prompt. Voyager owns its app server, records the native
identity and captures future events before opening a Ghostty window. Creating
or opening does not select human control; docking remains a separate operation.

The panel's plus button, terminal picker and remembered preference are not
implemented yet. This increment supports Codex 0.162.1 in a dedicated Ghostty
XWayland window on Linux. Claude, Ptyxis, native Wayland and macOS need their
own implementation and proof.

## Try it

Build from the repository root. Start Voyager from your graphical login so open
requests can reach the display. Native `codex` and `ghostty` must be on its PATH;
`VOYAGER_CODEX_BIN` may select an absolute native Codex executable. Authentication
and model selection stay with Codex.

```sh
cargo build --locked --bins
VOYAGER_STATE="$HOME/.local/share/voyager-instances"
target/debug/voyager --state "$VOYAGER_STATE" serve
```

No external socket is needed: the service starts with zero agents. Keep it
running in its own terminal, or run it independently with your process manager.
This repository does not yet install an OS background service.

In another terminal, with the same state directory:

```sh
VOYAGER_STATE="$HOME/.local/share/voyager-instances"
target/debug/voyager --state "$VOYAGER_STATE" create create-001 "My project" "$PWD"
```

Use the returned `session_id` below:

```sh
target/debug/voyager --state "$VOYAGER_STATE" open SESSION_ID ghostty
target/debug/voyager --state "$VOYAGER_STATE" list
target/debug/voyager --state "$VOYAGER_STATE" watch --pretty
```

`create` saves the name, canonical folder, launch state and managed identity.
Repeated delivery of the same request ID and inputs returns the saved receipt;
changed inputs conflict. A failed or stopped request is not automatically
restarted. No parent or model prompt is required.

`open` returns `state: opening` and records `interface.open_requested`. These
mean a native client process started, not that a usable window was seen. Check
the desktop. Calling it again opens another client, not another agent or an
automatic focus of the first window. Window readiness/failure reporting remains
pending. A failed opening leaves the registered instance available.

Type or speak in the native agent interface. Capture records completed user and
assistant text, tool lifecycle metadata and turn outcomes. It omits tool
arguments/results and terminal pixels. Close that client and repeat `open` to
rejoin the same conversation. Explicit stop remains separate:

```sh
target/debug/voyager --state "$VOYAGER_STATE" stop-worker SESSION_ID
target/debug/voyager --state "$VOYAGER_STATE" stop
```

The existing `stop-worker` operation applies to this managed instance too.
`stop` refuses while its runtime is alive. Crash/reboot survival is outside this
increment; see [worker lifetime](workers.md#persistence-boundary).

## Native decisions

In installed Codex 0.162.1, `thread/start` alone left the empty conversation
unavailable to the native terminal: resume reported no rollout. Setting the
person's chosen name through `thread/name/set` materialized its native history.
The terminal could then resume the same thread with **zero turns**. No hidden
setup prompt or fabricated conversation is needed.

The adapter explicitly requests `historyMode: legacy` because the installed
default rejected full-history reading in the compatibility probe. These are
version-specific findings, not guarantees about other Codex builds. The methods
are described in the [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server).

The owned server process receives `approval_policy="never"` and
`sandbox_mode="danger-full-access"`; thread creation requests the same policy.
This is the selected YOLO default. Global configuration and externally registered
conversations are untouched. Native resume gets no unsupported permission flag.

## Native evidence — 12 October 2026

Actor: a developer using the backend CLI and the actual Codex interface in
Ghostty on Fedora. Acceptance input went through the desktop window, not
Voyager's `send` operation.

| Action | Observation |
| --- | --- |
| Start without an external server | Zero registered and zero capturing sessions. |
| Create with an invalid folder | Error; no registration. |
| Create a named instance; repeat the request | Same saved receipt; one registered/capturing instance, no parent, prompt, model turn or control claim. |
| Open through the backend | Real Ghostty window displayed the empty native interface and YOLO label. |
| Enter a harmless Voyager `status` request | Tool succeeded; user/assistant messages, tool lifecycle and completion were captured. The actual native turn recorded `never` and `danger-full-access`. |
| Quit the client; open again | Client exited while capture stayed connected. Reopen retained the server and conversation; the new window displayed the previous exchanges. No second registration or automatic control. |
| Open a bare shell separately | Ordinary terminal appeared; the registry still contained only the Codex instance. |

The first test instruction accidentally included a trailing `.` argument. The
command failed with a usage error and Voyager captured that failure. The
corrected instruction succeeded. A completed model turn was not treated as
command success. Both outcomes remain in the private evidence.

This proves create/open, native turn permissions and idle close/reopen. It does
not resolve the earlier external lead's permission drift, establish YOLO for
every launch path, or repeat the active-task detach proof from the
[earlier worker experiment](workers.md#measured-on-9-october-2026). The new path's
physical panel create/dock/undock journey is still pending.

## Bare shells and current limits

```sh
target/debug/voyager --state "$VOYAGER_STATE" open-shell "$PWD" ghostty
```

This opens the person's ordinary shell. The receipt explicitly says
`registered: false`, `capturing: false`, `ownership: terminal`. Closing it has
normal shell lifetime behavior. Managed-shell commands, output capture,
persistence and docking need a separate capability and input-ownership design.

Only one managed runtime is allowed, whether created here or launched as a
worker. An external lead can launch one worker; a managed lead cannot yet launch
a second managed runtime. Roles, groups and concurrent agent fleets are later
increments.

The service owns create/open/status/capture. Native opening uses separate argv
arguments, not a caller-supplied shell command. Same-user socket access does not
isolate mutually untrusted YOLO agents. Known creation identity does not prove
discovery of an independently opened terminal or a later in-client conversation
switch; see [terminal discovery](terminal-discovery.md).

## Source and checks

- `src/service.rs`: create/open operations and lifecycle.
- `src/worker.rs`: native process ownership and named empty-thread creation.
- `src/terminal.rs`: the small Ghostty launcher, with no terminal emulator.
- `src/store.rs`: persisted name, optional parent/prompt and schema migration.
- `tests/service.rs`: service-boundary regression cases for creation, duplicate
  and conflicting requests, invalid folders, missing native executables and
  migration preserving attribution/events.

Run the checks in [CONTRIBUTING.md](../CONTRIBUTING.md). Fixtures do not establish
native desktop behavior. Private transcripts, screenshots and local IDs remain
outside this public repository.
