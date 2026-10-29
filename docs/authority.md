# Agent authority

Voyager agents have one selected rank: Admiral, Commodore, Captain or Crew.
Creation defaults to Crew in the panel, CLI and agent tools. Bash is a managed
resource and has no rank.

| Rank | Direct reports | Escalates to |
| --- | --- | --- |
| Admiral | Assigned Commodores | You |
| Commodore | Assigned Captains | Its Admiral |
| Captain | Assigned Crew | Its Commodore |
| Crew | Native subagents inside its harness | Its Captain |

Each registered agent has at most one supervisor. Rank alone grants no command
rights over another chain, peers or grandchildren. An unassigned agent can work
independently and escalate to you. Native harness subagents remain part of their
parent, with no separate Voyager rank or registration.

Development testing has a separate owner-issued checkout grant. It authorizes
fresh candidate runs and access to the caller's own run evidence and cleanup,
independent of rank and docking. It expires on removal or service restart.
[Development run contract and commands](development-tests.md).

## Try the panel

Create a Captain and a Crew instance with **+**. Rank starts at Crew; choose
Captain explicitly for the first. Assign Crew to the Captain using its Supervisor
choice at creation or the Supervisor choice in its menu afterward. Selecting a
different rank or supervisor applies the change directly. While Voyager waits for
the service, that choice is disabled. A refusal restores the confirmed value and
shows the reason on the Vessel.

Ask the Captain to use Voyager to give its Crew a small task. Ask an undocked
Crew to instruct another instance and it should receive a permission refusal.
Dock the astronaut on that Crew and repeat: the docked agent temporarily has the
human command surface's rights. Pull it away and new cross-instance instructions
are refused; work already accepted continues.

The panel shows questions escalated to you. An answer records your decision and
its delivery separately. A recorded decision is not proof the recipient received
it or completed its work.

## CLI

The owner CLI selects rank and assigns reports explicitly:

```sh
voyager --state PRIVATE_DIR create codex captain-create Captain /absolute/project --rank captain
voyager --state PRIVATE_DIR create codex crew-create Crew /absolute/project
voyager --state PRIVATE_DIR supervise CREW_ID CAPTAIN_ID
voyager --state PRIVATE_DIR rank INSTANCE_ID commodore
voyager --state PRIVATE_DIR supervise INSTANCE_ID none
```

Use returned IDs from list. A rank change that invalidates a current assignment
refuses unchanged; clear or change those assignments first. You can deliberately
move an agent to a different valid supervisor. No operation silently promotes or
reparents another agent.

An agent uses its existing native tool environment:

```sh
"$VOYAGER_BIN" --state "$VOYAGER_STATE" capabilities
"$VOYAGER_BIN" --state "$VOYAGER_STATE" send TARGET_ID unique-task-id "A bounded task"
"$VOYAGER_BIN" --state "$VOYAGER_STATE" report unique-report-id "The checks passed."
"$VOYAGER_BIN" --state "$VOYAGER_STATE" adjudicate REPORT_ID unique-decision-id accept "The result meets the task."
"$VOYAGER_BIN" --state "$VOYAGER_STATE" escalate unique-question-id "I need a decision."
```

Here REPORT_ID means the direct-report instance receiving the decision. An
optional --about TASK_REQUEST links a visible task. For an owner answer,
--reply-to ESCALATION_ID links the question being answered. Decisions are accept,
revise or resolve. Adjudication records and delivers a judgment; it does not
complete or cancel the native task. Escalation derives its destination from the
current assignment and gives no upward instruction rights.

Standing supervisors can launch the next lower rank, assigned to themselves.
Every omitted rank remains Crew: an Admiral selects --rank commodore explicitly;
a Captain's omitted rank creates Crew. Docked Crew can create an unassigned Crew
instance. Rank/assignment administration remains with the owner.

