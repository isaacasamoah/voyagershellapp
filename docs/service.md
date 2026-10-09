# Register a real Codex session

This first service slice connects to a Codex app server that is already running. You keep using the same native app and thread while Voyager observes new conversation events. Registration never makes Voyager the owner of the native process.

## Build and run

Linux, Rust and a C linker are required. Python 3 is needed only for the original probe tests. The implementation was developed against Codex app-server 0.162.0; the integration is experimental.

```sh
cargo build --locked --bin voyager
```

Supply your existing app server's Unix socket path from its host configuration. Voyager does not start, restart or reconfigure Codex to create one. The path is an explicit argument because guessing another process's socket would weaken the attachment boundary.

In one terminal, with `CODEX_SOCKET` set to that path:

```sh
VOYAGER_STATE="$HOME/.local/share/voyagershell-demo"
target/debug/voyager --state "$VOYAGER_STATE" serve "$CODEX_SOCKET"
```

In another terminal in this checkout:

```sh
VOYAGER_STATE="$HOME/.local/share/voyagershell-demo"
target/debug/voyager --state "$VOYAGER_STATE" discover
target/debug/voyager --state "$VOYAGER_STATE" register THREAD_ID
target/debug/voyager --state "$VOYAGER_STATE" list
target/debug/voyager --state "$VOYAGER_STATE" watch
```

Use the thread ID shown by `discover`, and the registration's returned session ID when sending:

```sh
target/debug/voyager --state "$VOYAGER_STATE" send SESSION_ID request-001 \
  "Please use no tools and change no files. Reply with: Voyager connected."
```

The message goes to the existing agent. No model, instructions, credentials or permission settings are replaced. Sending to an already-active thread is refused. Native input can race that check, so the returned native turn ID is authoritative; a send is not promised to create an independent task.

`serve` stays in the foreground unless your process manager launches it in the background. No system service is installed by this repository yet. Closing the watcher leaves the service running. Closing a foreground service terminal can stop the service; it never owns the Codex process.

## Commands

| Command | Result |
| --- | --- |
| `status` | Service instance, connection and capture count; explicitly reports that it owns no agents |
| `discover` | Metadata for currently loaded threads; no conversation history |
| `register THREAD_ID` | Subscribe to an existing loaded thread; repeated registration keeps its identity |
| `list` | Saved registrations, ownership and whether capture is currently connected |
| `send SESSION_ID REQUEST_ID MESSAGE` | Record the request and send text; acceptance is separate from observed completion |
| `events [CURSOR]` | Up to 100 recorded events after an exclusive sequence cursor |
| `watch [CURSOR]` | Print ordered JSONL pages, checking for new events every 250 ms when caught up |
| `stop` | Stop Voyager and record a capture gap; leave native agents alone |

Reusing a request ID with the same inputs returns the prior submission record. Changing its inputs is rejected. Delivery whose acknowledgement was lost remains uncertain and is never retried automatically. The request record stays about submission; the event stream carries the observed turn outcome.

## What is recorded

The service uses the [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server) over a WebSocket on a Unix socket. It checks that a thread is loaded before subscribing with `thread/resume` and `excludeTurns`, without configuration overrides. It sends text using `turn/start`. A thread disappearing between the loaded check and subscription remains an upstream race; there is no atomic attach-only operation established by this prototype.

The `conversation-v1` capture policy allows:

- Completed user text and assistant text, including the assistant's phase.
- Turn start/end and the native reported outcome.
- Tool lifecycle metadata: item ID, tool category and reported status.

Reasoning, raw terminal output, message deltas, old conversation history, attachments, tool arguments/results, credential stores and unrelated threads are excluded. Excluding tool payloads is deliberate for this first real capture test. User/assistant text itself can still contain sensitive information; this is not an infallible redactor.

Events retain native turn/item identifiers and a deduplication key, plus recorded time and source time where supplied. A registration maps the event's session ID to its native thread/server. The store does not treat a completed turn as proof its answer is correct. Unsupported notifications are outside this policy and are not represented as captured knowledge.

The private database lives in the selected state directory, never in the Git checkout. Records persist until you explicitly remove that dedicated directory after stopping Voyager. Text fields are capped at 16 KiB with a truncation marker. SQLite is capped at 8192 pages (32 MiB with the new database's default 4096-byte pages); temporary journal space is additional. A storage failure stops capture and is reported on stderr; a durable gap cannot be promised when storage itself is unavailable.

## Disconnect and restart

The app-server notification stream has no replay cursor established here. Voyager therefore records capture gaps on disconnect, normal stop and restart. After restart the saved registrations remain, but capture is disconnected until you register again. No prompt or old conversation is replayed. A request and its acceptance survive a service restart; uncertain requests remain uncertain.

This is deliberately a connection/capture service. It has no worker-launch, cancellation, process-adoption, live-upgrade or machine-reboot guarantee. The native app remains responsible for approvals. Voyager does not answer approval or tool-execution requests from Codex.

## Verification

```sh
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

Eight earlier black-box process fixtures remain. Three Rust tests exercise the service against a local WebSocket protocol fixture and test source deduplication/text bounds. They cover exact registration, unknown targets, duplicate sends and conflicting IDs, source filtering, client disconnect, native-owner independence, restart gaps, and uncertain delivery without replay, and explicit gaps after malformed notifications or an overflowing notification queue during a request. They are not substitutes for the separate real Codex demonstration.

## Real Codex check — 9 October 2026

On Fedora 43, Voyager registered an existing, already-loaded Codex app thread through app-server 0.162.0. Herdr was not involved. After the agent became idle, three deliberately harmless messages produced these recorded replies:

| Action | Observed result |
| --- | --- |
| Give the agent a marker and ask it to acknowledge the connection | `Voyager connected.` |
| Ask for the marker without repeating it | `ORBIT-42` |
| Stop Voyager, restart it, explicitly register the same thread, and request an acknowledgement | `Still here, ORBIT-42.` |

Each exchange produced a stored turn start, user message, assistant message and completed turn, linked by native turn/item IDs. The second reply demonstrated continuity in Codex's existing context. The third demonstrated communication after Voyager restarted; its prompt supplied the marker, so it is not a separate memory-recall result.

Repeated registration retained the Voyager session ID. Repeating an accepted request returned its original turn ID without a new turn. Across the Voyager restart, the native daemon's PID and process start time remained unchanged. Stored events explicitly marked the recording gap; registration after restart retained the same native thread and Voyager session identities.

A terminal watcher was started for the demo. Its process was verified; the desktop window's appearance was not independently observed. The receipt establishes real native protocol interaction and durable event capture, not Electron docking, Voyager ownership of Codex's lifetime, or graph-based memory. Private session metadata and transcripts remain outside this public repository.
