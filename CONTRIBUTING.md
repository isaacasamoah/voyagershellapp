# Building and learning together

Voyager is early. Small, reproducible experiments are more useful than a large architecture committed before we have used it.

You can contribute without writing code. Try a real workflow, report a confusing
step, improve a setup instruction, or describe an agent/terminal integration you
would use. Start with [the README](README.md) to install and run the app, and
[the capability reference](docs/capabilities.md) to see what is available.

An issue can describe a workflow you want, a failure you observed, or an integration capability we should test. Include your operating system and harness version, exact steps, expected behavior and what actually happened. Remove personal content, credentials and private repository details from examples.

For a change, keep the scope to one experiment. Explain who can use it, the observation that would disprove it, how you tried it, and what it still does not handle. Open an issue before a substantial new subsystem so we can agree on the problem together.

Areas we want to learn about:

- Connecting to agents already running in ordinary terminals.
- Cooperative process/terminal ownership transfer without replacing native agent interfaces.
- Reliable task and turn identity across different harnesses.
- Useful event capture that preserves evidence and respects privacy.
- A small Rust codebase that is approachable to people learning Rust.

We learn from other projects and credit the specific ideas. Do not upload third-party proprietary code, private traces or material you cannot share. Contributions are under the repository's MIT license.

## Set up a change

