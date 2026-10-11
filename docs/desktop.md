# Desktop experiment: dock a native agent

Voyager's Electron client shows the local Rust service through a floating glass
astronaut and a small panel. The native terminal remains your conversational
interface. Docking registers an identified session or rejoins its registration;
undocking disconnects the interface. Neither undocking nor quitting Electron
stops capture or a service-owned worker.

Open [the self-contained walkthrough](walkthrough.html) in a browser for a
six-step diagram and linked code: start Voyager, open a native terminal, dock,
launch a worker, detach, and switch agents. It is an explanatory guide, not a
live monitor or an app launcher; its buttons only change the diagram.

## Appearance and gestures

The floating 104 px astronaut has no text or square shadow. A click opens the
continuous curved glass panel, with rainbow VOYAGER lettering above the seated
astronaut and “Let’s Go Together” below the agent list. Click again to collapse.
Drag the panel background to move it. Buttons remain clickable.

Holding the astronaut leaves the panel visible. Pulling it away lifts it out
with a short falling tone; returning to the panel or a supported terminal uses
the inverse rising tone. A stationary hold is silent. Escape during a pull
restores the previous attachment. The highlight clears on release. Moving a
standalone astronaut never opens the panel automatically.

**Only the terminal-docked marker fades.** It sits centrally in the lower third
as an overlay above the terminal, so the terminal can have an opaque background.
It is normally click-through and non-focusable. Hover over the astronaut to
brighten it and enable grabbing; pull it away to detach. Hover does not take
keyboard focus. Moving away returns the faded, passive marker. A held mouse
button suppresses hover activation so an existing terminal selection drag can
continue. The same falling/rising sound pair is used for panel and terminal
undock/dock. There is no separate Detach button; Ctrl+Alt+V remains a keyboard
alternative.

This is an overlay **over** text, not an image between the terminal's text and
background. The browser reference can render those layers together; an external
window cannot. The avatar's hover area is reserved for grabbing once activated.
The floating and panel-seated astronaut keep their normal brightness. Hovering
over the open panel makes its existing glass colours opaque for readability;
leaving restores transparency, without changing its colour palette.

The panel shows Online/Offline and project names with connection dots. Green
means connected; gray means disconnected, stopped or unknown. Tooltips and
accessible labels retain the full status. No event feed, internal IDs,
terminal-launch button or instructional footer is shown. The close × quits only
Electron. Connection is observation status, not proof of task completion.

## Supported setup

The first adapter is **Codex in a dedicated Ghostty XWayland window**, with one
direct native client launched against an explicit Unix endpoint and fixed thread
UUID. It supports the native command below, with optional `--no-alt-screen`:

```sh
codex --remote "unix://$CODEX_SOCKET" resume "$THREAD_ID" --no-alt-screen
```

The conversation must already exist and be loaded. A session picker, `--last`,
tabs, an implicit default daemon, extra shell layers, and switching threads inside
that client are unsupported. Launch arguments establish the fixed resume target;
they cannot report later in-app thread switches. This is a bounded integration,
not detection of every running CLI. No native agent is restarted by docking.

Start the [service](service.md) against that same explicit socket. Set
`VOYAGER_CODEX_BIN` when starting it to the native executable your terminal uses;
different CLI/daemon installations may have different executable paths.

For a separate demo window, from a graphical-session terminal:

```sh
GDK_BACKEND=x11 ghostty --gtk-single-instance=false \
  -e /absolute/path/to/codex --remote "unix://$CODEX_SOCKET" \
  resume "$THREAD_ID" --no-alt-screen
```

The remote terminal inherits the existing thread’s permissions. Codex 0.162.1
rejects permission flags on remote resume; configure the session when starting
it. Voyager-launched workers default to YOLO. Docking does not change permissions.
No transparency setting is required or changed. The Ghostty flag gives this
prototype an unambiguous window-to-process mapping; it is not a visual requirement.

Build and open Voyager:

```sh
cargo build --locked --bins
cd desktop
npm ci
node node_modules/electron/install.js
VOYAGER_STATE="$HOME/.local/share/voyagershell" npm start -- --expanded
```

Use your actual private state directory. Start from the graphical session so
DISPLAY and X authorization are available. There is no installed OS service yet;
run the service independently of the terminal clients for persistence.

## Try the journey

1. Start the native conversation and open its dedicated terminal before docking.
   It is discoverable but unregistered; Voyager has not captured its history.
2. Pull the astronaut from the panel onto that terminal. Electron verifies the
   candidate window with a passive outline; that preview does not register it.
   On release it checks the
   native executable, process/start identity, explicit endpoint and thread. The
   Rust service checks that the thread is loaded and acknowledges registration.
3. Converse normally. Supported future user/assistant messages and lifecycle
   events are recorded. Repeated docking keeps the same registration.
4. Hover over the astronaut, then pull it away. Capture continues; nothing is
   unregistered. The keyboard alternative is Ctrl+Alt+V.
5. Dock again to rejoin. An unrelated same-title terminal must be refused.
6. Use the [worker commands](workers.md) from the native agent or a script to start
   one managed worker. Open its native interface in another terminal. Docking to
   that worker joins its existing registration. Window creation remains a desktop
   action, independent of the service's worker lifetime.

