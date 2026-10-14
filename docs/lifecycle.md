# Instance lifecycle

The lifecycle experiment separates a registered instance, its running process,
and its native terminal window. Registration decides whether Voyager captures
and orchestrates it. Owning a process permits stopping it. A window is a client,
so closing it does not stop work. Docking is a separate human control attachment.

The [CLI reference](service.md#commands) is the command surface. The panel calls
that same surface through named preload/IPC methods. There is no second frontend
implementation of process shutdown or registration.

## Inputs and results

Creation requires a request ID, kind, short name and existing absolute folder.
The service validates and canonicalizes the folder before starting a process.
`create` starts no initial task. `launch` requires an active parent and a task;
it submits once, waits for native acceptance, then opens a viewer. Both open by
default; `--background` is the explicit alternative.

`open` reuses the exact live owned terminal or opens one for the same runtime.
`background` closes only that owned viewer. `stop-instance` stops its owned
runtime and then closes its viewer; `--runtime-only` omits the close phase.
`remove` ends registration and future conversation/command capture, releases
its current control attachment and retains history. Runtime and window remain.
`remove --stop` completes stop and close before deregistration. Removal does not
delete historical records, stop children, or affect other instances.

The active `list` excludes removed instances. `--include-removed` includes their
retained records. Removed live owned instances remain in the panel's separate
Unregistered section; an owner can open or stop them. Opening never registers
them. Only `register-instance` deliberately resumes future capture.

Every lifecycle action has an immutable request ID and input set. The CLI
generates an ID unless `--request-id` supplies one; create/launch use their
positional ID. Saved operations contain action, session, runtime/window/
registration state, completed or requested effects, and the final event sequence.
The service returns `pending` promptly. The CLI polls `operation REQUEST_ID`
and prints the final result. Electron stays asynchronous during that wait.

States are `pending`, `completed`, `partial` or `uncertain`. An action completing
does not mean an agent task completed. `initial_request.state: accepted` is only
native task acceptance; observed turn/command events carry task outcomes.
Repeating the same ID and inputs returns its saved result, never replays effects.
Changed inputs with that ID fail. A new-ID `open` can repair a failed opening
without launching another instance. A restart makes interrupted operations
uncertain, rather than rerunning them.

An existing-window result confirms a focus request reached X11. It does not
claim the compositor gave keyboard focus. A new-window result requires the
launched child to be live and its exact window to be mapped. A close result
requires both client exit and window disappearance. Deadline expiry preserves
an incomplete result, including any effects that already happened.

## Ownership and execution

`service.rs` owns the store, runtime maps and service loop. Its private
`service/lifecycle.rs` implements creation and action progression;
`service/native.rs` progresses native discovery/registration/submission.
`actions.rs` defines typed actions and phases. JSON remains at wire/storage
boundaries. There is no new async runtime, global mutable registry or trait
framework.

The service advances bounded operations between capture passes. Waiting for
startup, native replies, stop or window closure does not block another
instance's capture/status. Native socket initialization is performed by an
owned helper thread; it returns a connection and metadata. That thread never
writes the store or changes runtime maps. Failed startup cleanup may briefly
wait while dropping its owned process; it does not adopt a replacement.

Each created runtime has a live `Child` handle. Normal stop signals that exact
owned runtime, observes exit, and escalates its owned process group after two
seconds if necessary. An external registration can be removed, but cannot be
stopped, backgrounded or opened through owned-runtime actions. Stop-and-remove
of an external instance refuses unchanged. Stored PIDs never establish ownership;
service restart leaves earlier runtimes unknown. Daemon `stop` refuses while an
owned runtime remains live, including removed instances.

Codex server ownership and native connection ownership are separate. A shell
owns a Bash child and PTY; its attach client carries bytes, without running
commands in a second shell. Bash stop sends HUP so Bash can forward it to jobs;
independently disowned or escaped processes are outside this contract.

Ghostty runs a dedicated XWayland client process. The service checks its live
`Child` before finding the one X11 window with that PID. Missing or multiple
matches fail instead of choosing by title. Close uses `_NET_CLOSE_WINDOW`;
focus uses `_NET_ACTIVE_WINDOW`. Voyager-created clients start with per-launch
`--confirm-close-surface=false`: they display service-owned work, so closing the
viewer is a detach. No global Ghostty setting changes, no existing terminal is
reconfigured, and no confirmation dialog is answered automatically. See
[Ghostty's option reference](https://ghostty.org/docs/config/reference#confirm-close-surface).

`Child::try_wait` observes/reaps without waiting for an unfinished process.
Dropping Rust's standard `Child` alone does not stop it; Voyager's process
owner therefore handles runtime cleanup explicitly. See the
[standard-library contract](https://doc.rust-lang.org/std/process/struct.Child.html).

## Capture cutoff and recovery

Every observation carries its source's capture generation. The store accepts it
only when the instance is registered and its generation still matches. Removal
sets a durable cutoff. Late native observations and queued shell boundaries
cannot restore capture. Administrative lifecycle records may still describe
removal or stopping; no later conversation/command content is captured.

Re-registering Codex establishes a fresh native observation connection, resumes
the same conversation without snapshot turns, drains pre-acknowledgement
notifications, and increments the generation. The previous subscription cannot
gain that generation. Re-registering Bash requires an idle prompt, no pending
command, no partially entered line and no incomplete hook frame. Its output
buffer is cleared on removal and is not retained while removed. Existing
history remains; only future content resumes.

SQLite schema version one adds cutoff/generation and operation records.
Version-zero migration runs transactionally and rolls back on failure; a newer
unsupported version is refused before mutation. This is forward migration,
not permission to run an older binary on this database. Crash/reboot recovery,
process adoption, role authentication, priority arbitration and voice handoff
are outside this increment.

## Low-level invariants

The service socket is private, locked, bounded and same-UID checked. Replacement
of a stale socket happens only while holding its exclusive service lock.
The client response limit permits one bounded event page. Native RPCs route
responses by ID and preserve allowed observations while waiting; unsupported
notifications are filtered, rather than manufactured into knowledge.

The PTY resize ioctl receives a live PTY descriptor and a valid winsize pointer.
Shell pre-exec setup uses only async-signal-safe syscalls with its already-bound
slave descriptors; hook descriptor nine is deliberately inherited. Service
pre-exec setsid is also async-signal-safe. See `shell.rs` and `service.rs` for
these boundaries. No allocation, lock or store access belongs after fork.
Shell submission freezes uncertain state before writing bytes; incomplete
writes are never replayed. Typeahead remains protected across prompt/command
notifications so an agent cannot append to a person's unfinished line.

## Native checks

Normal `cargo test --locked` and `desktop/npm test` use disposable fixtures and
real PTYs without a desktop/model account. They establish contract/failure
behavior, not native window usability.

From a graphical login, build the binaries and use a fresh private directory for
the opt-in [panel lifecycle proof](../desktop/README.md#lifecycle-experiment).
It drives actual renderer handlers, preload, IPC and Rust with two real Bash
instances in Ghostty. It covers background/reopen, independent work, stop,
remove, capture cutoff, re-register and combined stop/remove.

The separate native Codex test uses the installed model account and real
Ghostty windows. It deliberately submits small tasks, including one through an
independent native connection while Voyager capture is removed. It also checks the same native server through a separately owned external
observation service, including stop refusal and fresh capture after removal.
Its private result contains the observed events and action results.

```sh
VOYAGER_NATIVE_PROOF_DIR="$HOME/.local/share/voyager-native-lifecycle-proof" \
  cargo test --locked --test native_lifecycle -- --ignored --nocapture
```

Physical pointer delivery, menu legibility and sound are a separate user check.
Linux/Ghostty observations do not establish macOS, other terminals or voice.
