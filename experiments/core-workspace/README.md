# Voyager Core workspace prototype

This isolated Electron client uses Herdr Core to run terminal processes and render their screens. It does not replace the installed Voyager service. It remains a research prototype.

The 1 November UX candidate removes duplicate conversation controls, decorative dock buttons, layout/package toolbar buttons and the sidebar footer. One text control stays with the sidebar, or moves to the top bar when the sidebar is collapsed. Speech stays with the full-size avatar or its compact control location. The existing avatar animation and sound implementation is retained.

The selected vocabulary is Voyage for a space, Fleet for a tab, Vessel for content inside a Fleet, and Portal for content attached across a Voyage. The current implementation still uses the older `realm`, `dimension` and `portal` storage and API names. Voyage-wide Portals and the new typed public contract are not implemented by this UX change.

## Run and interact

Use Node 24, a Linux desktop and `hc` 0.1.15 on PATH. Chat and voice additionally need a configured Codex installation. Install dependencies and launch from this directory:

```sh
npm ci
npm start
```

Use `VOYAGER_WORKSPACE_SESSION=voyager-another-name` for an isolated Core session. `VOYAGER_WORKSPACE_CWD` selects its initial folder. `VOYAGER_HC` and `VOYAGER_CODEX_BIN` select executable paths. Starting the same profile again restores its viewer; it does not submit a new agent task.

Choose **+ Vessel** to open a terminal, native agent CLI or editable content package. Use the split controls and dividers to arrange content. Double-click a Voyage or Fleet to rename it through the existing dialog. Inline rename, broader drag placement and the refined local picker remain pending.

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

The Linux journey passed on 1 November using Electron 44.10.0 and real Herdr Core. Quit was driven through Electron's `Browser.close` debugging command. OS menu and desktop keyboard activation remain unproved. Startup/uncertain-stop failure scenarios have an isolated boundary test; they are not native failure trials. This establishes neither macOS nor Windows behavior.

Independent review found no remaining Required source issue in this quiet-interface increment. The known quiet-interface proving inventory fits its scoped size rule. The inherited prototype's aggregate acceptance gate remains open. No active demo was replaced, no main-branch integration occurred and no production release is claimed.
