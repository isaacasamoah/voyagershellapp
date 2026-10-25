# Tracer-bullet usability specification index

Project: VoyagerShellApp. Updated 26 October 2026.
State: The owner approved the capability boundaries, dependency direction, first scope and build order on 24 October 2026. The owner approved all four module specifications, then separately approved the docking plan and its D01-D04 build and review run. D01-D05 passed independent review and packaged verification. The owner accepted the updated trial and authorized merging docking, followed by the approved voice-handoff build. The owner approved building resume and panel in dependency order on 25 October 2026, with independent review and bounded correction passes. Merge, installation and runtime rollout remain separate decisions.

## This build branch

On 25 October, the owner accepted the current voice acknowledgement change and
requested draft plans for resume and the panel. The resume module passed R00-R03 review and selected-package verification.
This branch owns the approved current-work panel plan in tasks/plan.md and
tasks/todo.md, built after that dependency. The owner approved implementation
with independent review and bounded correction passes. P01-P03 passed their
corrective reviews. P04 passed its first independent review. The combined candidate is ready for owner inspection. Merge and installation
remain separate decisions. Remaining voice interruption, reconnect, failure and timing
work stays in the existing voice plan; accepting the acknowledgement increment
does not complete the full voice specification. The copied docking task list
was complete before this branch replaced it, and remains in Git history.

## Purpose and terminology

Make four everyday journeys dependable enough for the owner to keep using Voyager and learn what the product needs next. The application is a tracer-bullet build: a small working system whose code and boundaries we intend to retain and improve. A prototype is a disposable experiment used to resolve a specific uncertainty. This initiative adopted that terminology on 24 October. Earlier documents using "prototype" for the application retain their historical wording.

The working assumption is that each capability should deliver a complete, narrow journey through the existing Rust service and Electron client. This scope does not require an MVP rebuild, a TypeScript migration or a general adapter framework. Platform-specific window operations stay behind the existing native boundary. Fedora verification will establish Fedora behavior only.

## Approved capabilities

These ids identify specification scope. They do not require new packages, services or Rust modules.

| Module id | Responsibility | Depends on |
|---|---|---|
| `conversation-resume` | Explicitly resume a confirmed stopped, previously managed Codex conversation while preserving its logical Vessel and saved thread. Keep runtime startup, capture, viewer opening and task submission separate. Own the resume eligibility and operation-result contract consumed by the panel. | Existing lifecycle, native-provider, identity and capture boundaries. No dependency on another new capability. |
| `current-work-panel` | Show current work by default, expose previous agents on demand, and keep uncertain states discoverable. Present supported Open, Resume and history actions without treating registration as proof of a running process. | `conversation-resume` for the Resume action and its eligibility/result contract. Filtering can be tested independently. |
| `voice-handoff` | Acknowledge a delegated request, report truthful progress where useful, and return its result through the active voice conversation. Preserve visible results when audio is unavailable. | Existing private-conversation runtime and native handoff protocol. No dependency on another new capability. |
| `docking-recovery` | Make docking eligibility truthful throughout hover and drop. Keep the avatar recoverable after rejection, occlusion or identity loss, and provide an independent Show Voyager recovery path. | Existing service identity/control decisions and native window adapter. No dependency on another new capability. |

Approved build order: `docking-recovery`, then `voice-handoff`, then `conversation-resume`, then `current-work-panel`. Docking comes first because losing the controls obstructs ordinary use. Voice can be reviewed independently. Resume precedes the finished panel journey so that previous conversations have a useful return action. This is the approved sequence for the initiative. The owner subsequently authorized planning in this order. Implementation and parallel agents are not authorized by specification approval.

## Approved limits for the first specifications

