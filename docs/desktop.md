# Desktop experiment: a glass avatar and your agents

Voyager parks near the top-right of the screen. Click the astronaut to reveal a
compact glass panel; click again to collapse it. The 104 px avatar has no text
while floating. Opening the panel reveals one continuous glass surface with a
full-width curved top and rainbow VOYAGER lettering above the astronaut.
The seated avatar has no separate background or circular rim.
“Let’s Go Together” appears in a warm-to-blue gradient at the bottom of the panel.
Avatar and panel share the same translucent material.
The floating avatar keeps its circular highlights without an outer shadow;
the transparent native window also disables its shadow.

The panel shows **Online / Offline**, agent/project names and connection status.
It grows to fit the current list, within the display height. No event feed,
internal IDs, terminal-launch button or instructional footer is shown. A small
close × appears on hover or keyboard focus; it quits only the desktop client.
A Detach button appears while docked. Work stays with the Rust service.

This remains a Fedora experiment for an **already registered worker**, not
registration or ownership transfer of arbitrary running CLIs. Native Codex
interaction stays in the terminal. Open terminals using your normal workflow.

## Run

Prerequisites: Linux, X11/XWayland, Ghostty, Rust and Node 24. Follow
[the service](service.md) and [worker](workers.md) instructions first. A supported
window is a dedicated Ghostty XWayland process with a direct native Codex client
attached to the service-owned worker. Tabs and switching native threads are not
supported.

```sh
cargo build --locked --bins
cd desktop
npm ci
node node_modules/electron/install.js
VOYAGER_STATE="$HOME/.local/share/voyagershell" npm start
```

Use your actual private service directory. Start from a graphical-session
terminal so the normal DISPLAY/X authorization is available. The app does not
change those permissions. `npm start -- --expanded` opens the panel immediately.

1. Open the native worker terminal using the worker guide; it can already be open
   before Voyager's desktop client starts.
2. Click the avatar to see the real service and agent connection states.
3. Hold the astronaut for a moment (350 ms) to lift it out of the panel, or start
   dragging directly. A quick click still opens or closes the panel. Release a
   stationary hold to leave it floating; Escape during the gesture puts it back.
   Drag the avatar onto that terminal. The app matches a known worker session,
   then follows its window. An unrelated window with the same title is refused.
4. Drag away or choose Detach. Quit with × when finished. The service and native
   agent continue; reopening the app can rediscover the existing native client.

“Connected” describes the observation connection. It does not claim a task is
working or complete. When the service is unreachable, the panel says Offline and
retained rows say Unknown. Docking problems have an amber avatar indicator and a
short tooltip, rather than a persistent instruction along the bottom.

## How terminal recognition works

Electron main calls the Rust CLI over the existing private service contract.
The read-only `voyager-windows` helper supplies X11 window geometry and process
IDs. For a connected managed worker, the service supplies its exact native attach
command. The client looks for a dedicated Ghostty process with a direct child
whose executable and arguments match that command, including its native socket
and thread identity. It reads all spawning threads' direct children.

Before docking, fresh service, window and process/start-time evidence must agree.
A title is never identity, and several windows sharing one terminal process are
ambiguous. This works for a matching client opened before the desktop app, as
well as after it. It does not register or take over an unknown agent.

The renderer is isolated, has no Node access, cannot navigate remote pages, and
has only a narrow preload API. It no longer requests or receives conversation
events. No terminal-launch path remains in the UI. Closing it sends no agent stop
command.

## Limits and proof

- Dedicated Ghostty **XWayland** clients of the known worker only. Native Wayland,
  arbitrary standalone CLI registration and macOS remain unproved.
- Matching describes the native client's **fixed launch thread**. Switching
  threads or tabs needs a cooperative current-session signal; argv alone cannot
  establish that change.
- Keep the target visible. X11 hit testing cannot detect a native Wayland window
  covering it.
- Glass here means transparency, highlights and shared CSS material. CSS backdrop
  filtering does not establish compositor-level blur of other desktop apps.
- No new-agent launch, knowledge graph, voice interface or whiteboard in this
  client increment.

`npm test` verifies same-title refusal, ambiguous windows, PID reuse, missing
clients, disconnected capture and frontmost-window hit testing. `npm run proof`
is an opt-in check against the real service and an already-open worker terminal.
It discovers that terminal without a UI launch record, refuses a same-title
unrelated shell, exercises click-to-toggle, hold-to-lift and Escape-to-cancel in
the renderer, captures the panel, and verifies that detach preserves the worker
process and service instance. The
temporary unrelated shell is closed; the panel stays open. Receipts/screenshots
are private. No model call or desktop-wide input injection is used.

Observed on 10 October: existing native client rediscovered, correct session
accepted, unrelated shell refused, click handler toggled, the two-row agent list
fit without scrolling, and internal IDs/event feed were absent. Holding lifted
and detached the avatar, Escape restored the prior attachment, and releasing a
stationary hold left it floating. The same worker and service survived these
gestures. The final pointer-use preview has a continuous curved glass panel with
no separate banner fill or seated-avatar rim; keyboard focus still has a visible
outline.

Verdict: **surface** for physical drag and final desktop appearance. Renderer
input and programmatic window matching do not prove the compositor delivers a
real mouse drag. The previous XTEST input experiment was removed after it raised
a GNOME remote-desktop prompt; this app and its proof do not request it.
