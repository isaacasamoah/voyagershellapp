# Working on Voyager Shell

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

Rank presentation derives from service assignments in `desktop/src/ui/hierarchy.js`.
Fleet membership is separate, local presentation data in `desktop/src/fleets.cjs`.
Cell geometry belongs in `desktop/src/layout.cjs`; native placement uses
`src/window_layout.rs`. Read `docs/fleets.md` before changing these boundaries.
Minimise retains the terminal; background closes it. Neither changes authority.
Panel size follows rendered content through ResizeObserver, capped to the display.
Do not reintroduce Vessel-count estimates or duplicate supervisor group headers.

The opt-in private-runtime experiment lives in `examples/harness-runtime/` and
`desktop/experiments/harness/`; its contract is `docs/harness-runtime.md`.
It has no public service action for internal reasoning and does not change normal
startup. Keep its test evidence and account data outside the repository.
