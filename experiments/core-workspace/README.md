# Voyager Core workspace prototype

This isolated Electron client uses Herdr Core to run terminal processes and render their screens. It does not replace the installed Voyager service. It remains a research prototype.

The 1 November UX candidate removes duplicate conversation controls, decorative dock buttons, layout/package toolbar buttons and the sidebar footer. One text control stays with the sidebar, or moves to the top bar when the sidebar is collapsed. Speech stays with the full-size avatar or its compact control location. The existing avatar animation and sound implementation is retained.

The selected vocabulary is Voyage for a space, Fleet for a tab, Vessel for content inside a Fleet, and Portal for content attached across a Voyage. The current implementation still uses the older `realm`, `dimension` and `portal` storage and API names. Voyage-wide Portals and the new typed public contract are not implemented by this UX change.

New Vessel and Split open a compact picker beside the control. It follows the live content catalogue, supports keyboard choice and cancellation, and dismisses when the user changes workspace context or clicks into embedded content. Each opening captures its destination. A stale choice cannot create in a different Fleet.

## Run and interact

Use Node 24, a Linux desktop and `hc` 0.1.15 on PATH. Chat and voice additionally need a configured Codex installation. Install dependencies and launch from this directory:

```sh
npm ci
npm start
```

Use `VOYAGER_WORKSPACE_SESSION=voyager-another-name` for an isolated Core session. `VOYAGER_WORKSPACE_CWD` selects its initial folder. `VOYAGER_HC` and `VOYAGER_CODEX_BIN` select executable paths. Starting the same profile again restores its viewer; it does not submit a new agent task.

Choose **+ Vessel** to open a terminal, native agent CLI or editable content package. Use the split controls and dividers to arrange content. Double-click a Voyage, Fleet or Vessel name to rename it in place, or focus its navigation item/header and press F2. Enter or blur saves; Escape cancels. Drag navigation items to reorder, or use Alt+Shift+Up/Down for Voyages and Alt+Shift+Left/Right for Fleets. Drag a Vessel header onto another header or Fleet. Hover another Voyage during the drag to reveal its Fleet destinations. The Move action provides the same destinations by keyboard. Movement preserves content identity, data and backend address. The refined local picker and activity presentation remain pending.

Drag Voyager to a Voyage, Fleet, Vessel header or Home to change its context. For keyboard docking, focus the existing navigation item, Vessel header or Home and press Shift+Enter. Ctrl+J opens or closes text chat. Ctrl+B toggles the sidebar. Speech and text requests use the same avatar focus, while retaining the user's authority.

Closing the viewer leaves the Core session running and floats the desktop avatar. The standard application **Quit** action requests a stop for this dedicated session before exiting. A failed spawn can exit without a stop request. An unconfirmed startup or stop stays visibly unresolved and does not retry the effect. Stopped agent programs are not automatically resumed.

## Editable content

The existing package format uses these legacy paths and names:

```text
portals/
  packages/<type>/portal.json
  packages/<type>/view.html
  packages/<type>/...assets or backend files
  data/<instance-id>.json
  layouts/<dimension-id>-<name>.json
  .uninstalled/<type>/
```

The content folder is inside the selected session's Electron userData directory. The current UX removes the package/layout toolbar; this slice does not introduce a replacement menu. Existing named agent operations and file editing remain available.

A web package needs a manifest and HTML entry:

```json
{
  "id": "project-notes",
  "name": "Project notes",
  "renderer": "web",
  "entry": "view.html",
  "seed": { "text": "" },
  "contract": { "text": "The user's editable note" }
}
```

Put the folder under `packages/` while the app runs. It appears in the content catalog. HTML, JavaScript and CSS edits reload applicable views. Invalid manifests retain the previous package. A view reload does not restart its backend process.

The host injects Voyager styling and this browser interface:

```js
const snapshot = await portal.read();
await portal.write({ text: "A new note" }, snapshot.version);
portal.onChange(() => refresh());
```

The version prevents a stale host write from overwriting newer host data. It is not a transaction against arbitrary external file writers. Invalid JSON reports an error and retains the last valid data when available.

Terminal packages use `renderer: "terminal"` and `argv`. Web packages may also specify a Core-owned backend command. `{package}` and `{data}` expand to its folder and data file. Opening a new instance or explicitly starting its backend launches the command. Restoring a layout does not restart an ended process. Hiding content or uninstalling its package does not stop that backend.

The avatar's `voyager_portal` tool reads and updates content within its current focus. Source editing and package uninstall/restore require whole-workspace focus because they affect multiple instances. Uninstall moves the package into `.uninstalled/` while preserving its data, placement and backend. Restore makes those same instances available again.

These capabilities support cooperating browser content and terminal programs. Running a native GUI process does not automatically make its window embeddable or its meaning readable by an agent. Rich examples, explicit agent action contracts and voyage-wide placement are the next design work.

