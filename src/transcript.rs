use crate::{events, store::Store};
use anyhow::{Context, Result, ensure};
use nix::{libc, unistd::Uid};
use serde_json::{Value, json};
use std::{
    fs::{File, OpenOptions},
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

const LIMIT: u64 = 1024 * 1024;

pub struct Transcript {
    path: PathBuf,
    thread: String,
    identity: Option<(u64, u64)>,
    cursor: u64,
    anchor: Vec<u8>,
    turn: Option<String>,
}

fn open(path: &Path) -> Result<Option<File>> {
    match OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
    {
        Ok(file) => {
            let m = file.metadata()?;
            ensure!(
                m.is_file() && m.uid() == Uid::effective().as_raw(),
                "unsupported: transcript is not a same-user regular file"
            );
            Ok(Some(file))
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn line(reader: &mut impl BufRead) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(LIMIT + 1).read_until(b'\n', &mut bytes)?;
    ensure!(
        bytes.len() as u64 <= LIMIT,
        "transcript record exceeds 1 MiB"
    );
    Ok(bytes)
}

fn metadata(row: &Value, thread: &str) -> Result<()> {
    ensure!(
        row["type"] == "session_meta" && row["payload"]["id"] == thread,
        "transcript identity mismatch"
    );
    ensure!(
        row["payload"]["cli_version"] == "0.163.0",
        "unsupported: empty transcript adapter requires the tested Codex 0.163.0 format"
    );
    Ok(())
}

fn anchor(file: &mut File, cursor: u64) -> Result<Vec<u8>> {
    let n = cursor.min(128);
    file.seek(SeekFrom::Start(cursor - n))?;
    let mut bytes = vec![0; n as usize];
    file.read_exact(&mut bytes)?;
    Ok(bytes)
}

impl Transcript {
    pub fn empty(path: &Path, thread: &str) -> Result<Option<Self>> {
        ensure!(
            path.is_absolute(),
            "unsupported: transcript path must be absolute"
        );
        let mut result = Self {
            path: path.into(),
            thread: thread.into(),
            identity: None,
            cursor: 0,
            anchor: Vec::new(),
            turn: None,
        };
        if let Some(mut file) = open(path)? {
            let m = file.metadata()?;
            if m.len() > LIMIT {
                return Ok(None);
            }
            let mut reader = BufReader::new((&mut file).take(m.len()));
            let first = line(&mut reader)?;
            if !first.ends_with(b"\n") {
                return Ok(None);
            }
            let row: Value =
                serde_json::from_slice(&first).context("invalid transcript metadata")?;
            if row["type"] != "session_meta" || row["payload"]["id"] != thread {
                anyhow::bail!("transcript identity mismatch");
            }
            if !line(&mut reader)?.is_empty() {
                return Ok(None);
            }
            metadata(&row, thread)?;
            result.identity = Some((m.dev(), m.ino()));
            result.cursor = m.len();
            result.anchor = anchor(&mut file, result.cursor)?;
        }
        Ok(Some(result))
    }

    pub fn poll(&mut self, store: &Store, session: &str, generation: i64) -> Result<()> {
        let Some(mut file) = open(&self.path)? else {
            ensure!(self.identity.is_none(), "transcript disappeared");
            return Ok(());
        };
        let m = file.metadata()?;
        if let Some(identity) = self.identity {
            ensure!(
                identity == (m.dev(), m.ino()) && m.len() >= self.cursor,
                "transcript replaced or truncated"
            );
            ensure!(
                anchor(&mut file, self.cursor)? == self.anchor,
                "transcript checkpoint changed"
            );
        }
        file.seek(SeekFrom::Start(self.cursor))?;
        let mut reader = BufReader::new((&mut file).take(m.len() - self.cursor));
        for _ in 0..256 {
            let bytes = line(&mut reader)?;
            if !bytes.ends_with(b"\n") {
                break;
            }
            let row: Value = serde_json::from_slice(&bytes).context("invalid transcript record")?;
            if self.cursor == 0 {
                metadata(&row, &self.thread)?;
                self.identity = Some((m.dev(), m.ino()));
            } else {
                if row["type"] == "turn_context" {
                    self.turn = Some(
                        row["payload"]["turn_id"]
                            .as_str()
                            .context("missing transcript turn identity")?
                            .into(),
                    );
                }
                if let Some(event) = normalize(&row, &self.thread)? {
                    store.record(session, generation, event)?;
                } else if row["type"] == "response_item" {
                    let p = &row["payload"];
                    let kind = match p["type"].as_str() {
                        Some("function_call" | "custom_tool_call") => Some("tool.started"),
                        Some("function_call_output" | "custom_tool_call_output") => {
                            Some("tool.completed")
                        }
                        _ => None,
                    };
                    if let Some(kind) = kind {
                        let call = p["call_id"]
                            .as_str()
                            .context("missing transcript tool call ID")?;
                        store.record(session, generation, events::Observation { thread: self.thread.clone(), turn: self.turn.clone(), key: format!("transcript:{kind}:{call}"), kind, occurred_ms: None, payload: json!({"item_id":call,"tool_kind":p["type"],"payload_omitted":true}) })?;
                    }
                }
            }
            self.cursor += bytes.len() as u64;
        }
        drop(reader);
        self.anchor = anchor(&mut file, self.cursor)?;
        Ok(())
    }
}

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
        event.payload = json!({"source_event":ty});
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
        _ => return Ok(None),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn empty_capture_preserves_cutoff_partial_lines_and_identity() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("voyager-transcript-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root)?;
        let path = root.join("rollout.jsonl");
        let store = Store::open(&root.join("events.sqlite"))?;
        let session = store.register("test", &json!({"id":"native", "cwd":"/tmp"}))?;
        let mut tail = Transcript::empty(&path, "native")?.context("empty source")?;
        tail.poll(&store, &session, 1)?;
        let mut file = File::create(&path)?;
        writeln!(
            file,
            "{}",
            json!({"type":"session_meta","payload":{"id":"native","cli_version":"0.163.0"}})
        )?;
        let first = json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"one"}})
            .to_string();
        file.write_all(first.as_bytes())?;
        tail.poll(&store, &session, 1)?;
        assert_eq!(
            store.0.query_row(
                "SELECT count(*) FROM events WHERE kind='turn.started'",
                [],
                |r| r.get::<_, i64>(0)
            )?,
            0
        );
        writeln!(file)?;
        tail.poll(&store, &session, 1)?;
        tail.poll(&store, &session, 1)?;
        assert_eq!(
            store.0.query_row(
                "SELECT count(*) FROM events WHERE kind='turn.started'",
                [],
                |r| r.get::<_, i64>(0)
            )?,
            1
        );
        assert!(Transcript::empty(&path, "native")?.is_none());
        store.remove(&session)?;
        writeln!(
            file,
            "{}",
            json!({"type":"event_msg","payload":{"type":"task_complete","turn_id":"one"}})
        )?;
        tail.poll(&store, &session, 1)?;
        assert_eq!(
            store.0.query_row(
                "SELECT count(*) FROM events WHERE kind='turn.completed'",
                [],
                |r| r.get::<_, i64>(0)
            )?,
            0
        );
        file.set_len(1)?;
        assert!(
            tail.poll(&store, &session, 1)
                .unwrap_err()
                .to_string()
                .contains("truncated")
        );
        drop(file);
        drop(store);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn transcript_refuses_another_thread_before_content() -> Result<()> {
        let path =
            std::env::temp_dir().join(format!("voyager-transcript-{}", uuid::Uuid::new_v4()));
        std::fs::write(
            &path,
            format!(
                "{}\n",
                json!({"type":"session_meta","payload":{"id":"different","cli_version":"0.163.0"}})
            ),
        )?;
        assert!(
            Transcript::empty(&path, "native")
                .err()
                .context("expected identity refusal")?
                .to_string()
                .contains("identity")
        );
        std::fs::remove_file(path)?;
        Ok(())
    }
}
