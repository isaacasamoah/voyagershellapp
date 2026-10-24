# Spec: a panel focused on current work

Module id: `current-work-panel`. Project: VoyagerShellApp. Draft for review, 24 October 2026.
The [capability map](SPEC.md) is approved. This panel uses the behavior defined in the [conversation-resume contract](SPEC-conversation-resume.md). This specification awaits review before planning and implementation.

## Objective and scope

The owner sees the agents they are using, can find previous conversations when needed, and can understand why an agent needs attention. Stopped agents no longer fill the main panel with grey buttons that do nothing. Hiding a row must not delete its history or change who manages the agent.

The [renderer source inspection](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/ui/renderer.js) found that the panel currently shows registrations that have not been removed, but its main row action requires an agent that Voyager manages and that is running. The saved records are useful. Showing them all as active makes a registered agent look like a running agent.

Keep the existing panel and Fleet layout. Show additional detail when the owner asks for it. This change requires no new dashboard, search index, authority model or full transcript browser. History means the events Voyager actually saved; reconstructing a complete native transcript is outside this increment.

## Presentation contract

Use the process state and Resume availability reported by the service, as defined in the conversation-resume specification. A registration, visible window or matching title does not prove that an agent is running. If an older service does not supply the new lifecycle information, treat the state as unknown and explain that the service must be updated before Resume is available.

Apply the following classification in order. Show each Vessel only once as a row with actions. A label naming its supervisor provides context; it must not create another actionable row for that supervisor.

| Observation | Location and available behavior |
|---|---|
| The service is unavailable or its observations are out of date | Keep a connection warning visible. Retain existing rows as last-known information, but disable actions that need a current check. Do not mark an agent stopped just because its information is out of date. |
| Creation or resume is still in progress | Show the agent in Current work as Starting or Resuming, with the operation status. Do not allow the same action to be submitted again. |
| The service confirms that a process it owns is running | Show the agent in Current work whether its terminal window is open, minimised or closed. Keep the existing permitted Open, Background and Stop actions. Show a warning if event capture has a problem. |
| Registration was removed, but the service confirms its managed process is still running | Show the agent in Current work as Unregistered. Keep the existing permitted Open, Stop and Register again actions. Do not hide it in history or suggest that event capture continues. |
| An external agent is registered and its event capture is connected | Show it in Current work as External, with the supported read-only details and history. Do not offer actions reserved for processes Voyager manages or imply Voyager owns it. |
| A managed agent's process state is unknown, an operation has no established outcome, or an external registration remains present but its capture is disconnected | Show it in Needs attention without requiring the owner to open history. Offer Inspect and explain the actual problem. Do not offer Resume until the service confirms it is allowed. |
| Exit is confirmed and the registration remains present | Show it in Previous agents, collapsed by default. Offer details and history. Offer Resume conversation only when the service allows it. |
| Registration was removed and exit is confirmed, or an external registration was removed and Voyager owns no runtime for it | Show it within Previous agents after the owner selects Show removed records. Keep history readable. Explicitly say that an external process's state is unverified. Do not silently register or resume it. |

Previous agents shows a count and expands with one click or a keyboard action. Each row shows the name, working folder, state and last recorded activity when known. Say when a timestamp is unavailable. Show the first 50 previous records, ordered by last recorded activity and stable Vessel ID, and provide Load more for the rest. Apply the same limit to removed records. Use the list results the service already permits the caller to read; this does not add a search service or a new server-side paging system.

Allow the owner to read details and history for every row they have permission to inspect, even when its main action is unavailable. Show the service's explanation beside that action. Display names, paths and captured content as text, never as executable HTML. Load history in limited portions using the existing event cursor and limits, and let the owner request more. Label gaps and periods when capture was unavailable. No captured events does not mean no work occurred.

When a running worker's captain is not in the visible set, show a small label such as "Reports to NAME, stopped" or "Supervisor unavailable". This label provides context; it grants no authority and creates no second movable captain row. Keep the existing captain-and-worker stacks and Fleet membership for the agents still visible. Filtering rows or opening history must not move a supervisor and its workers or clear any worker's Fleet placement.

## Resume interaction

Offer Resume conversation for a previous conversation only when the service allows it. Give the owner's request one identifier. Reuse that identifier when retrieving the saved operation result, called its receipt, rather than starting another request. While the operation is pending, move the same Vessel row into Current work and show Resuming.

After resume succeeds, get a fresh service observation confirming that the agent is still running. Then call the existing Open action with its own request identifier. An earlier receipt saying resume completed does not prove the agent is still running now. If the terminal window fails to open, explain the failure without marking the agent stopped or starting it again.

If resume fails with a known outcome, put the row in the category matching its observed state and explain why it failed. If the outcome is uncertain, put it in Needs attention. Keep keyboard focus on the same Vessel where possible. If its row disappears, move focus to the control that expands its containing group. Submitting a request alone must not make the panel show success.

The panel cannot override the service's decision about Resume. Remove and Stop remain separate, explicit actions. Do not automatically clean up old records, registrations or capture. The owner can use the existing creation form to start a new Bash shell in a chosen folder. Do not label that as resuming an old shell or restoring its state.

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
| P1 | Supply test records covering every category above. Each Vessel must appear in the specified place. Current work must exclude confirmed stopped agents and include running agents whose terminal windows are closed. |
| P2 | Previous agents starts collapsed. Expanding it reveals history without launching anything. Load more must make record 51 reachable, and Show removed records must reveal removed, stopped records. |
| P3 | Resume a real stopped conversation through the panel. The same row must show Resuming, then running, before its terminal window opens. If Open fails, offer a way to retry opening the window without starting a second runtime. |
| P4 | Test outdated Resume availability, double clicks and lost replies. The service must still decide the outcome. Operations with uncertain outcomes must remain visible and must not be submitted again under another request ID. |
| P5 | Remove the registration of a running agent that Voyager manages. Keep it accessible as Unregistered, with Stop available subject to the existing permission checks. |
| P6 | Show a running worker whose supervisor is stopped, hidden or unavailable. Keep the worker accessible and describe its supervisor accurately. Stored assignments and Fleet information must not change. |
| P7 | Disconnect the service. Clearly mark existing rows as out of date. Do not silently mark any agent stopped or available to resume. On reconnect, refresh the existing rows by Vessel identity without creating duplicates. |
| P8 | Use only the keyboard to expand groups, inspect row details and activate available actions. Keep focus in a useful place when state changes. Text labels must explain state without requiring the user to distinguish colours. |
| P9 | Test an empty panel, a populated Fleet and a narrow display. Content must remain usable without overflowing horizontally. Panel size must follow rendered content, not an estimate based on the number of Vessels. |

Run P3, P5 and P7 in the real panel with fresh test records and the candidate service. For comparison, show how the old panel renders a stopped record. Check stored assignments, registration and event counts before and after actions that only reveal or hide information. Those actions must not change the underlying records. Use screenshots to verify presentation and service receipts to verify process operations. Neither is a substitute for the other.

## Boundaries and review decisions

Use the service's observations, preserve history and explain why an action is unavailable. Review any proposal for global history search, a change to how authority is shown, or a new state API beyond the conversation-resume contract before implementing it.

Do not delete records to reduce clutter, treat a closed terminal window as a stopped agent, move Fleets while filtering rows, or let the renderer grant permissions.

The proposed first UI uses Current work, Needs attention and Previous agents, showing previous records in batches of 50. Full transcript search, recovery of native conversations and restoration of removed records remain deferred. The first increment's proposed limits on resuming older records also apply here: if their settings cannot be verified, keep history accessible even though Resume is unavailable.
