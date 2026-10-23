# Voyager desktop

A small Electron client of the Rust service. It displays local agent connections
and a draggable astronaut. Rust owns the agent runtimes and private model
conversation; Electron presents chat and carries microphone and playback audio.
It does not emulate a terminal.

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
Codex instance or managed Bash. Click its card to reopen its native interface
or bring its existing window forward. `npm start -- --expanded` opens the
panel immediately. Quit and restart Electron to pick up changes to the main
process or preload. The service and its workers keep running independently.
Codex creation starts at Crew each time the form opens. Choose another rank
explicitly and optionally select an existing supervisor one rank above. Bash has
no rank; its optional controller can be an Admiral, Commodore or Captain. Each
instance's **⋯** menu shows its rank and current assignment and lets the owner
change them. The service rejects a rank change that would invalidate an assignment;
clear or change those assignments first.

The close cross leaves work running. The small top-left menu provides explicit
service shutdown, which refuses until managed Vessels have been stopped.
See [app and service lifetime](../docs/service.md#app-and-service-lifetime).

Questions addressed to the owner appear in **Questions for you**, with their
sender and delivery status. Answer a question, accept a result or request changes
there. A recorded response and delivery to the agent are separate outcomes.
Actions retain their request identity after a lost reply when explicitly retried
with the same inputs. The panel never resubmits them automatically.
If Electron's binary download was skipped during installation, run
`node node_modules/electron/install.js` once before starting it.

## Source map

| File                                     | Owns                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `src/main.cjs`                           | Native windows, gestures, IPC authorization and service calls                 |
| `src/binding.cjs`                        | Process identity and exact terminal-to-session matching                       |
| `src/instances.cjs`                      | Creation validation, pending request identity and retry after opening failure |
| `src/authority.cjs`                      | Named rank, assignment and owner-response calls                               |
| `src/control.cjs`                        | Persistent attachment socket, acknowledgement and connection loss             |
| `src/preload.cjs`                        | The renderer's small, allowlisted IPC API                                     |
| `src/ui/renderer.js`                     | Agent rows, pointer input and local sound cues                                |
| `src/ui/astronaut.js`                    | Idle stretches, processing gestures and tool page turns                       |
| `src/ui/authority.js`                    | Rank labels and eligible supervisor choices                                   |
| `src/ui/index.html`, `style.css`         | The glass interface and accessibility labels                                  |
| `src/ui/candidate.html`, `candidate.css` | Passive outline around a possible docking target                              |
| `assets/`                                | Astronaut artwork and its attribution                                         |

There is no frontend framework or bundler. Main owns the state; the renderer
receives a display snapshot and sends explicit user actions. Keep filesystem,
process and service access in main, behind the isolated preload boundary. Never
put native credentials or internal reasoning into the renderer. Intentional
user-facing chat text crosses the named conversation boundary.

The panel and astronaut are separate transparent windows so holding and pulling
the astronaut can leave the panel in place. A seated astronaut is a child of the
visible panel; floating detaches that relationship. Pointer capture moves the
panel background; controls keep their own input. Linux uses floating toolbar
windows so helpers are excluded from ordinary window switching. The astronaut and buttons remain separate so
their clicks reach the renderer.

Terminal docking now also holds a service control connection. Its lifetime is
independent of panel visibility. Lifecycle menus use named preload methods and
the same CLI/service operations as an agent. Native popovers keep the scrolling
instance list from clipping actions. Main never kills an agent directly. Clicking the docked astronaut reveals the panel
at its saved position; it never moves the astronaut or releases control.
See [the control contract](../docs/control.md) for events, exact-generation release,
restart behavior. The separate [voice contract](../docs/voice.md) covers handoff. `test/control.test.cjs`
checks socket lifetime; `npm start -- --proof-control` exercises two existing
native clients without model calls.

## Testing changes

For the account-local Fedora package and build commands, see
[install the Fedora prototype](../docs/install-linux.md). Set
`VOYAGER_INSTALLED_APP=/absolute/path/to/voyagershell` when running the lifetime
check below to exercise that bundle and its included Rust binaries instead of
the checkout. Run the check from a different working directory for installation
proof.

The app/service lifetime check opens real Electron and Ghostty, starts the
installed private Codex provider without a model turn, and tests UI close/reopen,
shutdown refusal, stop/remove, retained history and explicit service shutdown:

```sh
VOYAGER_PANEL_LIFECYCLE_DIR=/tmp/voyager-panel-new \
  node test/service-lifecycle-proof.cjs
```

Use a fresh absolute directory and a graphical-session environment. The check
uses programmatic renderer actions; physical pointer behavior remains separate.

`test/binding.test.cjs` checks identity mistakes and refusal cases without a
desktop, model or credentials. `test/live-proof.cjs` is an explicit integration
check, invoked by `npm run proof`, using an already running service and supported
registered native terminal. It checks the actual X11 window stack as well as the renderer:
injected clicks can pass even when another native window covers the astronaut.

The live proof creates and closes one unrelated shell as a counterexample. It
does not submit work to a model or inject desktop-wide mouse input. Its receipts
and screenshots stay in the private service directory. It leaves the panel open
and the marker docked for a human to check appearance, physical gestures and sounds.

`test/authority.test.cjs` checks eligible choices and the named preload actions.
`test/renderer.test.cjs` executes the renderer against a small document fixture to
check Crew resets, Bash rank visibility, rejection feedback and explicit retry
identity. These fixtures do not prove native appearance or pointer delivery.

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

## Native authority experiment

`npm start -- --proof-authority` requires a fresh private VOYAGER_STATE, the built
Rust binaries, installed Codex and a graphical session. It creates real Captain,
Crew and Bash instances through the panel, checks creation defaults, changes an
assignment, exercises dock/undock authority and answers an owner escalation through chat.
It records authority-proof.json and authority-panel.png in that private state,
then stops its own instances and service. It makes native model calls. Physical
drag quality and sound remain a separate user check. The ignored Rust
native_authority test separately checks native agent tool identity.

## Vessels and fleets

[The panel contract](../docs/fleets.md) owns the terms and gestures.
`src/ui/hierarchy.js` derives command branches; `src/fleets.cjs` routes collection actions to the Rust service independently
of authority. `src/layout.cjs` calculates fixed grid slots in rank order
using native minimum sizes. The card surfaces a Vessel and its top-right menu
retains lifecycle actions. Fleet canvases accept dragged Vessel cards.

ResizeObserver measures the unconstrained panel flow. A separate viewport scrolls
at the display limit; the main process clamps native bounds to that display.
An empty canvas starts at one row and grows with its visible cards.

`test/fleets.test.cjs` checks durable membership; `test/hierarchy.test.cjs` checks
branches and cell geometry. `--proof-fleets` exercises programmatic drag/drop and
native sizing on an existing hierarchy, without agent/model launches. Physical
pointer testing remains separate.

## Conversation

`src/conversation.cjs` owns the named service calls and voice lease.
`src/ui/conversation.js` presents chat and owns audio in the avatar renderer.
The [conversation contract](../docs/harness-runtime.md) covers startup, privacy,
CLI operations, lifecycle and the optional `--proof-conversation` check.

## Polish and voice check

`npm start -- --expanded --proof-polish` uses a fresh private `VOYAGER_STATE`.
It creates real Bash and Codex vessels, exercises renaming and background/reopen,
measures placement, and switches native/app voice through the real service.
Codex must be signed in, Ghostty installed and microphone access available.
The app audio input is silent test audio. Native CLI voice uses its actual audio
host. The check removes only its created vessels and Fleet on success. Results
remain in `polish-proof.json`; failed resources remain identifiable for cleanup.
Physical dragging, audible quality and smoothness still require a user.

## Native panel visibility check

`npm start -- --proof-visibility` exercises real pointer clicks on GNOME/XWayland.
Use a fresh private `VOYAGER_STATE` and `VOYAGER_VOICE_FOLLOWS_DOCK=0`. Python 3
with PyGObject and a graphical GNOME session are required. The check moves the
pointer, toggles and focuses the panel, checks native stacking and opacity, then
returns from docking to its own disposable Bash terminal. It removes that
terminal afterward. It does not start voice or submit a model turn.

Renderer-injected clicks are insufficient here: explicitly focusing the avatar
first hides the native ordering bug. Results stay in `visibility-proof.json`.
Optional `VOYAGER_VISIBILITY_CAPTURE_SCRIPT` and `VOYAGER_VISIBILITY_MONITOR` name
a local Python monitor-capture helper and connector for desktop screenshots.
