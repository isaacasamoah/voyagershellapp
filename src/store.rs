use crate::events::Observation;
use anyhow::{Context, Result, ensure};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub struct Store(pub Connection);

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path)?;
        db.execute_batch("PRAGMA foreign_keys=ON;
            PRAGMA journal_mode=DELETE;
            PRAGMA synchronous=FULL;
            PRAGMA max_page_count=8192;
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, server TEXT NOT NULL, native_id TEXT NOT NULL,
                native_session_id TEXT, cwd TEXT NOT NULL, registered_ms INTEGER NOT NULL,
                UNIQUE(server,native_id));
            CREATE TABLE IF NOT EXISTS requests (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
                message TEXT NOT NULL, state TEXT NOT NULL, native_turn_id TEXT, created_ms INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
                session_id TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL,
                native_turn_id TEXT, source_key TEXT, occurred_ms INTEGER, recorded_ms INTEGER NOT NULL,
                payload TEXT NOT NULL, UNIQUE(session_id,source_key));
            CREATE TABLE IF NOT EXISTS workers (
                launch_id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES sessions(id),
                cwd TEXT NOT NULL, prompt TEXT NOT NULL, state TEXT NOT NULL,
                session_id TEXT UNIQUE REFERENCES sessions(id), pid INTEGER);")?;
        Ok(Self(db))
    }

    pub fn register(&self, server: &str, metadata: &Value) -> Result<String> {
        let native = metadata["id"]
            .as_str()
            .context("Codex metadata has no thread ID")?;
        if let Some(id) = self
            .0
            .query_row(
                "SELECT id FROM sessions WHERE server=?1 AND native_id=?2",
                params![server, native],
                |r| r.get(0),
            )
            .optional()?
        {
            return Ok(id);
        }
        let id = Uuid::new_v4().to_string();
        self.0.execute(
            "INSERT INTO sessions VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                id,
                server,
                native,
                metadata["sessionId"].as_str(),
                metadata["cwd"].as_str().unwrap_or(""),
                now()
            ],
        )?;
        self.local(
            &id,
            "session.registered",
            json!({"ownership":"external","capture_policy":"conversation-v1"}),
        )?;
        Ok(id)
    }

    pub fn sessions(&self) -> Result<Vec<Value>> {
        let mut query = self.0.prepare("SELECT s.id,s.server,s.native_id,s.native_session_id,s.cwd,s.registered_ms,w.parent_id,w.state FROM sessions s LEFT JOIN workers w ON w.session_id=s.id ORDER BY registered_ms")?;
        Ok(query.query_map([], |r| {
            let parent: Option<String> = r.get(6)?;
            Ok(json!({"id":r.get::<_,String>(0)?,"server":r.get::<_,String>(1)?,"native_thread_id":r.get::<_,String>(2)?,"native_session_id":r.get::<_,Option<String>>(3)?,"cwd":r.get::<_,String>(4)?,"registered_ms":r.get::<_,i64>(5)?,"ownership":if parent.is_some(){"managed"}else{"external"},"parent_id":parent,"worker_state":r.get::<_,Option<String>>(7)?}))
        })?.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn session(&self, id: &str) -> Result<Value> {
        self.sessions()?
            .into_iter()
            .find(|s| s["id"] == id)
            .context("unknown session")
    }

    pub fn launch(&self, id: &str) -> Result<Option<Value>> {
        Ok(self.0.query_row("SELECT parent_id,cwd,prompt,state,session_id,pid FROM workers WHERE launch_id=?1",[id],|r|Ok(json!({"launch_id":id,"parent_id":r.get::<_,String>(0)?,"cwd":r.get::<_,String>(1)?,"prompt":r.get::<_,String>(2)?,"state":r.get::<_,String>(3)?,"session_id":r.get::<_,Option<String>>(4)?,"pid":r.get::<_,Option<u32>>(5)?}))).optional()?)
    }

    pub fn begin_launch(&self, id: &str, parent: &str, cwd: &str, prompt: &str) -> Result<()> {
        // Unknown launches may still have processes: do not automatically replace them.
        let active: i64 = self.0.query_row(
            "SELECT count(*) FROM workers WHERE state IN ('starting','running','unknown')",
            [],
            |r| r.get(0),
        )?;
        ensure!(
            active == 0,
            "one worker at a time; stop the current worker or resolve unknown ownership first"
        );
        self.0.execute(
            "INSERT INTO workers VALUES (?1,?2,?3,?4,'starting',NULL,NULL)",
            params![id, parent, cwd, prompt],
        )?;
        Ok(())
    }

    pub fn register_worker(
        &mut self,
        launch: &str,
        server: &str,
        metadata: &Value,
        pid: u32,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let native = metadata["id"].as_str().context("missing worker thread")?;
        let tx = self.0.transaction()?;
        tx.execute(
            "INSERT INTO sessions VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                id,
                server,
                native,
                metadata["sessionId"].as_str(),
                metadata["cwd"].as_str().unwrap_or(""),
                now()
            ],
        )?;
        tx.execute(
            "UPDATE workers SET session_id=?2,pid=?3,state='running' WHERE launch_id=?1",
            params![launch, id, pid],
        )?;
        tx.commit()?;
        self.local(
            &id,
            "session.registered",
            json!({"ownership":"managed","capture_policy":"conversation-v1"}),
        )?;
        Ok(id)
    }

    pub fn worker_state(&self, launch: &str, state: &str) -> Result<()> {
        self.0.execute(
            "UPDATE workers SET state=?2 WHERE launch_id=?1",
            params![launch, state],
        )?;
        Ok(())
    }

    pub fn native(&self, session: &str, server: &str) -> Result<String> {
        self.0
            .query_row(
                "SELECT native_id FROM sessions WHERE id=?1 AND server=?2",
                params![session, server],
                |r| r.get(0),
            )
            .optional()?
            .context("unknown session for this Codex server")
    }

    pub fn local(&self, session: &str, kind: &str, payload: Value) -> Result<()> {
        self.insert(session, kind, None, None, None, payload)
    }

    fn insert(
        &self,
        session: &str,
        kind: &str,
        turn: Option<&str>,
        key: Option<&str>,
        occurred: Option<i64>,
        payload: Value,
    ) -> Result<()> {
        self.0.execute("INSERT INTO events (event_id,session_id,kind,native_turn_id,source_key,occurred_ms,recorded_ms,payload) VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(session_id,source_key) DO NOTHING",params![Uuid::new_v4().to_string(),session,kind,turn,key,occurred,now(),payload.to_string()])?;
        Ok(())
    }

    pub fn record(&self, session: &str, observation: Observation) -> Result<()> {
        self.insert(
            session,
            observation.kind,
            observation.turn.as_deref(),
            Some(&observation.key),
            observation.occurred_ms,
            observation.payload,
        )
    }

    pub fn events(&self, after: i64) -> Result<Value> {
        ensure!(after >= 0, "cursor must be nonnegative");
        let mut query = self.0.prepare("SELECT seq,event_id,session_id,kind,native_turn_id,source_key,occurred_ms,recorded_ms,payload FROM events WHERE seq>?1 ORDER BY seq LIMIT 100")?;
        let rows = query.query_map([after], |r| {
            let raw: String = r.get(8)?;
            let payload: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            Ok(json!({"sequence":r.get::<_,i64>(0)?,"event_id":r.get::<_,String>(1)?,"session_id":r.get::<_,String>(2)?,"type":r.get::<_,String>(3)?,"native_turn_id":r.get::<_,Option<String>>(4)?,"source_key":r.get::<_,Option<String>>(5)?,"occurred_ms":r.get::<_,Option<i64>>(6)?,"recorded_ms":r.get::<_,i64>(7)?,"payload":payload,"schema_version":1,"capture_policy":"conversation-v1"}))
        })?.collect::<rusqlite::Result<Vec<_>>>()?;
        let cursor = rows
            .last()
            .and_then(|v| v["sequence"].as_i64())
            .unwrap_or(after);
        Ok(json!({"events":rows,"cursor":cursor}))
    }

    pub fn request(&self, id: &str) -> Result<Option<Value>> {
        Ok(self.0.query_row("SELECT session_id,message,state,native_turn_id FROM requests WHERE id=?1",[id],|r|Ok(json!({"request_id":id,"session_id":r.get::<_,String>(0)?,"message":r.get::<_,String>(1)?,"state":r.get::<_,String>(2)?,"native_turn_id":r.get::<_,Option<String>>(3)?}))).optional()?)
    }

    pub fn begin_request(&self, id: &str, session: &str, message: &str) -> Result<()> {
        self.0.execute(
            "INSERT INTO requests VALUES (?1,?2,?3,'uncertain',NULL,?4)",
            params![id, session, message, now()],
        )?;
        Ok(())
    }

    pub fn accepted(&self, id: &str, turn: &str) -> Result<()> {
        self.0.execute(
            "UPDATE requests SET state='accepted',native_turn_id=?2 WHERE id=?1",
            params![id, turn],
        )?;
        Ok(())
    }
}
