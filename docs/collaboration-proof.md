# Collaboration trial observations — 16 October 2026

These are bounded local observations, not a claim of general extraction accuracy
or a five-agent collaboration improvement.

| Check | Observed result |
|---|---|
| Real provider availability | Pinned `jev-1.13.0` and `gpt-6.1-sol`, medium reasoning, both responded successfully. No substituted providers. |
| Conversation replay | Four selected, verbatim user messages from the design conversation produced two decision records and one attributed discovery, in one topic. This was an excerpt, not the full transcript. |
| Provenance | The service checked every evidence quote against its cited source event before saving. |
| Deliberate conflict | Real API calls over the checked-in synthetic export scenario produced two decisions, one discovery and a contradiction score of 0.93. The conflict required user review; both decisions remained in history. |
| Known-different input | The synthetic acknowledgement, “Thanks,” produced no additional knowledge. |
| Explicit resolution | The fixture's trusted operator selected `adopt_new`; only then did the earlier decision become superseded. A resolution notification batch was created. |
| Relevance refinement | The first relevance question scored a directly related design-only assignment 0.54. Clarifying that designing/testing/reviewing a subject counts produced 0.97 on the same assignment. This is one example, not calibration. |
| Direct active-turn steering | A real Codex agent received an update during a bounded wait. The returned turn ID matched the original turn, and its final reply incorporated the supplied test marker. |
| Automatic packet delivery | Jev subscribed a real test agent. The outbox delivered one grouped evidence packet into its existing active turn. Its response named the notification ID, explicitly used the inline receiving skill and compared the evidence. |
| Live source adapter | Follow mode captured actual completed native messages and gaps. The accepted outbox packet was absent from extracted source rows; the agent response remained available. |
| Native terminal window | The original trial daemon lacked the desktop session environment. Restarting with the session manager's display/authentication environment repaired opening through the Voyager CLI. A new real Codex viewer was visually inspected; background and reopen retained its runtime PID, session and native thread. The test instance was then stopped. |
| Inspector | The interface is a full-page graph with progressive topic, record and edge inspection. Evidence, source events, subscriber packets and metadata are revealed on selection. Private source text is rendered as text. |

The initial conversation trial plus relevance retests used 24 provider calls,
27,471 input tokens and 2,426 output tokens; summed HTTP time was 40.8 seconds.
The four-event synthetic relation trial used 18 provider calls, 22,922 input tokens
and 2,577 output tokens; summed HTTP time was 47.5 seconds. These totals include
rejected compositions and relevance checks and are not per-event latency claims.
Provider usage is retained rather than converting it into an unverified price.

Automated checks cover causal windows, capture gaps, invented evidence, speaker
attribution, grouped recipient delivery, resolver identity, required human review,
stale resolution, exact native active-turn selection, duplicate-send prevention,
private inspector access, and the existing service/disconnect tests. The separately
ignored native lifecycle/desktop suite is not included in the normal test count.

Still unproved: extraction recall on a labelled corpus, portable adapters beyond
Codex, live conflict resolution by an agent under load, other desktop environments,
and five-worker quality/latency/cost comparisons. Serial model
calls are a deliberately measurable prototype bottleneck. Several new items of
the same kind in one event are surfaced as `needs_split`, not silently merged.
