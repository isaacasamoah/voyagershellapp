# Spec: a panel focused on current work

Module id: `current-work-panel`. Project: VoyagerShellApp. Draft for review, 24 October 2026.
The [capability map](SPEC.md) is approved. This specification consumes the [conversation-resume contract](SPEC-conversation-resume.md). It awaits review before planning and implementation.

## Objective and scope

The owner sees the agents they are using, can find previous conversations when needed, and understands why an agent needs attention. Stopped records no longer fill the main panel as inert grey buttons. Hiding a row never deletes history or changes an assignment.

The [renderer source inspection](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/ui/renderer.js) establishes that the current active set means nonremoved registrations, while its main row action requires managed and running. The retained records are useful; their current presentation confuses registration with liveness.

Keep the existing panel, Fleet layout and progressive disclosure. No new dashboard, search index, authority model or full transcript browser is required. Native transcript reconstruction remains outside this increment; history means the captured evidence Voyager actually retains.

## Presentation contract

Use the service's lifecycle observation and resume eligibility, defined by the provider specification. Never infer running state from registration, a window's presence or its title. Treat a missing new observation from an older service as unknown and show that the running service must be updated before resume is available.

Apply the following classification in order. Each actionable Vessel appears once; contextual supervisor labels are not duplicate actionable rows.

| Observation | Location and available behavior |
|---|---|
| Service unavailable or stale observations | Show a persistent connection warning. Retain visible rows as last-known information; disable actions that require current verification. Do not classify stale rows as stopped. |
| Pending creation/resume | Current work, labelled Starting or Resuming with its operation status. Duplicate action submission is unavailable. |
| Confirmed service-owned runtime running | Current work, whether its viewer is open, minimised or closed. Keep existing permitted Open, Background and Stop actions. Capture problems get a visible warning. |
| Removed but confirmed running managed runtime | Current work, labelled Unregistered. Preserve existing permitted Open, Stop and Register again actions. Do not hide it in history or imply capture continues. |
| External registration with connected capture | Current work, labelled External, with supported read-only details/history. Do not offer managed lifecycle actions or imply Voyager owns it. |
| Unknown managed runtime, unresolved operation, or nonremoved disconnected external registration | Needs attention, visible without opening history. Offer Inspect and the actual reason. Do not offer Resume until the service resolves eligibility. |
| Confirmed stopped/exited, still registered | Previous agents, collapsed by default. Offer details/history and Resume conversation only when service eligibility permits. |
| Removed and confirmed stopped, or removed external registration without an owned runtime | Within Previous agents, behind a Show removed records control. History remains readable; external process state stays explicitly unverified. No implicit re-registration or resume. |

Previous agents shows a count and expands with one click or keyboard activation. Rows show name, working folder, state and last recorded activity when known. Label missing timestamps as unavailable. Show the first 50 previous records with a Load more control for further records, ordered by last recorded activity and stable Vessel ID. This is disclosure over existing authorized list results, not a new search or pagination service. Removed records use the same disclosure bound.

Details and history are readable for every permitted row, even when its primary action is unavailable. Display the service's reason beside the relevant action. Render names, paths and captured content as text, never executable HTML. A bounded history view uses the existing event cursor/limits and offers more evidence on demand. Label capture gaps and unavailable periods. An empty capture is not proof no work occurred.

When a running worker's captain is outside the visible subset, show a small contextual "Reports to NAME, stopped" or "Supervisor unavailable" label. It does not grant authority or create a second movable captain row. Preserve existing assigned stacks and Fleet membership for the remaining visible subset. Filtering and opening history never moves a branch or clears a descendant's Fleet placement.

## Resume interaction

A service-eligible previous conversation offers Resume conversation. Use one request ID per user intent and reuse it when recovering its receipt. Show Resuming while pending and move that same logical row into current work. After confirmed success and a fresh observation that the resumed runtime is still running, call existing Open with its own request ID. A historical completed receipt alone cannot establish that state. Explain viewer failure without reverting the agent to stopped or launching it again.

A known unsuccessful resume returns the row to its observed category with a readable reason. An uncertain result goes to Needs attention. Keep keyboard focus on the same Vessel where possible, or on its containing disclosure if its row disappears. No successful-looking state follows only from submitting a request.

