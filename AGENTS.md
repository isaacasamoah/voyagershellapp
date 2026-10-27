# Working on Voyager Shell

Read `CONSTRAINTS.md` before writing code. Do not weaken it to make a change pass.

Voyager is an experimental Rust service around existing native agent interfaces. Electron is its desktop client. Preserve that product boundary: do not add a terminal UI, run tmux or Herdr as a backend, or pretend registration transfers process ownership.

- Work in small increments with one user-visible experiment and a known-different test.
- Inspect the repository and dirty state before editing. Preserve unrelated work.
- Use Rust for the service and CLI. Prefer a small number of explicit types and modules to plugin frameworks or distributed machinery.
- Separate process ownership, client connections, structured agent events and derived knowledge.
- A received command is not a completed task. A quiet terminal is not proof of success.
- Detach must not stop a managed process. Explicit stop must not affect unrelated processes.
- Persist only the fields the experiment needs. Do not commit local state, transcripts, credentials, private planning notes or terminal recordings.
- Keep public documentation usable by someone outside the author's environment. Link public research; cite pinned source revisions for code claims.
- Add a dependency only for a real primitive we need now. Do not copy upstream code as an implementation shortcut.
- Run formatting, relevant tests and Clippy when Rust code changes. Tests should exercise the real service boundary, including disconnect and failure paths.
- Record what was observed, what is inferred, and what remains unproved. Linux evidence does not establish macOS support.
- No automatic agent resubmission or process restoration after an uncertain failure.

The detailed design work can evolve before an implementation increment is accepted. Update the README's actual status when behavior changes; do not call a scaffold a working feature.

Use `rust-best-practices` from the installed BeautifulRust wrappers alongside
implementation and testing skills whenever changing Rust. Use `rust-review`
alongside `code-review-and-quality` for Rust reviews. This applies to current and
future builds. Preserve this project's comment-free source rule, `CONSTRAINTS.md`,
existing toolchain/lint policy and real-application proof. Keep required design and
unsafe reasoning in the owning context documents. Do not copy upstream lint
presets or add dependencies, abstractions or tools merely because a skill mentions
them. Surface concrete conflicts and measured limits in the review.

Read the small Rust conventions in `CONTRIBUTING.md`. Keep source readable for
people learning with us, and preserve the same checks and docs in every increment.
Use a working branch and PR; never use the admin bypass without Isaac explicitly
authorizing that particular merge or protected-branch update.

Lifecycle operations are owned by `src/service/lifecycle.rs`; native requests by
`src/service/native.rs`; both use the one service-owned store and process maps.
Read [the lifecycle contract](docs/lifecycle.md) before changing either boundary.
Keep changed code comment-free, including doc comments and explanatory docstrings.
Put mechanisms, invariants and design reasons in the owning context document.

Rank and direct-assignment policy belongs in `src/authority.rs`. Runtime identity,
coordination and capability presentation belong in `src/service/authority_ops.rs`.
The CLI and Electron expose those service decisions; they do not grant rights.
Read `docs/authority.md` before changing that boundary. Native voice and explicit
preemptive override remain separate from rank and ordinary steering.

Preserve product terminology and semantic consistency across UI labels, accessible
names and help text. Registered agents and terminals are Vessels. The panel uses
Vessels and Previous vessels; lifecycle states do not replace the entity name.

Rank presentation derives from service assignments in `desktop/src/ui/hierarchy.js`.
Fleet membership is separate, local presentation data owned by `src/service/fleets.rs`;
`desktop/src/fleets.cjs` only calls its named service actions.
Cell geometry belongs in `desktop/src/layout.cjs`; native placement uses
`src/window_layout.rs`. Read `docs/fleets.md` before changing these boundaries.
Minimise retains the terminal; background closes it. Neither changes authority.
Panel size follows rendered content through ResizeObserver, capped to the display.
Do not reintroduce Vessel-count estimates or duplicate supervisor group headers.

The service-owned private conversation lives in `src/service/conversation.rs`.
Its desktop boundary is `desktop/src/conversation.cjs`; microphone/playback and
progressive chat belong in `desktop/src/ui/conversation.js`. Read
`docs/harness-runtime.md` before changing these boundaries. It is separate from
Vessel identity, capture and authority. Provider work must not block the service
loop; losing a desktop voice lease stops audio, not the runtime. Keep internal
reasoning unavailable to instance callers. Evidence and account data stay outside
the repository.

The private conversation's tool catalog is `src/service/conversation-tools.json`;
`conversation_tools.rs` maps those named operations to the existing service. Keep
the app owner, Vessel rank and no-tools escalation presenter distinct. The model
may explain evidence; only an actual human reply may be routed as an answer,
unchanged and bound to its original request. Recheck pending sources before speech.

Voice selection belongs in `src/service/voice.rs`; native terminal input belongs
in `src/terminal.rs`. Read `docs/voice.md` before editing either boundary. Native
input must target verified process and PTY identity, never desktop keyboard focus.

## Workspace and working documents

The primary checkout tracks `main`. Integration and packaging use separate task
worktrees. Rust checks are defined in CONTRIBUTING.md;
Electron commands are in desktop/package.json.

Linux packaging is owned by `desktop/scripts/package-linux.cjs`; its account-local
installer is `desktop/scripts/install-linux.cjs`. Read `docs/install-linux.md`.
Packaged main-process code locates Rust binaries in `process.resourcesPath/bin`;
development keeps `target/debug`. Never install login startup or restart existing
services implicitly. Prove the installed executable, not just a checkout launch.

Task worktrees belong in `.worktrees/`. Keep the selected revision stable until an intentional integration. Read the source and its applicable nested instructions before editing.

Development specifications belong at the repository root. Start at `SPEC.md`,
which indexes the named module specifications alongside it. Keep `docs/` for
technical documentation and guides. Use the canonical
`spec-driven-development` skill for specifications, `planning-and-task-breakdown`
for `tasks/plan.md` and its default `tasks/todo.md` task list, and the existing
build/incremental implementation and Git skills for execution and version control.
Keep those procedures unchanged for the first trial. Plan and implement one
capability at a time in the approved map order. The active plan and task list name
that capability; slices deliver complete, testable behavior rather than technical
layers. Later-capability notes are reference material, not an executable task queue.
Do not create plans before specification review or duplicate task status in
human-facing project notes.

Human-facing documentation lives at `/home/isaac/obsidian/Projects/voyagershellapp`.
Read its `status.md` for project navigation. Use `working-docs` for walkthroughs,
research, reviews and status/log maintenance there; link to the repository-owned
specifications and plans rather than maintaining editable copies. Its existing
explainer/, specs/, plans/ and research/ directories retain historical material;
this policy does not authorize a bulk migration of that history. Status and log
have one owner at the documentation root. This explicit destination policy takes
precedence over the current working-docs skill's broader placement defaults.

Use Voyager orchestration only when requested or called for by an approved plan. Project facts remain here; shared procedures remain in skills.
