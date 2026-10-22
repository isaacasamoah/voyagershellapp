# Voice follows the astronaut

The floating soundwave controls Voyager's private app conversation. Docking a
Codex Vessel selects that terminal's native voice. Its soundwave starts or stops
that native voice, never the private app runtime. Docking Bash stops voice and
disables the soundwave because Bash has no voice interface.

Automatic activation is on by default. Start the service with
`VOYAGER_VOICE_FOLLOWS_DOCK=0` to disable it. The setting has no panel control yet.
Undocking stops a selected native voice. Closing Electron releases control and
its app audio attachment; runtimes and capture continue.

## One participating destination

`src/service/voice.rs` owns selection. It first stops the private conversation,
then stops every live Codex registration in this Voyager service. Native stop
must produce `thread/realtime/closed`; accepting the RPC is insufficient.
Only then does it activate the destination. Missing connections, provider errors
and stale generations refuse the handoff. Nothing automatically retries a native
toggle or an uncertain selection. Explicit retries use a new action ID.

The owner CLI exposes the same decision:

```sh
voyager --state PRIVATE_DIR voice app
voyager --state PRIVATE_DIR voice DOCKED_SESSION_ID
voyager --state PRIVATE_DIR voice none
```

`status.voice` reports the target and switching, ready, on, off or failed state.
An app target becomes ready before Electron negotiates audio; the private
conversation's own status confirms its actual call. Operation receipts retain
completed, cancelled or uncertain outcomes. Native errors and closure clear the
active indication. Selecting voice changes neither rank nor registration.

This is coordination within one service, not a system-wide microphone lock.
Other Voyager services and unrelated applications are untouched. A participating
Vessel started manually outside the selected route is stopped when its native
start notification arrives. That observation cannot prevent every transient
manual overlap. During managed handoffs the previous destination stops first.

## Native adapter

The current adapter targets stock Codex 0.163.0 in a dedicated Ghostty XWayland
window on Linux. Codex retains its own audio host, authentication, interface and
input draft. Voyager sends the default F8 voice shortcut directly to that
terminal's PTY master. It never uses desktop focus, types `/voice`, submits Enter,
or reads and rewrites a draft. Custom voice key bindings are not supported.

Before writing the five fixed bytes, `terminal.rs` verifies a same-user supported viewer,
process start time, the mapped window, one PTY master, the exact Codex executable,
remote server and conversation arguments, the matching stdin slave, and the
foreground process group. `pidfd_open` anchors the terminal process;
`pidfd_getfd` duplicates its descriptor. `TIOCGPTN` checks the live master. Each
successful descriptor is wrapped once in an owned File, and ioctl pointers name
live correctly sized integers. A short write is uncertain and never replayed.
Kernel access refusal leaves system policy unchanged and voice unavailable.
No privileged helper, global shortcut or Codex patch is installed.

Native server closure confirms backend shutdown, not sample-accurate release of
every audio device. The native check observes microphone streams in addition to
service receipts. Audible quality, physical dragging and human interruption need
a user trial. Other Codex versions, accounts, terminals, platforms and Claude
need their own adapter proof.

The xterm option uses the same identity and PTY-input checks. A native fixture
confirmed one F8 sequence and rejection of a stale frontend identity on Fedora.
That is not a Codex microphone/voice pass; repeat the full app/service voice journey
with xterm before treating it as validated for everyday voice use.

## Checks

Normal Cargo tests make no model calls. They cover selection permissions,
private voice ownership, provider failure and lifecycle behavior. The opt-in
`--proof-polish` journey creates disposable real Vessels, switches Codex A to B,
switches to app audio and back, and observes native microphone streams. It also
checks native soundwave stop/start and refusal of private audio while docked.
Results stay outside the repository. See [desktop checks](../desktop/README.md#polish-and-voice-check).
