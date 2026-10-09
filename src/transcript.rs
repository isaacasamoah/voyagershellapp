//! Bounded, opt-in experiment: derive events from one Codex 0.162.0 rollout.
//! The production service still owns its notification capture and its database.
use crate::{events, store::Store};
use anyhow::{Context, Result, ensure};
use nix::unistd::Uid;
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, DirBuilder, File, OpenOptions},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

const RECORD_LIMIT: u64 = 1024 * 1024;
const BATCH_LIMIT: usize = 256;
const ANCHOR_BYTES: u64 = 128;

fn source_file(path: &Path) -> Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(path)
        .context("open transcript read-only")?;
    let meta = file.metadata()?;
    ensure!(meta.is_file(), "transcript must be a regular file");
    ensure!(
        meta.uid() == Uid::effective().as_raw(),
        "different-user transcript"
    );
    Ok(file)
}

// A bounded read also applies to ignored records; never allocate an entire trace.
fn line(reader: &mut impl BufRead) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(RECORD_LIMIT + 1)
        .read_until(b'\n', &mut bytes)?;
    ensure!(
        bytes.len() as u64 <= RECORD_LIMIT,
        "transcript record exceeds 1 MiB"
    );
    Ok(bytes)
}

fn record(bytes: &[u8]) -> Result<Value> {
    serde_json::from_slice(bytes).map_err(|_| anyhow::anyhow!("invalid transcript JSON"))
}

fn metadata(file: &mut File, expected_thread: &str) -> Result<()> {
    file.rewind()?;
    let bytes = line(&mut BufReader::new(file))?;
    ensure!(bytes.ends_with(b"\n"), "incomplete transcript metadata");
    let row = record(&bytes)?;
    ensure!(row["type"] == "session_meta", "missing transcript metadata");
    ensure!(
        row["payload"]["id"] == expected_thread,
        "transcript thread mismatch"
    );
    ensure!(
        row["payload"]["cli_version"] == "0.162.0",
        "this experiment supports Codex 0.162.0 only"
    );
    Ok(())
}

fn anchor(file: &mut File, cursor: u64) -> Result<Vec<u8>> {
    let start = cursor.saturating_sub(ANCHOR_BYTES);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = vec![0; (cursor - start) as usize];
    file.read_exact(&mut bytes)
        .context("transcript shortened at checkpoint")?;
    Ok(Sha256::digest(bytes).to_vec())
}

/// Start at the current EOF. Earlier conversation is neither imported nor copied.
pub fn register(state: &Path, source: &Path, thread: &str) -> Result<Value> {
    let path = source.canonicalize()?;
    let mut file = source_file(&path)?;
    metadata(&mut file, thread)?;
    let meta = file.metadata()?;
    let cursor = meta.len();
    ensure!(cursor > 0, "transcript became empty during registration");
    let boundary = anchor(&mut file, cursor)?;
    file.seek(SeekFrom::Start(cursor - 1))?;
    let mut last = [0];
    file.read_exact(&mut last)?;
    ensure!(
        last == *b"\n",
        "wait for a complete record before registering"
    );

    // A fresh directory prevents accidental use of the live service's database.
    DirBuilder::new()
        .mode(0o700)
        .create(state)
        .context("create NEW private experiment directory")?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(state.join("transcript.sqlite"))?;
    let store = Store::open(&state.join("transcript.sqlite"))?;
    let session = store.register("codex-transcript-v1", &json!({"id":thread}))?;
    store.0.execute_batch(
        "CREATE TABLE transcript_source (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), path TEXT NOT NULL,
        thread_id TEXT NOT NULL, session_id TEXT NOT NULL,
        device TEXT NOT NULL, inode TEXT NOT NULL, cursor INTEGER NOT NULL CHECK(cursor>=0),
        anchor BLOB NOT NULL)",
    )?;
    store.0.execute(
        "INSERT INTO transcript_source VALUES (1,?1,?2,?3,?4,?5,?6,?7)",
        params![
            path.to_str().context("non-UTF8 transcript path")?,
            thread,
            session,
            meta.dev().to_string(),
            meta.ino().to_string(),
            i64::try_from(cursor)?,
            boundary
        ],
    )?;
    Ok(
        json!({"session_id":session,"native_thread_id":thread,"cursor":cursor,"history_imported":false}),
    )
}

