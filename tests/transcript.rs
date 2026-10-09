//! Independent CLI invocations prove the checkpoint survives collector exit.
use rusqlite::Connection;
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    process::{Command, Output},
};
use uuid::Uuid;

struct Fixture {
    root: PathBuf,
    source: PathBuf,
    state: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("voyager-transcript-test-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let f = Self {
            source: root.join("rollout.jsonl"),
            state: root.join("private"),
            root,
        };
        f.append(
            &json!({"type":"session_meta","payload":{"id":"thread-a","cli_version":"0.162.0"}}),
        );
        f
    }
    fn bytes(&self, bytes: &[u8]) {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.source)
            .unwrap()
            .write_all(bytes)
            .unwrap();
    }
    fn append(&self, row: &Value) {
        self.bytes(format!("{row}\n").as_bytes());
    }
    fn command(&self, op: &str) -> Output {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_voyager-transcript"));
        cmd.arg(op).arg(&self.state);
        if op == "register" {
            cmd.arg(&self.source).arg("thread-a");
        }
        cmd.output().unwrap()
    }
    fn run(&self, op: &str) -> Value {
        let out = self.command(op);
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice(&out.stdout).unwrap()
    }
    fn fails(&self, op: &str, expected: &str) {
        let out = self.command(op);
        assert!(!out.status.success());
        assert!(
            String::from_utf8_lossy(&out.stderr).contains(expected),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    fn db(&self) -> Connection {
        Connection::open(self.state.join("transcript.sqlite")).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

fn item(id: &str, ty: &str, text: &str) -> Value {
    json!({"timestamp":"2026-10-10T00:00:00Z","type":"event_msg","payload":{
        "type":"item_completed","thread_id":"thread-a","turn_id":"turn-a","completed_at_ms":1234,
        "item":{"type":ty,"id":id,"content":[{"type":if ty=="UserMessage" {"text"} else {"Text"},"text":text}]}}})
}

#[test]
fn catches_up_after_exit_without_history_duplicates_or_disallowed_content() {
    let f = Fixture::new();
    f.append(&item("old", "UserMessage", "PRIVATE_HISTORY"));
    assert_eq!(f.run("register")["history_imported"], false);
    f.append(&json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-a","started_at":1}}));
    let user = item("user-a", "UserMessage", "Please remember ORBIT.");
    f.append(&user);
    f.append(&json!({"type":"response_item","payload":{"type":"message","role":"user","content":"DUPLICATE_REPRESENTATION"}}));
    f.append(&item("hidden", "Reasoning", "PRIVATE_REASONING"));
    f.append(&json!({"type":"event_msg","payload":{"type":"item_completed","thread_id":"thread-a","turn_id":"turn-a",
        "item":{"id":"tool-a","type":"CommandExecution","command":"PRIVATE_TOOL_ARGUMENT","aggregated_output":"PRIVATE_TOOL_OUTPUT","status":"Completed"}}}));
    let first = f.run("poll");
    assert_eq!(first["inserted"], 3);
    // The collector process has exited. Codex keeps appending to its own file.
    f.append(&item("reply-a", "AgentMessage", "Remembered ORBIT."));
    f.append(&json!({"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-a","completed_at":2,"last_agent_message":"DUPLICATE_FINAL"}}));
    f.append(&user);
    let resumed = f.run("poll");
    assert_eq!(resumed["inserted"], 2);
    assert_eq!(resumed["duplicates"], 1);
    assert_eq!(f.run("poll")["inserted"], 0);
    let all = f.run("events");
    let events = all["events"].as_array().unwrap();
    assert_eq!(events.len(), 6); // Registration plus five derived observations.
    assert_eq!(events.iter().filter(|e| e["type"] == "message").count(), 2);
    for word in [
        "PRIVATE_HISTORY",
        "PRIVATE_REASONING",
        "PRIVATE_TOOL_ARGUMENT",
        "PRIVATE_TOOL_OUTPUT",
        "DUPLICATE_REPRESENTATION",
        "DUPLICATE_FINAL",
    ] {
        assert!(!all.to_string().contains(word));
        assert!(
            !String::from_utf8_lossy(&fs::read(f.state.join("transcript.sqlite")).unwrap())
                .contains(word)
        );
    }
    assert_eq!(events[2]["payload"]["role"], "user");
    assert_eq!(events[4]["payload"]["role"], "assistant");
    assert_eq!(events[4]["native_turn_id"], "turn-a");
    assert!(
        events[4]["payload"]["source"]["byte_start"]
            .as_u64()
            .is_some()
    );
}

#[test]
fn waits_for_complete_record_and_commits_events_with_cursor() {
    let f = Fixture::new();
    f.run("register");
    let initial = f.run("poll")["cursor"].clone();
    let body = item("user-a", "UserMessage", "A complete message").to_string();
    f.bytes(&body.as_bytes()[..body.len() / 2]);
    let partial = f.run("poll");
    assert_eq!(partial["partial_record"], true);
    assert_eq!(partial["cursor"], initial);
    f.bytes(&body.as_bytes()[body.len() / 2..]);
    f.bytes(b"\n");
    let db = f.db();
    db.execute_batch("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON transcript_source BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    f.fails("poll", "fixture failure");
    assert_eq!(f.run("events")["events"].as_array().unwrap().len(), 1);
    db.execute_batch("DROP TRIGGER fail_checkpoint").unwrap();
    assert_eq!(f.run("poll")["inserted"], 1);
    assert_eq!(f.run("poll")["inserted"], 0);
}

#[test]
fn rejects_loss_conflicts_and_wrong_identity_without_advancing() {
    for failure in [
        "malformed",
        "wrong-thread",
        "conflict",
        "compaction",
        "replacement",
        "truncation",
        "rewrite",
    ] {
        let f = Fixture::new();
        f.run("register");
        let original = item("same", "UserMessage", "original");
        f.append(&original);
        f.run("poll");
        let before = f.run("events");
        let cursor: i64 = f
            .db()
            .query_row("SELECT cursor FROM transcript_source", [], |r| r.get(0))
            .unwrap();
        // A valid row before the failure must also roll back with its cursor.
        f.append(&item("new", "AgentMessage", "must roll back"));
        let expected = match failure {
            "malformed" => {
                f.bytes(b"{broken}\n");
                "invalid transcript JSON"
            }
            "wrong-thread" => {
                let mut bad = item("bad", "UserMessage", "other");
                bad["payload"]["thread_id"] = json!("other-thread");
                f.append(&bad);
                "another thread"
            }
            "conflict" => {
                f.append(&item("same", "UserMessage", "changed"));
                "source identity conflict"
            }
            "compaction" => {
                f.append(&json!({"type":"compacted","payload":{}}));
                "compaction"
            }
            "replacement" => {
                let bytes = fs::read(&f.source).unwrap();
                fs::rename(&f.source, f.root.join("old")).unwrap();
                fs::write(&f.source, bytes).unwrap();
                "replaced"
            }
            "truncation" => {
                OpenOptions::new()
                    .write(true)
                    .open(&f.source)
                    .unwrap()
                    .set_len(1)
                    .unwrap();
                "truncated"
            }
            "rewrite" => {
                let s = fs::read_to_string(&f.source)
                    .unwrap()
                    .replace("original", "rewritten");
                fs::write(&f.source, s).unwrap();
                "checkpoint rewritten"
            }
            _ => unreachable!(),
        };
        f.fails("poll", expected);
        assert_eq!(f.run("events"), before);
        let after: i64 = f
            .db()
            .query_row("SELECT cursor FROM transcript_source", [], |r| r.get(0))
            .unwrap();
        assert_eq!(after, cursor);
    }
}

#[test]
fn refuses_unsupported_version_and_bounds_records_and_message_text() {
    let f = Fixture::new();
    fs::write(&f.source,b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread-a\",\"cli_version\":\"unknown\"}}\n").unwrap();
    f.fails("register", "0.162.0 only");
    assert!(!f.state.exists());
    let f = Fixture::new();
    f.run("register");
    f.append(&item("large", "UserMessage", &"\u{2603}".repeat(10_000)));
    f.run("poll");
    let events = f.run("events");
    assert_eq!(events["events"][1]["payload"]["truncated"], true);
    assert!(
        events["events"][1]["payload"]["text"]
            .as_str()
            .unwrap()
            .len()
            <= 16 * 1024
    );
    f.bytes(&vec![b'x'; 1024 * 1024 + 1]);
    f.fails("poll", "exceeds 1 MiB");
}
