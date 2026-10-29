# Spec draft: avatar behavior around the panel and menus

Module id: avatar-behavior. Isaac requested a separate specification on 27 October
2026. This draft records the reported behavior and intended correction for review.
It is not an approved implementation plan or an instruction to alter the live app.
The approved reconnect build finishes first, followed by the small panel changes.

## Objective

The owner can place the avatar freely without pulling the panel along, and use
panel menus without the avatar intercepting input. Preserve existing docking,
terminal behavior and the return to the panel when a docked terminal closes.

## Required journeys

- Open a Vessel's three-dot menu where the avatar overlaps it. Select Rename,
  type and save using pointer or keyboard without moving the avatar. Keep the
  menu and editor in front throughout the interaction. Closing, Escape or outside
  dismissal restores normal ordering without moving either window.
- Drag the avatar away and drop it onto empty desktop. Leave it where dropped
  and preserve the panel's position. A rejected drop onto an unsupported terminal
  shows its existing readable refusal and also preserves the panel's position.
- Close an already docked terminal. Preserve the accepted return-to-panel
  behavior and the panel's remembered position. Ordinary avatar clicks still
  toggle the panel. Do not conflate target loss with a new rejected dock.

Keep the current minimal look, existing controls and explicit Stop/Background
semantics. No automatic agent restart, viewer replacement or permission change.

## Source findings and limits

The menu is a browser popover inside panelWin. The avatar is a separate native
window. main.cjs explicitly raises the seated avatar. A CSS-only change cannot
establish ordering between those native windows. A native pointer test must prove
that the menu, including its Rename editor, actually receives input.

For rejected docking, refuseDock chooses dockOrigin only when binding exists.
Before attachment it calls restoreFloating without an origin. That calls
setExpanded without an anchor and places the panel relative to the avatar. An
empty-desktop drop instead calls undock. This is a source-traced explanation for
the difference Isaac reported, not a new live reproduction.

## Boundaries and proving

Implementation belongs in the existing Electron window and interaction owners:
desktop/src/main.cjs, its narrow preload bridge and ui/renderer.js where needed.
Keep service ownership, rank policy and terminal input unchanged. Read
SPEC-docking-recovery.md and docs/fleets.md before changing placement.
Use ordinary functions, comment-free changed source and existing dependencies.

Use existing native application proving and pointer actions. First reproduce each
failure against the selected baseline. Prove actual window ordering, unchanged
panel bounds, free placement, cancellation and terminal-close recovery on the
candidate. Preserve known-different supported versus unsupported docking cases.
Use the existing renderer/main-process tests only for deterministic internal
transitions. They do not replace native input and window observations.

From an approved implementation worktree run npm --prefix desktop run format:check
and npm --prefix desktop test. Package with npm --prefix desktop run package:linux
and use the maintained native runner. The later plan must select its precise
journey and isolated launch command. Record actual app/service identities and
cleanup. Apply CONSTRAINTS.md and the agreed fresh-review/corrective-pass limit.
No runtime proof or code repair is claimed by this draft.
