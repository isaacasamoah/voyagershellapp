# Plan: voice acknowledgement and result handoff

Status: approved for the next build after docking merged, 25 October 2026.
Governing specification: [voice-handoff](../SPEC-voice-handoff.md). Tasks and
completion evidence belong in [todo.md](todo.md). The completed docking plan is
preserved in the merge of PR 25. Resume and panel implementation are outside this
run. Apply [the build constraints](../CONSTRAINTS.md).

## Approach

First enable Codex's native delegation acknowledgement and prove that a real
inspection request produces both acknowledgement and its actual answer. Preserve
native automatic return. Do not add a second announcer, custom result channel,
new tool, permission change or fallback model. Stop with evidence if the native
contract cannot deliver the required behavior.

The private service conversation owns provider requests and public events.
Its existing desktop client carries those events to the UI, which owns microphone,
playback and visible history. Native terminal voice stays in its current boundary.
Use the installed provider's generated protocol to check fields and defaults;
record its version with each real trial. Codex 0.164.0 is the inspected baseline.
The official app-server documentation describes version-specific schema generation
and turn completion at https://learn.chatgpt.com/docs/app-server.

Reuse native request, turn, item and voice-client identities. Check actual outcomes
before announcing completion. Retain readable results when audio is unavailable.
Suppress duplicate messages by native item identity and retire stale audio clients.
Do not expose reasoning or automatically retry uncertain work.

## Ordered slices

1. V01: hear acknowledgement and the inspection answer. Reuse the existing native
   conversation journey and compare acknowledgement enabled against disabled.
2. V02: receive truthful progress and one final outcome. Cover slow tools, refusal,
   failure, interruption, duplicate events and completion without an answer.
3. V03: keep results through interruptions and reconnects. A stale result remains
   readable without becoming the newer request's spoken answer. No automatic replay.
4. V04: preserve readable results when audio fails and verify destination changes
   between the private app conversation, managed Codex and Bash.

Each slice is a complete behavior, with a failing regression, real candidate
journey and fresh-context review. Allow one corrective product build after initial
review, then re-review. If Required issues remain, stop and report them. Checkpoints
are retained for final owner review; the owner authorized this complete sequence.
This authorization does not merge the new feature or replace the installed app.

## One native proving fixture

Before adding another independent runner, consolidate the active conversation and
return-position journeys around shared native input, waiting, evidence and cleanup.
Keep that refactor separate from behavior changes. Preserve its assertions and
prove parity on the same isolated app/service. Historical unrelated journeys can
remain recorded migration debt; do not rebuild every old fixture in this module.

Keep one maintained entry point with named journeys and small reusable actions.
Use actual UI input for user actions. Setup and fault injection may use existing
service operations. Keep deterministic provider and renderer fixtures for event
ordering and failures; they do not replace native user journeys.

Count all authored test/proof code, including temporary scripts and helpers,
against the production behavior exercised. Preserve exact counts and scope in
review evidence. Do not inflate product scope or delete failure assertions to
meet the budget. When a PR approaches 1,000 changed lines, simplify first and
then create a native GitHub stack if the behavior and evidence cannot shrink.
Keep each behavior's tests in its own PR layer. Documentation and fixture refactors
can be separate layers; preserve all dependencies and review each layer.

## Verification

Normal checks do not call models or open a desktop:

```sh
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo build --locked --bins
npm --prefix desktop ci
node desktop/node_modules/electron/install.js
npm --prefix desktop run format:check
npm --prefix desktop test
```

Use the focused Rust conversation test and desktop conversation test during
iteration. Run the relevant complete checks after product edits. Reviewers perform
a meaningful mutation and restore source exactly before handing back the result.

For real checks, use fresh private state and a separate desktop profile. App and
service must come from the same worktree/revision. Record executable paths/hashes,
provider version, display backend, input/output devices and created runtime IDs.
Preserve caller identity. Never attach new code to the installed service and call
that a candidate test. Clean up only verified test resources.

Use the current physical microphone for the real-input journey and record the
unmuted output monitor. Input fixtures can provide repeatable speech for diagnostic
comparisons, but injected MediaStreams do not prove real microphone interruption.
V06 needs a real microphone and audible playback. If physical input cannot be
established, leave that acceptance case open and report the exact limitation.

Use monotonic timestamps for detected end of speech, delegation, acknowledgement
output, backing turn completion and final output. Correlate them by request and
native turn/item. Preserve recorded output for content and timing inspection;
a decoded peak or scheduled playback is insufficient. Record the delay in speech
end detection separately. Exclude time spent waiting because the human is speaking
from final-result delay and state the excluded duration.

At the combined checkpoint, use the actual Linux package and bundled service.
Run all V1-V8 journeys and 20 successful delegated requests on a quiet active voice
connection. At least 19 must acknowledge within one second of detected speech end,
and at least 19 must start the final answer within two seconds of backing-turn
completion. All 20 must give the correct result without duplicate or misattributed
speech. Retain slow and failed trials. Fedora evidence proves no other platform.

## Risks and stopping conditions

The native protocol may expose a field without delivering the required runtime
behavior. Late or duplicate events can cross voice generations. Native audio can
fail independently of the backing runtime. Preserve the existing service deadlines
and show uncertainty; do not silently retry, raise permissions or invent progress.

If automatic delivery cannot meet the cases, report the exact failed stage and
request a design decision before adding any alternative mechanism. If a slice
cannot meet the test budget with effective proof, report the counts and conflict.
The final handoff must distinguish implemented, proved and still-open behavior.

## Current checkpoint

Fixture preparation passed the additional owner-authorized correction and fresh
review. Independent controls reject premature success and unconfirmed helper
exit. Both active journeys passed on the actual package, with a retained
unexplained initial drag failure. The complete scoped test budget passes. The
task list records evidence and advisories. Continue V01 under the existing
approved sequence and one-correction-per-slice rule. No new feature is merged,
installed or accepted by this preparation checkpoint.
