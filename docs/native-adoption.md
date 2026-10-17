# Adopting existing native work

The feature branch adds adoption through the Electron avatar. Dragging onto a supported Ghostty window asks the Rust service to retain its existing Bash PTY, register the instance and select human control. It preserves the original process. It does not restart the shell or replace its interface.

The current proved target is Linux x86_64, X11/XWayland, Ghostty 1.1.3 and Bash, with one terminal surface in that Ghostty process. Adoption of unmodified Codex remains unproved. Other shells, multiple panes/windows in one Ghostty process, native Wayland and macOS are not established by this experiment.

## Codex acceptance

The app must work with normally installed, unmodified Codex. A source patch,
custom build or pinned replacement binary does not satisfy this requirement.
The existing [frontend bridge experiment](../integrations/codex/README.md) proved
parts of the mechanism, but is not the selected distribution approach.

Codex must pass the same native journey as Bash: independent launch, avatar drop,
exact identity, control, future capture, undock, normal viewer close while work
continues, same-instance reopen, and selected stop/removal. It must also launch
a worker and refuse a stale binding after the displayed conversation changes.
A similar unrelated window and conversation must remain unaffected. No prepared
title, launch metadata, model prompt or manual conversation selection may supply
the identity. Capability checks may refuse an unsupported installed version;
they must not silently choose a likely conversation.

## User actions

| Action | Effect |
| --- | --- |
| First avatar drop | Verify the exact window, acquire the native handoff, register capture, select control |
| Undock | Release control; runtime and capture continue |
| Background | Close the original viewer; retain the existing shell and foreground work |
| Open | Open a native Ghostty viewer onto that same PTY |
| Stop | Stop the selected runtime and close its viewer |
| Remove | End registration and capture; retain historical events |

For Codex, stop archives the selected conversation and stops its frontend and enclosing shell. It leaves the shared app-server daemon and unrelated conversations running. Archived conversation history remains available through Codex.

The CLI exposes `inspect-window WINDOW_ID` for a read-only identity check and `adopt WINDOW_ID REQUEST_ID` for the same adoption operation used by Electron. A repeated request ID returns its recorded result; changed inputs are refused. These commands are for the service contract and diagnostics. The user gesture needs neither a conversation ID nor a special terminal title.

## Mechanism and alternatives

| Approach | Observation |
| --- | --- |
| Keep only a duplicate PTY master | Ghostty still sends HUP and waits for its shell to exit |
| Ask Bash to ignore HUP | Preserves Bash but leaves Ghostty waiting during close |
| Move the process to another PTY | Disrupts the original viewer and terminal state |
| Launch through Voyager | Works for new work; does not adopt existing work |
| Retain the PTY and intercept Ghostty's exact shutdown handshake | Preserves the original shell and lets the original viewer close; selected for this prototype |

Voyager resolves the X11 window PID, verifies UID/process start/session identity, finds the unique Bash slave TTY and matching Ghostty master, then retains pidfds and duplicates the master. No title, folder or transcript recency is used as identity.

A dedicated Linux ptrace thread observes terminal I/O. It suppresses only Ghostty's HUP to the selected Bash process group and supplies the corresponding nonblocking wait acknowledgement. Ghostty remains the sole PTY reader until its process exits; Voyager then takes over reading and relays bytes to a native viewer. This is a version-specific debugger integration, not a public Ghostty handoff API.

Ghostty's native close confirmation is handled through AT-SPI only for the adopted process while its handoff tracer is active. The adapter matches the exact close dialog and its Yes action. It changes no global Ghostty setting. Python 3, PyGObject and AT-SPI are required for this small native adapter.

The [pinned Ghostty shutdown source](https://github.com/ghostty-org/ghostty/blob/889478f310c9a531327b14a380ea56dbc602eb82/src/termio/Exec.zig#L1256) explains the HUP/wait behavior. The earlier failed Bash-only experiment is retained in `experiments/adoption_probe.py`; it is not the product mechanism.

## Capture and identity

Bash command boundaries come from Ghostty's shell integration markers. They are observations of native output, not authenticated claims about command semantics. Agent commands require a foreground Bash prompt with no draft. The prototype reads Bash's exported readline state; unexpected mappings or missing symbols fail explicitly.

The earlier Codex bridge identifies the displayed conversation through its own frontend event loop. Capture and instructions then use the existing app-server connection. Voyager checks the identity again before sending. Switching the frontend to another conversation is not permission to send to that new conversation. Replacing that bridge with an unmodified-Codex mechanism is the current open problem.

## Proof and limits

The 17 October 2026 native run passed against source `51b1ede`, using a custom
Codex build. It does not establish the unmodified-Codex acceptance above:

| Journey | Observed result |
| --- | --- |
| Bash | Avatar drop, fade, hover, undock, command capture, draft refusal, foreground-job persistence, same-PID/environment reopen and stop/remove |
| Codex | Avatar drop, worker launch with the adopted parent ID, task completion after close, same-thread reopen, re-docking, capture cutoff and stop |
| Isolation and failures | A similar unrelated terminal remained usable; released tracing left native input usable; repeated adoption was idempotent; stale windows, changed request inputs and malformed viewer input were refused |

A separate service run verified that selected-thread stop left unrelated loaded Codex conversations available. The ordinary Rust and Electron checks passed. A desktop refresh race found during worker shutdown was fixed: a single ended instance no longer clears the window inventory or undocks its parent.

These observations do not establish frontend reconnection, native conversation-switch interaction, microphone behavior or recovery after a service crash. The existing identity checks refuse a changed conversation. Physical drag feel and sound still benefit from human review.

Run ordinary checks without opening windows:

```sh
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cd desktop && npm run format:check && npm test
```

From a GNOME graphical terminal, run the native proof separately:

```sh
cargo build --locked --bins
python3 experiments/run_adoption.py /absolute/path/to/integrated/codex
```

The driver creates a fresh private `/tmp/vsad-*` service, opens disposable ordinary Ghostty windows and submits real Codex requests. It temporarily moves the desktop pointer. It needs `xdotool`, ImageMagick and the GNOME D-Bus input interfaces. Optional `VOYAGER_PROOF_MONITOR=CONNECTOR` adds compositor screenshots through GStreamer/PipeWire. Native gesture checks currently require uniform Electron-reported display scale.

The output directory holds `adoption-proof.json` and native screenshots. A `rework` result exits nonzero and leaves evidence for inspection. It never uses the live user service. The standalone binary includes normal CLI/server commands as well as the frontend identity bridge.

Kernel policy may prohibit pidfd duplication or ptrace. Voyager does not lower that policy or grant itself privileges. The observed host already allowed same-user tracing. This prototype does not recover retained PTYs after service crash/reboot and does not claim broad terminal compatibility.

## Code ownership

- `src/adoption.rs`: verified process handles, PTY identity and tracer handshake.
- `src/native_instance.rs`: native runtime, byte relay, shell observations and Codex identity checks.
- `src/service/adopt.rs`: adoption request and service registration.
- `src/service/lifecycle.rs`: existing lifecycle operations for launched and adopted instances.
- `integrations/ghostty/confirm_close.py`: scoped native close-dialog action.
- `desktop/src/main.cjs`: discovery, avatar drop and presentation.

Unsafe calls stay at Linux process/PTY boundaries. Successful raw descriptors immediately become owned `File` values. Remote memory reads use bounded buffers, and retained pidfds prevent PID reuse from redirecting signals. No ptrace option kills the target when the tracer exits. Recovery and backpressure limits remain explicit prototype work.
