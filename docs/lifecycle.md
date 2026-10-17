# Instance lifecycle

The Rust service owns lifecycle decisions. The panel and CLI call the same
operations. Registration, runtime, window and docking are separate state.
See the [CLI reference](service.md#commands) for command syntax.

## Actions

| Action | Runtime | Native window | Registration |
| --- | --- | --- | --- |
| Create / launch | Starts an owned instance | Opens by default; `--background` skips it | Starts capture |
| Adopt | Retains the existing runtime | Keeps the original viewer | Starts future capture |
| Open | Keeps the same runtime | Focuses or reopens its viewer | Unchanged |
| Background | Keeps working | Closes the owned viewer | Capture continues |
| Stop | Stops the owned runtime | Closes its viewer; `--runtime-only` skips explicit close | Retained |
| Remove | Unchanged | Unchanged | Ends future capture and instruction routing |
| Stop and remove | Stops, then closes | Closure is confirmed before removal | Deregisters; history remains |
| Register again | Keeps existing work | Unchanged | Resumes future capture explicitly |

Creation validates an existing absolute folder, kind and short name. `create`
starts without a task; `launch` requires an active parent and submits one task.
An accepted task is not a completed task.

Active `list` excludes removed instances; `--include-removed` returns history.
Removed live owned instances remain in the panel's Unregistered section so their
owner can open or stop them. Stopped-and-removed instances disappear from the
panel. Removal neither deletes events nor stops children.

## Receipts and retries

Every action has an immutable request ID and input set. Results distinguish
`pending`, `completed`, `partial` and `uncertain`, with observed runtime, window,
registration and effects. The service returns promptly; the CLI polls
`operation REQUEST_ID`. Electron remains asynchronous.

Repeating identical inputs with the same ID returns the saved result. Changed
inputs fail. An uncertain action is not replayed automatically. Failed opening
can be repaired by a new `open` on the same instance, without launching another
runtime. Restart marks unfinished actions uncertain and never restores ownership.

## Window and process ownership

Launched instances retain live child handles. Adopted instances retain verified
pidfds, the existing PTY and a confirmed native shutdown handoff. Stored PIDs
alone do not establish lifecycle control. External registration without that
handoff remains distinct and cannot use owned lifecycle actions. See
[native adoption](native-adoption.md) for its integration requirements and limits.
The daemon refuses shutdown while any owned runtime is live, including removed
instances.

Stop signals the exact owned runtime, observes exit, and may escalate within its
process group after two seconds. Bash receives HUP so it can forward it to jobs;
independently disowned or escaped processes are outside this contract.

Each viewer has a retained child or adopted process handle and its exact X11 window ID. Mapping requires
one window belonging to the live child; ambiguous or unidentified windows fail.
Focus uses `_NET_ACTIVE_WINDOW` and confirms the request, not keyboard focus.
Close uses `_NET_CLOSE_WINDOW`; completion means that mapped window is gone.
Ghostty may remain resident afterward. A known closed viewer can be reopened
without restarting the runtime; an unidentified opening is not guessed away.

Voyager launches dedicated Ghostty XWayland clients with
`--confirm-close-surface=false`. Closing that viewer detaches from service-owned
work. Global settings are untouched. Adopted Ghostty windows keep their existing
configuration; the adapter confirms their own close dialog after handoff. See
[Ghostty's configuration](https://ghostty.org/docs/config/reference#confirm-close-surface).

## Capture cutoff

Removal commits its cutoff and `session.removed` event in one transaction; failed
writes roll back. Observations must match an active registration and its capture
generation. Late or queued content cannot resume recording after removal.
Administrative lifecycle events may still describe stopped or removed work.

Codex re-registration creates a fresh observation connection without importing
snapshot turns. An adopted empty Codex conversation may instead read future
records from its exact native transcript; see [the adapter](../integrations/codex/README.md).
Stopping an adopted Codex instance uses a separate native request connection,
so removal or failure of its capture source cannot cancel the stop operation.
Bash requires a clean idle prompt with no pending command,
partial input or incomplete hook frame. Its removed-period buffer is discarded.
Opening a window never implicitly registers it.

## Implementation boundaries

`service.rs` owns the store and runtime/window maps. Private `service/lifecycle.rs`
progresses typed actions; `service/native.rs` progresses native requests. Startup
helpers return connections and metadata without mutating the store. Waiting
phases advance between capture passes, keeping other instances responsive.
JSON stays at protocol and storage boundaries.

The private socket is locked, bounded and same-UID checked. SQLite version-one
migration is transactional; unsupported newer schemas are refused before writes.
PTY ioctl calls use live descriptors and valid pointers. Post-fork setup uses
async-signal-safe calls only; inherited hook descriptor nine is intentional.
Uncertain or incomplete shell writes are never replayed, and human typeahead
remains protected. Rust's `Child` does not stop a process merely when dropped;
Voyager's runtime owner handles cleanup explicitly.

## Native checks

Normal Cargo/Electron tests use fixtures and real PTYs without model calls.
The [panel lifecycle proof](../desktop/README.md#lifecycle-experiment) uses two
real Bash/Ghostty instances. It checks menu hit testing, background/reopen,
already-closed viewers, stop, capture cutoff, re-registration, and row removal.

The separate Codex check uses real native tasks, managed and external capture,
background completion, same-runtime reopen, removal and stop refusal:

```sh
VOYAGER_NATIVE_PROOF_DIR="$HOME/.local/share/voyager-native-lifecycle-proof" \
  cargo test --locked --test native_lifecycle -- --ignored --nocapture
```

Use a fresh private directory. Physical gestures, menu readability and sound
still require a person. These checks do not establish other platforms, role
authentication, voice handoff or crash/reboot recovery.
