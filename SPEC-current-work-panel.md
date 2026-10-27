# Spec: a panel focused on current work

Module id: `current-work-panel`. Project: VoyagerShellApp. Approved by the owner, 24 October 2026. The owner approved its implementation plan and build on 25 October 2026.
The [capability map](SPEC.md) is approved. This panel uses the behavior defined in the [conversation-resume contract](SPEC-conversation-resume.md). The earlier candidate passed independent review for owner inspection on 26 October. The following row refinement is a specification and planning change, not implemented behavior. Merge and installation remain separate decisions.

## Proposed refinement: compact Vessel rows with details in the menu

Isaac revised this refinement on 27 October 2026. It applies to Vessels,
Previous vessels and Removed vessels. It supersedes the earlier inline-expansion
proposal and requirements to show routine state, folder and activity text on every
row.

Show the Vessel's name, its existing rank presentation and status dot. Keep the
existing type, colors, spacing, rounded controls, Fleet layout and captain-and-
worker stacks. Preserve the existing rules for which records have a rank. Do not
add an always-visible Running label that repeats the status indicator. The dot
must retain its actual existing meaning, including capture and connection state;
this presentation change must not redefine it as proof of process ownership or
liveness. Keep state available in accessible text and Details so color is not the
only way to understand it.

Clicking a running managed Vessel's name keeps the existing action that opens or
brings forward its terminal. Preserve keyboard activation, selection and drag
behavior. Previous vessels retain their explicit Resume action when the service
allows it. Removed and external records keep only their existing permitted
actions. Do not make clicking the name silently resume a stopped agent.

Use Details in the existing three-dot menu for the full working folder path,
last recorded activity date and time, state and other existing metadata. Reuse
the existing details view and captured-history access. Add no row disclosure,
inline expansion, extra Inspect button or second details view. Do not introduce
an editable description or new stored field. Label the timestamp Last activity.
Say Activity time unavailable or Folder unavailable when necessary; do not
substitute registration time for unknown activity.

Keep pending progress and action failures with the affected Vessel. Keep service-
wide connection feedback at panel level and retain a Reports to explanation when
a worker's captain is absent from the filtered list. Routine successful state
belongs in Details, while progress, errors and missing responsibility context
remain visible when needed.

Opening a three-dot menu must put its controls and any Rename input in front of
the avatar. The owner must be able to select Rename, type and save without moving
the avatar. Keep the panel usable for the whole menu interaction, including
keyboard use. Closing or dismissing the menu restores ordinary window ordering
without moving the avatar or panel, changing docking or reopening a closed menu.
This is a window-ordering correction, not a new Rename flow.

Refresh must retain useful keyboard focus and keep an open details view tied to
the same Vessel. Preserve history scroll position and the existing focus fallback
when a whole group closes. Details remain readable while the service is offline,
with last-known information identified and service-dependent actions unavailable.
Opening Details must not launch a terminal, resume an agent, submit work or change
registration, assignments or Fleet placement.

Measure panel size from rendered content through the existing ResizeObserver.
Keep long details readable within the display bounds and existing scroll areas.
Do not estimate height from a Vessel count. Apart from menu window ordering,
this refinement changes neither avatar placement nor docking behavior.

### Refinement acceptance journeys

| Id | What the owner can verify |
|---|---|
| N1 | Current, previous and removed rows show the name, applicable rank and status dot, without routine folder, date or Running text. Details in the three-dot menu exposes the existing metadata and labels missing values clearly. |
| N2 | Clicking or keyboard-activating a live managed Vessel's name still opens or brings forward its terminal. Resume remains explicit for eligible previous Vessels. Opening Details causes no lifecycle, task, registration or assignment operation. |
| N3 | Refresh, sorting and a change between current and previous lists preserve useful focus and keep the details view associated with the correct Vessel. History scrolling and menu keyboard access remain usable. |
| N4 | Pending operations, failed actions, missing-supervisor context and service loss remain understandable. Status remains accessible without relying on color, and viewing stale details never enables an unavailable lifecycle action. |
| N5 | Long names and paths, short and long history lists, and narrow or short displays remain readable and keyboard usable. Rendered content determines panel size within the display limit. Existing history batching, Fleet stacks and docking remain usable. |
| N6 | With the avatar overlapping a menu location, open the three-dot menu and complete Rename by pointer and keyboard without moving the avatar. Menu controls stay in front throughout editing. Dismissal restores ordinary ordering and changes no window position or docking state. |

