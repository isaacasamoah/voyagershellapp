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

A drop reports success only after the service accepts its control attachment
and the native window inventory confirms a visible avatar above the intended
terminal. Only that attempt requests a docking sound. Covered targets, failed
placement and superseded attempts cannot report success. Failure releases the
attachment and reveals the floating controls. Recovery after a previously
successful dock releases control and restores the floating controls. Applications
recovery uses the independent presentation operation described below.

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
Neither operation types into a terminal. `placement.cjs` returns placed, failed
or superseded after checking the native stack and current attempt. It does not
hide the avatar to represent successful placement. Linux hover uses a
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

Set `VOYAGER_PROOF_D02=1` on the native Codex comparison to require visible
placement and capture output audio. The fixture records only a bounded interval
from the unmuted output monitor, requires silence before the action, and checks
that covered placement produces no sound. It does not record the microphone.
A valid run records the drop, acceptance, placement and sound-request times,
then the observed sound onset and end. Output-monitor timestamps are measured
when audio chunks arrive; they are conservative observations rather than room
microphone measurements. Packaged batches passed with both viewers. Owner
listening remains a separate acceptance check.

Placement compares fresh native marker bounds with the requested bounds, allowing
two physical pixels for rounding. Invalid geometry fails. A pending native move
gets the existing one-second placement deadline before failure restores controls.
The desktop converts the two rectangle corners with Electron's Linux-supported
[point conversion](https://github.com/electron/electron/blob/v44.7.0/docs/api/screen.md#screendiptoscreenpointpoint-windows-linux).
The rectangle conversion API is Windows-only. This remains XWayland evidence,
not native Wayland support.

The native fixture records launch and finish manifests containing candidate source
and executable hashes, and rejects a run if those files changed. Its D02 check
independently compares the native avatar center with the terminal anchor and
captures a compositor image cropped to the disposable terminal. Test captures
and manifests stay in the private trial directory.

The main process retains at most 32 docking attempt records in memory. They
answer which attempt was accepted, whether placement completed, and where time
was spent before the sound request. The proof reader can collect them without
terminal contents or credentials. Service authorization and its deadlines do
not change. `control.cjs` accepts only a reply matching the requested generation,
Vessel, window and both process identities.

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

## Recovery after a target becomes unavailable

Refresh treats a failed placement or an unavailable target as the end of that
control attachment. It restores the floating avatar and panel, leaving the
managed runtime and event capture alone. A refresh started before a newer dock
cannot release that newer attachment. A failed panel query is reported and always
releases the refresh guard, so a later refresh can update again. Control release continues through the
existing voice coordinator; visible recovery does not wait for voice confirmation
and does not start the private microphone.

The X11 probe includes the window's workspace in visibility. A mapped window
on another workspace is unavailable. A window marked for all workspaces remains
eligible; missing workspace observations are not proof of visibility. This follows
the [window manager workspace contract](https://specifications.freedesktop.org/wm/latest/ar01s05.html).
Floating Voyager controls appear across workspaces. A docked avatar belongs to
its current workspace until control ends. Display changes cancel an attachment
and clamp the recovered controls to an available display.

The recovery proof uses disposable native windows, observes service process and
capture continuity, and changes actual workspaces. Its monitor trials save the
current configuration, apply temporary arrangement/scale changes, then restore
and compare the configuration even after failure. The test uses
[Mutter's versioned display interface](https://github.com/GNOME/mutter/blob/49.0/data/dbus-interfaces/org.gnome.Mutter.DisplayConfig.xml).
These checks establish the exercised Fedora XWayland behavior only.


## Applications and keyboard recovery

Opening the candidate through Applications reveals both controls on first launch
and on later launches. A later launch releases its control attachment and reveals
the existing panel and avatar. It keeps the managed runtime and capture. Ctrl+Alt+V
uses the same recovery operation. A later dock supersedes an unfinished recovery.
The recovery does not submit work or start a replacement agent.

On stock GNOME, Applications appears on the primary monitor. XWayland may retain
an old pointer position while the GNOME grid owns input. The launching process
passes an explicit Applications-launch flag through Electron's single-instance data;
that path chooses the grid's primary display. Keyboard and ordinary command-line
recovery use the pointer display. The installer adds `--from-applications` to its desktop entry. Inherited terminal
environment variables do not identify an Applications launch. Custom launchers or GNOME extensions that move
the grid are not established by this trial. This small selector is in
`desktop/src/recovery.cjs`; it is not a cross-platform window-management framework.

The platform facts come from [GNOME Shell 49.0's overview monitor constraint](https://github.com/GNOME/gnome-shell/blob/49.0/js/ui/overview.js),
[Electron 44.7's single-instance data](https://github.com/electron/electron/blob/v44.7.0/docs/api/app.md#apprequestsingleinstancelockadditionaldata).
The requested panel anchor is passed directly into placement because native
bounds can still report the old monitor immediately after a move.

`VOYAGER_PROOF_D04=1` extends the visibility proof with a temporary, separately
named Applications entry. The operator selects that exact candidate in the real
GNOME grid while docked and after failed placement. Twenty further launches use
that same desktop entry, measuring request through both native windows being
visible. Runtime and capture identity must survive every trial. The launcher is
removed afterward. `VOYAGER_PROOF_KEYBOARD=1` uses actual key events in an isolated
desktop so the installed app's shortcut is not replaced.

`VOYAGER_PROOF_BATCH=1 VOYAGER_PROOF_D02=1` extends the docking proof with twenty
actual pointer drops and output-monitor recordings. Every drop must visibly
place the avatar and request exactly one sound. At least nineteen recordings
must begin within two seconds. All slow and failed runs remain evidence.

For packaged trials, `VOYAGER_PROOF_APP` selects the built executable in the native
Codex fixture. The service is its bundled `resources/bin/voyager`, not the checkout
binary. Explicit proof flags can load the harness from an absolute
`VOYAGER_PROOF_DIRECTORY`; normal launch does not load this code. Source, harness,
package and bundled binary hashes are recorded before and after each trial.
No proof flag installs or restarts the main app.

The pointer fixture uses logical desktop coordinates. Mutter's
[49.0 monitor-stream transform](https://github.com/GNOME/mutter/blob/49.0/src/backends/meta-screen-cast-monitor-stream.c)
expects stream pixels, so the fixture applies each monitor's scale. X11 pointer
readback is only a check over XWayland windows, not over GNOME's own grid.


The native panel's all-workspace membership is reasserted after showing it. A
fresh GNOME session can otherwise report no current workspace and leave the
initial panel on workspace zero. This does not relax terminal eligibility:
unknown terminal workspace observations still refuse docking. Initial panel
confirmation errors are reported without skipping the keyboard shortcut or the
refresh and pointer timers. The owner can retry recovery without restarting work.

The native re-entry proof now moves onto Voyager's own panel and verifies that
native target before returning to the same terminal. It repeats this in each
batch trial. The earlier test assumed the desktop corner was an empty target;
one packaged Ghostty run failed that assumption. The exact event sequence in
that failure remains unknown. It is retained rather than presented as a repaired
Ghostty defect.

The final Ghostty polish sequence can leave the recovered panel over the later
Bash docking point. That is a covered target, so refusal is correct. Establish an
unobstructed target by collapsing the panel before the positive Bash comparison,
and show the panel before its final screenshot. The recorded packaged trial used
an external fixture for the first step and a second launch of the same candidate
for the screenshot. The unchanged automatic sequence is not claimed to pass.
Retain these setup steps alongside the exact fixture hash when repeating it.

A final participating voice connection can disappear during fixture teardown.
The resulting outcome_unknown remains separate from successful docking recovery
and earlier voice destination assertions. Do not describe that status as a
confirmed voice closure.


## Return position after automatic recovery

Before a docking drag moves the avatar, the desktop remembers the floating panel
and avatar positions and whether the avatar was seated in the panel. A direct
dock captures the same information before placement. Switching between terminal
targets retains this origin. Automatic target-loss recovery restores it, using
the existing display clamps if the original location is no longer available.
Current panel content still determines its height. No position is persisted.

A pending recovery retains its original positions across overlapping display
events. The latest recovery may finish that restoration; an older one cannot
move a newer dock. Explicit docking, undocking or dragging clears the pending
restoration. Applications recovery still chooses its current display rather than
returning to the old one. These presentation changes do not affect process
ownership, capture or service permissions.

The focused native probe is desktop/test/recovery-position-proof.cjs. Load it as
visibility-proof.cjs through the existing explicit VOYAGER_PROOF_DIRECTORY option
in a private trial. It uses real pointer drags and native window observations for
minimise and close with each supported viewer. Display-removal fallback and
overlapping-event order are deterministic regressions; the focused native trial
does not claim a physical monitor-removal test.

## Current and previous work

The panel groups service observations into Vessels, Needs attention and
Previous vessels. A running owned runtime stays current when its viewer is closed.
A removed registration with a running owned runtime stays visible as Unregistered.
A confirmed stop moves into the initially collapsed Previous vessels group. Unknown
ownership and disconnected external capture remain visible under Needs attention.
Each record appears once; selection does not change assignments or Fleet data.
Fleet inheritance still uses all registered supervisors, including a supervisor
outside the current visible rows.

State labels use words as well as the connection dot. A disconnected service keeps
cached rows as last-known information and disables their actions. Connection loss
closes an open Actions popover before rebuilding the rows. A late action result
cannot enable an offline control. The Previous vessels control is excluded from
panel dragging so its normal click and keyboard behavior remain available. An older service
without lifecycle observations produces a service-update warning and unknown state,
never an inferred stop. The desktop forwards the service's lifecycle and Resume
objects without granting any new permission.

The maintained `panel-current` journey uses actual disposable Bash runtimes and
Chromium input in the real Electron panel to verify grouping and expansion without
recording new work. The shared runner retains its separate OS input actions for
native window journeys. Chromium input follows Electron's
[sendInputEvent contract](https://www.electronjs.org/docs/latest/api/web-contents#contentssendinputeventinputevent),
including focused-window and visible-control checks. It does not prove physical
mouse, keyboard or trackpad delivery. A GNOME pointer attempt did not reach the
expected window during this build; its delivery or coordinate cause remains open.

Previous vessels uses the latest saved event's recorded time, with stable Vessel
identity breaking ties. Missing activity remains unavailable. The existing list
response supplies nullable last_activity_ms through an indexed per-session lookup;
registration and provider occurrence times are not substitutes. Instance callers
retain their existing metadata allowlist.

History rows appear in local batches sized from actual row and display measurements.
The list keeps its own scroll position and a thin scrollbar, while Load more stays
outside it. Removed records require the explicit checkbox. Inspect works for every
visible row and displays saved metadata as text. Its named preload method reads
one existing global event portion, filters the permitted result to the chosen
agent, and preserves the original cursor. Empty filtered portions can advance;
they do not mean the agent has no later history. Capture-gap events remain visible.
No history action creates a runtime, registers an agent or submits work.

The selected panel journey checks actual Chromium keyboard and wheel scrolling,
local batch growth without window growth, removed-record reveal and bounded saved
history. Physical wheel and trackpad input remain unproved by these synthetic
Chromium events.

When the final history batch hides Load more, focus moves to the last row's
enabled Inspect control. Normal focus scrolling brings that control into view.
Saved-details text is excluded from panel dragging, allowing the browser to select
it. The shared journey checks both saved-text default handling and the different
ordinary panel-background behavior, which still starts panel dragging.

The owner can Resume an eligible saved conversation from its previous row. The
chosen generation and one request ID go through a named preload method to the
existing service command. Concurrent clicks share the in-flight attempt. After
an interrupted reply, the desktop reads that original operation rather than
submitting a replacement. Pending status reads remain bounded by the existing
service deadline; a desktop polling limit does not make the runtime stopped.

A completed Resume receipt is checked against a fresh list observation before
Open. The runtime must still be running with that receipt's generation. Open has
its own request ID. A known failed Open allows an explicit new Open request;
a missing or uncertain result retains the original Open ID. A saved completed
Open result resolves a lost reply without starting another viewer. A viewer error
keeps the conversation running and reports the distinction in the panel.

The shared real-Codex journey also runs as panel-resume. It reuses its original
saved-marker, idle, identity, attachment and cleanup checks, but chooses Resume
and failed/repaired Open through actual panel controls. It records the Resuming
label before the runtime becomes current. Its input adapter verifies panel focus;
after a native terminal cycle it can request activation of that exact proof window
through the existing xdotool tool, then rechecks focus. This does not claim OS-level
keyboard or pointer delivery for the Chromium events.

Saved Resume and Open results are matched to the request ID, action and Vessel
before use. A matching generation alone cannot identify a conversation. Polling
checks that binding on each reply. The focused Resume test file keeps realistic
receipt fixtures separate from creation and history tests.

The desktop's Open adapter keeps service completion separate from subsequent
window placement. If Open completed and placement fails, the result stays completed
with a readable placement warning. The menu clears that completed request. The
native panel journey waits for UI action completion and checks this distinction.
The automatic placement warning remains a separate existing limitation; this
increment changes no window geometry policy.

A refused Resume whose original reply cannot be distinguished from lost admission
can leave its desktop attempt pinned. Rechecks inspect that same request; they do
not silently submit a new one. A broader distinction between confirmed admission
refusal and uncertainty is deferred. This conservative UI limit can require a
desktop restart after the service again reports eligibility. Restarting the client
does not restore a runtime or bypass the service's current checks.

## Supervisor context and focus

A visible worker names its supervisor when that supervisor is outside its visible
stack. The label comes from the complete service list and reports the observed
state. Missing metadata says Supervisor unavailable. Filtering does not change
assignments or inherited Fleet placement and creates no duplicate captain row.

The small focus helper remembers a named control and its Vessel before rebuilding
rows, including when an asynchronous action temporarily disables its button. If
that Vessel moves into collapsed Previous vessels, focus goes directly to the
summary. Otherwise it keeps a usable control on the same Vessel or the relevant
group heading. A rectangle alone is insufficient evidence that a control inside a
closed disclosure can receive focus. Restored focus scrolls into view.

History reads return focus to their re-enabled button only if the reader has not
moved elsewhere. Closing details returns to Inspect, or Previous vessels when the
containing disclosure is closed. Offline state also disables Fleet actions,
creation submission and service stop. Cached inspection remains available.

The shared runner's panel-context journey reuses the existing real-Codex session.
It creates an owned disposable worker, stops its captain through keyboard input,
and checks the worker's label, useful focus and unchanged assignments/Fleet data.
The history journey checks keyboard inspection, reading and close behavior and
verifies content fits the actual narrow panel and display before its final pointer
comparison. No host display configuration changes are needed.

Chromium pointer input does not move the OS cursor. The ordinary-background
comparison checks default event handling after the bounds and focus checks;
it does not prove native panel dragging, which follows the OS cursor. Physical
keyboard, mouse, wheel and trackpad delivery remain separate manual checks.


Use the established Vessel terminology consistently in headings, accessible names
and explanatory copy. Vessels identifies the current list; Previous vessels names
its history. An agent and a Bash terminal share this product entity. A lifecycle
state describes that entity rather than introducing another name for it.

The desktop and its launch setup own internal storage configuration. The Linux
worker socket adds 42 bytes to the state directory and requires a total below
104 bytes. The shell socket also adds 42. A manual trial must choose a short persistent
state path before starting the service. A CLI suggestion to change --state is not
a usable remedy in the creation form. The long-path trial failure was caused by
its launch configuration, before any vessel started; the normal default state
path fits. Separating persistent data from short runtime socket paths remains a
broader architecture question, not a change in this wording correction.


## Compact Vessel Resume

Rows show the Vessel name, applicable rank and existing connection dot. Routine
state, folder and activity metadata are in Details in the three-dot menu.
Starting, Resuming, Reconnecting and actual connection failures stay visible.
Stopped names remain static text with one explicit Resume action. Resume and the
menu have separate columns. Details keeps the full path, labeled last activity,
state, rank and saved history, and identifies unavailable metadata. Viewer selection also lives there rather than in a form
under every row. Runtime ownership, task submission and separate Open receipts
retain their existing service contracts.

Pending Resume uses the same operation identity, shows Resuming and prevents
another submission. A stopped row becoming current retains its identity and useful
keyboard focus. Closing Details returns to the row's menu, or the containing
history disclosure when it is collapsed. Cached Details stays accessible offline;
service actions and history reads remain unavailable until connected.

The matching shared panel journey verifies actual Resume, idle state, saved-marker
recall, fresh credentials and failed Open followed by successful same-runtime Open.
The history journey opens Details through the row menu and retains keyboard and
scrolling checks. History-view controls and per-Vessel error placement are the
following increment, not part of this compact-row change.

The direct rank and supervisor choices are implemented on the current candidate.
They use the existing service actions, retain pending state across row replacement
and restore confirmed values on refusal. Code checks pass. Native acceptance is
still blocked: the mouse-only Controller selection left it Unassigned. The
existing keyboard-selection journey passed on the earlier package, but does not
resolve this mouse check. See the active task record before treating the slice
as ready for owner inspection.


Offline action disabling uses one helper for standalone rows, Fleet rows and
repeated cached refreshes. Menu, Details and local expand controls stay available;
service mutations remain disabled. Resume announces its start and result through
a persistent visually hidden polite status region. When its pending button is
disabled or replaced, focus tries the same Vessel's menu before a group heading.
The native journey checks that pending focus and status announcement explicitly;
this checks Chromium semantics, not delivery by an installed screen reader.
