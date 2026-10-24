# Desktop experiment: dock a native agent

Voyager's Electron client shows the local Rust service through a floating glass
astronaut and a small panel. The native terminal remains your conversational
interface. Docking selects [current control](control.md) only for a running,
connected, registered agent managed by this service. It never registers an
external terminal. Undocking records a release.
Neither undocking nor quitting Electron
stops capture or a service-owned worker.

Open [the self-contained walkthrough](walkthrough.html) in a browser for a
six-step diagram and linked code: start Voyager, open a native terminal, dock,
launch a worker, detach, and switch agents. It is an explanatory guide, not a
live monitor or an app launcher; its buttons only change the diagram.

## Appearance and gestures

On Linux, the astronaut, glass panel and docking outline use native toolbar
windows, requesting exclusion from Activities and the taskbar. The Applications
launcher remains available. Fedora's final overview appearance still needs a
desktop check; native window hints alone do not prove it. Opening Voyager again
reveals the existing panel instead of creating another interface. The Linux prototype uses software
rendering after native desktop launch exposed repeated Mesa GPU-process crashes.
Renderer isolation and sandboxing remain enabled. See Electron's
[window types](https://www.electronjs.org/docs/latest/api/base-window) and
[hardware acceleration API](https://www.electronjs.org/docs/latest/api/app#appdisablehardwareacceleration).

The floating 104 px astronaut has no text or square shadow. A click opens the
continuous curved glass panel, with rainbow VOYAGER lettering above the seated
astronaut and “Let’s Go Together” below the agent list. Click again to collapse.
Drag the panel background to move it. Buttons remain clickable. Pointer capture
keeps the drag attached until release. Electron main applies the cursor offset
through its existing pointer timer and moves the seated astronaut with the panel.
This avoids GNOME's disabled window-manager move action for toolbar windows.

At rest, Voyager stretches every 20–40 seconds. Its private conversation's
active turn opens a book; tool results and a 4.8-second reading rhythm turn
pages. When processing ends, it puts the book away, stretches and returns to
rest. These gestures use the [original artwork](../desktop/assets/README.md).
Gesture holds and transitions run at 1.6 times the original duration, with eased
crossfades. They indicate processing, not task success, and do not change docking opacity
or input behavior. Reduced-motion mode uses static reading and resting poses.
The animation currently follows the app conversation, not a docked Vessel's turn.

When the astronaut is docked to a terminal, clicking it toggles the panel where
you last left it. The astronaut stays at the terminal and control is unchanged.
The panel does not follow it. Pressing and pulling releases terminal control;
returning to the panel's seat is a separate drag action.

Holding the astronaut leaves the panel visible. Pulling it away lifts it out
with a short falling tone; returning to the panel or a supported terminal uses
the inverse rising tone. A stationary hold is silent. Escape during a pull
restores the previous attachment. The highlight clears on release. Moving a
standalone astronaut leaves the panel closed unless docking refuses. A refusal
opens the panel with a readable reason and keeps the avatar visible.

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
The floating and panel-seated astronaut keep their normal brightness. The seated
astronaut stays above the panel when it reopens or receives focus; it shares the
panel's glass underneath instead of showing through it from behind. Hovering
over the open panel makes its existing glass colours opaque for readability;
leaving restores transparency, without changing its colour palette.

The panel shows names with connection dots and reports Offline when needed. Green
means connected; gray means disconnected, stopped or unknown. Tooltips and
accessible labels retain the full status. No event feed, internal IDs,
instructional footer is shown. A **+** opens the instance form; an instance card
surfaces its native window. [Vessels and fleets](fleets.md) organise related work. The close × quits only
Electron. Connection is observation status, not proof of task completion.

## Create from the panel

The [instance journey](instances.md) is the current starting point. Open the app,
choose **+**, then Codex or Terminal · Bash, name and folder. Creation establishes
registration/capture and opens Ghostty. Docking selects control; it does not
create a second registration. The bare Bash has command capture and agent access
through `shell-exec` / `shell-read`, with no conversational interface.

## Identify a supported client

Docking supports dedicated Ghostty XWayland and xterm windows for managed Codex
and Bash instances. The desktop verifies the viewer executable, process start
identity and direct client. Codex must use the service's explicit Unix endpoint
and fixed thread UUID. Bash must use the service's exact attachment arguments.
A title, working folder or old registration does not establish eligibility.

External clients can still be discovered or explicitly registered through the
service, but cannot be docked through the desktop. Registration does not transfer
process ownership. General terminal adoption remains future work.

The service's `attach-info` response establishes that it still holds the managed
runtime. The desktop also requires one matching registration, running state and
connected capture. Missing, removed, ambiguous or disconnected records refuse.
Tabs, multiple windows for one viewer process and extra shell layers cannot
establish the required one-to-one identity. Later in-app thread switches remain
unsupported because launch arguments cannot report them.

Build and open Voyager:

```sh
cargo build --locked --bins
cd desktop
npm ci
node node_modules/electron/install.js
VOYAGER_STATE="$HOME/.local/share/voyagershell" npm start -- --ozone-platform=x11 --expanded
```

Use your actual private state directory. Start from the graphical session so
DISPLAY and X authorization are available. There is no installed OS service yet;
run the service independently of the terminal clients for persistence.

## Try the journey

1. Create a disposable Codex or Bash instance through the panel and open its
   supported terminal viewer.
2. Pull the astronaut onto the terminal. A neutral dashed outline says that
   Voyager is checking it. Only a verified target gets the solid outline and
   "Release to dock". Other windows show a refusal reason.
3. Release the astronaut. The desktop repeats the live checks and retains the
   process identity established during hover. A stopped or replaced client
   cannot silently become a new target. Refusal leaves visible controls and a
   reason in the panel, without registration or a success sound.
4. Converse normally in an accepted managed terminal. Pull the astronaut away
   to release control. The runtime and capture continue.
5. Try an ordinary external terminal using the same supported viewer. It must
   refuse and leave the service's registration list unchanged.

Successful placement and sound remain separate requirements. The current
placement path can still hide an accepted marker when its target is covered,
then request a success sound. The next docking slice addresses that behavior;
passing the refusal checks does not establish reliable complete docking.

An earlier attempt to launch a worker from the registered native lead was blocked
by that harness's sandbox: it could not connect to Voyager's local socket
(`Operation not permitted`). No worker was created, and no permission was changed.
YOLO is the explicit creation policy for Voyager-launched sessions; changing
launch policy is separate from docking. An earlier corrected demo lead launched
a worker, which successfully called Voyager's status API. Both sessions were verified as YOLO after their
native terminal clients opened; see the [historical worker evidence](workers.md#yolo-default-verified-on-11-october-2026).
The [earlier external-lead run](workers.md#earlier-manual-run-external-lead-permission-failure) failed
again on native-turn permissions and launched no worker. That failure remains open.

The selected session is the person's **current bridge**, not automatically a new
supervisor. Moving the astronaut does not reparent workers, change permissions or
redirect accepted tasks. External agents retain their original process owner;
registration does not guarantee they survive their original terminal closing.

## Implementation boundary

Electron main calls the Rust service CLI; the isolated renderer receives only
presentation state. `connection-info` reveals connection identity without
subscribing or importing conversation history. Hover and drop call the same
`resolveDockTarget` eligibility check. Each check uses its own window, service
and process observations so a concurrent refresh cannot replace its inputs.
Only the current drag can publish its hover result. A target that disappears
leaves a refusal attached to that drag, so releasing it still explains the failure.

A drop repeats discovery and checks the hovered identity before requesting the
existing service control attachment. The desktop creates no registration and
grants no rights. The service still authorizes control. Process identity remains
separate from window placement, runtime ownership and capture.

`voyager-windows` reads X11 inventory. Its narrow `above` operation may reposition
only a window belonging to its calling process. Its separate layout operation
arranges identified managed terminals as described in [Vessels and fleets](fleets.md).
Neither operation types into a terminal. Electron checks the actual native stack after asking for placement. A covered
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

The D01 refusal check uses real native pointer events and disposable external
and managed Bash windows. Start a candidate with fresh private state, after
building its Rust binaries and installing its Electron runtime:

```sh
VOYAGER_STATE=/absolute/fresh/private/state VOYAGER_PROOF_TERMINAL=xterm \
  ./desktop/node_modules/electron/dist/electron --ozone-platform=x11 \
  ./desktop --expanded --proof-docking
```

Run from the checkout root in a GNOME graphical session. Repeat with `ghostty`.
Leaving and returning to a target starts a fresh hover check and restores its cue.
The check exercises external refusal, a valid managed target and a target stopped
between hover and drop. It records screenshots, registration equality, control
identity and sound-request counts in `docking-proof.json` under the private state
directory. It stops its disposable managed instance and external viewer, then
exits Electron. Stop the isolated service separately with `voyager --state DIR stop`.
It makes no model turn or microphone request. IPC sound counts do not prove
acoustic output, and managed eligibility is not proof of D02 placement reliability.

The independent Codex comparison starts its own external Codex server and viewer,
then starts the candidate service and Electron from this checkout. Supply a new,
nonexistent private directory and the graphical session environment:

```sh
VOYAGER_EXTERNAL_DOCK_DIR=/tmp/new-codex-docking-trial VOYAGER_PROOF_TERMINAL=xterm \
  cargo test --locked --test native_external_docking -- --ignored --nocapture
```

Repeat with `ghostty` and another new directory. This test submits one short
setup turn to the external Codex conversation before opening its native client.
It requires the recorded desktop verdict, not merely Electron's exit status.
It verifies that the external server and conversation survive the refusal,
then stops only the disposable resources it created. The pointer check verifies
its actual position before clicking. The recorded D01 trials use the external
monitor; mixed-scale pointer behavior on the laptop display remains unproved.

The older `--proof-registration` check describes the superseded external-docking
behavior and is not a current acceptance test. Its historical evidence below
does not authorize or establish general terminal adoption.

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
