# Collaboration experiment: visual proposal

This branch contains an interactive design surface for a possible Voyager
collaboration feature. It uses authored example data. It does not call Jev or
OpenAI, capture conversation, start workers, send messages, or compare real
task results. Normal Voyager service and desktop behavior is unchanged.

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

The future feature belongs in Voyager: Rust owns source cursors, model calls,
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

Existing topic selection precedes composition. Several distinct findings in one
window still need an agreed localization policy before the real harness is built.
Both comparison arms retain ordinary orchestration. Use fresh workspaces and
sessions, the same task checks and work-agent budget, and disclose harness costs.
Do not assume the arm with collaboration will win.

## Observed in this prototype

Both views were inspected in Chrome at 1728 × 961, with their content fitting the
viewport. The acknowledgement example stopped before composition. The simulated
adoption added a supersedes label, preserved both decision cards, and left all
comparison metrics unmeasured. Keyboard selection of the Tests worker showed one
packet with two subscription reasons. These checks establish mockup behavior,
not extraction quality, real routing, native Electron integration or agent gains.

The existing nine desktop tests and desktop formatting check passed. No Rust
source changed, so the Rust runtime checks were not rerun for this visual slice.