Use existing renderer tests for deterministic behavior and the maintained native
panel journey for real interaction and layout. Demonstrate that the baseline
shows the unwanted routine metadata. Preserve existing name-click, Resume,
lifecycle and history assertions. Record the candidate app and bundled service
used. No implementation or native proving is claimed by this specification edit.

## Approved revision, 26 October 2026

Owner testing found that the Resume controls clutter the panel and spread one
Vessel's operation across unrelated areas. This revision proposes a compact row
with one primary Resume action and secondary details. It uses the revised
[Resume configuration rule](SPEC-conversation-resume.md#current-configuration-at-startup).
The current model/effort policy and YOLO launch default are owner-selected. Isaac
broadly agreed with the compact presentation and specified no checkbox. The
running app at that review still used the previous design. The compact Resume
correction was subsequently built and tested, before the name-only refinement.

## Proposed follow-up: proactive connection recovery

Approved by Isaac, 26 October 2026. The service behavior is owned by the
[reconnection section](SPEC-conversation-resume.md#proposed-follow-up-reconnect-a-surviving-vessel).
This section supersedes the earlier automatic Needs attention placement for a
previously managed Codex Vessel whose service connection was lost.

- Keep that Vessel in Vessels while the service checks it. Show Reconnecting as
  temporary progress. Do not require the owner to find it in another group first.
- Successful verification returns the same Vessel to normal use. Preserve focus,
  Fleet placement and the owner's current window and avatar arrangement.
- A failed bounded check shows a readable Connection lost reason and Retry
  connection. Retry invokes verification of the existing runtime, not Resume.
  Disable duplicate requests while an attempt is active and announce progress.
- Use Previous vessels and Resume after the service confirms runtime exit.
  A failed connection alone must never imply stopped or enable a replacement.
- Use Needs attention only for a specific problem with a supported user remedy.
  Details can explain evidence; it is not itself a remedy for lost management.
  Keep unavoidable system uncertainty readable without making the user responsible
  for repairing a connection the application can check itself.
- Show window state as unverified when the service has lost its viewer record.
  Do not report closed until the native observation establishes that result.

Keep the existing minimal, subtle look. Reuse the current row, secondary-menu,
keyboard and error-feedback patterns. Put fallback Retry connection in the existing
Vessel menu; add no dashboard, permanent recovery banner or confirmation dialog. This
follow-up changes recovery and its presentation, not the separate requested
name-only collapsed-row refinement or the retained free-undocking behavior.

Verification uses the same service-loss journey as the owning Resume spec. Prove
that recovery is automatic, that Retry connection works after a failed check,
that no attention-only dead end remains, and that no new process or turn starts.

## Objective and scope

The owner sees the agents they are using, can find previous conversations when needed, and can understand why an agent needs attention. Stopped agents no longer fill the main panel with grey buttons that do nothing. Hiding a row must not delete its history or change who manages the agent.

The [renderer source inspection](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/ui/renderer.js) found that the panel currently shows registrations that have not been removed, but its main row action requires an agent that Voyager manages and that is running. The saved records are useful. Showing them all as active makes a registered agent look like a running agent.

Keep the existing panel and Fleet layout. Show additional detail when the owner asks for it. This change requires no new dashboard, search index, authority model or full transcript browser. History means the events Voyager actually saved; reconstructing a complete native transcript is outside this increment.

## Presentation contract

Owner correction, 26 October 2026: use Vessels and Previous vessels as the section
names. Keep Vessel as the product term for both registered coding agents and
terminals. State labels describe a Vessel without replacing its name with a new
concept. This correction changes wording, not classification or lifecycle rules.


Use the process state and Resume availability reported by the service, as defined in the conversation-resume specification. A registration, visible window or matching title does not prove that an agent is running. If an older service does not supply the new lifecycle information, treat the state as unknown and explain that the service must be updated before Resume is available.

Apply the following classification in order. Show each Vessel only once as a row with actions. A label naming its supervisor provides context; it must not create another actionable row for that supervisor.

| Observation | Location and available behavior |
|---|---|
| The service is unavailable or its observations are out of date | Keep a connection warning visible. Retain existing rows as last-known information, but disable actions that need a current check. Do not mark an agent stopped just because its information is out of date. |
| Creation or resume is still in progress | Show the agent in Vessels as Starting or Resuming, with the operation status. Do not allow the same action to be submitted again. |
| The service confirms that a process it owns is running | Show the agent in Vessels whether its terminal window is open, minimised or closed. Keep the existing permitted Open, Background and Stop actions. Show a warning if event capture has a problem. |
| Registration was removed, but the service confirms its managed process is still running | Show the agent in Vessels as Unregistered. Keep the existing permitted Open, Stop and Register again actions. Do not hide it in history or suggest that event capture continues. |
| An external agent is registered and its event capture is connected | Show it in Vessels as External, with the supported read-only details and history. Do not offer actions reserved for processes Voyager manages or imply Voyager owns it. |
| A managed Codex Vessel loses its service connection | Apply the proposed recovery section above: check automatically, keep it in Vessels, and offer Retry connection after a failed bounded check. Do not offer Resume without confirmed exit. |
| An operation has no established outcome, an external registration loses capture, or a runtime remains unverified outside the proposed recovery scope | Explain the actual problem. Needs attention requires a supported remedy; otherwise show the unresolved system state and available checks directly. Preserve uncertainty and do not offer Resume until the service confirms it is allowed. |
| Exit is confirmed and the registration remains present | Show it in Previous vessels, collapsed by default. Offer details and history. Offer Resume only when the service allows it. |
| Registration was removed and exit is confirmed, or an external registration was removed and Voyager owns no runtime for it | Show it in the Removed vessels view after the owner chooses Show removed vessels from the history menu. Keep history readable. Explicitly say that an external process's state is unverified. Do not silently register or resume it. |

Previous vessels shows a count and expands with one click or a keyboard action. Apply the compact-row refinement above, with working folder, activity and routine state in Details in the three-dot menu. Do not print technical IDs in the list. Order records by last recorded activity and stable Vessel ID.

Let the expanded history grow within the panel's available space, then scroll inside that area. The number of visible rows follows the available height rather than a fixed target of 50. Keep the other panel controls accessible. A short list should use only the space it needs; a long list must not push the panel beyond the display. Keep panel sizing based on rendered content and the display limit, not an estimate from the total number of records.

Reveal records in small batches sized for the available history area, with Load more at the bottom for older records. Adding a batch extends the scrollable content without forcing the panel to grow. Use ordinary wheel, trackpad and keyboard scrolling, with a subtle scrollbar that remains discoverable. Keep the focused row visible and preserve the owner's place when more records are added. Apply the same behavior to removed records. Use the list results the service already permits the caller to read; this does not add a search service or a new server-side paging system.

Allow the owner to read details and history for every row they have permission to inspect, even when its main action is unavailable. Show the service's explanation beside that action. Display names, paths and captured content as text, never as executable HTML. Load history in limited portions using the existing event cursor and limits, and let the owner request more. Label gaps and periods when capture was unavailable. No captured events does not mean no work occurred.

When a running worker's captain is not in the visible set, show a small label such as "Reports to NAME, stopped" or "Supervisor unavailable". This label provides context; it grants no authority and creates no second movable captain row. Keep the existing captain-and-worker stacks and Fleet membership for the agents still visible. Filtering rows or opening history must not move a supervisor and its workers or clear any worker's Fleet placement.

## Resume interaction

The screen's job is to find a previous Vessel and return to it. Keep the existing
colors, type, rounded controls and Fleet layout. Reuse the established row and
secondary-menu patterns. Add no dashboard, settings form or new visual theme.

A previous Vessel has one compact row. Its name remains legible rather than
looking disabled because the process is stopped. Show Stopped in Details and retain one primary Resume button on the row. The existing secondary menu contains
viewer changes, details and existing permitted maintenance actions. Do not show a
full-width viewer selector, separate Inspect button, raw identifiers or a second
metadata block beneath every row. Keep full paths and precise timestamps readable
in Details in the three-dot menu. Do not rely on hover for access to any control.

Resume uses the Vessel's retained viewer, or the existing supported default when
no selection was retained. Choosing another viewer is optional and stays in the
secondary menu. Use current Codex model and effort settings, with YOLO as the
launch permission default unless the user explicitly changed that default. Do not
ask the owner to confirm ordinary configuration changes. Model and effort controls
are deferred.

Previous vessels remains collapsed by default and keeps its count. Opening it
shows the list directly. No checkbox appears in this history or Resume flow. Put
a plain Show removed vessels action in the secondary history menu. That action
opens the removed-records view, clearly labeled Removed vessels, with Back to
previous vessels to return. Use the same compact rows and scrolling behavior.
Switching views does not remove, restore or start any Vessel. Keep the approved
batching and display-size behavior.

Give the owner's Resume request one identifier. Reuse it when retrieving the
saved result rather than starting another operation. While pending, move the same
Vessel row into Vessels and show Resuming in place of its normal action. Disable
repeated submission and announce the status accessibly. Receipt retrieval must
not require another visible primary action.

After Resume succeeds, confirm through a fresh service observation that the
Vessel is running. Then call the existing Open action with its own identifier.
If Open fails, keep the running Vessel visible and offer Open again. Opening a
viewer never starts another runtime or submits work.

Put a concise startup error on the affected Vessel row. Its details can retain
the full provider error and operation identifier. Do not show raw error codes in
the main list or place a Vessel-specific error above unrelated Vessels. A service
connection failure still belongs at panel level. A known failed Resume leaves the
Vessel stopped; an uncertain outcome retains its evidence and a supported next action. Neither should
appear as a success. Keep the failure visible after refresh until the owner
dismisses it or a later explicit operation supersedes it.

Keep keyboard focus with the same Vessel as its state changes. If it moves into a
collapsed group, focus that group's disclosure. All primary and secondary actions
must work by keyboard and have readable accessible names. On narrow or short
displays, keep one clear row hierarchy and use the existing bounded scroll areas.

The panel follows service ownership and eligibility. Remove and Stop remain
separate explicit actions. Opening history does not delete records, change
assignments or start work. New Bash creation starts a new shell in a chosen folder;
it does not restore a stopped shell's jobs or state.

## Source ownership, stack and style

Retain Electron 44.7.0, Node 24 and the existing JavaScript renderer and preload bridge. The Rust service owns state and permissions. No TypeScript migration or new UI framework is included.

- `desktop/src/ui/renderer.js` draws the rows; `desktop/src/ui/hierarchy.js` presents supervision assignments and Fleet ancestry.
- `desktop/src/instances.cjs` and `desktop/src/preload.cjs` expose narrow lifecycle/detail calls. The renderer cannot send arbitrary service operations.
- `desktop/src/layout.cjs` and the existing ResizeObserver control panel size. The rendered content determines its height, limited by the display size.
- Put unit and interface tests in `desktop/test/renderer.test.cjs`, `hierarchy.test.cjs` and `instances.test.cjs`. Use the existing real-panel tests as the starting point for integration testing.

Read [fleets.md](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/fleets.md), [lifecycle.md](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/lifecycle.md) and [CONTRIBUTING](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/CONTRIBUTING.md). Use plain functions and comment-free changed source. This existing [hierarchy function](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/ui/hierarchy.js) illustrates using assigned ancestry rather than inventing authority in the renderer:

```javascript
function children(sessions, id) {
  return active(sessions)
    .filter((s) => s.supervisor_id === id)
    .sort(compare);
}
```

The current `active` filter selects registrations; it does not establish which processes are alive. Revise how the panel selects rows without changing stored assignments or existing rules for who may issue commands.

## Commands

From the selected worktree root, when implementation is authorized:

```sh
npm --prefix desktop ci
npm --prefix desktop run format:check
npm --prefix desktop test
node --test desktop/test/renderer.test.cjs desktop/test/hierarchy.test.cjs desktop/test/instances.test.cjs
```

If service-side observations or read contracts change, also run:

```sh
cargo build --locked --bins
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

The later plan must give the command for an isolated test of the real panel and identify the candidate executables it runs. A renderer test using simulated service data can check layout and interaction, but cannot prove an agent's process state or that resume works.

## Success criteria and verification

| Id | Case and required evidence |
|---|---|
| P1 | Supply test records covering every category above. Each Vessel must appear in the specified place. Vessels must exclude confirmed stopped agents and include running agents whose terminal windows are closed. |
| P2 | Previous vessels starts collapsed. Expanding it reveals history without launching anything. Test a short list and a list longer than the available history area. The long list must scroll, and Load more must make records beyond the first batch reachable without losing the owner's place or forcing the panel to grow. The Show removed vessels menu action must open the labeled removed-records view with the same scrolling behavior. Back to previous vessels returns to the ordinary history list. No checkbox appears, and changing the view does not change registrations. |
| P3 | Resume a real stopped conversation through the panel. The compact row offers one Resume action, uses current Codex model and effort settings with the selected launch permission default and shows Resuming, then running, before its terminal window opens. Viewer choice and details are reachable through its secondary menu. No per-row viewer form or separate Inspect button appears. If Open fails, offer a way to retry opening the window without starting a second runtime. |
| P4 | Test outdated Resume availability, double clicks and lost replies. The service must still decide the outcome. Operations with uncertain outcomes must remain visible and must not be submitted again under another request ID. A known startup failure stays attached to its Vessel after refresh, with readable text instead of an internal error code. A panel-level connection warning remains distinct. |
| P5 | Remove the registration of a running agent that Voyager manages. Keep it accessible as Unregistered, with Stop available subject to the existing permission checks. |
| P6 | Show a running worker whose supervisor is stopped, hidden or unavailable. Keep the worker accessible and describe its supervisor accurately. Stored assignments and Fleet information must not change. |
| P7 | Disconnect the service. Clearly mark existing rows as out of date. Do not silently mark any agent stopped or available to resume. On reconnect, refresh the existing rows by Vessel identity without creating duplicates. |
| P8 | Use only the keyboard to expand groups, scroll Previous vessels, load more records, inspect row details and activate available actions. Keep focus in a useful place when state changes and keep the focused row visible. Also check wheel and trackpad scrolling and that the scrollbar can be found. Text labels must explain state without requiring the user to distinguish colours. |
| P9 | Test an empty panel, a populated Fleet, and displays with limited width or height. The history area must adapt to the space available while keeping the other controls accessible. Content must remain usable without overflowing horizontally or growing beyond the display. Panel size must follow rendered content, not an estimate based on the number of Vessels. |

Run P3, P5 and P7 in the real panel with fresh test records and the candidate service. For comparison, show how the old panel renders a stopped record. Check stored assignments, registration and event counts before and after actions that only reveal or hide information. Those actions must not change the underlying records. Use screenshots to verify presentation and service receipts to verify process operations. Neither is a substitute for the other.

## Boundaries and review decisions

Use the service's observations, preserve history and explain why an action is unavailable. Review any proposal for global history search, a change to how authority is shown, or a new state API beyond the conversation-resume contract before implementing it.

Do not delete records to reduce clutter, treat a closed terminal window as a stopped agent, move Fleets while filtering rows, or let the renderer grant permissions.

The approved first UI uses Vessels, Needs attention and Previous vessels. Previous vessels uses the panel's available space, internal scrolling and small batches rather than a fixed 50-record batch. Check the batch sizing and scrolling interaction in the real panel during implementation. Full transcript search, recovery of native conversations and restoration of removed records remain deferred. The revised Resume eligibility rules apply to older records: missing historic settings alone do not block Resume, while missing identity or confirmed-stop evidence still does. Keep history readable when an operation is unavailable.
