# Tasks: a panel focused on current work

Status: owner approved build, 25 October 2026. Resume R00-R03 passed review.
Use one independent review, at most one corrective pass and another review per
increment. Merge and installation remain separate decisions.
The [plan](plan.md) owns design and commands; the
[specification](../SPEC-current-work-panel.md) owns P1-P9. Old docking tasks remain
in Git history; this does not overwrite or complete the voice task list.

## P01: show each agent in the right group

- [x] Show Current work, Needs attention and collapsed Previous agents according
  to the service observations. Preserve current actions and old-service warnings.
- [x] Exact-membership checks cover running with closed viewer, stopped, unknown,
  external and removed-but-running records. No assignment or Fleet write occurs.
- [x] Prove a relevant wrong classification fails, inspect the real labels and
  complete independent review. Covers P1/P5 and basic P6/P7.

P01 passed independent second review after one correction. All 94 desktop checks
and the matching packaged journey pass. Reviewed budget: 8,222 / 8,258.

## P02: reveal readable history within the available space

- [x] Expand Previous agents and removed records explicitly; show missing times,
  saved details, event gaps and bounded history without starting anything.
- [x] Short and long lists fit the display. Local batches and Load more preserve
  scroll/focus. Check keyboard, wheel and trackpad separately. Covers P2/P8/P9.
- [x] Reuse the maintained runner and existing event cursor. Keep safe text
  rendering and a narrow desktop/preload call. Complete independent review.

## Checkpoint P-A

- [x] Classification and history behaviour pass the real-panel checks. Review
  before connecting Resume; do not infer real process state from fake data.

P02 passed independent second review after one corrective pass. Both focus and
text-selection controls pass in the selected package. The complete count is
8,444 / 8,451. Physical wheel and trackpad remain unproved; Chromium input is recorded.

## P03: resume and open the same conversation

- [ ] After accepted conversation-resume integration, use one Resume ID and the
  observed generation. Keep the same row through pending and completed states.
- [ ] Refresh runtime observation before a separate Open. Double clicks, lost
  replies and failed Open cannot start a second runtime or replay work. Covers P3/P4.
- [ ] Use the shared real-provider/panel journey and focused action regression;
  preserve the service's permission decision and complete independent review.

## P04: preserve useful context and keyboard focus

- [ ] Keep a worker visible with an accurate supervisor label when its captain is
  absent. Never add another actionable captain row or change Fleet placement.
- [ ] Disconnect/reconnect marks last-known rows and refreshes by identity without
  duplicate actions. Keyboard focus remains useful after group/row changes.
- [ ] Run P1-P9 in the selected package and record actual input coverage, exact
  build identities, required checks and independent review. Covers remaining P6-P9.

## Final checkpoint

- [ ] Every focused test has a single stated purpose and a failure it catches.
  Remove overlap without weakening the real-panel journey.
- [ ] Complete test/helper counts and disjoint exercised production ranges pass
  the project's limit; record an appropriate deliberately broken comparison.
- [ ] Present the result and remaining limits for owner acceptance. No new
  dashboard, automatic record cleanup, permission changes or runtime rollout.
