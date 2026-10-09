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
