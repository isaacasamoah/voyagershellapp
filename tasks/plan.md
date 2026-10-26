# Plan: show current work and reveal older conversations on demand

Status: built and independently reviewed for owner inspection, 26 October 2026.
P01-P03 passed one corrective pass and re-review each; P04 passed first review.
All required findings are resolved. The task list records evidence and unproved
physical input. Merge and installation remain separate decisions. Governing
[specification](../SPEC-current-work-panel.md).
The [task list](todo.md) owns completion. Apply [CONSTRAINTS.md](../CONSTRAINTS.md)
and the installed application-proof reference.

## What the owner will see

Running work stays in the main panel even when its terminal is closed. Confirmed
stopped conversations appear under Previous agents. Uncertain records remain
visible under Needs attention. The owner can inspect saved history and, when
the service permits it, resume a conversation and open its terminal.

Keep the existing panel, captain/worker groups and Fleets. Filtering never deletes
records, changes assignments or moves work. The service owns runtime truth and
permissions. The desktop presents them. No new dashboard or server search/paging
system is included.

This separate planning branch preserves the active voice tasks. Integrate the
accepted shared runner before building. The full Resume journey depends on the
conversation-resume module, especially its eligibility and receipt contracts.
P01-P02 can be designed and checked independently; P03 cannot be accepted first.

## Design decisions

Apply the specification's classification order exactly. In particular, a removed
registration whose owned process still runs remains Current work as Unregistered.
A disconnected service makes rows last-known information; it does not make agents
stopped. An older service without lifecycle fields leaves state unknown and Resume
unavailable. Each Vessel has one actionable row.

Previous agents starts collapsed. Order by last known activity, then stable Vessel
ID, and say when activity time is unavailable. Use recorded activity supplied
by the service or bounded history reads; never substitute registration time. Let its history area grow within
the measured available panel space, then scroll inside it. Use small local batches
appropriate to that space and preserve focus/scroll when loading more. Do not use
50 as a fixed visible-row target or estimate height from total record count.

Use a small named desktop/preload history method calling the existing permitted,
bounded event reads. Keep the service cursor and gap/truncation markers. Render
saved names, paths and messages as text. Do not reconstruct a full native transcript
or expose an arbitrary service-request bridge.

A running worker remains visible when its captain is absent from the selected
rows. Show a small Reports to label without inventing another captain row or
changing assignments. Group selection and Fleet locations remain independent.

Resume uses one request ID and the generation observed when the user chose it.
Poll that request's result without resubmitting. Refresh live state after a saved
success before issuing Open with its own ID. A window failure offers Open again;
it never starts a second runtime. Uncertain operations stay under Needs attention.

## Ordered work

### P01: distinguish current, stopped and uncertain work

Introduce a presentation selector for the service observations and show the three
groups. Keep existing supported actions on current rows. Previous agents initially
shows only its count. Keep old-service and disconnected-service warnings visible.

Acceptance: every record is in exactly the specified group; a closed viewer does
not hide a running agent; filtering changes no stored assignments or Fleet location.
Verification: a focused exact-membership renderer test, including a deliberately
reversed classification that must fail. Use a real candidate to inspect labels.
Likely files: desktop/src/ui/renderer.js, desktop/src/ui/hierarchy.js,
desktop/src/ui/style.css, desktop/test/renderer.test.cjs and docs/desktop.md.
The stylesheet path was verified during planning. Scope: medium.
Dependency: service lifecycle observations from conversation-resume R01; an
explicit unsupported-old-service case may be tested before that integration.
Covers P1, P5 and the basic P6/P7 states.

### P02: inspect older records without growing the window beyond the display

Expand Previous agents, inspect saved details/history and request more records.
Show removed records only after an explicit choice. Keep a long list in its own
scroll area and leave the other panel controls usable.

Acceptance: short and long lists stay usable; Load more preserves the owner's
place; history shows saved text and gaps without launching or registering anything.
Verification: focused history/batching tests plus a shared real-panel journey
using wheel/trackpad and keyboard actions. Do not create another launcher.
Likely files: desktop/src/ui/renderer.js, desktop/src/preload.cjs,
desktop/src/instances.cjs, the existing panel stylesheet and
desktop/test/renderer.test.cjs. Keep any helper extraction justified by reuse.
Scope: medium. Dependency: P01. Covers P2, history portions of P8 and P9.

### P03: resume the selected conversation and open its window

Connect the existing row to the service-owned Resume request and saved receipt.
Show Resuming on the same logical row, then confirm running before Open. Preserve
readable failure reasons and the distinction between runtime and window state.

Acceptance: double clicks or reconnects do not create another request; uncertain
outcomes remain visible; failed window opening leaves the running agent available
to Open again. Verification: the shared panel journey calls real Resume from the
completed resume module and compares an intentionally failed Open.
Likely files: desktop/src/instances.cjs, desktop/src/preload.cjs,
desktop/src/ui/renderer.js, desktop/test/instances.test.cjs and the maintained
panel journey. Scope: medium. Dependencies: P02 and accepted resume R01-R03.
Covers P3/P4. No permission decision belongs in the renderer.

### P04: keep workers, focus and results usable through state changes

Finish the hidden-supervisor labels, reconnect behaviour and keyboard focus rules.
Use one real packaged panel journey to exercise grouping, history and Resume
without duplicating their setup. Retain separate focused regressions where they
catch different failures.

Acceptance: workers remain accessible without a visible captain; loss/recovery of
service connection never invents stop or repeats effects; keyboard users can reach
groups, older rows, details and supported actions after state changes.
Verification: exact-membership and focus assertions, followed by actual candidate
keyboard and pointer actions. Record the real UI and service identities.
Likely files: desktop/src/ui/hierarchy.js, desktop/src/ui/renderer.js,
desktop/test/hierarchy.test.cjs, desktop/test/renderer.test.cjs and the shared
panel journey. Scope: medium. Dependency: P03. Completes P6-P9.

## Checkpoints and proof

After P01-P02, review classification and long-history interaction before connecting
Resume. After P03-P04, run the specification's P1-P9 cases against the packaged app
and matching service. Implementation is approved; installation is not.

The planned command, once the panel journey exists, is:

```sh
VOYAGER_PROOF_APP=/absolute/candidate/voyagershell \
  python3 desktop/test/run-native-proof.py /tmp/NEW_PANEL_STATE panel-current
```

The shared runner will gain that named journey during the panel build. Extend its existing
entry point and packaging helper list within a relevant slice, rather than adding
an unreviewed extra task or a second test framework. Keep each final file map
around five files; reslice before coding if a complete behaviour grows beyond that.

Each test has one clear purpose and a reason tied to the change. Several assertions
may prove one user journey; duplicate checks need a distinct purpose. Count all
fixture and temporary code, including older regression tests used for acceptance.
Shared helpers count once. Do not hide code by moving or compressing it.

Use the repository's Node 24 desktop tests and format check. Service changes also
require Rust formatting, tests and Clippy. A fake renderer can verify classification;
only an actual app/service run can establish the Resume and scrolling experience.
Keep screenshots and private evidence outside source control. Record pointer,
keyboard, wheel and trackpad coverage separately; unavailable physical input stays
unproved. Use an independent review for each behaviour and propose the same
one-correction-and-re-review limit as the voice trial. The owner has approved this plan for implementation.