pub fn open(state: &Path) -> Result<Store> {
    let dir = fs::symlink_metadata(state)?;
    ensure!(
        dir.is_dir() && dir.uid() == Uid::effective().as_raw() && dir.mode() & 0o077 == 0,
        "experiment directory must be private and owned by this user"
    );
    let db = fs::symlink_metadata(state.join("transcript.sqlite"))?;
    ensure!(
        db.is_file() && db.uid() == Uid::effective().as_raw() && db.mode() & 0o077 == 0,
        "experiment database must be private and owned by this user"
    );
    let store = Store::open(&state.join("transcript.sqlite"))?;
    ensure!(
        store
            .0
            .query_row("SELECT count(*) FROM transcript_source", [], |r| r
                .get::<_, i64>(0))?
            == 1,
        "not a registered transcript experiment"
    );
    Ok(store)
}

struct Source {
    path: PathBuf,
    thread: String,
    session: String,
    device: String,
    inode: String,
    cursor: u64,
    anchor: Vec<u8>,
}

fn unchanged(source: &Source, file: &mut File) -> Result<()> {
    let meta = fs::metadata(&source.path)?;
    ensure!(
        meta.dev().to_string() == source.device && meta.ino().to_string() == source.inode,
        "transcript replaced; checkpoint unchanged"
    );
    ensure!(
        meta.len() >= source.cursor,
        "transcript truncated; checkpoint unchanged"
    );
    ensure!(
        anchor(file, source.cursor)? == source.anchor,
        "transcript checkpoint rewritten; checkpoint unchanged"
    );
    Ok(())
}

/// Insert a bounded batch and advance its cursor in the same SQLite transaction.
/// A crash can leave both committed or neither; native IDs suppress source repeats.
pub fn poll(state: &Path) -> Result<Value> {
    let store = open(state)?;
    // The Store helpers use this same connection. No nested transaction is opened.
    let tx = Transaction::new_unchecked(&store.0, TransactionBehavior::Immediate)?;
    let source = tx.query_row(
        "SELECT path,thread_id,session_id,device,inode,cursor,anchor FROM transcript_source",
        [],
        |r| {
            let cursor: i64 = r.get(5)?;
            Ok(Source {
                path: PathBuf::from(r.get::<_, String>(0)?),
                thread: r.get(1)?,
                session: r.get(2)?,
                device: r.get(3)?,
                inode: r.get(4)?,
                cursor: cursor
                    .try_into()
                    .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(5, cursor))?,
                anchor: r.get(6)?,
            })
        },
    )?;
    let mut file = source_file(&source.path)?;
    let meta = file.metadata()?;
    ensure!(
        meta.len() >= source.cursor,
        "transcript truncated; checkpoint unchanged"
    );
    ensure!(
        meta.dev().to_string() == source.device && meta.ino().to_string() == source.inode,
        "transcript replaced; checkpoint unchanged"
    );
    metadata(&mut file, &source.thread)?;
    unchanged(&source, &mut file)?;
    file.seek(SeekFrom::Start(source.cursor))?;
    // Do not chase an actively growing file forever in a single poll.
    let mut reader = BufReader::new((&mut file).take(meta.len() - source.cursor));
    let mut cursor = source.cursor;
    let mut inserted = 0;
    let mut duplicates = 0;
    let mut skipped = 0;
    let mut partial = false;
    for _ in 0..BATCH_LIMIT {
        let bytes = line(&mut reader)?;
        if bytes.is_empty() {
            break;
        }
        if !bytes.ends_with(b"\n") {
            partial = true;
            break;
        }
        let row = record(&bytes)
            .with_context(|| format!("at source byte {cursor}; batch rolled back"))?;
        if let Some(mut event) = normalize(&row, &source.thread)? {
            // Keep source locations with the evidence; don't copy the raw record.
            event.payload["source"] = json!({"adapter":"codex-transcript-v1", "byte_start":cursor,
                "byte_end":cursor + bytes.len() as u64, "recorded_at":row["timestamp"].as_str()});
            // Duplicates may occur in a source. A changed payload under the same
            // identity is a source conflict, not an excuse to erase old evidence.
            let existing: Option<String> = tx
                .query_row(
                    "SELECT payload FROM events WHERE session_id=?1 AND source_key=?2",
                    params![source.session, event.key],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(raw) = existing {
                let mut previous: Value = serde_json::from_str(&raw)?;
                previous
                    .as_object_mut()
                    .context("invalid stored event")?
                    .remove("source");
                let mut incoming = event.payload.clone();
                incoming
                    .as_object_mut()
                    .context("invalid event")?
                    .remove("source");
                ensure!(
                    previous == incoming,
                    "source identity conflict; batch rolled back"
                );
                duplicates += 1;
            } else {
                store.record(&source.session, event)?;
                inserted += 1;
            }
        } else {
            skipped += 1;
        }
        cursor += bytes.len() as u64;
    }
    drop(reader);
    unchanged(&source, &mut file)?;
    let boundary = anchor(&mut file, cursor)?;
    tx.execute(
        "UPDATE transcript_source SET cursor=?1, anchor=?2 WHERE singleton=1",
        params![i64::try_from(cursor)?, boundary],
    )?;
    tx.commit()?;
    Ok(
        json!({"cursor":cursor,"inserted":inserted,"duplicates":duplicates,"skipped":skipped,
        "partial_record":partial,"remaining_bytes":meta.len()-cursor}),
    )
}

