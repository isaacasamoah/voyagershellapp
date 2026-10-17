# Window groups

The panel groups registered instances by their existing supervisor assignments.
An Admiral, Commodore or Captain has a collapsible group containing itself and
its assigned descendants. Collapse hides panel rows; it does not minimise windows
or change an assignment. Unassigned instances remain at the top level.

Click a group heading to surface its running members on the display containing
the panel. Other identified terminal windows belonging to this service minimise.
**Show all** surfaces every running managed instance in the current service.
It does not include unrelated windows or another Voyager service.

Choose **Even grid** for a compact grid ordered from Admiral through Crew.
**By rank** gives each rank its own row and wraps peers when the terminal's
minimum width requires it. If minimum terminal sizes cannot fit the selected
layout, Voyager refuses rather than deliberately overlapping the windows.
Try Even grid or select a smaller group.

Click an instance card to open or restore its terminal on the left half of that
display, minimise the others and bring it forward. The **⋯** menu is in the card's
top-right corner. An unregistered retained instance can still reopen its terminal;
it is excluded from automatic groups.

## Terms

- **Surface:** open or restore a terminal and bring it forward.
- **Minimise:** hide its existing window; retain the terminal client.
- **Background:** close the terminal client; retain the agent runtime and capture.

Neither surfacing nor grouping grants instruction authority. Docking still selects
the human command surface. A docked terminal can be minimised without releasing
its attachment; its astronaut hides with it and returns when surfaced.

## Boundaries

Group membership comes from the service; panel expansion and window placement are
presentation state. They do not require a second group database or a new rank.
The renderer uses named preload actions. Electron resolves native client identity
against service records and passes a placement plan to the Rust window helper.
The helper checks window ownership, process start identity and the terminal
executable before sending X11 requests. It reports requested versus observed
geometry. No native keystrokes or model requests are involved.

This prototype supports dedicated Ghostty XWayland windows. It uses native
minimum-size hints and the panel's display scale. Native Wayland, other terminal
adapters, saved layouts and automatic creator/new-worker pairing remain separate
work. Resizing can reflow the native terminal display; it does not restart work.

## Checks

`npm test` checks group boundaries, rank ordering, minimum-size wrapping,
non-overlapping grids, collapse state and the named instance-card action.
`npm start -- --expanded --proof-groups` deliberately arranges existing registered
native windows. It requires a populated hierarchy with a Captain and reports;
it makes no model calls and creates no instances. It checks Show all, a Captain's
group, an individual card and return to the full grid, while registration, capture
and control remain unchanged. It leaves the app open and saves groups-proof.json,
last-layout.json and groups-panel.png in the private state directory. Physical
pointer behaviour remains a user check.