The panel cannot override service eligibility. Remove and Stop remain explicit existing actions. There is no automatic cleanup of old records, registration or capture. Bash may use the ordinary creation form to start a new shell in a chosen folder; this scope does not add a false Resume action for shell state.

## Source ownership, stack and style

Retain Electron 44.7.0, Node 24 and the existing JavaScript renderer and preload bridge. The Rust service owns state and permissions. No TypeScript migration or new UI framework is included.

- `desktop/src/ui/renderer.js` owns row rendering; `desktop/src/ui/hierarchy.js` owns presentation of assignments and Fleet ancestry.
- `desktop/src/instances.cjs` and `desktop/src/preload.cjs` expose narrow lifecycle/detail calls. The renderer cannot send arbitrary service operations.
- `desktop/src/layout.cjs` and existing ResizeObserver sizing retain geometry ownership. Content determines panel height, capped to the display.
- `desktop/test/renderer.test.cjs`, `hierarchy.test.cjs` and `instances.test.cjs` are the unit/contract test homes. Existing native panel proofs supply the starting integration machinery.

Read [fleets.md](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/fleets.md), [lifecycle.md](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/lifecycle.md) and [CONTRIBUTING](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/CONTRIBUTING.md). Use plain functions and comment-free changed source. This existing [hierarchy function](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/ui/hierarchy.js) illustrates using assigned ancestry rather than inventing authority in the renderer:

```javascript
function children(sessions, id) {
  return active(sessions)
    .filter((s) => s.supervisor_id === id)
    .sort(compare);
}
```

Its current `active` registration filter is a behavior to revise for presentation, not a liveness rule to preserve. New classification must not change service assignment data or the meaning of existing command authority.

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

The later plan must give the isolated real-panel proof command with candidate executable paths. A renderer stub establishes layout/interaction behavior only; it cannot prove process state or resume.

## Success criteria and verification

| Id | Case and required evidence |
|---|---|
| P1 | A mixed fixture containing every classification above puts each Vessel in the specified location. Current work excludes confirmed stopped records and includes running agents with closed viewers. |
| P2 | Previous agents starts collapsed, reveals history without launching anything, and makes record 51 reachable through Load more. Removed stopped records are reachable through the explicit additional filter. |
| P3 | Resume a stopped real conversation through the panel. The same row progresses through Resuming to running, then opens the viewer. A failed Open offers repair without a duplicate runtime. |
| P4 | Inject stale eligibility, double clicks and lost replies. The service controls the outcome; uncertain work stays discoverable and is not resubmitted with another ID. |
| P5 | Remove a live managed registration. Its runtime remains reachable as Unregistered and can still be stopped through the existing permission checks. |
| P6 | Show a running worker whose supervisor is stopped, hidden or unavailable. The worker stays reachable and its responsibility cue remains truthful. No assignment or Fleet metadata changes. |
| P7 | Lose the service connection. Existing rows become clearly stale; none is silently marked stopped or eligible to resume. Reconnect refreshes by identity without duplicate rows. |
| P8 | Navigate disclosures, row details and available actions using only the keyboard. State changes preserve useful focus. Labels convey state without relying on colour. |
| P9 | Check an empty panel, a populated Fleet and a narrow display. Content remains usable without horizontal overflow or panel sizing based on Vessel counts. |

Exercise the real panel with fresh test records and the candidate service for P3, P5 and P7. Compare against a stopped record under the old rendering logic as the known-different case. Verify stored assignments, registration and event counts before/after disclosure-only actions. Capture screenshots for presentation and service receipts for lifecycle claims; neither substitutes for the other.

## Boundaries and review decisions

Always use service observations, preserve history and keep disabled actions explainable. Review any new global history search, authority presentation change or new state API beyond the provider contract. Never delete a record to declutter, treat a closed viewer as a stopped agent, move Fleets during filtering or allow the renderer to grant rights.

Proposed first UI choices are the labels Current work, Needs attention and Previous agents, plus a 50-record disclosure batch. Full transcript search, native thread recovery and removed-record restoration remain deferred. Approval of the first-increment resume limitation also applies here: history stays accessible when older settings cannot be verified.
