# Deriving events from an existing transcript

An agent already writes a conversation record. This experiment asks whether
Voyager can use that record as its source, read only new entries, and catch up
after its reader exits. Conversion is ordinary Rust code. Jev interpretation and
knowledge-graph construction come after the resulting event stream.

This is a separate CLI and private database. It does not replace the running
service's notification capture, change a native agent, or import other sessions.
Its event insertion and text bounds reuse the existing Voyager store/normalizer.
No model is called by this reader.

## Run one small experiment

The adapter is pinned to the **observed Codex 0.162.0 JSONL rollout format**.
Other versions are refused because native transcript formats are not assumed to
be stable. Tests use synthetic records; a real trial needs an existing session
whose future conversation you intend to capture.

```sh
cargo build --locked --bin voyager-transcript

# Supply the actual file and native thread ID of that one session.
# The parent directory must exist; the experiment creates this NEW private dir.
target/debug/voyager-transcript register /tmp/voyager-transcript-trial \
  /absolute/path/to/rollout.jsonl NATIVE_THREAD_ID

# Chat in the native agent, then collect new records.
target/debug/voyager-transcript poll /tmp/voyager-transcript-trial
target/debug/voyager-transcript events /tmp/voyager-transcript-trial

# Leave the reader stopped, continue chatting, then run poll again to catch up.
# Repeat poll without new records: inserted should be zero.
```

Every command exits. There is no watcher left running. `events DIR CURSOR` pages
through up to 100 events using the returned event cursor. The file byte cursor
reported by `poll` is a different coordinate. A poll reads at most 256 complete
records; poll again while `remaining_bytes` is positive, except that an incomplete
last record must first finish writing. Start and stop the native agent as usual;
the reader does not control its process.

Registration validates the native thread ID and version in the first metadata
record, then starts at current EOF. It requires a complete final line. Existing
conversation is not imported. The experiment's Voyager session ID is local to
this isolated database; it is not the running service's registration ID. Match
observations between the two by native thread/turn/item identities.

## What becomes an event

| Native record | Voyager observation |
| --- | --- |
| `event_msg.task_started` | `turn.started` with the native turn ID |
| `event_msg.item_completed`, `UserMessage` | User text, capped at 16 KiB, with omitted-part count |
| `event_msg.item_completed`, `AgentMessage` | Assistant text and phase, with the same bounds |
| Supported completed tool item | Tool kind/status and native ID; arguments and results omitted |
| `event_msg.task_complete` | `turn.completed`; completion alone does not assert success |

The same message also appears in other representations, including
`response_item` and the final-message field of `task_complete`. Those are not
additional messages. Reasoning, instructions, raw tool contents, attachments,
token records, world state and other unsupported records are skipped. The poll
receipt counts skipped records. This is deliberately incomplete trace capture;
it does not synthesize tool starts that this adapter has not observed.

Each retained observation has native identity, source byte range, source-record
timestamp where present, receipt time and the existing conversation capture
policy. The source table retains the selected path, file identity and cursor.
The original transcript remains evidence, rather than a second raw transcript
being copied into Voyager. User/assistant text can itself be sensitive: storage
is private, not an infallible secret redactor. Nothing is shared or uploaded.

## Checkpoint and failure contract

- The event batch and byte cursor commit in one SQLite transaction. If a write
  fails or the collector dies before commit, neither advances. Native event keys
  suppress repeated records. A different payload under the same key is an error.
- A partial final JSON line waits until complete. Malformed complete records,
  mismatched thread IDs and records over 1 MiB fail the batch without advancing.
- Registration creates a mode-0700 directory and mode-0600 `transcript.sqlite`.
  It uses the existing store's roughly 32 MiB database limit. It never opens the
  running service's `events.sqlite`.
- Device/inode, length and a SHA-256 digest of the 128 bytes before the checkpoint
  detect replacement, observed truncation and edits at the checkpoint. The
  digest avoids persisting raw bytes from excluded content. `sha2` is the one new
  dependency, for that primitive.
- This assumes an append-only source. It is not whole-file tamper detection:
  same-inode edits elsewhere or truncate-and-regrow outside the checkpoint can
  escape detection. The reader does not lock the agent's file against writes.
  Compaction/reset/rollback records recognized by this adapter are refused.
  General rewriting, rotation, branching and migration need a later contract.
- Errors are explicit command failures; existing stored events remain readable.
  This isolated experiment does not yet publish capture-health events to the
  daemon or recover automatically from source loss. Stop and inspect the source;
  do not silently reset the cursor or import history.

Lifecycle facts such as registration, parent–worker relationships, scope,
launches and process exits still originate in the Voyager service. They cannot
all be recovered from a conversation transcript. Before using source references
for long-lived knowledge, we must also decide how to retain selected evidence
when the native harness deletes or rewrites its original files.

## Verification

`cargo test --locked --test transcript` exercises actual CLI invocations against
disposable files. It covers process-exit catch-up, no historical import,
duplicate representations and repeated records, exclusion of sensitive fixture
fields, partial writes, atomic rollback when the checkpoint write fails,
malformed data, wrong-thread data, conflicting identities, file replacement,
truncation/checkpoint edits, unsupported versions/compaction and bounded text.

On 10 October 2026, the same journey passed against the already registered,
service-owned Codex 0.162.0 worker on Fedora. Two deliberately harmless prompts
requested the replies `VOYAGER_TRANSCRIPT_LIVE_42` and
`VOYAGER_TRANSCRIPT_OFFLINE_42`. The first turn was collected while it ran. No
transcript-reader process ran during the second turn; the existing service's
independent notification capture established when that turn finished.

On the next invocation, the transcript reader recovered all four second-turn
events in one batch: turn start, user message, assistant reply and turn completion.
Both turns retained the native turn IDs and exact requested user/assistant text.
Each repeat poll inserted zero observations. The isolated store contains eight
conversation events plus its registration event. Earlier history was not copied.
The private receipt and database remain outside Git. No collector was left
running, and the existing service/worker were not restarted or replaced.

Formatting, strict Clippy, all four new CLI tests, five existing service tests
and eight earlier process fixtures passed locally. This is a **pass for this
bounded transcript experiment**, not Jev extraction, live service integration,
desktop proof or all-harness support. The next increment can move this proven
source/checkpoint boundary into the service without running two conversation
writers for the same registered session.
