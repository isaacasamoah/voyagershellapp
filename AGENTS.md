# Working on Voyager Shell

Voyager is an experimental Rust service around existing native agent interfaces. Electron is a later client. Preserve that product boundary: do not add a terminal UI, run tmux or Herdr as a backend, or pretend registration transfers process ownership.

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
