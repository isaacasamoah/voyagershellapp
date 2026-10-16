use super::types::{Graph, SourceEvent};
use anyhow::{Context, Result, ensure};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::{path::Path, time::Duration};

pub struct Db(pub Connection);

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if path.exists() {
            use std::os::unix::fs::MetadataExt;
            let meta = std::fs::symlink_metadata(path)?;
            ensure!(
                meta.is_file()
                    && meta.uid() == nix::unistd::Uid::effective().as_raw()
                    && meta.mode() & 0o077 == 0,
                "collaboration database must be private and not a symlink"
            );
        }
        let db = Connection::open(path)?;
        if path != Path::new(":memory:") {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        ensure!(
            (0..=1).contains(&version),
            "unsupported collaboration schema version"
        );
        db.busy_timeout(Duration::from_secs(2))?;
        db.execute_batch("PRAGMA user_version=1; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS graph (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS input_events (seq INTEGER PRIMARY KEY, source_key TEXT UNIQUE NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', error TEXT);
            CREATE TABLE IF NOT EXISTS attempts (seq INTEGER PRIMARY KEY, source_key TEXT NOT NULL, stage TEXT NOT NULL, request TEXT NOT NULL, response TEXT NOT NULL, elapsed_ms INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);")?;
        db.execute(
            "INSERT OR IGNORE INTO graph VALUES(1,?1)",
            [serde_json::to_string(&Graph::default())?],
        )?;
        Ok(Self(db))
    }

    pub fn graph(&self) -> Result<Graph> {
        let body: String = self
            .0
            .query_row("SELECT body FROM graph WHERE id=1", [], |r| r.get(0))?;
        Ok(serde_json::from_str(&body)?)
    }

    pub fn save(&self, graph: &Graph, event: Option<i64>) -> Result<()> {
        let tx = self.0.unchecked_transaction()?;
        tx.execute(
            "UPDATE graph SET body=?1 WHERE id=1",
            [serde_json::to_string(graph)?],
        )?;
        if let Some(seq) = event {
            tx.execute(
                "UPDATE input_events SET status='done',error=NULL WHERE seq=?1",
                [seq],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn insert(&self, event: &SourceEvent) -> Result<bool> {
        ensure!(
            !event.event_id.is_empty() && !event.session_id.is_empty(),
            "missing source identity"
        );
        ensure!(
            event.event_id.len() <= 200 && event.session_id.len() <= 200,
            "source identity too long"
        );
        ensure!(
            ["user", "assistant", "gap"].contains(&event.role.as_str()),
            "invalid source role"
        );
        ensure!(
            event.text.len() <= crate::events::TEXT_LIMIT,
            "source event exceeds capture limit"
        );
        let key = serde_json::to_string(&(&event.session_id, &event.event_id))?;
        let body = serde_json::to_string(event)?;
        let existing: Option<String> = self
            .0
            .query_row(
                "SELECT body FROM input_events WHERE source_key=?1",
                [&key],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(existing) = existing {
            ensure!(
                existing == body,
                "source identity reused with different content"
            );
            return Ok(false);
        }
        self.0.execute(
            "INSERT INTO input_events(source_key,body) VALUES(?1,?2)",
            params![key, body],
        )?;
        Ok(true)
    }

    pub fn next(&self) -> Result<Option<(i64, SourceEvent)>> {
        let row: Option<(i64, String)> = self
            .0
            .query_row(
                "SELECT seq,body FROM input_events WHERE status='queued' ORDER BY seq LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        row.map(|(seq, s)| Ok((seq, serde_json::from_str(&s)?)))
            .transpose()
    }

    pub fn window(&self, seq: i64, session: &str, limit: usize) -> Result<Vec<SourceEvent>> {
        let mut query = self.0.prepare("SELECT body FROM input_events WHERE seq<=?1 AND json_extract(body,'$.session_id')=?2 ORDER BY seq DESC LIMIT 100")?;
        let bodies = query
            .query_map(params![seq, session], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut total = 0;
        let mut events = Vec::new();
        for body in bodies {
            let event: SourceEvent = serde_json::from_str(&body)?;
            let length = event.text.chars().count();
            if events.is_empty() {
                ensure!(
                    length <= limit,
                    "newest event exceeds window; increase window_chars"
                );
            }
            if total + length > limit {
                break;
            }
            total += length;
            let gap = event.gap;
            events.push(event);
            if gap {
                break;
            }
        }
        events.reverse();
        Ok(events)
    }

    pub fn attempt(
        &self,
        key: &str,
        stage: &str,
        request: &Value,
        response: &Value,
        elapsed: u128,
    ) -> Result<()> {
        self.0.execute("INSERT INTO attempts(source_key,stage,request,response,elapsed_ms) VALUES(?1,?2,?3,?4,?5)", params![key,stage,request.to_string(),response.to_string(),elapsed as i64])?;
        Ok(())
    }

    pub fn fail(&self, seq: i64, error: &str) -> Result<()> {
        self.0.execute(
            "UPDATE input_events SET status='failed',error=?2 WHERE seq=?1",
            params![seq, error],
        )?;
        Ok(())
    }

    pub fn cursor(&self) -> Result<i64> {
        let value: Option<String> = self
            .0
            .query_row("SELECT value FROM meta WHERE key='cursor'", [], |r| {
                r.get(0)
            })
            .optional()?;
        value
            .map(|s| s.parse().context("invalid source cursor"))
            .unwrap_or(Ok(0))
    }

    pub fn set_cursor(&self, cursor: i64) -> Result<()> {
        self.0.execute("INSERT INTO meta VALUES('cursor',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [cursor.to_string()])?;
        Ok(())
    }

    pub fn snapshot(&self) -> Result<Value> {
        let mut query = self.0.prepare(
            "SELECT seq,body,status,error FROM input_events ORDER BY seq DESC LIMIT 100",
        )?;
        let events = query.query_map([], |r| Ok(json!({"seq":r.get::<_,i64>(0)?,"event":serde_json::from_str::<Value>(&r.get::<_,String>(1)?).unwrap_or(Value::Null),"status":r.get::<_,String>(2)?,"error":r.get::<_,Option<String>>(3)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
        let mut query = self.0.prepare("SELECT seq,source_key,stage,request,response,elapsed_ms FROM attempts ORDER BY seq DESC LIMIT 30")?;
        let attempts = query.query_map([], |r| Ok(json!({"seq":r.get::<_,i64>(0)?,"event":r.get::<_,String>(1)?,"stage":r.get::<_,String>(2)?,"request":serde_json::from_str::<Value>(&r.get::<_,String>(3)?).unwrap_or(Value::Null),"response":serde_json::from_str::<Value>(&r.get::<_,String>(4)?).unwrap_or(Value::Null),"elapsed_ms":r.get::<_,i64>(5)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(
            json!({"graph":self.graph()?,"events":events,"attempts":attempts,"source_cursor":self.cursor()?,"limits":{"events_shown":100,"attempts_shown":30}}),
        )
    }
}
