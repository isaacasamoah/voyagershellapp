# Voyager desktop

A small Electron client of the Rust service. It displays local agent connections
and a draggable astronaut; it does not run an agent, emulate a terminal or handle
model conversations.

See the [desktop guide](../docs/desktop.md) for setup, gestures and the limits of
the current Ghostty XWayland adapter. The first version runs on Fedora; macOS and
native Wayland behavior still need their own proof.

## Development

Use Node 24. From this directory:

```sh
npm ci
npm run format:check
npm test
```

Build the Rust binaries from the repository root with `cargo build --locked
--bins`, then open Electron; it connects to or starts the [service](../docs/service.md). From this
directory, in a graphical-session terminal:

```sh
VOYAGER_STATE="$HOME/.local/share/voyagershell" npm start
```

The directory is created privately if absent. Use the panel’s **+** to create a
Codex instance or managed Bash and **↗** to reopen its native interface or bring
its existing window forward. `npm start -- --expanded` opens the
panel immediately. Quit and restart Electron to pick up changes to the main
process or preload. The service and its workers keep running independently.
If Electron's binary download was skipped during installation, run
`node node_modules/electron/install.js` once before starting it.

## Source map

| File                                     | Owns                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `src/main.cjs`                           | Native windows, gestures, IPC authorization and service calls                 |
| `src/binding.cjs`                        | Process identity and exact terminal-to-session matching                       |
| `src/instances.cjs`                      | Creation validation, pending request identity and retry after opening failure |
| `src/control.cjs`                        | Persistent attachment socket, acknowledgement and connection loss             |
| `src/preload.cjs`                        | The renderer's small, allowlisted IPC API                                     |
| `src/ui/renderer.js`                     | Agent rows, pointer input and local sound cues                                |
| `src/ui/index.html`, `style.css`         | The glass interface and accessibility labels                                  |
| `src/ui/candidate.html`, `candidate.css` | Passive outline around a possible docking target                              |
| `src/whiteboard.cjs`                     | Drawing mode, panel bounds and snippet insertion                              |
| `src/screenshot.py`                      | One interactive Linux screenshot portal request via Python GI                 |
| `src/ui/whiteboard/`                     | Drawing, direct text editing and selection                                    |
| `assets/`                                | Astronaut artwork and its attribution                                         |

There is no frontend framework or bundler. Main owns the state; the renderer
receives a display snapshot and sends explicit user actions. Keep filesystem,
process and service access in main, behind the isolated preload boundary. Never
put native credentials or conversation text into the renderer.

The panel and astronaut are separate transparent windows so holding and pulling
the astronaut can leave the panel in place. A seated astronaut is a child of the
visible panel; floating detaches that relationship. The native panel background
is draggable outside drawing mode. Opening the collapsible Whiteboard section
reveals the drawing controls; see [the whiteboard guide](../docs/whiteboard.md).
Drawing expands the panel window while preserving the sidebar and astronaut
positions; closing drawing restores its bounds. The astronaut and buttons are excluded from native drag regions so
their clicks reach the renderer.

Terminal docking now also holds a service control connection. Its lifetime is
independent of panel visibility. Lifecycle menus use named preload methods and
the same CLI/service operations as an agent. Native popovers keep the scrolling
instance list from clipping actions. Main never kills an agent directly. Clicking the docked astronaut reveals the panel
at its saved position; it never moves the astronaut or releases control.
See [the control contract](../docs/control.md) for events, exact-generation release,
restart behavior and the unimplemented voice handoff. `test/control.test.cjs`
checks socket lifetime; `npm start -- --proof-control` exercises two existing
native clients without model calls.

## Testing changes

`test/binding.test.cjs` checks identity mistakes and refusal cases without a
desktop, model or credentials. `test/live-proof.cjs` is an explicit integration
check, invoked by `npm run proof`, using an already running service and supported
registered native terminal. It checks the actual X11 window stack as well as the renderer:
injected clicks can pass even when another native window covers the astronaut.

The live proof creates and closes one unrelated shell as a counterexample. It
does not submit work to a model or inject desktop-wide mouse input. Its receipts
and screenshots stay in the private service directory. It leaves the panel open
and the marker docked for a human to check appearance, physical gestures and sounds.

Keep changes small, explain what was actually observed, and update the user guide
with behavior changes. Reports of a failed native interaction are useful: include
the OS, display setup and steps, with private session details removed.

`test/registration-proof.cjs` is the separate opt-in native registration check.
`npm start -- --proof-registration` requires `VOYAGER_DEMO_THREAD` and an already
open matching terminal. It registers that session and submits a harmless marker
request. It proves capture while undocked and identity on rejoin. See the user
guide before running it; it uses your native model account.

When docked to a terminal, the astronaut is a faded overlay above it. It normally
ignores mouse events; hovering restores pointer input without taking keyboard
focus. Pulling detaches with the same cue as leaving the panel. A held pointer
button prevents activation during an existing selection drag. Ctrl+Alt+V is the
keyboard alternative; there is no separate Detach button.

Drop and hover exclude only the astronaut and candidate outline from native
window hit testing. The panel remains an occluder. Returning to it requires its
exact window to be in front and the pointer to hit the rendered glass, rather
than transparent rectangular padding. Showing the panel preserves the terminal
attachment, marker position and passive fade.

`voyager-windows above` can reposition only a window belonging to its calling
Electron process. It also reports pointer button state for hover, without injecting
input or typing into the terminal. Opaque terminals need no appearance settings.
An X11 window covering the marker hides it; native Wayland occlusion is unproved.

Hover must read the native pointer snapshot: Electron's cursor position can stay
cached while the window ignores mouse input. Do not use that cached point to
decide whether to poll the desktop. The sample-based regression alone missed
this boundary; physical opaque-terminal hover and pulling exposed and verified
the fix.

## Lifecycle experiment

Each instance's **⋯** menu uses the [lifecycle contract](../docs/lifecycle.md).
`test/lifecycle-proof.cjs` drives the actual renderer handlers, preload, IPC,
Rust service and newly created Ghostty windows with real Bash tasks. Run only
with a fresh private state directory:

```sh
VOYAGER_STATE="$HOME/.local/share/voyager-lifecycle-proof" npm start -- --expanded --proof-lifecycle
```

It writes `lifecycle-proof.json` and `panel-lifecycle.png` privately. It is a
programmatic native check; Isaac still tests pointer delivery and visual quality.
It makes no model requests. The separate ignored Rust native test in the
[lifecycle guide](../docs/lifecycle.md#native-checks) uses the actual Codex account.
