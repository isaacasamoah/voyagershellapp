# Draw on the desktop

The whiteboard lives in a collapsible section of Voyager's glass agent panel.
The desktop itself is the drawing surface. This branch rebases the experiment
onto the refined desktop interface and keeps its astronaut and docking gestures.

## Try it

Build the Rust binaries with `cargo build --locked --bins`, then use Node 24:

```sh
cd desktop
npm ci
VOYAGER_STATE=/absolute/path/to/service-state npm start -- --expanded
```

Run from a logged-in graphical desktop with the existing service running. Open
**Whiteboard** beneath the agent list. The section starts collapsed.

- Pen: drag over the desktop to draw freehand.
- Box or Text: click the desktop, then type directly into the new item. Text has
  no card background. Enter or clicking outside finishes; double-click to edit again.
- Connect: click two items to join them with an arrow.
- Select: drag around several items, or Shift-click to add/remove an item from
  the selection. Drag a selected item to move the group; connections follow.
- Click an item for its corner resize handles. Undo reverts a completed action;
  initial typing and placement undo together.
- Delete removes the selection. Clear removes the drawing; either can be undone.
- Done or Escape returns control to other apps. Choose a drawing tool to resume.
- Closing the Whiteboard section, collapsing the panel or beginning an astronaut
  gesture ends drawing mode. Marks remain in memory while this prototype runs.

The panel background can be dragged while drawing is inactive. During drawing,
the sidebar stays in place and its controls remain clickable. The canvas and
controls share the panel's native window; the astronaut stays above it as a child
window. There is no third native drawing window to cover the controls.

## Current scope

This is a temporary drawing prototype: quitting clears its in-memory board.
The sidebar has no label field or Save marks, Save board, Open board or Mermaid
buttons. Those operations are intended for registered agents through a shared
Voyager MCP tool set; that service integration is not implemented yet. This UI
update does not claim agent interpretation, saved boards or knowledge-graph events.

The drawing model and marks-only snapshot remain in
`desktop/src/ui/whiteboard/`. No application windows beneath the drawing are
captured. The JSON validation and explicit-connection Mermaid conversion are
local data helpers, not callable Voyager agent tools.

The prototype covers the display containing the panel. Other apps receive input
after leaving drawing mode. Changing displays ends drawing mode; marks keep
pixel coordinates and may be clipped on a smaller display. Linux/XWayland is the
only tested platform.

## Isolation and checks

Keep this micro-project on its own branch and worktree. Its
`desktop-whiteboard-glass-profile` lives beside the service state, so it does not
reuse the main desktop client's lock or the previous whiteboard preview's lock.
It connects to the existing service without taking ownership of its agents.

```sh
cd desktop
npm test
npm run format:check
VOYAGER_STATE=/absolute/path/to/service-state \
VOYAGER_WHITEBOARD_PROOF=/absolute/path/to/evidence npm run proof:whiteboard
```

The separate proof profile runs pointer input through the actual Electron panel.
It checks collapsed/expanded sizing, each drawing tool, direct typing, resizing,
selection/group movement, undo/delete/clear, returning to the desktop and the
astronaut toggle. It verifies transparent background pixels, native drag regions,
and the astronaut's position in the actual X11 window stack. A deliberate
canvas-above-controls counterexample must block the Box click before the correct
order is restored. The service instance must remain unchanged.

Programmatic input and native stack observations do not establish physical
drawing feel or every compositor interaction. The live app remains the final
human check. The proof exits its own UI and does not send an agent prompt or stop
a worker.