/// Only canonical completed items are messages. response_item and task_complete's
/// last_agent_message are other representations of those same items, not new facts.
fn normalize(row: &Value, thread: &str) -> Result<Option<events::Observation>> {
    let p = &row["payload"];
    ensure!(
        row["type"] != "compacted"
            && row["type"] != "session_meta"
            && p["type"] != "thread_rolled_back",
        "source reset or compaction requires a new experiment; batch rolled back"
    );
    if row["type"] != "event_msg" {
        return Ok(None);
    }
    let ty = p["type"]
        .as_str()
        .context("missing transcript event type")?;
    if ty == "task_started" || ty == "task_complete" {
        let turn = p["turn_id"]
            .as_str()
            .context("missing transcript turn ID")?;
        let method = if ty == "task_started" {
            "turn/started"
        } else {
            "turn/completed"
        };
        let mut event = events::normalize(
            &json!({"method":method,"params":{"threadId":thread,"turn":{"id":turn}}}),
        )
        .context("unsupported turn")?;
        event.payload = json!({"source_event":ty}); // Completion alone isn't success.
        event.occurred_ms = p[if ty == "task_started" {
            "started_at"
        } else {
            "completed_at"
        }]
        .as_i64()
        .and_then(|t| t.checked_mul(1000));
        return Ok(Some(event));
    }
    if ty != "item_completed" {
        return Ok(None);
    }
    ensure!(
        p["thread_id"] == thread,
        "item belongs to another thread; batch rolled back"
    );
    let turn = p["turn_id"].as_str().context("missing item turn ID")?;
    let native = &p["item"];
    let kind = match native["type"].as_str() {
        Some("UserMessage") => "userMessage",
        Some("AgentMessage") => "agentMessage",
        Some("CommandExecution") => "commandExecution",
        Some("McpToolCall") => "mcpToolCall",
        Some("DynamicToolCall") => "dynamicToolCall",
        Some("FileChange") => "fileChange",
        Some("WebSearch") => "webSearch",
        _ => return Ok(None), // Includes reasoning and unsupported item types.
    };
    let id = native["id"].as_str().context("missing item ID")?;
    let mut item = json!({"id":id,"type":kind,"status":native["status"].as_str()});
    let mut omitted = 0;
    if kind == "userMessage" || kind == "agentMessage" {
        let mut body = String::new();
        for part in native["content"]
            .as_array()
            .context("missing message content")?
        {
            if (kind == "userMessage" && part["type"] == "text")
                || (kind == "agentMessage" && part["type"] == "Text")
            {
                let text = part["text"].as_str().context("missing message text")?;
                if body.len() <= events::TEXT_LIMIT {
                    body.push_str(text);
                }
            } else {
                omitted += 1;
            }
        }
        item["content"] = json!([{"type":"text","text":body}]);
        item["text"] = json!(body);
        item["phase"] = native["phase"].clone();
    }
    let mut event = events::normalize(&json!({"method":"item/completed","params":{
        "threadId":thread,"turnId":turn,"item":item,"completedAtMs":p["completed_at_ms"]}}))
    .context("unsupported completed item")?;
    if event.kind == "message" {
        event.payload["omitted_parts"] = json!(omitted);
    }
    Ok(Some(event))
}
