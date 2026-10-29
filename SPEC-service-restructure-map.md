# Capability map: service restructure

Proposed on 29 October 2026. This map is for discussion. Its module boundaries,
dependencies and order have not yet been approved. No individual module spec or
implementation plan is created by this document.

The [design brief](BRIEF-service-restructure.md) owns the agreed direction. The
[existing specification index](SPEC.md) continues to own the functional track.
This map is separate from that track and does not change its task status.

## Outcome

Keep Voyager's service capabilities while making their owners, types and native
interfaces easier to understand. The target has one Voyager Rust executable starting
in `src/main.rs`, a small `src/lib.rs`, native agent tools and a typed Electron
client. Archive the CLI client once its replacement paths are complete.

Specification modules are independently reviewable outcomes, not new processes,
crates or code folders. The proposed code groups remain contract, service,
runtimes, platform and the desktop client.

## Proposed modules

| Module id | Outcome and boundary | Depends on |
| --- | --- | --- |
| `structure-foundation` | A contributor can follow the app from main.rs to the owning capability. Group existing code, narrow intentional exports, account for probe/test callers and preserve native journeys and existing consumers. No new permission, protocol or placement behavior. | Existing verified application baseline. |
| `shared-service-contract` | One typed operation/result/error/receipt/event vocabulary serves all callers, with validation at external boundaries and one state owner. Define operation identity, acceptance versus completion, progress and adapter capabilities. This module owns the shared contract; consumers adapt it. | `structure-foundation` |
| `native-agent-interface` | A Codex Vessel and administrator can use the service through native tools, with bound identity, minimal connection context and observable delivery. Extend the bounded trial to the selected operation scope, including disconnection and uncertainty. Preserve native tools and terminal behavior. | `shared-service-contract` |
| `typed-desktop-client` | Electron main, preload and renderer use TypeScript and the direct service contract. Move shipped window-helper work behind the service/platform boundary. Once native and desktop callers are covered, archive the CLI client and retire the helper executable, preserving the one service executable. | `shared-service-contract`, `native-agent-interface` |
| `request-observability` | Follow one operation across desktop, native tool adapter, service and runtime. Expose meaningful progress, errors and timings, plus local usage observations by interface and action. Keep diagnostics distinct from work events, briefs and knowledge. | `native-agent-interface`, `typed-desktop-client` |
| `authority-consistency` | Panel and floating-avatar interactions retain user authority; docking adds equivalent authority to the Vessel until undock. All routes use the same service decision. Preserve delegated rank/assignment scope and reject stale contexts. | `native-agent-interface`, `typed-desktop-client` |
| `docking-continuity` | Keep a valid dock, voice and authority when the terminal leaves view. Show the dock marker immediately and until undock. Reveal a hidden panel when the docked terminal leaves view, preserve intentional floating/rejected-drop behavior and the home control, and separate failed embedding from ordinary occlusion. | `authority-consistency`, `typed-desktop-client` |
| `coordination-briefs` | Create and retrieve service-owned coordination briefs and pass stable references with task instructions. Define permitted writes, ownership, storage and retention without granting general project-file editing. | `shared-service-contract`, `native-agent-interface`, `authority-consistency` |
| `administrator-delegation` | The administrator uses native tools and user authority for coordination, while project code, prose, configuration and skill changes run in an identifiable Vessel. Verify execution context, instructions and actual outcomes. State runtime enforcement limits honestly. | `coordination-briefs`, `authority-consistency`, `typed-desktop-client` |
| `voyager-skills` | Users can select and customize optional orchestration/collaboration skills independently of Voyager's primitives. Define defaults, discovery, scope, precedence, updates, attribution and the optional instruction-file addendum. Native connection identity and authority remain service-owned. | `native-agent-interface`, `administrator-delegation` |
| `capability-aware-voice` | Preserve supported native voice and expose only available voice modes for the selected runtime/account. Docking continues the selected Vessel's conversation with the previous X user-visible turns available before the first substantive voice response. Reuse native context where already shared. Distinguish text, transcription and live voice; retain the target through visibility changes and report real context/connection failures. | `native-agent-interface`, `typed-desktop-client`, `docking-continuity`, `administrator-delegation` |

## Proposed order

1. Start with `structure-foundation` and discuss its module specification first.
2. Establish `shared-service-contract`, then `native-agent-interface` and
   `typed-desktop-client`. CLI archival completes here after replacement coverage,
   rather than breaking current callers during the initial file moves.
3. Add `request-observability`, then `authority-consistency` and
   `docking-continuity`, so later behavior changes have useful diagnostics.
4. Add `coordination-briefs`, `administrator-delegation`, `voyager-skills` and
   `capability-aware-voice` in their dependency order.

This is a review order for specifications and subsequent capability work, not a
technical task plan. Independent dependencies do not automatically authorize
parallel agents or another workstream. Each module still needs its own reviewed
specification, plan and complete behavior checks.

## Boundaries for the first module

`structure-foundation` changes organization and the application entry point. It
preserves the existing service boundary, authority, runtime ownership, capture,
voice and supported native journeys. It must account for the probe's actual
verification consumers rather than assume it is dead code.

Current CLI and window-helper callers may remain during those structural moves.
Their replacement and final archival belong to the later client modules. The
final target still has one Voyager Rust executable and no required CLI client.

The first module must identify its exact baseline and maintain a traceable map
from old paths to new owners. It does not introduce a plugin framework, a shared
knowledge graph or placeholder adapters. Existing public imports used by tests
and binaries need an intentional migration rather than blanket visibility.

## Later adapter delivery and deferred knowledge work

Design the core types and boundaries for Linux, macOS and Windows now. The first
structural increment preserves actual supported combinations; it cannot establish
new OS support. The later adapter specifications must each deliver native process,
transport, window and terminal behavior on their real OS. Hosted Mac access and a
Windows test environment still need selection. Linux checks do not prove them.

Codex has one bounded native callback proof in
[the draft experiment](https://github.com/isaacasamoah/voyagershellapp/pull/66).
The general adapter still needs specification. Claude Code is a separate native
integration and is deferred until subscription/access is available. Pi and Hermes
remain investigation targets. Missing voice is a normal supported configuration.
Do not substitute a custom SDK agent for the promised native terminal experience
without a separate design decision.

Jev integration, extraction models, graph construction and knowledge retrieval
remain deferred. Reliable service event capture and configurable agent workflows
do not choose a knowledge architecture implicitly.

## Decisions needed during specification

- Confirm module boundaries and dependency order before writing module specs.
- Choose the authoritative contract source, generation approach and compatibility
  strategy without maintaining parallel definitions.
- Define the minimum public library surface and the probe retention decision.
- Define visibility triggers and panel display/workspace placement. Specify real
  target loss separately from a covered or off-workspace terminal.
- Choose the dock indicator's accessible visual treatment.
- Define brief ownership, allowed edits and runtime-specific write enforcement.
- Decide skill scope, precedence, update behavior and the final directory name.
- Define X for dock-to-voice context: its default/configuration, turn unit,
  history limits and provider delivery. Prove recent-text continuation, correct
  Vessel/thread selection and context failure without replaying past actions.

After this map is reviewed, write `SPEC-structure-foundation.md`. Do not write the
other module specifications, alter the active functional plan, or start
restructure implementation based on this proposed map alone.