Follow [the source setup](README.md#get-started), then install Python 3.11+ for
the disposable process fixtures. Read [AGENTS.md](AGENTS.md) and
[CONSTRAINTS.md](CONSTRAINTS.md) before editing. The constraints define the test
budget, native proving fixture, review size, and acceptance rules. Do not weaken
them to make a change pass.

Keep your work on a branch. From the repository root, for example:

```sh
git status --short --branch
git switch -c feat/describe-your-change
```

Inspect existing changes before switching branches or editing, and preserve other
people's work. If using a task worktree, place it under `.worktrees/` and keep its
selected revision stable until an intentional integration.

For a substantial capability, start at [SPEC.md](SPEC.md). Specifications live at
the repository root. Review the specification before planning, and plan one
capability at a time in its approved order. The active plan is `tasks/plan.md` and
its default task list is `tasks/todo.md`. A specification's approval does not
authorize implementation, merging, installation, or a runtime restart.

## Run the checks

Run the relevant checks from the repository root. For Rust changes:

```sh
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

For desktop changes, use Node 24:

```sh
npm --prefix desktop ci
npm --prefix desktop run format:check
npm --prefix desktop test
```

The current Rust test suite is Linux-only and needs Python 3.11+ for disposable
process fixtures. Normal Cargo and desktop tests make no model calls and do not
open desktop windows. Explain the limit of a fixture result; it does not replace
trying the real native application.

Changed behavior needs a meaningful failure comparison as well as a successful
journey. Follow the constraint file's test-size accounting and review requirements.
Native checks open real windows and can use an authenticated model account. Choose
the relevant journey from [the desktop guide](desktop/README.md#testing-changes)
and [lifecycle checks](docs/lifecycle.md#native-checks), use deliberate isolated
state, and retain private evidence outside Git. Audible output and physical
gestures require their own evidence. Linux results do not establish macOS or
Windows support.

## Small, readable Rust

Start with the [Rust book](https://doc.rust-lang.org/book/) and use the
[Rust API Guidelines](https://rust-lang.github.io/api-guidelines/about.html) as
guidance, not a reason to build a framework. In this project:

- Prefer ordinary functions, small modules and explicit ownership. Introduce a
  trait or generic abstraction when there is a real second implementation.
- Represent meaningful states with types and enums. Keep JSON at protocol and
  persistence boundaries; do not turn every internal operation into a string command.
- Return `Result` for expected filesystem, socket and process failures. Add
  context at a useful boundary. Reserve panic/unwrap for established invariants,
  and describe non-obvious invariants in the owning context document.
- Prefer safe Rust and borrowed inputs. Use `unsafe`, `Arc`, locks and background
  tasks only when the primitive requires them, with its contract made clear.
- Let rustfmt handle layout and Clippy flag common mistakes. Test observable
  behavior and a failure case; do not add tests that merely restate the code.
- Keep dependencies tied to an immediate need. Commit lockfiles for this app.
- Keep changed source comment-free. Explain non-obvious choices, unsafe
  contracts and boundary invariants in the owning context document. Update the
  runnable example and measured limitations with the implementation.

The book's chapters on [errors](https://doc.rust-lang.org/book/ch09-00-error-handling.html)
and [tests](https://doc.rust-lang.org/book/ch11-00-testing.html) are good starting
points. Current code is an evolving experiment, not a claim that every existing
boundary is already ideal.

## Desktop conventions

The optional live proof is a separate, deliberate action; see
[the desktop experiment](docs/desktop.md).
The [desktop source map](desktop/README.md) explains the main process, preload
and browser-side UI. Prefer plain functions and a small number of files. Native
window behavior needs a desktop check; renderer-only tests cannot prove it.

## Source ownership and documentation

| Location                                                   | Responsibility and context                                                                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/service.rs`, `src/service/`                           | One state owner, lifecycle, native requests, recovery, private conversation, and Fleets. Read [lifecycle](docs/lifecycle.md) before changing runtime/native boundaries. |
| `src/authority.rs`, `src/service/authority_ops.rs`         | Rank, direct assignments, bound identity, and capabilities. Read [authority](docs/authority.md).                                                                        |
| `src/terminal.rs`, `src/window_layout.rs`, `src/viewer.rs` | Verified process/PTY/window operations and viewer choice. Read [voice](docs/voice.md) and [Fleets](docs/fleets.md) for their boundaries.                                |
| `src/bin/`                                                 | Rust CLI and native window helper. Clients expose service decisions; they do not grant rights.                                                                          |
| `desktop/src/`                                             | Electron main, preload, and UI. See [the desktop source map](desktop/README.md#source-map).                                                                             |
| `tests/`, `desktop/test/`                                  | Service-boundary tests, desktop tests, and opt-in native journeys.                                                                                                      |
| `docs/`                                                    | Public technical contracts, run guides, and capability reference.                                                                                                       |
| `SPEC*.md`, `tasks/`                                       | Authoritative specifications, active plan, and task evidence.                                                                                                           |
| `skills/`                                                  | Agent instructions for the service and CLI.                                                                                                                             |

Keep the Rust service and CLI separate from native agent interfaces and Electron
presentation. Preserve process ownership, connections, captured events, and derived
knowledge as distinct concepts. Do not add a terminal UI or substitute tmux or
Herdr for the backend. Registration does not transfer ownership of an external
process. Detach keeps managed work running; explicit Stop targets only owned work.
Never automatically resubmit work or restore a process after an uncertain failure.

Update the README when supported behavior changes. Keep its current-system diagram
grounded in the selected source revision. Keep the proposed diagram tied to reviewed
specifications or explicit owner direction, with unapproved designs labeled. Move
verified changes into the current view as they land. Public documentation must
work without private vault files, transcripts, credentials, or personal paths;
use pinned public source links for code claims.

Project-maintainer walkthroughs and status notes have a separate Obsidian home,
identified in [AGENTS.md](AGENTS.md). They link to repository specifications and
plans rather than duplicating those contracts. Contribution does not require
access to that private workspace or the maintainer's agent skills.

## Review and preservation

Work on a branch and open a PR. `main` requires one approving review; repository
admins retain an explicit bypass. The bypass is for a deliberate owner decision,
not the normal development path. Force pushes and deletion of `main` are disabled.
Automated checks run on PRs and feature branches. A green run does not establish
native desktop behavior, and a draft PR does not mean a feature is released.

Keep a PR focused on one complete behavior. Explain the problem, resulting behavior,
checks performed, native evidence, and remaining limits. Include a known-different
case for behavior changes and the constraint file's required counts. Never commit
local state, credentials, private planning notes, transcripts, or terminal recordings.
Use readable links to the relevant specification and evidence. Merge and rollout
remain explicit owner decisions.
