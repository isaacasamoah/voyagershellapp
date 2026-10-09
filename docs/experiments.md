# First experiments: ownership and capture

9 October 2026. Tested on Fedora 43, Linux 6.18.9-200.fc43.x86_64, Rust 1.99.0 and Python 3.14.2. These are mechanism experiments, not a release of the planned service.

## E1: hand an existing terminal connection to Rust

Question: can a process started before Voyager continue after its original terminal owner exits, without restarting the process?

```text
before: fixture terminal owner ── PTY master ── already-running child

handoff: owner pauses reads → passes descriptor → Rust acknowledges
         owner closes its descriptor → confirms → exits

after:  Rust receiver ── same PTY ── same child PID
```

The Python fixture creates a real Linux PTY and child. It waits for the child's READY marker before starting the Rust receiver. After the owner exits, the test releases the child to print an AFTER marker with the same PID and ANSI color bytes. Rust forwards those bytes unchanged. No agent, model call, terminal emulator or tmux is involved.

**Observed:** the child produces its AFTER marker after the old owner exits, with the original PID. The receiver has the connection but has not become the process's parent. Its final report is `pty_closed outcome=unknown`; the fixture supervisor separately reaps the child and checks its exit status.

**Known-different arm:** the owner also sends SIGHUP to its own child's process group when closing. Even though Rust has the master descriptor, the child dies from SIGHUP and produces no AFTER marker. This is the evidence that descriptor transfer alone does not solve a terminal emulator's explicit kill policy.

Other boundary checks reject a non-PTY descriptor and a socket directory with group/other access. A second receiver cannot replace the first one's socket. The receiver checks the connecting user's identity and accepts exactly one descriptor. This is local-user isolation, not a sandbox against other programs running as that user.

The wire protocol is deliberately tiny: one `H` byte carrying the PTY master via SCM_RIGHTS; receiver validates and replies `+`; sender closes its copy and sends `D`. The test sender pauses all PTY reads before transfer. An interrupted handshake is an error, not a crash-safe transfer protocol.

## E2: capture alongside the native stream

Question: can a separate Rust collector record structured source events without constructing them from terminal rendering?

The synthetic input uses Pi-shaped `type` fields and tool-call IDs. The collector writes ordered envelopes with source ID, source ordinal, recorded time and the preserved source JSON. Task and session attribution stay null because this fixture has not established them. `agent_end`, `agent_settled` and input EOF do not create a successful task result.

**Observed:** six source records survive in order with a tool-call ID retained. The collector handles an actual Unicode U+2028 inside a JSON string; only LF splits records. An invalid, incomplete or oversized record produces a capture-gap record and a nonzero exit. Earlier records remain intact. The collector never overwrites an existing file; new evidence files are private to the user.

**Known-different arm:** while a handed-off child waits, the independent collector receives malformed input and exits unsuccessfully. The child can still produce its AFTER marker. This demonstrates separation between these two processes, not yet fault isolation in an integrated daemon. If storage itself fails, stderr/nonzero exit may be the only failure evidence; writing a durable gap is then not guaranteed.

The fixture collector preserves the supplied object rather than implementing a Pi adapter, a redactor or a semantic event classifier. It is explicitly for synthetic data. The 64 KiB per-record bound is an experimental framing limit, not a production retention policy. Total storage quotas, restart/deduplication, source authentication and real-data exclusions remain future service work.

## Reproduce

From the checkout, on Linux with Rust, a C linker and Python 3:

```sh
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

`cargo test` builds the Rust binary and runs eight black-box experiments in `tests/experiments.py`. The fixture supervisor becomes a child subreaper solely to reap its own processes after the original owner exits; no global kernel setting is changed. Temporary directories, fixture records, sockets and processes are cleaned up by the suite. There are no account credentials, model calls or live-session attachments.

To run just the handoff experiment after a build:

```sh
cargo build --locked
VOYAGER_PROBE="$PWD/target/debug/voyager-probe" python3 tests/experiments.py Experiments.test_existing_child_survives_cooperative_owner_exit -v
```

The low-level binary commands are `receive PRIVATE_DIR/socket` and `capture-fixture NEW_FILE SOURCE_ID`. The first blocks waiting for the cooperative fixture protocol and streams PTY output to stdout. It does not yet forward keyboard input, resize a terminal, reconnect clients or survive a broken output pipe. The second consumes synthetic JSONL on stdin and flushes each record to a new file. Prefer the fixture suite; neither command is ready to manage real work.

## Decision from this evidence

Cooperative handoff is a viable Linux primitive. A real integration must still coordinate the original terminal's I/O and shutdown policy, preserve interactive input/resize and restore its display connection. Keeping work alive when a client disconnects remains a separate product test. No Ghostty/Ptyxis integration, arbitrary process adoption, macOS support, audio capture or actual harness-event adapter has been proved.

The next increment should target one supported terminal/harness pair. Event capture should use that harness's structured observations alongside the native interface. Knowledge extraction, Electron docking and remote orchestration remain outside these experiments.