Ordinary sends start a turn when idle or steer the exact observed active turn.
They do not interrupt it. A changed turn or lost acknowledgement never causes an
automatic new-turn fallback or replay. Duplicate request IDs retrieve the saved
outcome; changing an ID's inputs refuses. An accepted message is not a completed
task. Follow the native turn's completion events.

## Service boundary

Rust resolves instance callers through a private, service-issued context and
checks the current assignment and dock at the action boundary. The native tool
environment receives only the context file's locator. Tokens never belong in
prompts, argv, skills or logs. Missing, invalid, removed or previous-service
credentials refuse; an agent call cannot fall back to the owner socket.

This is cooperative authorization for local agents sharing an OS user. A hostile
same-user process can still use OS-level access outside Voyager's supported tool
surface. Docking and rank do not grant access to private knowledge. Crew retains
its own event reads and status reporting while undocked.

The service serializes changes and checks permission again before a pending
effect. Undock, UI loss and terminal closure release temporary dock authority.
Remove revokes the credential and clears current assignments while retaining
history and accepted work. Reports become unassigned; re-registration restores
no previous supervisor automatically. An assigned Bash controller may be an
Admiral, Commodore or Captain. Shell scripts receive a resource identity, never a
supervisor credential.

Schema version two preserves version-one events, native identities and lifecycle
receipts. Existing Codex registrations migrate to Crew with no guessed supervisor.
Restart clears credentials and control; it does not recover old process ownership
or resubmit work. Unfinished coordination delivery is reconciled from saved native
requests: known loss becomes failed, an unconfirmed dispatch becomes uncertain,
and a saved acknowledgement remains accepted. No message is replayed. Use a fresh
prototype state when trying this branch, or back up a closed service before an
explicit upgrade.

Explicit human interruption remains a subsequent increment. The separate
[voice coordinator](voice.md) follows current control without changing rank.
Ordinary terminal adoption and native Wayland discovery remain separate work.

## Checks

Normal service/CLI tests cover assigned versus unrelated targets, default rank,
forged/revoked identity, lifecycle behavior and exact-turn steering with local
protocol fixtures. They make no model calls.

The opt-in native test runs real Codex tools in service-created instances and
opens Ghostty windows. Use an installed Codex account and a fresh path from a
graphical environment:

```sh
VOYAGER_NATIVE_AUTHORITY_DIR=/tmp/voyager-authority-new \
  cargo test --locked --test native_authority -- --ignored --nocapture
```

It checks actual tool caller identity, delegated completion, other-chain and Crew
refusal, upward escalation and credential absence from stored capture. It cleans
up only its own service and instances. Native observations and remaining physical
interaction checks are recorded separately from fixture results.

## Observed in the native experiment

On Fedora with Codex 0.163.0 and dedicated Ghostty XWayland clients, real native
tools reported the correct Captain and Crew identities. Captain delegation to
its assigned Crew completed; unrelated-target and Crew-to-peer instructions
refused. Crew escalation reached its Captain. The stored capture and native
server arguments contained no generated instance credential.

The actual panel created ranked Codex and rankless Bash instances, changed an
assignment, docked Crew onto its native window, withdrew temporary authority on
undock while accepted work completed, and delivered an owner response to an
escalated question. Docking was driven programmatically; physical gestures and
sound remain a person’s check.

A separate real Codex experiment delivered a second message to the same active
turn and observed the updated exact reply. Repeating the message ID returned its
saved receipt. Run it deliberately with the installed account:

```sh
python3 experiments/native_steering.py
```

Normal fixture tests exercise all four ranks and denied relationship cases. The
real native tool journey uses the Captain/Crew pair. Neither establishes native
Wayland discovery, other terminal applications or crash recovery. Native voice
has its own [adapter and proof limits](voice.md).

Fleet membership is presentation data. The currently docked agent can list Fleets
and move Vessel branches between them using the bound CLI. This grant expires
on undock and never changes ranks or supervisory assignments. Fleet definition
changes remain owner operations.
