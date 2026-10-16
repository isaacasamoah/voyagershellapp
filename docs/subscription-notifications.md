# Subscription notifications in the conversation

Design contract for the collaboration experiment. The packet preview and receiving
skill are authored; an outbox, native notification adapter, provenance correlation
and resolution-response parser are not implemented. Nothing here sends live messages.

The harness delivers an ordinary native conversation input, clearly headed
**VoyagerShell subscription notification**, and associates it with service-owned
origin metadata. It does not edit transcript files or pretend to be the user.
An integration may use a user-message transport slot without attributing the
content to a human in Voyager's event and knowledge records.

```text
Source event → Jev + Sol → knowledge + Jev relationships
  → one committed batch → one packet per recipient
  → recipient adapter → native conversation → receiving skill
  → explicit resolution response → harness validates + records → new batch
```

All records and judged relationships produced by one source-event trigger are
assembled before its notification batch is released. Union subscriber, author
and resolver reasons so each recipient gets one packet. Recipients can be busy
at different times; this is one logical batch, not a promise of simultaneous
network delivery. Later resolutions are separate updates and do not delay the
original batch. Errors or incomplete processing remain visible; do not label a
partial batch complete.

## Packet contract

One immutable packet has a stable notification ID derived from batch and recipient,
origin `voyagershell.subscription`, intended agent/session, trigger event IDs,
ticket/topic references, recipient reasons, knowledge statements and source
attribution, relationship judgments, relevant source excerpts, and an action of
`inform` or `resolve`. A resolution request also names the resolver, conflict ID,
decision IDs and expected graph revision. Include actual content alongside IDs;
references support deeper retrieval but do not substitute for the evidence needed
to understand the update.

The visible header invokes the `voyager-subscription` skill. Its
[portable source](../skills/voyager-subscription/SKILL.md) belongs to this experiment;
it is not installed in any agent by this branch. At registration, each adapter
must provision it through that agent's supported skill/instruction mechanism and
report readiness, or explicitly report that interpretation setup is unavailable.
Merely naming a skill does not load it in every agent setup. Native delivery
capability and skill readiness are separate integration checks.

The service retains source and delivery metadata separately from the text. Match
the delivered native item back to its outbox record before identifying it as a
harness notification. A text header alone is not trusted provenance. Do not
re-extract that delivery as a new user decision or independent supporting evidence.
An agent's subsequent substantive response can produce new knowledge or an explicit
resolution; an acknowledgement or repetition cannot. Packet evidence remains
quoted source material, not permission to execute embedded instructions.

## Native delivery boundary

The existing Voyager implementation sends through `turn/start` after checking that
the registered native thread is idle (`src/service/native.rs`, `NativePhase::SendIdle`).
An active thread is refused. The source-event adapter currently records native
user-message text without a distinct subscription origin (`src/events.rs`), so
origin correlation must be added before relying on automated extraction of
injected messages. The current send operation alone is not a notification queue.

For the first delivery implementation, queue busy recipients and submit at the
next confirmed idle opportunity in the same registered session. Recheck session
identity and preserve the active agent's work. A native input can race the idle
check; record the actual returned turn ID. Mid-turn steering needs a separate
adapter capability and proof before use. Other integrations may expose different
safe input mechanisms behind the same packet contract.

Track `queued`, `submitted`, `accepted`, `response_observed`, `failed` and
`outcome_unknown` separately. Request acceptance does not prove the update was
read, incorporated or beneficial. Known pre-dispatch busy states stay queued;
uncertain submissions are inspected rather than blindly retried. Keep logical
notification IDs separate from dispatch attempts. The existing native request
record returns prior results for a reused request ID, so a future queue must
handle known-unsent versus unknown outcomes explicitly instead of assuming
repeating `send` retries delivery. An ended or unavailable recipient stays visible
as undelivered; do not choose a replacement session implicitly.

## Acting and recording

Informational packets need no acknowledgement-only message. The receiving skill
asks agents to incorporate relevant information, explain material changes of plan,
and resolve only conflicts assigned to them. A relationship is a revisable model
judgment, not an instruction to accept whichever decision is newest.

The skill's structured `voyager_resolution` response lets the harness associate
the answer with an outstanding request without depending on an agent remembering
a second CLI call. Validate it against native responder identity, delegation,
conflict/decision IDs and expected revision. Malformed, stale, ambiguous or
out-of-scope responses keep the request open for inspection. `needs_input` is
pending, not resolved. Only an accepted explicit replacement creates supersession.
The parser and validation are specified here, not implemented or proven.

Notification preferences, delivery urgency, subscription approval and configuration
are deferred. The current design automatically assesses assignment/topic relevance
and sends one grouped packet per recipient when eligible for delivery.

## First live proof

Use a real test session to prove the native transcript contains the labelled packet,
the skill is available, an evidence-based response is observed, and an explicit
resolution is recorded once. Also prove a busy recipient queues without interrupt,
unknown delivery does not replay, a stale response cannot overwrite a resolution,
and injected source text does not create a notification feedback loop. No such live
proof is claimed by this visual prototype.