- Resume begins with an explicit owner request for a supported saved Codex thread. It never automatically replays a task, treats unknown state as stopped, or restores old credentials. Reopening a viewer is separate. Restoring shell jobs or adopting external processes is outside this capability.
- Panel filtering preserves records, capture and assignments. Running agents remain current when their viewers close. A worker must remain discoverable when its captain is absent from the filtered view. Fleet membership stays separate from authority.
- Voice uses the native acknowledgement and return mechanisms first. Acknowledgement is not completion. The local timing targets in the approved specifications require audible testing; approval does not establish that they have been achieved. Private reasoning stays private.
- Docking initially supports verified running, connected, managed Vessels. Unsupported terminals receive a clear refusal and no success sound or implicit registration. Future explicit adoption remains a separate product capability.

General adoption of externally started terminals is a broader intended outcome. This map establishes the approved interim managed-only docking scope based on the owner's request to stop implying unsupported adoption. It does not claim that broader capability is implemented.

## Evidence and verification direction

This specification follows source inspection of [worker startup](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/src/worker.rs), [panel rendering](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/ui/renderer.js), [private voice](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/src/service/conversation.rs), and [docking](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/main.cjs). The missing managed-resume operation, registration-based panel filtering and disabled voice acknowledgement were established in that investigation. The exact silent-return and disappearing-avatar incidents remain incompletely traced. These proposed capabilities address the required behavior without claiming those incident causes are fully proved.

Each module specification defines its successful journey, a deliberately different refusal or failure case, and what evidence demonstrates the result. Integration verification must run the actual selected app and service revisions. Docking measurement extends from the user's action through placement and audible sound; voice verification includes heard acknowledgement and result delivery. Automated receipts alone do not establish those experiences. No new runtime verification occurred while preparing this map.

## Approved module specifications

| Module id | Authoritative specification | Approved first scope |
|---|---|---|
| `docking-recovery` | [Truthful docking and avatar recovery](SPEC-docking-recovery.md) | Undock when the target becomes obscured; local timing targets. |
| `voice-handoff` | [Voice acknowledgement and result handoff](SPEC-voice-handoff.md) | Private app conversation scope and local audible timing targets. |
| `conversation-resume` | [Explicitly resume a saved conversation](SPEC-conversation-resume.md) | Verified settings required; insufficient legacy records stay inspectable but ineligible. |
| `current-work-panel` | [A panel focused on current work](SPEC-current-work-panel.md) | Current work, Needs attention and Previous agents; bounded history disclosure. |

Each specification owns its behaviour, contracts and acceptance cases. The owner
approved the four specifications. This branch's [draft plan](tasks/plan.md) and
[task list](tasks/todo.md) cover `conversation-resume` for review only. Docking is
accepted and merged. The owner has accepted the current voice acknowledgement
increment and requested planning for resume and the panel. Remaining voice work
stays open in its existing task list. No resume or panel implementation has begun.

## Review and development workflow

The capability boundaries, build order and four module specifications are approved. The docking build now has an approved plan and explicit implementation authorization. The owner accepted docking and authorized its merge. Runtime rollout remains a separate gate. Recording specification approval alone does not start another capability or change the running app.

This file is the repository entry point. The four adjacent module specifications own their respective contracts; this index does not duplicate them. Preserve the module boundaries when selecting work.

Follow Specify, Plan, Tasks and Implement for each capability in the approved order. The active `tasks/plan.md` and `tasks/todo.md` currently cover only `docking-recovery`. Each task is a small complete behavior with implementation and verification, not a separate technical layer or another plan. [Later-capability notes](tasks/future-capability-notes.md) retain investigation for future planning; they are not an active task list. Follow the existing build and Git skills unchanged for the first trial. Review and approve the active plan before implementation.

The source links in these specifications are pinned to the revision inspected when the drafts were prepared. They document the baseline, not newly completed runtime checks. Tests described here are acceptance requirements; completed evidence is recorded by the owning task list. Public operational contracts remain in the owning documents such as [lifecycle](docs/lifecycle.md), [voice](docs/voice.md) and [fleets](docs/fleets.md).

Human-facing research and project navigation can link to these repository documents. Private incident logs, transcripts and account-local evidence remain outside committed source. Do not maintain a second editable specification elsewhere.
