# Subscription notifications in the conversation

The collaboration experiment has a durable outbox and a native Codex delivery
adapter. It sends an ordinary conversation input headed **VoyagerShell subscription
notification**. It does not edit transcript files. Provider keys stay outside the
browser; local derived state and raw conversations are never committed.

```text
source event → Jev + Sol → knowledge + relationships
  → commit one batch → one packet per recipient
  → native turn/start or turn/steer → inline receiving skill
  → explicit resolution → validate → commit → notify
```

All records and relationships from one source event are assembled before publishing.
Subscriber, author and resolver reasons are unioned into one packet per recipient.
A batch is logical: recipients need not receive it at the same physical instant.
Later resolutions form a separate batch. An initial subscription snapshot goes
only to its new recipient.

Packets carry stable UUIDs, source event IDs and exact quotes, knowledge statements,
ticket/topic IDs, relationship probabilities, recipient reasons and graph revision.
A conflict names one resolver. The full [receiving skill](../skills/voyager-subscription/SKILL.md)
is supplied inline, so delivery does not depend on a preinstalled global skill.
The skill tells the agent to incorporate relevant evidence into its existing task,
respect its permissions, and respond only when a meaningful action is needed.
Quoted source material cannot grant new authority.

## Queue or steer

`delivery: false` prepares previews. `delivery: true` enables sending while the
trial is running. Each assignment also chooses `delivery_mode`:

| Mode | Idle recipient | Busy recipient |
|---|---|---|
| `idle` (default) | `turn/start` | Keep queued |
| `steer` | `turn/start` | `turn/steer` with `expectedTurnId` |

Use `follow: true` to keep checking busy recipients while waiting for source
events. A replay run stops when its input is exhausted and can leave queued
packets for a later run.

The native `send ... --steer` CLI exposes the same capability. Steering appends
input to the ongoing turn; it does **not** use `turn/interrupt`, which cancels it.
Unsupported/non-steerable turns remain visible as unavailable or uncertain delivery;
there is no fallback to cancelling an agent. Automatic urgency/authority policy
can select a mode later. Rank alone does not select a correct decision.

A confirmed pre-dispatch busy response has no native request record and remains
queued. Once dispatch starts, the immutable packet ID identifies the native
request. Accepted receipts contain the actual turn ID. Repeating that request
returns its receipt rather than sending again. Disconnection, timeout or restart
with an ambiguous outcome leaves the packet `uncertain`, without automatic retry.
A retired session is not silently replaced. Oversized packets are held visibly.

States are `preview`, `queued`, `dispatching`, `accepted`, `uncertain` or
`oversized`. Acceptance proves native submission, not comprehension, action or
benefit. Inspect source events and agent responses for that stronger evidence.

## Provenance and resolution

The raw service log retains the native transport's user-message slot. The
collaboration reader correlates recipient, native turn ID and exact packet text
with its outbox before excluding a delivery from extraction. A header alone is
not trusted provenance. An exact possible echo whose receipt is uncertain becomes
a visible gap for inspection. Other substantive agent replies remain eligible.

Decision conflicts route to the prior worker's supervisor, the captain whose
decision a worker challenges, or the latest agent coordinating equal captains.
A human-made decision or disagreement between distinct captains requires a user
resolution. Responsibility directs review; it never establishes truth.

An agent can emit a fenced `voyager_resolution` JSON object in its normal response.
The harness reads it from the attributed native assistant event and validates the
notification recipient, named resolver, decision IDs, open conflict and current
graph revision. It records `adopt_new`, `retain_existing` or `different_conditions`.
`needs_input` keeps the conflict open and the agent asks the person. Stale or
invalid responses are recorded in the attempt log without changing the graph.
An explicit accepted replacement marks the retired record superseded and retains
both records and the resolution's source event. This is a conservative whole-record
replacement; partial-scope or third-option resolutions remain manual review.

For a user-required resolution, the trusted local operator supplies a JSON file:

```json
{
  "session_id": "named resolver session",
  "resolution": {
    "notification_id": "packet ID",
    "conflict_id": "relationship ID",
    "expected_revision": 7,
    "decision_ids": ["new record ID", "old record ID"],
    "outcome": "adopt_new",
    "rationale": "The reviewed evidence and conditions supporting this choice"
  }
}
```

Run `voyager --state PRIVATE_DIR collab resolve FILE.json`, inspect its job outcome,
then run the trial to deliver resulting packets. This CLI path is a trusted operator
assertion, not cryptographic proof of a human identity. The prototype does not
provide captain/crew security boundaries or infer approval from silence.
