# Tasks: small panel refinement

Selected order: finish the approved reconnect plan, then activate this panel plan
at the canonical task paths on its own branch. Module: current-work-panel.
N01 is complete on feat/compact-vessel-rows, based on the completed reconnect candidate. N02 is next.

- [x] N01: show name, applicable rank and existing status dot. Keep live name-click
  Open and explicit Resume. Put routine metadata in existing Details. Prove N1–N5.
- [x] N01 checkpoint: checks, packaged proof, full line inventory, fresh review,
  the initial corrective pass and Isaac's explicitly approved additional pass and review.
  Final review has no Required code or proving finding.
- [ ] N02: apply changed rank/assignment selections directly without Change
  buttons. Preserve service policy, pending requests and failure feedback. Prove N7.
- [ ] N02 checkpoint: the same checks, native proof, full inventory, fresh review,
  at most one corrective pass and re-review pass. Record evidence before completion.
- [ ] Handover: actual-status docs, plain-language PRs, skills report and candidate
  ready for Isaac. Merge and rollout remain separate decisions.

Avatar behavior has its own spec draft. Stale window-action labels remain an
investigation note. Neither is an additional active panel task.

## N01 acceptance evidence

[Compact Vessel rows](https://github.com/isaacasamoah/voyagershellapp/pull/62)
is the implementation PR, based on the separate
[approved plan](https://github.com/isaacasamoah/voyagershellapp/pull/61).
The native GitHub stack is 63, above completed Retry connection PR60.

One selected package passes current panel, current-configuration Resume/context,
and inherited reconnect journeys. The package and bundled service are under
`desktop/out/voyagershell-linux-x64-e99e181701bb`. The native records are
`/tmp/vn01-panel-e99`, `/tmp/vn01-resume-e99` and `/tmp/vn01-reconnect-e99`,
with clear cleanup in all three. They preserve non-final scroll position, final
focus, full long-path Details, unchanged events/registrations, separate Resume/menu,
visible captain/worker expansion and actual live-name Open, dock, voice startup,
Background and Stop. Linux evidence does not establish other platforms or audibility.

Formatting and 104 desktop tests pass. Two redundant mock tests were replaced
by real native offline-container and stack-expansion checks with parity evidence.
The independent baseline control fails for the former routine metadata. The
final extra-pass review is `/tmp/voyager-n01-extra-review.md`; the canonical
Obsidian walkthrough retains it with earlier failures and original reviews.

The fully audited inventory is 9,633 maintained plus 1,369 temporary lines,
11,002 combined, against 11,039 exercised production lines. It includes 57 reviewer
helper lines, the shared proof-only desktop startup and the service entry function.
The earlier inventory had omitted both of those owners. Both omissions were
corrected without changing a constraint or claiming full branch coverage.

N02 retains the normal one-corrective-pass and re-review limit. Isaac's extra
N01 approval does not extend that budget. No merge, installation or owner-runtime
restart was performed. The earlier intermittent voice-start failure stays deferred.
