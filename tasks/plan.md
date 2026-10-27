# Plan: compact Vessel rows with details in the menu

Module: `current-work-panel`. Approved by Isaac in the selected reconnect-then-panel build order, 27 October 2026.
Owning spec: `SPEC-current-work-panel.md`, section "Approved refinement: compact
Vessel rows with details in the menu". Branch: `design/name-only-vessel-rows`.
Implementation is approved. Merge, installation and owner-app restart remain separate decisions.

## Outcome

Rows show the Vessel name, applicable rank and existing status dot. Clicking a
live managed Vessel keeps its existing Open or bring-forward action. Folder,
last activity and other metadata live in Details in the existing three-dot menu.
Previous vessels retain their explicit Resume action. There is no inline expansion.

## Plan ownership and dependencies

Isaac selected reconnect completion before panel work on 27 October. Keep its
canonical plan and task list active until complete. Then activate this plan at
tasks/plan.md and its task list at tasks/todo.md on the panel branch. Preserve the
reconnect evidence in Git. No unfinished task is discarded or called complete.

This refinement starts from the reviewed reconnect correction. It needs no new
service operation, stored metadata, dependency, TypeScript conversion or remaining
reconnect slice. Keep its PR separate and reconcile the small renderer change at
integration. Build this capability in two sequential vertical slices.

## Implementation decisions

Reuse the shared row renderer across current, previous and removed lists. Remove
routine visible folder/date metadata and the repeated Running label. Preserve rank,
status-dot meaning, accessible state labels, live name-click behavior, drag handling,
selection and existing Open/Resume request identifiers. Keep errors and pending
progress attached to the Vessel and missing-supervisor context discoverable.

Reuse the existing three-dot Details action and its details/history view. Check
that the view exposes the full folder and labeled last activity, with explicit
missing values. No second details component, row disclosure or expansion-state
store is needed. Display metadata as text. Retain offline last-known labeling and
existing service-action availability. Keep keyboard focus stable through refresh
and when closing Details. Existing content measurement and scroll areas own size.

## N01: simplify rows while preserving their actions

Deliver one complete vertical slice across Vessels, Previous vessels and Removed
vessels, including its proving and review. The expected primary files are:

- desktop/src/ui/renderer.js for routine labels and action preservation.
- desktop/src/ui/history.js for metadata placement in the existing Details view.
- desktop/src/ui/style.css only if compact layout needs adjustment.
- desktop/test/renderer.test.cjs for focused behavior checks.
- desktop/test/panel-proof.cjs for the existing real-panel journey.

Acceptance criteria:

- N1 and N2 pass. Rows keep name, applicable rank and status dot. Details shows
  metadata. Live name activation still opens the terminal, Resume stays explicit,
  and reading Details changes no runtime, work, registration or assignment.
- N3 and N4 pass. Refresh, group transitions, offline data, pending operations and
  failures retain useful focus and truthful feedback. State is accessible without
  requiring color discrimination. Preserve Fleet and responsibility context.
- N5 passes in the selected packaged app. Short displays, long names/paths and
  large lists remain readable and scrollable, with unchanged history batching.

Dependencies: approval of this revised spec and plan. No parallel build is needed.

## Proving and review checkpoint

First demonstrate the baseline's unwanted routine metadata with a focused failing
renderer test. Preserve existing name-click and lifecycle assertions. Keep tests
short, focused and justified by this change; reuse fixtures and existing details
checks rather than duplicating setup. Run from the selected worktree root:

```sh
npm --prefix desktop ci
node --test desktop/test/renderer.test.cjs
npm --prefix desktop run format:check
npm --prefix desktop test
cargo build --locked --bins
npm --prefix desktop run package:linux
```

Package a clean committed candidate. Confirm the actual package output directory,
then run the maintained native runner against that app and its bundled service:

```sh
VOYAGER_PROOF_APP="$PWD/desktop/out/voyagershell-linux-x64-$(git rev-parse --short=12 HEAD)/voyagershell" python3 desktop/test/run-native-proof.py "/tmp/vn-$(date +%s)" panel-current
```

Preserve caller identity and use the existing scoped development authorization if
needed. Never remove credentials to bypass it. Use fresh short private state, not
the owner's running trial or real Vessels. Record app/service paths and manifests,
real row/menu and keyboard interaction, screenshots, geometry and verified cleanup.
Keep the panel-resume regression journey in the same runner, using `panel-resume`
and separate fresh state. Reading Details must not change process/conversation
identity or add work events; opening the terminal is a separate asserted action.

Record all maintained and temporary proving lines against production actually
exercised, plus additions/deletions. The completed reconnect inventory has only a two-line margin. Reuse and simplify with parity evidence; stop if required proving cannot
fit. Do not pad production, compress tests or discard necessary assertions.

Freeze the slice for fresh-context code-review-and-quality review, including
accessibility, state transitions, budget and a mutation or negative control.
Allow one corrective build and re-review. Stop if Required findings remain.
Rust changes are not planned. If they become necessary, revisit scope and use
BeautifulRust implementation/review skills, Rust formatting, tests and Clippy.

## N02: apply rank and assignment changes directly

After N01, implement N7 in the existing menu. Likely owners are ui/renderer.js,
renderer.test.cjs and the existing native panel journey. Selecting a changed
Rank or Supervisor invokes its named service action once, without a separate
Change button. Preserve Controller wording for Bash. Unchanged selections do
nothing. Keep pending/error feedback, request identity and confirmed values after
a refused change. The service continues to decide authority and permitted choices.

Acceptance criteria:

- N7 passes for changed and unchanged choices, pending requests and refusal.
- Mouse and keyboard selection both work without a second confirmation button.
- The same curated native runner proves the interaction with disposable Vessels.
  Apply the full budget and fresh review with one corrective pass and re-review.

Avatar/menu ordering is owned by SPEC-avatar-behavior.md. The intermittent stale
window-action report remains an investigation note, not a third implementation
slice. Keep both outside this narrowly approved panel build.

## Completion and handover

Mark each slice complete only after its acceptance, packaged proving, size accounting and
independent review pass. Record evidence in the task list before checking it off.
Update actual-status documentation and Obsidian links without copying task status.
Use the PR template with before/after, verification, real-app proof, review and
known limitations. Target a focused change near 300 lines. Near 1,000, simplify
or use a native GitHub stack of complete behaviors, not separate plumbing/tests.

Prepare the candidate for Isaac's inspection and report actual skills used.
Merge and restart remain separate decisions. Activate this plan only after the reconnect plan is complete.
