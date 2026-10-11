# Docking and current control

This increment records where the human is working. One service instance has at
most one current control attachment. It is separate from registration, capture,
process ownership and worker parentage.

## Actions you can try

| Action | Service behavior |
| --- | --- |
| Drop onto a supported terminal | Register if needed, acknowledge an attachment and record `interface.docked` |
| Click the docked astronaut | Toggle the panel at its previous position; keep the same attachment |
| Hover, then leave | Brighten, then fade the marker; no service event |
| Press and pull away | Record `interface.undocked`; release control, keep agents and capture running |
| Dock another terminal | Select a new attachment; the old one cannot remain current |
| Escape after pulling away | Recheck the old terminal and acquire a new attachment |
| Quit Electron or lose its connection | Release control; keep agents and capture running |
| Close the attached terminal client | Release control; retain registration and any independent native server |
| Restart Voyager | Record release of an interrupted attachment; start without a controller |

The panel stays where it was left when the astronaut departs. Clicking the docked
astronaut does not move it home or bring the panel to the terminal. Dragging back
into the panel is a separate action. Only the terminal marker fades off hover.

## Intentional boundaries

1. **Rust owns current control.** Electron checks the native window, executable,
   fixed resume command and conversation identity. Rust checks registration,
   capture and terminal/client PID start times. It acknowledges before Electron
   shows the completed dock or plays its sound. The desktop owns the
   window-to-conversation match; Rust does not infer it from a title.
2. **An open connection represents attachment.** Electron holds one private Unix
   socket until detach. No heartbeat, lease timer, reconnect loop or new worker
   supervisor is needed. EOF releases control. A hung but connected UI is not
   detected; another deliberate dock can replace it.
3. **Each attachment has a unique generation.** It names the session, window,
   terminal/client PIDs and start times, and peer desktop process. Two windows
   showing one conversation remain distinct. Release names that generation so
   an old release cannot clear a newer attachment.
4. **History is durable; authority is live.** SQLite commits the previous release,
   new attachment and event together. The saved singleton lets restart record
   the interrupted claim's release, never restore it. Duplicate dock requests
   reuse their record; a released generation cannot reacquire control.
5. **Detach never stops execution.** This socket owns only the attachment. The
   native server or managed worker still owns execution. Service restart retains
   the recovery limits in [the service guide](service.md).

Socket loss, client exit and capture disconnection are observed in the existing
service loop. Long native RPCs can delay observation until their bounded timeout;
this is not realtime failover.

## Commands and evidence

`voyager --state PRIVATE_DIR status` includes `control` (an attachment or `null`)
and `voice`. `watch --pretty` shows `interface.docked` and `interface.undocked`,
including identity and release reason. Movement, hover and panel visibility
create no service events.

An agent or script can read the current generation and condition a command on it:

```sh
voyager --state "$VOYAGER_STATE" --control "$GENERATION" \
  send TARGET_SESSION unique-request-id "Please report your status."
voyager --state "$VOYAGER_STATE" --control "$GENERATION" \
  launch CURRENT_SESSION unique-launch-id /path/to/work "A bounded task"
```

`--control` works with `send`, `launch` and `stop-worker`. Stale generations are
refused before submitting work. A control-conditioned launch must name the
current session as parent. `undock GENERATION` releases only that attachment and
is safe to repeat. `list` and `status` stay read-only.

These are coordination preconditions, not authentication secrets. Same-user
programs already have direct CLI access. Docking grants no new permission.
Direct commands work while undocked; supervisor loops are not cancelled.
Busy-agent sends still refuse to interrupt. Priority scheduling, live steering,
supervisor arbitration and automatic tool/context installation in an existing
agent remain separate increments.

## Voice preference

Set `VOYAGER_VOICE_FOLLOWS_DOCK=1` when starting the Rust service to request voice
following. `0` (the default) leaves it disabled. Other values are rejected. The
setting is read at service startup; there is no settings UI yet.

**Automatic voice handoff is not implemented.** Enabled status says `unsupported`
with reason `native_client_voice_control_unproved`. The docked avatar's tooltip
reports this. No audio start/stop calls are sent or microphone claimed. Codex
0.162.1's installed experimental schema exposes thread realtime start/stop and
audio transport; it does not establish control of an existing terminal client's
recording/playback. The next voice experiment must prove client activation and
acknowledged stop-before-start without replacing native voice.

## Proof and limits

Service tests use real local sockets and synthetic native servers. They exercise
session switching, duplicate/conflicting requests, stale releases/commands,
wrong process start time, UI loss, terminal exit, crash recovery, normal stop,
and capture after detach. Desktop socket tests cover acknowledgement, connection
lifetime and refusal of inactive claims.

`npm start -- --proof-control` is an opt-in desktop check using two already-open
supported native clients and `VOYAGER_STATE`. It makes no model calls. It checks
Rust/desktop agreement, release/switch behavior and panel clicks through the real
renderer handler. Receipts stay in private `control-proof.json`. These
programmatic checks are `surface` evidence; physical gesture, fade and sound need
a human test. Two terminal views of one conversation prove client distinction,
not two independent agent tasks.

Support remains Fedora/XWayland, dedicated Ghostty clients and the fixed Codex
binding. Plain shells, tabs, other terminals, native Wayland and macOS have no
new support from this increment.
