# Vessels and fleets

A **Vessel** is one registered agent or terminal. The service and CLI still call
it an instance; IDs and commands are unchanged. A **Fleet** is a named collection
for a topic or shared goal. Fleet membership grants no command authority.

## Panel

Rank rows form the command hierarchy directly: Admiral → Commodore → Captain →
Crew. Each supervisor starts collapsed. Its chevron reveals assigned vessels,
with a small indentation for each level. There is no extra group header.

Click a Vessel card to open or restore its terminal on half the panel's display
and minimise the other managed terminals. Its top-right **⋯** retains lifecycle
and assignment actions, including Rename. **Minimise** retains the terminal client. **Background**
closes the client while keeping the agent runtime and capture.

Use **+** opposite **Fleets**, enter its goal, then drag Vessel cards onto its canvas.
Dragging a supervisor carries its assigned descendants. Each Vessel appears in
one Fleet or in the main Vessels list. Drag back to that list to leave a Fleet.
New descendants inherit their supervisor's Fleet unless explicitly moved.
Moving a supervisor again carries its whole current branch, including descendants
that had been placed elsewhere. None of these moves changes ranks or assignments.

Click a Fleet name to surface its running vessels in rank order. Two use equal
halves; three use a left half and two right quarters; four use quarters. More
vessels use a grid. Shared edges are calculated once, without gaps. Terminal
minimum sizes still apply. There is no layout selector.

The Fleet menu offers Rename and Remove fleet. Renaming changes its label without
changing membership. Vessel renaming preserves runtime, capture and identity.

Removing a Fleet returns its members to Vessels; it does not stop or deregister
them. Unregistered retained instances remain separately reopenable and do not
appear in Fleets until registered again.

## Size

An empty canvas reserves one Vessel row and grows naturally with visible cards.
The panel measures its rendered content, including forms, errors, questions and
expanded rank rows. It grows and shrinks to fit, stays within the display's work
area, and scrolls when that physical limit is reached. This measures content;
it does not infer height from the number of registered instances.

## Implementation and checks

`desktop/src/ui/hierarchy.js` derives rank branches and inherited membership.
`service/fleets.rs` serialises atomic, private writes to fleets.json in the
existing state directory. The CLI, conversation tools and desktop all use that
one service owner through named actions. It stores Fleet names and explicit membership roots;
corrupt settings refuse edits and remain preserved. These are local presentation
settings, separate from the service's authoritative rank and lifecycle data.
The renderer uses named preload actions; it never reads state files directly.

The existing Rust window helper applies identified presentation plans. Surfacing,
minimising and Fleet membership do not move docking authority. Dedicated Ghostty
XWayland remains the supported terminal surface.

Cargo tests cover private persistence, repeated creation, branch moves, removal,
invalid data and authority. Desktop tests cover named routing, inherited membership
and collapsed rank rows.
`npm start -- --expanded --proof-fleets` exercises the actual desktop panel with
an existing Captain hierarchy and empty Fleet settings. It creates a temporary
Fleet, delivers programmatic drag/drop events, checks measured native panel
bounds and canvas growth, surfaces a Fleet in native terminals, restores their
previous geometry, then removes its own metadata. It preserves service
registrations, ranks, assignments and capture. It creates no agent or model task.
Physical dragging remains a user check.
