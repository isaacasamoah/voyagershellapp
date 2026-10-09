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
--bins`, then start the [service and worker](../docs/workers.md). From this
directory, in a graphical-session terminal:

```sh
VOYAGER_STATE="$HOME/.local/share/voyagershell" npm start
```

Use your existing private service directory. `npm start -- --expanded` opens the
panel immediately. Quit and restart Electron to pick up changes to the main
process or preload. The service and its workers keep running independently.
If Electron's binary download was skipped during installation, run
`node node_modules/electron/install.js` once before starting it.

## Source map

| File                             | Owns                                                          |
| -------------------------------- | ------------------------------------------------------------- |
| `src/main.cjs`                   | Native windows, gestures, IPC authorization and service calls |
| `src/binding.cjs`                | Process identity and exact terminal-to-worker matching        |
| `src/preload.cjs`                | The renderer's small, allowlisted IPC API                     |
| `src/ui/renderer.js`             | Agent rows, pointer input and local sound cues                |
| `src/ui/index.html`, `style.css` | The glass interface and accessibility labels                  |
| `assets/`                        | Astronaut artwork and its attribution                         |

There is no frontend framework or bundler. Main owns the state; the renderer
receives a display snapshot and sends explicit user actions. Keep filesystem,
process and service access in main, behind the isolated preload boundary. Never
put native credentials or conversation text into the renderer.

The panel and astronaut are separate transparent windows so holding and pulling
the astronaut can leave the panel in place. A seated astronaut is a child of the
visible panel; floating detaches that relationship. The native panel background
is draggable. The astronaut and buttons are excluded from native drag regions so
their clicks reach the renderer.

## Testing changes

`test/binding.test.cjs` checks identity mistakes and refusal cases without a
desktop, model or credentials. `test/live-proof.cjs` is an explicit integration
check, invoked by `npm run proof`, using an already running service and supported
worker terminal. It checks the actual X11 window stack as well as the renderer:
injected clicks can pass even when another native window covers the astronaut.

The live proof creates and closes one unrelated shell as a counterexample. It
does not submit work to a model or inject desktop-wide mouse input. Its receipts
and screenshots stay in the private service directory. It leaves the panel open
for a human to check appearance, physical gestures and the sounds.

Keep changes small, explain what was actually observed, and update the user guide
with behavior changes. Reports of a failed native interaction are useful: include
the OS, display setup and steps, with private session details removed.