An earlier attempt to launch a worker from the registered native lead was blocked
by that harness's sandbox: it could not connect to Voyager's local socket
(`Operation not permitted`). No worker was created, and no permission was changed.
YOLO is now the explicit default for Voyager-launched sessions. External
registration continues to preserve its session's permissions; changing launch
policy is separate from docking.
The corrected demo lead subsequently launched a worker, which successfully
called Voyager's status API. Both sessions were verified as YOLO after their
native terminal clients opened; see the [worker evidence](workers.md#yolo-default-verified-on-11-october-2026).

The selected session is the person's **current bridge**, not automatically a new
supervisor. Moving the astronaut does not reparent workers, change permissions or
redirect accepted tasks. External agents retain their original process owner;
registration does not guarantee they survive their original terminal closing.

## Implementation boundary

Electron main calls the Rust service CLI; the isolated renderer receives only
presentation state. `connection-info` reveals connection identity without
subscribing or importing conversation history. `register` is called only on a
verified drop. Process identities are rechecked after acknowledgement before the
avatar joins. Registration may succeed even if subsequent visual placement fails;
the agent still appears in the service registry.

`voyager-windows` reads X11 inventory. Its narrow `above` operation may reposition
only a window belonging to its calling process; it does not move or type into the
terminal. Electron checks the actual native stack after asking for placement. A covered
marker hides rather than painting over another X11 app. Linux hover uses a
bounded pointer/button probe while a dock or panel is visible, because Electron forwards ignored
mouse movement only on macOS/Windows; it does not inject input. Native Wayland
windows are absent from this inventory, so occlusion by those windows is unproved.
Panel and avatar remain separate windows. A seated avatar is a child of the mapped
panel, preserving the fix for row selection covering the astronaut.
The passive candidate outline is a third transparent, non-focusable window.

## Checks and evidence

`npm test` covers endpoint and fixed-thread recognition, identical titles, extra
windows, duplicate candidates, PID reuse, changed native arguments and hit testing.
Rust tests cover registration, capture, ownership, failures and worker detach.

`npm run proof` is the UI regression check with a registered native terminal.
It makes no model call. It opens and closes one unrelated shell, exercises
app-local gestures, checks the native stack and preserves the service/native client.
It checks native input regions as well as CSS: Electron 44.7.0 implements ignored
mouse events using a 1×1 region at the transparent corner, outside the artwork;
the interactive avatar has its full input region restored. See the
[pinned Electron implementation](https://github.com/electron/electron/blob/v44.7.0/shell/browser/ui/electron_desktop_window_tree_host_linux.cc#L226).

The separate **live registration proof makes one real model request**:

```sh
VOYAGER_STATE=/absolute/private/state \
VOYAGER_DEMO_THREAD=exact-native-thread-uuid \
npm start -- --proof-registration
```

Use only a deliberately selected demo conversation. The check rejects an unrelated
same-title window, registers the selected existing session, records a harmless
user/assistant marker exchange while detached and verifies the same registration
on rejoin. Receipts stay in the private state directory. First registration and
rejoining an earlier registration are reported separately.

Earlier on 11 October, the user physically docked the selected native terminal
and its subsequent user/assistant exchange was captured. That establishes the
registration path, independently of this newer overlay refinement.

The overlay's live regression check then observed an above-terminal native stack,
passive and interactive native input regions, hover brightness and unchanged
keyboard focusability. Explicit pointer samples exercised hover, leaving, a held
button and a covered/missing target. Panel toggling, hold/pull/return sound events,
row-selection stacking, and the unchanged service/native process also passed.
These samples exercise the real UI transitions without moving the physical mouse.

The first physical test exposed a missed boundary: Electron's cursor position
stayed cached while the astronaut ignored input. The supplied-coordinate test
had bypassed that acquisition failure. Hover now uses the native X11 pointer
snapshot for both entry and exit; the cached Electron point never gates sampling.
The live trace then observed Isaac hovering, lifting, dragging and releasing the
astronaut on the opaque Ghostty demo. Isaac confirmed the result looked good.
This establishes that specific desktop interaction, not every terminal or desktop.
The diagnostic check also moved the X11 pointer briefly over the exact avatar;
it used no keyboard/button injection, XTEST or remote-control permission.

Native Wayland windows can cover XWayland windows without appearing in this
inventory. Keep the demo target visible. Native Wayland/macOS, arbitrary running
CLIs, thread switching, compositor blur and a knowledge graph remain unproved.
See [the source map](../desktop/README.md) for contributor guidance.

## Extending terminal support

Keep three boundaries separate:

- **Agent adapter:** commands, conversation identity and event formats belong to
  Codex, Claude or another harness, independently of which terminal displays it.
- **Desktop adapter:** identifying windows, following movement, stacking and hit
  testing depend on X11, the Wayland compositor or macOS. Electron alone does not
  make these foreign-window operations portable.
- **Session binding:** a window must identify its current agent conversation.
  This prototype uses a dedicated Ghostty process and one exact native child.
  Shared terminal processes, tabs, panes, nested shells and in-app thread switches
  need explicit evidence, potentially shell integration or terminal-specific APIs.

The overlay can be shared across terminals on a supported desktop. There is no
promise that every terminal can register an agent out of the box. Prove a second
terminal against the same session contract before extracting an adapter framework;
never infer identity from a title or the foreground window alone.

References: [Electron's Wayland limitations](https://www.electronjs.org/docs/latest/api/browser-window#platform-notices),
[mouse pass-through](https://www.electronjs.org/docs/latest/api/base-window#winsetignoremouseeventsignore-options),
and [Ghostty shell integration](https://ghostty.org/docs/features/shell-integration).
