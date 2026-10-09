# Desktop experiment: one avatar, one known worker window

The astronaut floats near the top-right of the primary screen. Click it to open
or collapse a small session dashboard. Drag it onto a supported terminal to show
the session that terminal was opened for. Undocking and quitting the avatar leave
the Rust service and worker running.

This is a small Fedora experiment for an **already registered worker**. It is not
yet registration of an arbitrary running CLI. The native Codex interface remains
in Ghostty; Electron displays status and captured evidence.

## Run

Prerequisites: Linux, an X11/XWayland desktop, Ghostty, Rust, Python 3 for tests,
and Node 24. First follow [the service](service.md) and [worker](workers.md)
instructions to create a private service with one running worker.

From this checkout:

```sh
cargo build --locked --bins
cd desktop
npm ci
VOYAGER_STATE="$HOME/.local/share/voyagershell" npm start
```

Use your actual private service directory if different. Start from a terminal in
your graphical session so DISPLAY and the desktop's normal X authorization are
available. The app uses that existing authorization; it does not change permissions.

1. Click the astronaut. The panel lists registered sessions and capture status.
2. Select the managed worker and click **Open demo terminal**. This opens another
   native client of that worker, not another agent process or model conversation.
3. Drag the astronaut onto that window. The panel also offers a Dock button as a
   keyboard-accessible alternative.
4. Talk to Codex in its normal terminal. The selected session's new captured
   events appear in the panel.
5. Undock or quit the avatar. Work and event capture continue. Reopen the app and
   use Open demo terminal to establish a fresh window binding.

## How the connection works

Electron main calls the existing Rust CLI, which checks the peer of the private
service socket. A read-only Rust helper, `voyager-windows`, asks X11 for window
IDs, geometry and process IDs. Its one new crate, `x11rb`, supplies that protocol.

Opening a terminal records the launched Ghostty process, its start time, the
direct native Codex child, the exact attach arguments and native thread ID.
Docking checks that record against the live window, process identities and fresh
service status. A title is only a label. Two windows with the same title do not
become interchangeable; multiple windows in one terminal process are rejected.
Linux records children per spawning thread, so direct-child discovery checks all
threads of that one known terminal process.

The renderer has a narrow preload API, no Node access, no remote page navigation,
and no arbitrary command or socket API. Text from events is rendered as text.
Closing the UI never sends a stop command. There is no new execution engine here.

## Boundaries to try next

- Only dedicated Ghostty **XWayland** windows opened by this app are bound. Native
  Wayland windows need a GNOME adapter. Existing extensions are unchanged.
- The binding describes a **fixed launch thread**. Do not change Codex threads or
  add terminal tabs inside a bound window: a launch record cannot establish the
  foreground thread after such a change. A cooperative current-thread signal is
  needed before claiming general live-session detection.
- Keep the target terminal visible. Hit testing sees X11 windows; it cannot rule
  out a native Wayland window covering the target.
- Window bindings live for this UI run. A reopened UI can read the same service
  and events, but creates a fresh native client to establish a new binding.
- Transparency and the original artwork are present. Native background blur,
  macOS, installation at login, new-agent launch from the panel, shared memory and
  community features are not implemented here.

Electron documents the [Wayland positioning limit](https://www.electronjs.org/docs/latest/api/browser-window#platform-notices)
and [physical/DIP coordinate conversion](https://www.electronjs.org/docs/latest/api/screen#screenscreentodippointpoint-windows-linux).
See [Rust's X11 client](https://docs.rs/x11rb/latest/x11rb/) for the helper's protocol primitive.

## Proof

`npm test` checks the binding decision with same-title windows, ambiguous sibling
windows, PID reuse, a missing frontend, disconnected capture and overlapping
windows. These tests do not prove real dragging or window appearance.

`npm run proof` is an opt-in test against the private live service. It opens a
worker terminal and a separate unrelated shell with identical titles, checks
acceptance/refusal, renders actual worker events and verifies the worker's PID
and start time after undocking. Private receipts and an app screenshot are saved
inside the service directory; no transcript is committed.

The app-local proof sends pointer events only to its own renderer to check the
click toggle. Physical dragging remains a manual acceptance check. An attempted
XTEST desktop-input experiment displayed GNOME's Remote Desktop permission prompt
and did not produce a verified click, even after permission was granted. That
input fixture was removed; neither the app nor the shipped proof requires it.

Observed locally: exact binding accepted, same-title unrelated window refused,
renderer pointer events opened/collapsed the panel, real captured events rendered,
and the same worker and service were preserved after undock.
Physical pointer drag and the overall desktop appearance need user confirmation.
