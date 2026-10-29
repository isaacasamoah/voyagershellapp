# Voyager structure and typed contracts

Design brief, 28 October 2026. Updated 29 October after the native tool trial and
subsequent design discussion. This is the separate restructure brief.
It records the intended design, not a claim that the current app already behaves
this way. The inventory comes first. Capability specifications and an
implementation plan follow the design discussion.

## Goal and scope

Make Voyager easier to understand, change and extend while keeping its existing
functionality. Isaac and a new contributor should be able to trace a request,
find the code responsible for a behavior, and identify the contracts a change
affects.

Preserve existing user-facing service capabilities, with the explicit changes
below: archive the CLI client in favor of native tools, correct authority and
avatar behavior, and support user-customizable coordination skills. Specify and verify those corrections explicitly.
The portability and voice requirements extend the target. Specifications must
distinguish structural changes, compatibility corrections and new adapter support.
Completed baseline specifications and panel records are retained in
[the historical index](done/SPEC-tracer-bullet-usability.md) and
[the completed panel task record](tasks/done/compact-vessel-rows-todo.md).
Unfinished voice and avatar inputs remain listed in the [current index](SPEC.md).
Complete the restructure with existing functionality preserved, then return to
the remaining functional workstreams. No unfinished scope is marked complete.

## Design principles

Give each responsibility one owner and define shared rules once. Organise code
so a change to one capability or client has limited effects on unrelated code.
Every folder and layer must help a reader locate behavior or separate things
that need to change independently.