## Evidence and limits

The maintained fixture is `prove.py`, extended by focused journey modules. Run `npm test` and `npm run format:check` here. `prove.py --ux` checks the quiet interface, keyboard/drag docking, control placement, stable terminal identity and Electron Quit in an isolated running candidate. It compares removed controls with the preserved preview through its local debugging endpoint.

The Linux journeys passed on 1 November using Electron 44.10.0 and real Herdr Core. The organisation journey completed in stages within the same corrected instance after browser-driver setup errors; its run-history receipt retains those errors and the explicit drag cancellation used to clear a stuck driver gesture. It verified rename variants, pointer/keyboard placement, live backend and note identity, pinned avatar focus after a renderer reload, and a real stale-document save refusal. The maintained suite now has 16 passing tests. Quit was driven through Electron's `Browser.close` debugging command. OS menu and desktop keyboard activation remain unproved. Startup/uncertain-stop failure scenarios have an isolated boundary test; they are not native failure trials. This establishes neither macOS nor Windows behavior.

Independent review found no remaining Required source issue in this quiet-interface increment. The known quiet-interface proving inventory fits its scoped size rule. The inherited prototype's aggregate acceptance gate remains open. No active demo was replaced, no main-branch integration occurred and no production release is claimed.

The picker journey passed in an isolated Electron/Core session after an owner-approved additional iframe-dismissal correction. Independent review verified focus remained in the embedded Notes field and a missing-close negative control reproduced the defect. The final journey also exercised live type changes, stale controls, a single terminal creation and an actual stale-save rejection without replay. The earlier failed attempts remain recorded. The known scoped picker inventory fits, while the inherited aggregate gate remains open.

## Direct-controls candidate

The next candidate removes the fixed New Vessel/split toolbar and visible Move chooser. Drag a Vessel header to preview the exact destination half, then release to place it. Split choices appear near the upper-right header corner or with keyboard focus. Ctrl+Shift+O/E opens a side-by-side/top-bottom split picker and Ctrl+Shift+T opens a Fleet. Empty Fleets retain local creation. Alt+Shift+H/J/K/L rearranges beside a directional neighbour. Space on a focused header picks up a Vessel; Enter or Space on a Fleet places it, including another Voyage. Escape cancels.

The native journey passed in stages in one corrected owned instance. It verified normal docking before failure tests, terminal text selection, web editing, cancelled/self-drop cleanup, both placement directions, retained process/data identity, empty-Fleet creation and keyboard movement. A real catalogue watcher update cancelled an active drag without a late move. A final deliberate stale-save rejection remained gated without replay. The earlier closed trial may explain the owner's docking report, but its timing was not matched, so that cause is unconfirmed.

Independent source review has no remaining Required issue. Acceptance remains blocked by the written size rule: 2,879 normally formatted proof/bookkeeping lines exceed 2,781 mapped production lines by 98. Failed diagnostics and retired helpers remain counted. The inherited aggregate gate and physical OS keyboard/menu evidence are also open. This is a draft checkpoint, not accepted completion, a merge or a release. All disposable candidates were explicitly quit; the preserved demo remains unchanged.

## Consolidated proof checkpoint

Isaac approved consolidating the verification after the tagged direct-controls prototype. Runtime source is unchanged. The maintained picker and direct-controls journeys now share recording, process snapshots, settlement and picker opening. Cross-Voyage keyboard carry, moved-source stale choices and actual watcher cancellation are maintained checks rather than separate successful review scripts. Historical resume-only branches belong to the earlier tagged fixture.

The corrected full journey passed uninterrupted on an isolated Xvfb/X11 desktop with real Electron and Herdr Core. It asserted zero late move dispatches after watcher cancellation, preserved process/data identity, and ended with one actual stale-save rejection. The first full run is retained because its initial watcher assertion could miss an asynchronous move. The corrected second run and independent geometry mutation completed without a remaining Required issue. Eighteen unchanged boundary tests and formatting passed.

The fresh scoped inventory is 2,425 normally formatted proof/bookkeeping lines against 2,781 mapped production-function/dispatch lines. It includes the retained first-run module, shared Quit helper, setup/cleanup, mutation, audit code and embedded programs. The older 2,879/2,781 result remains historical evidence, not a rewritten passing result. This scoped check does not close inherited aggregate acceptance or establish GNOME compositor behavior, physical OS keyboard/menu operation, audible voice, macOS or Windows. Both owner previews remain on their separate immutable source tags.

Use the candidate's prove.py with --launch --picker --direct-controls and a dedicated --session, --port and --evidence directory. A new launch requires a fresh evidence directory. Later --quit uses that same directory and verified owned candidate. Do not run these destructive test journeys against an owner's session.
