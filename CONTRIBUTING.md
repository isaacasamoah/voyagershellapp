# Building and learning together

Voyager is early. Small, reproducible experiments are more useful than a large architecture committed before we have used it.

An issue can describe a workflow you want, a failure you observed, or an integration capability we should test. Include your operating system and harness version, exact steps, expected behavior and what actually happened. Remove personal content, credentials and private repository details from examples.

For a change, keep the scope to one experiment. Explain who can use it, the observation that would disprove it, how you tried it, and what it still does not handle. Open an issue before a substantial new subsystem so we can agree on the problem together.

Areas we want to learn about:

- Connecting to agents already running in ordinary terminals.
- Cooperative process/terminal ownership transfer without replacing native agent interfaces.
- Reliable task and turn identity across different harnesses.
- Useful event capture that preserves evidence and respects privacy.
- A small Rust codebase that is approachable to people learning Rust.

We learn from other projects and credit the specific ideas. Do not upload third-party proprietary code, private traces or material you cannot share. Contributions are under the repository's MIT license.

For Rust changes, run `cargo fmt --check`, `cargo test --locked`, and `cargo clippy --locked --all-targets -- -D warnings`. The current test suite is Linux-only and needs Python 3 for disposable process fixtures. Explain the limit of a fixture result; it does not replace trying the real native harness.

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
  and explain an invariant when it is not obvious.
- Prefer safe Rust and borrowed inputs. Use `unsafe`, `Arc`, locks and background
  tasks only when the primitive requires them, with its contract made clear.
- Let rustfmt handle layout and Clippy flag common mistakes. Test observable
  behavior and a failure case; do not add tests that merely restate the code.
- Keep dependencies tied to an immediate need. Commit lockfiles for this app.
- Explain why a non-obvious choice exists. Update the runnable example and
  measured limitations in the same change as the implementation.

The book's chapters on [errors](https://doc.rust-lang.org/book/ch09-00-error-handling.html)
and [tests](https://doc.rust-lang.org/book/ch11-00-testing.html) are good starting
points. Current code is an evolving experiment, not a claim that every existing
boundary is already ideal.

For the Electron client, use Node 24 and run `npm ci`, `npm run format:check` and
`npm test` inside `desktop/`. Normal checks do not open windows or call a model.
The optional live proof is a separate, deliberate action; see
[the desktop experiment](docs/desktop.md).

## Review and preservation

Work on a branch and open a PR. `main` requires one approving review; repository
admins retain an explicit bypass. The bypass is for a deliberate owner decision,
not the normal development path. Force pushes and deletion of `main` are disabled.
Automated checks run on PRs and feature branches. A green run does not establish
native desktop behavior, and a draft PR does not mean a feature is released.
