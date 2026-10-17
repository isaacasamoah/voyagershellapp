# Native adoption experiment

This branch investigates adopting work that Voyager did not launch. It does not add adoption to docking yet. Existing registration and lifecycle behavior are unchanged.

## Design

A drop should resolve the exact native window, acquire lifecycle control, start capture and select human control. Background, reopen, send, stop and remove must then operate on that same instance. Keeping a PID or registering a conversation alone does not meet that contract.

| Alternative | Tradeoff | Result |
| --- | --- | --- |
| Retain the existing PTY and cooperate with Bash | Preserves shell identity and native interface without moving its descriptors | Does not overcome Ghostty's shutdown ownership |
| Steal the PTY | Can retain the shell, but disrupts the original viewer | Earlier probe required forcibly terminating that viewer |
| Launch through Voyager first | Already supports persistence | Does not adopt independently started work |
| Explicit terminal/provider handoff | Can transfer the relevant ownership deliberately | Required capability remains to be implemented or integrated |

The initial recommendation was to test Bash cooperation before changing service ownership. The native result rejects that mechanism for the full Ghostty lifecycle. The next design decision is an explicit terminal handoff integration, rather than treating duplicated descriptors as adoption.

## Rust inspection

```sh
cargo build --locked --example adoption_inspect --bin voyager-windows
cargo run --locked --example adoption_inspect -- WINDOW_ID
```

Use a decimal X11 window ID from `target/debug/voyager-windows`. This diagnostic accepts a separate Ghostty XWayland window running ordinary Bash. It uses no session ID, title or working directory as identity. Multiple windows on the terminal process, multiple direct children, a different user, stale processes, a non-Bash child or an ambiguous PTY fail explicitly.

It resolves the window owner, opens pidfds, checks process start/session identity and duplicates the single matching PTY master. `TIOCGPTN` verifies the duplicated descriptor against Bash's slave TTY. It emits `not_adopted`, then releases its handles. `--retain` holds them until stdin closes; the only input command is `status`, which polls the retained process handles. It never sends signals or writes terminal input.

The inspection is a snapshot. It does not prove a current Codex conversation, exclusive terminal input, command capture or a completed ownership transfer. A same-user application can change after inspection. The experiment stays outside the live service until it establishes the required handoff.

Linux `pidfd_getfd` is permission controlled. Refusal is an experimental limit, not a reason to lower ptrace policy or grant Voyager extra privileges. The native run used the machine's existing `ptrace_scope=0`; a normal installation may refuse it.

## Native reproduction

Requirements: Linux x86_64, Ghostty, an X11/XWayland desktop, `xprop`, system Python with PyGObject, and the existing kernel permissions for duplicating the disposable terminal's master. Run in your graphical login environment:

```sh
cargo build --locked --example adoption_inspect --bin voyager-windows
/usr/bin/python3 experiments/adoption_probe.py /absolute/fresh/private/proof-directory
```

The driver opens two disposable windows sequentially with ordinary Bash startup. The per-launch X11 and single-instance flags isolate its windows; no conversation IDs, special matching titles or agent prompts are provided. Each shell acknowledges its HUP handler through a private marker before closure is requested. The Rust process holds the original master without reading it. The driver verifies the exact GTK owner before requesting normal native close, polls the retained pidfds, writes `result.json` and cleans up only its own processes. It performs no model calls and changes no global settings. Do not use the marker or the driver's command injection as a proposed discovery or user integration mechanism.

Observed with Ghostty 1.1.3 on Fedora:

| Shell handling | Normal close | Same shell after close |
| --- | --- | --- |
| Catch HUP with a handler | Completes | Exits |
| Ignore HUP | GTK request times out; terminal process remains | Survives |

A rework result exits with status 2; it is not an adoption acceptance pass.
Neither result establishes graceful persistent adoption. The second result is not success just because its visible window disappears.

[Ghostty's pinned shutdown implementation](https://github.com/ghostty-org/ghostty/blob/889478f310c9a531327b14a380ea56dbc602eb82/src/termio/Exec.zig#L1256) repeatedly sends HUP to the child's process group and waits for the child to exit. The inference is that a Bash-only integration cannot supply a clean close handoff against this implementation. Voyager must cooperate with the terminal's lifecycle owner or change the accepted behavior.

## Codex boundary

The installed Codex 0.163.0 uses a shared app-server daemon by default. Its generated protocol provides conversation and turn operations, but this investigation has not found a verified ordinary frontend-to-current-conversation mapping or a complete per-conversation stop operation. Stopping the shared daemon would affect unrelated work. Interrupting a turn or unsubscribing one connection does not establish the requested lifecycle parity.

The service must not claim managed ownership for either target until its adapter establishes the actual handoff. This experiment leaves the existing desktop matcher intact.

## Code contracts

`examples/adoption_inspect.rs` owns its descriptors with Rust `File` values. The unsafe calls are Linux `pidfd_open`, `pidfd_getfd`, `poll` and `ioctl`. Only successful descriptor results become `File`s; polling uses a live pidfd; `TIOCGPTN` receives a valid writable unsigned integer. These calls do not alter the target process or original descriptor. The probe assumes Linux `/proc` and refuses unexpected identities instead of falling back to a title or recent transcript.

`experiments/adoption_probe.py` owns all mutated resources. Its duplicate master is used only to establish a handler in its disposable shell. The ignored-HUP case requires explicitly stopping that shell during cleanup so Ghostty can finish closing. Failure evidence is retained, not presented as a product feature.
