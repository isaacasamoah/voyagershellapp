# Tracer-bullet usability specification index

Project: VoyagerShellApp. Updated 24 October 2026.
State: The owner approved the capability boundaries, dependency direction, first scope and build order on 24 October 2026. The four module specifications are drafted and await separate review. Map approval does not authorize implementation or runtime changes.

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

Approved build order: `docking-recovery`, then `voice-handoff`, then `conversation-resume`, then `current-work-panel`. Docking comes first because losing the controls obstructs ordinary use. Voice can be reviewed independently. Resume precedes the finished panel journey so that previous conversations have a useful return action. This is the approved sequence for the initiative. It does not authorize a task plan, implementation or parallel agents.

## Approved limits for the first specifications

- Resume begins with an explicit owner request for a supported saved Codex thread. It never automatically replays a task, treats unknown state as stopped, or restores old credentials. Reopening a viewer is separate. Restoring shell jobs or adopting external processes is outside this capability.
- Panel filtering preserves records, capture and assignments. Running agents remain current when their viewers close. A worker must remain discoverable when its captain is absent from the filtered view. Fleet membership stays separate from authority.
- Voice uses the native acknowledgement and return mechanisms first. Acknowledgement is not completion. Timing targets need agreement and audible testing; the report's suggested numbers are not accepted guarantees. Private reasoning stays private.
- Docking initially supports verified running, connected, managed Vessels. Unsupported terminals receive a clear refusal and no success sound or implicit registration. Future explicit adoption remains a separate product capability.

General adoption of externally started terminals is a broader intended outcome. This map establishes the approved interim managed-only docking scope based on the owner's request to stop implying unsupported adoption. It does not claim that broader capability is implemented.

## Evidence and verification direction

This specification follows source inspection of [worker startup](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/src/worker.rs), [panel rendering](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/ui/renderer.js), [private voice](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/src/service/conversation.rs), and [docking](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/main.cjs). The missing managed-resume operation, registration-based panel filtering and disabled voice acknowledgement were established in that investigation. The exact silent-return and disappearing-avatar incidents remain incompletely traced. These proposed capabilities address the required behavior without claiming those incident causes are fully proved.

Each module specification defines its successful journey, a deliberately different refusal or failure case, and what evidence demonstrates the result. Integration verification must run the actual selected app and service revisions. Docking measurement extends from the user's action through placement and audible sound; voice verification includes heard acknowledgement and result delivery. Automated receipts alone do not establish those experiences. No new runtime verification occurred while preparing this map.

## Module specifications for review

| Module id | Authoritative draft | Main review choice |
|---|---|---|
| `docking-recovery` | [Truthful docking and avatar recovery](SPEC-docking-recovery.md) | Undock when the target becomes obscured; proposed latency budgets. |
| `voice-handoff` | [Voice acknowledgement and result handoff](SPEC-voice-handoff.md) | Private app conversation scope and proposed audible timing budgets. |
| `conversation-resume` | [Explicitly resume a saved conversation](SPEC-conversation-resume.md) | Verified settings required; insufficient legacy records stay inspectable but ineligible. |
| `current-work-panel` | [A panel focused on current work](SPEC-current-work-panel.md) | Current work, Needs attention and Previous agents; bounded history disclosure. |

Each draft contains its behavior and contracts, commands, source ownership, conventions, tests and acceptance cases. Detailed timing budgets and interaction choices are proposals within these drafts, not decisions implied by approval of the map. Review the specifications before implementation planning. No plan, task list or product implementation has been created in this pass.

## Review and development workflow

The capability boundaries and build order are approved. Each linked module specification remains a draft for behavior review. In particular, the timing budgets, recovery interaction and legacy resume limits need review. Moving these documents into version control does not approve their contents or start implementation.

This file is the repository entry point. The four adjacent module specifications own their respective contracts; this index does not duplicate them. Preserve the module boundaries when selecting work.

After specification approval, use the canonical planning skill to produce `tasks/plan.md` and its default task list, `tasks/todo.md`, or the project's explicitly designated tracker. The active plan identifies which approved modules it covers. Follow the existing build and Git skills unchanged for the first trial. No plan or task list has been created yet.

The source links in these specifications are pinned to the revision inspected when the drafts were prepared. They document the baseline, not newly completed runtime checks. Tests described here are future acceptance requirements. Public operational contracts remain in the owning documents such as [lifecycle](docs/lifecycle.md), [voice](docs/voice.md) and [fleets](docs/fleets.md).

Human-facing research and project navigation can link to these repository documents. Private incident logs, transcripts and account-local evidence remain outside committed source. Do not maintain a second editable specification elsewhere.
