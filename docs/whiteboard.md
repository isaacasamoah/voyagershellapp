# Whiteboard experiment

Can a person and an existing coding agent plan together using a small drawing surface?
This standalone Electron client uses the desktop app's JavaScript stack and dependency
lockfile. It deliberately runs independently of the docking demo and Rust service.

## Try it

Use Node 24, from `desktop/`:

```sh
npm ci
npm run whiteboard
```

Run from a logged-in graphical desktop terminal. The window is an ordinary opaque
whiteboard with a full-screen canvas option, not a transparent desktop overlay.

- Pen: drag to sketch.
- Box or Text: enter a label and click the canvas.
- Connect: click two labelled items in order.
- Move: drag an item; connections follow it.
- Undo: restore the previous operation, including a board import.
- Save image: download a 1400 × 800 PNG for a vision-capable agent.
- Save board: download JSON containing labelled nodes, directed edges and point strokes.
- Open board: select an agent-edited JSON file. Validation runs before replacing the canvas.
- Save Mermaid: export a flowchart from labelled items and explicit connections.

Save before closing. This prototype has no autosave or shared storage. Imported board
files are limited to 5 MB, 1,000 items per collection and 100,000 stroke points.

## Collaborate with an agent now

1. Sketch a question and save both the image and board file.
2. Give those files to the coding agent you already use. Ask it to explain what it
   sees, distinguish labelled relationships from guesses about strokes, and propose
   an edit to the JSON in a new file.
3. Open that file in the board. Undo returns to the previous canvas.
4. Export Mermaid after agreeing on the structured diagram.

The import contract is `{ version: 1, nodes, edges, strokes }`. Nodes have a unique
`id` beginning with `n`, `kind` (`box` or `text`), `label`, and coordinates `x`, `y`.
Edges have `from` and `to` node IDs. Strokes contain `[x, y]` point arrays. The canvas
is 1400 × 800. `desktop/whiteboard/model.mjs` owns validation and Mermaid serialization.
Freehand marks are preserved in the image/JSON but explicitly omitted from Mermaid.
There is no automatic handwriting recognition or model call.

## Proposed Voyager connection — not implemented

The Rust service should own a board ID and revision associated with a registered
session. A read tool could return the board JSON and image; a write tool could accept
an edited board with its expected revision and attributed agent/session identity.
A stale revision must refuse an overwrite so an agent cannot silently erase a
concurrent human sketch. Electron would remain the view and input client.

Those tools belong in a later small experiment after the file exchange is useful.
This prototype provides neither a service tool nor a computer-use provider; it does
not alter agent ownership, session registration, docking, or knowledge-graph storage.

## Checks and limits

```sh
cd desktop
npm test
npm run format:check
VOYAGER_WHITEBOARD_PROOF=/absolute/path/to/evidence npm run proof:whiteboard
```

The deliberate Electron proof opens a visible window, sends pointer input, exports
PNG/JSON/Mermaid, imports a programmatically edited graph, rejects a malformed import
without changing the board, and undoes the valid import. It writes evidence and exits.
Ordinary tests open no window and call no model. Linux/XWayland is the tested surface;
physical drawing feel, macOS behavior and agent interpretation remain human tests.
