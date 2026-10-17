# Codex native identity integration

The adoption prototype needs the conversation currently displayed by a specific native frontend. The stock app-server protocol lists conversations but does not bind one to a desktop window. Matching titles, folders or recent transcripts cannot establish that identity.

This small frontend patch publishes a private, read-only Unix socket. Voyager verifies its peer UID and PID, then asks the frontend's own event loop for the displayed conversation and app-server endpoint. It does not insert a prompt, create a conversation or change permissions.

Pinned source: [Codex rust-v0.163.0, 83086188](https://github.com/openai/codex/tree/83086188ae0614bd882818ff1aa23f3194962012).

Build a separate integration binary:

```sh
git clone https://github.com/openai/codex.git codex-voyager
cd codex-voyager
git checkout 83086188ae0614bd882818ff1aa23f3194962012
git apply /absolute/path/to/voyagershellapp/integrations/codex/native-identity.patch
cd codex-rs
RUSTUP_TOOLCHAIN=stable CARGO_BUILD_JOBS=4 CARGO_PROFILE_DEV_DEBUG=0 cargo build -p codex-cli --bin codex
```

The pinned tag's lockfile still records workspace package version `0.0.0`, so this build refreshes those workspace version entries. Keep the resulting lockfile with the build evidence. The tested compiler was Rust 1.99.

Run `target/debug/codex` in your normal Ghostty Bash shell, or deliberately add a `codex` symlink to it in your chosen PATH. This repository does not replace your installed Codex or restart its shared daemon. Start a conversation, then drag the avatar onto that terminal.

This is an explicit prototype integration, not stock Codex support. Only local Unix app-server connections are accepted. Frontend reconnection and empty conversations remain to be verified. A missing or stale bridge refuses adoption; it does not fall back to guessing.
