# Collaboration experiment: visual proposal

This branch contains an interactive design surface for a possible Voyager
collaboration feature. It uses authored example data. It does not call Jev or
OpenAI, capture conversation, start workers, send messages, or compare real
task results. The separate [live trial](collaboration-trial.md) now implements the Rust pipeline.
This page describes the earlier authored visual proposal only.

Open `desktop/src/ui/collaboration/index.html` in a browser, or serve that
directory on loopback:

```sh
python3 -m http.server 8770 --bind 127.0.0.1 --directory desktop/src/ui/collaboration
```

Visit `http://127.0.0.1:8770/`. The two views are:

- **How knowledge moves:** source window, Jev trigger, existing topic membership,
  GPT-6.1 Sol composition, relationship checks, storage and recipient routing.
- **How we test collaboration:** two independent runs of the same task, with
  five workers each, with and without the added collaboration feed. Select
  workers, preview an update, and inspect a simulated captain resolution.

Select a stage to see its inputs and outputs. The acknowledgement example stops
after detection; it should not proceed to composition. Changing the window
changes the proposed input label only, not measured model behavior. All metrics
remain unmeasured. Click the captain in the collaboration arm to try resolutions.

The implemented trial follows this boundary: Rust owns source cursors, model calls,
graph state, routing and resolution; Electron presents the experiment. Provider
keys remain in the existing agent-secrets mechanism, never the renderer. The
first actual run should replay one verified conversation before following live
events or launching controlled multi-agent trials. Native transcript capture
limitations remain visible in that trial.

Decision contradictions request reconciliation; only explicit accepted
replacement creates supersession. Discovery links support or challenge claims
without automatically selecting a winner. Topic subscribers and directly involved
actors receive one update with all applicable reasons. Five workers in a drawing
do not demonstrate five running agents or successful delivery.

Existing topic selection precedes composition. The expandable **Topic + relationship rule** in
the harness diagram records this current contract:

1. Jev checks membership against a versioned catalogue of topic IDs, names and
   scope descriptions. Multiple matches and no-match are legitimate outcomes;
   uncertainty remains distinct.
2. Sol receives provisional matches. On no-match it also receives the existing
   catalogue, so it can suggest existing IDs for reassessment or propose a new
   subject name and scope. Unsupported means the sources do not support recording
   this knowledge: keep the attempt for inspection, but publish no knowledge or
   topic from it. This does not stop processing later events.
3. A proposed new topic or disputed match goes to Jev for semantic checking before
   comparing knowledge records. Agreed existing matches skip this extra call.
   Distinct conclusions can share a subject; similar names alone do not prove
   equivalence. An uncertain topic match stays visible as a pending candidate with
   its reason, for reassessment with more context or review. This is not a finding
   that the knowledge is false, and does not pause other agent work.
4. The harness reuses an ID or creates a topic, checking catalogue revision at
   the atomic write. A changed revision requires checking additions or changed
   definitions before retrying. Model calls do not hold a database transaction.
   The revision is from the last topic check, not necessarily source-event time.
   This step settles topic IDs; it does not publish the final knowledge update.
5. Jev compares the new knowledge statement with related existing statements,
   applicable conditions and evidence. It judges possible decision contradictions
   or discovery support/challenges. Shared topic IDs alone cannot establish links.
6. The harness stores knowledge and judged links, then routes normal topic updates
   and relationship-specific notices to affected authors and responsible resolvers.
   One recipient gets one packet with all reasons. A valid record without a special
   relationship can still generate a topic update. Supersession requires an
   explicit resolution, not an automatic Jev judgment.

The small trial supplies the full catalogue within a visible limit. Incomplete
candidate coverage is not evidence for a new topic. Catalogue revision, supplied
topic IDs, Jev judgments and Sol output stay attached to the call trace. Later
retrieval and topic merging need their own evaluation; semantic matching is not
a guarantee that duplicates never occur. The live trial uses a bounded, single-writer registry.

Several distinct findings in one
window still need a localization policy; the live trial marks them `needs_split`.
Both comparison arms retain ordinary orchestration. Use fresh workspaces and
sessions, the same task checks and work-agent budget, and disclose harness costs.
Do not assume the arm with collaboration will win.

The [subscription delivery contract](subscription-notifications.md) defines direct
native conversation messages headed **VoyagerShell subscription notification** and
the accompanying [receiving skill](../skills/voyager-subscription/SKILL.md). Expand
the transcript preview in the comparison view to inspect an example packet. This
preview is illustrative; the live trial has an outbox and Codex integration. Preferences
and subscription approval remain deferred.

## Observed in this prototype

Both views were inspected in Chrome at 1728 × 961, with their content fitting the
viewport. The acknowledgement example stopped before composition. The simulated
adoption added a supersedes label, preserved both decision cards, and left all
comparison metrics unmeasured. Keyboard selection of the Tests worker showed one
packet with two subscription reasons. These checks establish mockup behavior,
not extraction quality, real routing, native Electron integration or agent gains.

The existing nine desktop tests and desktop formatting check passed. That visual slice changed no Rust source. Current Rust validation is recorded in
the live trial proof notes.
