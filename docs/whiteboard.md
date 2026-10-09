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
collapsed. Choose Pen, Box, Text, Connect or Move under **Desktop whiteboard**.
A transparent drawing layer covers the display containing the sidebar.

- Pen: drag directly over your desktop and application windows.
- Box or Text: enter the label in the sidebar, then click the desktop to place it.
- Connect: click two labelled items in order.
- Move: drag a labelled item; connections follow.
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
`id` beginning with `n`, `kind` (`box` or `text`), `label`, and `x`, `y` coordinates in
display-local CSS pixels. Edges have `from` and `to` IDs. Strokes contain `[x, y]`
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

The opt-in proof uses a separate UI profile and the existing service. It exercises
the actual sidebar IPC, pointer drawing on the overlay, zero-alpha background pixels,
file export/import, malformed-import refusal, undo, hide/reopen, Escape and sidebar
collapse. File dialogs are replaced only in the test to select evidence filenames.
It verifies that the service instance remains the same and exits its test UI.
It does not send a prompt, open a worker terminal, or stop an agent.

Linux/XWayland is the tested platform. Renderer input proves application behavior;
physical input routing, compositor stacking and drawing feel still need a user test.
The sidebar is raised above the drawing layer when the layer gains focus. Escape is
registered only while drawing; if another app owns that shortcut, the sidebar reports
that Use desktop remains the exit. Hiding the layer avoids relying on transparent
click-through behavior, which varies across platforms and Electron versions.

References: Electron's [transparent window limitations](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)
and [window positioning and stacking APIs](https://www.electronjs.org/docs/latest/api/browser-window/).
