# Draw on the desktop

The desktop is the whiteboard. The existing Voyager avatar/session sidebar owns the
tools; there is no separate whiteboard application or opaque canvas window.

## Try it

Use Node 24 from `desktop/`, with the existing Voyager service running:

```sh
npm ci
VOYAGER_STATE=/absolute/path/to/service-state npm start -- --expanded
```

Build the repository's service/helper binaries first with `cargo build --locked --bins`.
Run from a logged-in graphical desktop terminal. Open the avatar if the sidebar is
collapsed. Choose Pen, Box, Text, Connect or Select under **Desktop whiteboard**.
A transparent drawing layer covers the display containing the sidebar.

- Pen: drag directly over your desktop and application windows.
- Box: click the desktop to place a rectangle and type directly inside it.
- Text: click the desktop and type plain text. Its editing outline appears only when selected.
- Connect: click two labelled items in order.
- Enter or clicking outside finishes typing. Double-click an existing item to edit
  its text in place. Undo treats placement and the initial text as one action.
- Click an item to select it; drag its corner handles to resize it.
- Select: drag around items to select them together. Shift-click adds or removes
  boxes, text items or pen strokes. Drag a selected item to move the group; connections follow.
- Delete selected or the Delete key: remove the selection and its connections. Undo restores it.
- Undo and Clear marks: change the drawing; clearing can be undone.
- Use desktop or Escape: hide the marks and release desktop input. Choose a tool
  again to resume the same drawing. Collapsing or dragging the avatar also hides it.
- Save marks: export a transparent PNG of the drawing, without capturing the apps underneath.
- Save board / Open board: exchange structured JSON with an agent.
- Mermaid: export the labelled items and explicit connections as a flowchart.

Saving opens a file dialog and exits drawing mode. Select a tool to resume. Marks
stay in memory while this UI runs; save the board before quitting. It has no autosave.
The prototype covers one display at a time. Moving the sidebar to another display
repositions the layer on the next activation; diagrams retain their pixel positions
and can be clipped on a smaller display. Display changes end drawing mode.

## Agent collaboration

Give a coding agent the saved PNG and JSON. Ask it to explain the marks, distinguish
explicit relationships from guesses, then edit a copy of the JSON. Open the edited
file from Voyager's sidebar; Undo restores the previous drawing. This is a manual
file exchange, not a live Voyager agent tool. Mermaid deliberately omits freehand
strokes and adds a comment documenting that omission.

The JSON contract is `{ version: 1, nodes, edges, strokes }`. Nodes have a unique
`id` beginning with `n`, `kind` (`box` or `text`), `label`, `width`, `height`, and `x`, `y`
centre coordinates in display-local CSS pixels. Missing dimensions default to 200 by
64 pixels; dimensions must be between 40 by 32 and 4096 by 4096 pixels.
Edges have `from` and `to` IDs. Strokes contain `[x, y]`
point arrays. Validation lives in `desktop/whiteboard/model.mjs`; imported files are
limited to 5 MB, 1,000 items per collection and 100,000 stroke points. No imported
markup is executed.

A future service experiment could own board IDs/revisions and expose snapshot and
edit tools to registered agents. Edits would need an expected revision and agent
attribution to avoid erasing a concurrent human change. Neither that service contract
nor model-based sketch recognition is implemented here.

## Checks and current limits

```sh
cd desktop
npm test
npm run format:check
VOYAGER_STATE=/absolute/path/to/service-state \
VOYAGER_WHITEBOARD_PROOF=/absolute/path/to/evidence npm run proof:whiteboard
```

The prototype uses its own `desktop-whiteboard-profile` beside the service state, so
it does not take the main docking client's single-instance lock. Keep micro-projects
on their own branch and worktree; run the prototype from that worktree.

The opt-in proof uses another separate UI profile and the existing service. It sends
pointer events through the shared window, exercising each drawing tool, typing directly
in new and existing items, resizing, marquee and Shift-click selection, group movement,
deletion, file export/import, malformed-import refusal, undo, hide/reopen, Escape and
sidebar collapse. Its known-broken control places the drawing above the sidebar and
confirms the tool click fails before restoring the correct stacking. It checks
zero-alpha background pixels. File dialogs are replaced only in the test to select evidence filenames.
It verifies that the service instance remains the same and exits its test UI.
It does not send a prompt, open a worker terminal, or stop an agent.

Linux/XWayland is the tested platform. Renderer input proves application behavior;
physical input routing, compositor stacking and drawing feel still need a user test.
Sidebar and drawing are elements of one transparent native window. Drawing mode
expands that window to the display while keeping the sidebar at its previous position,
above the drawing. Exiting restores the sidebar window bounds. Escape is registered
only while drawing; if another app owns that shortcut, the sidebar reports that
Use desktop remains the exit. Other applications receive input after exiting drawing
mode. The prototype does not support simultaneous drawing and interaction with apps underneath.

References: Electron's [transparent window limitations](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)
and [window positioning and stacking APIs](https://www.electronjs.org/docs/latest/api/browser-window/).