Prioritize the agreed user experience. Address concrete, reachable risks with
the smallest sufficient safeguard. Follow the
[project's user-experience guidance](AGENTS.md#user-experience-and-proportionate-safeguards).
Ask focused questions about consequential behavior that remains unspecified.

## What the parts mean

| Part | Responsibility |
| --- | --- |
| Voyager service | The running Rust backend. It owns coordination, policy, managed Vessel lifecycles, authoritative state and recorded observations. |
| Voyager harness | The shared operations for managing Vessels and coordinating work. This names the capability set; it does not require another process or implementation layer. |
| Voyager administrator | The native agent representing the user through the panel and avatar, currently called the private assistant. It administers Voyager, prepares instructions, delegates project changes and explains results. |
| Electron | The typed desktop client. It presents state and calls the common service contract directly. |
| Native agent tools | Provider-native callers of the same service capabilities, with verified administrator or Vessel identity. |
| Archived CLI client | Historical command-line access retained for possible future reuse. It is not part of the target app or native agent request path. |
| Native runtimes and clients | Bash, Codex app servers and terminal interfaces. They retain their native execution behavior and communicate with Voyager through defined adapters. |

The private assistant's Codex runtime is separate from Codex Vessel runtimes.
A native terminal client can communicate directly with its own runtime; not every
native interaction passes through Voyager.

Keep process ownership, viewer connections, registration, capture and authority
distinct. Detaching a client must preserve its managed runtime. Keep explicit
ownership checks and refusal to replay uncertain effects. Voyager must not
replace the native terminal or agent execution environment.

Recorded events are observations. Any derived knowledge or relationship between
events needs its own definition and evidence. Inventory what exists without
treating a proposed shared knowledge graph as implemented or adding one as part
of structural cleanup.

## Administrator role and delegated work

The administrator retains the user's authority for app operations. Reuse the
provider's native tools and expose Voyager operations through the same service
contract used by Electron and native agent callers. Do not rebuild native search,
file-reading or command tools as a separate assistant tool set.

Investigate native Vessel tool callbacks over an existing runtime connection,
without requiring a per-call CLI process or an additional tool-server process.
The Codex experiment establishes two callback probes on a fresh managed Vessel;
the complete operation catalog, effectful calls and recovery still need proof. Distinguish standalone Claude Code from an SDK-hosted agent
when assessing its tool extension options. Keep provider choices explicit rather
than assuming one in-process extension exists for every harness.

Bind native calls to the actual Vessel and runtime generation, preserving its
delegated or docked authority. Reuse the service contract and checks, not the
administrator's owner-facing identity. Prove native-terminal callback delivery,
reconnect, Resume and equivalent completion milestones before selecting the
production adapter or claiming a speed improvement. The CLI may remain as a
transitional caller until its replacement coverage is established.

The 29 October experiment passed two direct native tool probes from one fresh
Codex Vessel and its actual terminal client in an isolated PTY. It preserved the
Vessel's Crew identity and refused the owner-only negative case. This is evidence
for that bounded route, not the general adapter, effectful operations, recovery
or performance. The experimental change is not installed or merged. Defer the
Claude Code native experiment until Isaac has subscription/access available.

Delegate changes to project code, prose, configuration and skills to a Vessel.
Give that Vessel the intended folder, repository and remote, worktree where
applicable, task instructions and acceptance expectations. Collect its events
so project work has an identifiable execution and outcome.

Preparing coordination material is administrative work. Propose service-owned
brief storage for instructions too long to pass inline, with a reference supplied
to the Vessel. This does not require general project-file write access. Define
storage, permitted brief edits, retention and runtime access during specification.

Investigate broad terminal and process interaction through native capabilities
and user-authorized operations. Keep this separate from process ownership and
dockability. Determine the exact permitted writes and what each runtime can
enforce. A role instruction alone does not establish a filesystem restriction
when native command execution can also write files.

## Native connection and user-customizable skills

The agent-runtime adapter is Voyager code that translates the selected provider's
native protocol. It supplies minimal connection instructions, registers Voyager
operations and routes tool calls/results through the shared contract. It binds
calls to the actual Vessel and runtime generation. It does not choose the user's
workflow, grant authority or reimplement the provider's native tools.

Provide a small startup context explaining that this agent is part of Voyager,
how to inspect its verified identity and capabilities, and where its selected
coordination skills can be found. Make delivery observable. Verification must
show both the supplied instruction/skill versions and actual use of an identity
or capability operation. A model's assertion of awareness is insufficient proof.
Native discovery and instruction delivery must be proved for each provider.

Provide useful optional orchestration and collaboration skills that compose the
service's primitives. A proposed user-owned directory is `.voyagershell/skills/`,
with ordinary `SKILL.md` files users can edit or replace. Defaults must remain
useful without adopting our development workflow. Do not overwrite user edits
when shipping an update, or load every skill into every conversation.

Expose a concise skill index through the native adapter, using the provider's
supported discovery mechanism where available. Do not assume the provider
recognizes a Voyager-specific folder automatically. Keep one editable skill
source, preserve the user's own project instructions and record which skills
were supplied. The native adapter translates presentation, not skill meaning.
Specify user/project scope, selection, precedence and update behavior before
implementation; do not invent silent merging rules.

Offer an optional AGENTS.md addendum during installation for projects and agents
that need to discover Voyager. Use the instruction file the runtime reads and
avoid duplicate copies when one imports another. Show the exact edit, preserve
existing instructions and allow explicit skill invocation without the addendum.
Voyager-launched Vessels receive connection context through their native adapter
and do not depend on modifying every project's instructions.

Skills define how an agent combines operations. They do not change operation
semantics, invent identity or grant permissions. Event recording stays reliable
at the service boundary even if no workflow skill is loaded. Defer Jev, model
selection for extraction, graph construction and knowledge retrieval design until
that capability is deliberately specified. Do not implement a skill interpreter,
generic plugin framework or knowledge graph as part of structural cleanup.

## Portability and adapter boundaries

The target is a service that supports Linux, macOS and Windows, multiple native
terminals, and multiple agent harnesses. Define contracts and capability owners
for that target now. Current Linux, Ghostty/xterm and Codex code is an existing
implementation, not the definition of a Vessel or a service operation.

Keep three adapter responsibilities explicit:

- Platform adapters implement local communication, process observation and
  ownership, terminal input primitives, and desktop/window operations for each OS.
- Terminal adapters launch and identify a native terminal client and connect it
  to the intended runtime. Terminal choice is separate from agent choice.
- Agent adapters translate supported lifecycle, instruction, observation and
  attachment operations into the selected harness's native interfaces.

Codex and Claude Code are the initial agent targets to assess and prove. Pi and
Hermes are additional targets to investigate. Do not assume their protocols or
capabilities are equivalent. Apply the same consideration to the private
assistant's provider boundary without assuming every harness supplies app voice.

Keep platform paths, window IDs, Unix descriptors and provider-specific message
shapes inside the appropriate adapters. Shared types express Voyager concepts.
Report adapter capabilities explicitly, including unavailable operations. Preserve
provider-specific capabilities without pretending every harness supports Resume,
steering, capture or voice in the same way. Missing adapter support and a caller's
authority are different facts.

Use small explicit interfaces for real variations. Do not create empty adapter
trees, placeholder implementations or a plugin framework for unproved targets.
Select the exact first platform/harness combinations during specification.

## One typed contract

Define one authoritative service contract for operations, inputs, results, errors,
receipts and events. A receipt reports an operation's progress and outcome;
acceptance does not establish completion.

Electron, administrator tools and native Vessel tools use the same contract.
Adapters translate clicks, text, voice requests and native tool calls into service
requests. Archive the standalone CLI client for possible future reuse; it is not
a required intermediary in the target design. The service defines the action, permission,
retry and completion rules.

Use intentional Rust types internally. Convert Electron main, preload and
renderer code to TypeScript, with checked inputs and outputs at their boundaries.

Choose one authoritative source for shared contracts and a way to keep Rust,
TypeScript and runtime validation aligned without manually duplicating
definitions. Their internal representations may differ while retaining the same
meaning. The contract tooling and exact types remain to be chosen.

Use typed adapters for Codex messages and terminal operations. Validate external
messages as they enter, then pass typed values internally. Build checks should
catch incompatible arguments, results and missing handling of defined states.
Runtime checks still establish external message contents, live ownership,
permissions and actual effects.

## Voice capabilities and transitions

Voice availability depends on the selected agent/runtime, its version, account
entitlements, configuration and actual supported interface. An installed agent
name alone does not establish voice support. Report supported voice modes and
current availability through the adapter contract, separately from authority.

Keep text-only, speech-to-text input and live interactive voice distinct. The
user's Codex realtime experience and possible press-to-speak input in another
harness are examples to assess, not a promise that every provider or account
supports them. Pi and Hermes voice capabilities remain to be investigated.

Docking starts the selected Vessel's native voice when its adapter supports it;
undocking stops that native voice. The avatar soundwave control starts or stops
app interactive voice when supported. Keep private app voice and Vessel-native
voice capabilities distinct, and define the handoff through the common voice
contract. Route to the identified runtime rather than desktop keyboard focus.

Docking must also make the selected Vessel's recent conversation available to
voice, so the user can continue naturally without repeating what was just
discussed in text. Reuse the existing native conversation context where voice
already shares it. Otherwise the runtime adapter prepares the previous X
user-visible conversation turns, including relevant visible tool results, as
part of voice activation. Do not make an uninformed first voice response while
that context is still missing.

X is a design parameter, not a chosen default. Specify its default, configuration,
what counts as a turn, context limits and provider-specific delivery mechanism in
the voice module. Bind the handoff to the selected Vessel, native conversation
and current docking context. Changing the target must not carry another Vessel's
history into voice. Do not duplicate history already present, expose internal
reasoning or replay past task instructions or tool calls as new work.

Verify seamless continuation from recent text, correct target selection, the
chosen history window, and unavailable or failed context delivery. Treat a docked
terminal going out of view as the same continuing conversation, not a reason to
restart voice or load it into a different assistant. Record context readiness
and voice readiness separately when measuring docking latency. This is an agreed
target; the native tool probe did not test voice-context handoff.

If the configured setup has no voice support, keep the app fully usable through
text and ordinary controls and omit inapplicable voice controls. Missing optional
voice is a normal capability state, not an app failure. Distinguish unsupported
voice from a temporary failure of a previously supported voice connection, and
report the latter without inventing success or automatically replaying input.

Verify text-only setups, each supported voice mode, docking/undocking activation,
account/configuration unavailability and connection failure with the appropriate
adapter and native journey. Do not assume one harness's shortcut or protocol
applies to another.

## User and delegated authority

The panel and floating avatar always retain the user's full authority.
Docking the astronaut on an agent additionally makes that agent a user interface
for the duration of the docking. It does not take authority away from the panel.

| Interaction | Authority |
| --- | --- |
| Panel controls, text and voice requests | Full user authority in every avatar placement state. |
| Voice through the floating avatar | Full user authority, including while the panel stays open. |
| Agent bearing the docked astronaut | Equivalent access to the service's user capabilities while docked. |
| Agent without the astronaut | Its delegated permissions and assignment scope. |

Do not impose different permission ceilings because the user clicks, types,
speaks or uses a docked agent. Audio routing and microphone selection are
separate from permissions.

The service verifies the caller and current docking context. Docking does not
permanently change rank or assignments. Undocking ends the agent's access through
that docking and leaves panel and floating-avatar authority intact. Specify how
pending requests and stale docking contexts behave.

Delegation includes task scope. A captain asked to assemble a research team does
not thereby receive unrestricted authority over unrelated work. Distinguish
permissions the service enforces from task boundaries expressed as instructions
to an agent.

Isaac reported differences between panel controls, private-assistant tools and
docked-agent access. Investigate those differences before claiming their cause
or that equivalent access already works.

## Avatar placement and docking

The avatar can be seated in the panel, docked on a Vessel, or floating
independently. Floating is a deliberate placement. The user can keep the panel
open and speak through the avatar elsewhere. Avatar and panel positions are
independent.

The panel is the avatar's home. Other dockable targets are terminal interfaces
of Vessels launched by Voyager, identified through their managed runtime and
Voyager metadata. An externally launched Ghostty terminal or Codex session is
undockable, like any other application window. Do not implicitly adopt it.

Over an undockable target, show a dotted outline and "Not dockable" feedback.
Releasing there leaves the avatar floating where the user placed it. Keep the
panel in place. Do not snap the avatar back or move either window because the
app infers that the avatar might be obscured or invisible. A rejected drop
grants no authority to the target.

A successfully docked avatar stays docked when its terminal is covered, moves
outside the current view, or the user changes screens or desktops. Visibility
alone must not trigger undocking, return to the panel, native voice shutdown or
loss of docking authority. Distinguish an actually failed embed from a valid dock
that is temporarily outside the user's view.

The panel marks the docked Vessel immediately when docking succeeds and retains
that indication until undocking. The marker reflects docking state continuously,
not only when visibility is lost. It remains part of panel state while the panel
is hidden and is present whenever the panel is shown. Its exact icon, ring or
color treatment is still a design choice and must be distinguishable accessibly.

Clicking the avatar continues to toggle panel visibility while docked. If the
panel is hidden and the docked terminal leaves view, reveal the panel so the
marked Vessel can be found. Showing the panel must not change the docking target,
voice routing or authority. Do not invent panel-following movement. Specify the
visibility trigger, display/workspace placement and genuine target-loss behavior
without confusing these with ordinary occlusion.

Clicking the avatar's home position in the panel returns the avatar there.
Keep that control available while the avatar is elsewhere. Return the avatar
to the panel's existing position.

Isaac reported unwanted panel-following and recovery behavior. The cause remains
to be investigated. The placement rules above describe the intended corrections.

## Code structure

Build one Voyager Rust binary, with `src/main.rs` as the application entry point and
`src/lib.rs` retained. One binary does not require one running process.

Group modules consistently by meaningful capabilities. Prefer explicit functions
and types. Choose the directory structure after understanding those capabilities.

Use the target groups `src/contract/`, `src/service/`, `src/runtimes/`,
`src/platform/` and the TypeScript desktop client under `desktop/src/`. Clients is
a logical responsibility, not a reason to create an empty Rust `clients/` folder
once the CLI is retired. Keep only the public library surface actual callers need.

Separate structural moves from behavior changes. The first module reorganizes
working code and establishes the main entry point while preserving current
consumers and native journeys. Retire the CLI client and separate window helper
only when native tools and the direct desktop/service path cover their callers.
Archival preserves recoverable source/history; it is not a hidden fallback route.
The service executable and its startup mode remain.

Account for the probe experiments and shipped window-helper operations before
consolidating or removing executable targets. Preserve useful verification and
native window behavior. Actual callers and verification roles determine whether
code is useful or obsolete.

## Observability and usage feedback

Make service and Electron behavior diagnosable through structured logs and
correlated timings. Follow a user action through the client, service, runtime
adapter and native effect so we can see where it waits or fails. Distinguish
request acceptance, runtime readiness, task acceptance, viewer visibility and
actual task completion instead of reporting one undifferentiated duration.

Use a shared request identity and retain the provider/native identities needed
to join related observations. Record the action, originating interface, phase,
duration, outcome and useful error code. Trace asynchronous work and reconnects
without treating a new observation connection as a new user action.

Collect local usage data about intentional interactions: voice versus panel text,
native agent tools and transitional CLI calls, which panel actions are used, their frequency, outcomes and
latency. Keep usage observations separate from Vessel work events and derived
knowledge. The first design does not require a hosted analytics service or
recording message contents, raw audio, credentials or keystrokes.

Define questions and retention before adding telemetry. Start with why Vessel
creation feels slow, where failures occur, and which interfaces and actions the
user actually uses. Prefer the smallest instrumentation that answers those
questions. Verify that a failed journey can be followed using its diagnostics.

## First deliverable: current-system inventory

Present the review as an interactive visual guide. Show the current system and
the proposed system separately, with folder overlays and explanations of each
component's owner and each connection's inputs, outputs and limits. Follow the
same operations through the panel, assistant and delegated-agent routes. Explain
the current problems beside the proposed changes. Keep detailed source findings
and verification evidence available without making them the main reading path.

Record each capability's purpose, state owner, entry points, callers and external
dependencies. Trace requests, results, errors, receipts, Vessel records and events.
Identify their shapes, validation, translation, persistence and duplicate
definitions, with references to the code that owns each one.

Follow the connected journey discussed with Isaac: activate app voice, create a
Vessel, background its viewer, reopen it and send instructions. Compare the
equivalent manual client routes and relevant failure paths.

For each service capability, compare panel controls, private-assistant text and
voice, current CLI callers and docked-agent tools. Mark the CLI as historical
and transitional in the inventory; target verification uses native tools. Record caller authority, adapters, service
enforcement, missing routes and inconsistent outcomes.

Also inventory Linux/Unix/X11 assumptions, terminal dependencies and Codex-specific
fields or states. Distinguish portable policy from host/provider mechanisms and
identify which current operations each proposed adapter can actually support.

Separate source implementation, observed runtime behavior and proposed changes.
Record the source revision and runnable artifact independently. Do not treat
earlier evidence as proof of a different build.

## Verification and next decisions

Preserve existing user journeys, native process behavior, saved identities and
uncertainty semantics. Record any compatibility migration and the explicit
authority or placement corrections separately from structural moves.

The later specifications must define proof for:

- Equivalent service access through user-authorized clients, including panel
  controls and text while voice uses the floating avatar.
- Panel authority while a Vessel is docked, and loss of that Vessel's docking
  authority after undocking, including stale-context cases.
- Accepted managed-Vessel docking, rejected external-terminal and ordinary-window
  drops, deliberate floating, and return through the panel home control.
- Retention of the chosen avatar and panel positions after rejected drops.
- Dock, native voice and authority continuity while a valid terminal is obscured,
  off the current desktop or on another screen; distinguish genuine target loss.
- An immediate dock marker that remains until undock, and panel reappearance when
  a hidden panel is needed to locate the docked Vessel.
- Native request paths without a CLI intermediary, including caller identity,
  receipt semantics and failure/reconnect behavior.
- Minimal connection-context delivery and usable, version-attributed skills,
  with user edits preserved and an optional project addendum.
- Build-time rejection of incompatible contract use and runtime rejection of
  malformed external messages.
- Existing native journeys and meaningful failure cases through the maintained
  proving fixture.
- Portable contract and state-transition tests on Linux, macOS and Windows, plus
  native process, local-communication, terminal and desktop tests on each OS.
- Shared adapter conformance journeys and actual integration tests for Codex and
  Claude Code, with Pi and Hermes marked unproved until their adapters are tested.

Establish OS-specific test environments as part of the work. Hosted OS runners
can exercise builds and service tests. Window, focus, input and audible voice
journeys need suitable native desktop sessions, using dedicated hosts or VMs
where appropriate. Linux containers or cross-compilation do not prove macOS or
Windows runtime behavior. Record tested OS, architecture, terminal, harness and
version combinations; a passing adapter fixture is not native integration proof.

Follow [CONSTRAINTS.md](CONSTRAINTS.md) and
[CONTRIBUTING.md](CONTRIBUTING.md), including test-size limits, formatting, tests,
Clippy and real-application proof. Compilation alone does not establish the user
experience or support for another platform.

Use BeautifulRust alongside the canonical specification, planning,
implementation and review skills. After the inventory, discuss the component
boundaries, contracts and module structure with Isaac. Then define the capability
map and specifications before planning implementation. Keep restructure task
status separate from the existing functional task list.
