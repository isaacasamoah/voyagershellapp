# Service restructure specification index

Project: VoyagerShellApp. Updated 29 October 2026.
State: design review. This branch starts from current main after the accepted
feature integration and naming-convention update. No restructure implementation
is authorized by this index.

## Current initiative

The [design brief](BRIEF-service-restructure.md) records the agreed direction.
The [proposed capability map](SPEC-service-restructure-map.md) records eleven
candidate modules, their owners, dependencies and proposed build order.
The owner has not yet approved that map. Review it before writing any individual
module specification. Each reviewed module specification will live beside this
index as SPEC-module-id.md.

Start with structure-foundation after map review. It preserves working behavior
while making the source layout easier to follow. Subsequent typed contracts,
clients and behavioral changes retain their own specification boundaries.

## Completed baseline and task records

The [historical usability index](done/SPEC-tracer-bullet-usability.md) links the
accepted baseline. Completed contracts remain authoritative for existing behavior:

- [Docking and recovery](done/SPEC-docking-recovery.md).
- [Conversation Resume and reconnect](done/SPEC-conversation-resume.md).
- [Current-work panel](done/SPEC-current-work-panel.md).

The completed panel [plan](tasks/done/compact-vessel-rows-plan.md) and
[task record](tasks/done/compact-vessel-rows-todo.md) retain acceptance evidence
and the explicitly deferred failed mouse-only check. An archived record is not
permission to weaken its acceptance criteria.

## Unfinished inputs

[Voice handoff](SPEC-voice-handoff.md) retains unfinished scope beyond its merged
acknowledgement slice. [Avatar behavior](SPEC-avatar-behavior.md) is an unbuilt
draft. Keep both visible during map review and decide how their requirements
fit the new modules. Neither is marked done or an independently active build.
[Later-capability notes](tasks/future-capability-notes.md) are reference material,
not an executable task queue.

## Planning and execution

There is no active restructure implementation plan or task list yet.
After map review, review the first module specification, then its plan and tasks.
Do not create every module plan in advance or implement from the brief alone.
Keep current specifications here, completed accepted specifications in done/ and
completed plans/task lists in tasks/done/. Preserve standing instructions,
constraints and technical guides in their existing locations.
