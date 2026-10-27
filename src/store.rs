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
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        ensure!(version <= 4, "unsupported database schema version");
        db.execute_batch(
            "PRAGMA foreign_keys=ON;
            PRAGMA journal_mode=DELETE;
            PRAGMA synchronous=FULL;
            PRAGMA max_page_count=8192;",
        )?;
        if version == 0 {
            db.execute_batch("BEGIN IMMEDIATE;")?;
        }
        db.execute_batch("CREATE TABLE IF NOT EXISTS sessions (
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
            CREATE INDEX IF NOT EXISTS events_session_seq ON events(session_id,seq);
            CREATE TABLE IF NOT EXISTS workers (
                launch_id TEXT PRIMARY KEY, parent_id TEXT REFERENCES sessions(id),
                cwd TEXT NOT NULL, prompt TEXT, state TEXT NOT NULL,
                session_id TEXT UNIQUE REFERENCES sessions(id), pid INTEGER, name TEXT);")?;
        let has_name: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('workers') WHERE name='name')",
            [],
            |r| r.get(0),
        )?;
        if !has_name {
            db.execute_batch(
                "ALTER TABLE workers RENAME TO workers_before_instances;
                CREATE TABLE workers (
                    launch_id TEXT PRIMARY KEY, parent_id TEXT REFERENCES sessions(id),
                    cwd TEXT NOT NULL, prompt TEXT, state TEXT NOT NULL,
                    session_id TEXT UNIQUE REFERENCES sessions(id), pid INTEGER, name TEXT);
                INSERT INTO workers SELECT *,NULL FROM workers_before_instances;
                DROP TABLE workers_before_instances;",
            )?;
        }
        let has_kind: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('sessions') WHERE name='kind')",
            [],
            |r| r.get(0),
        )?;
        if !has_kind {
            db.execute_batch(
                "ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'codex';",
            )?;
        }
        let has_worker_kind: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('workers') WHERE name='kind')",
            [],
            |r| r.get(0),
        )?;
        if !has_worker_kind {
            db.execute_batch("ALTER TABLE workers ADD COLUMN kind TEXT NOT NULL DEFAULT 'codex';")?;
        }
        if version == 0 {
            db.execute_batch(
                "ALTER TABLE sessions ADD COLUMN removed_ms INTEGER;
                ALTER TABLE sessions ADD COLUMN capture_generation INTEGER NOT NULL DEFAULT 1;
                CREATE TABLE operations (
                    id TEXT PRIMARY KEY, inputs TEXT NOT NULL, receipt TEXT NOT NULL,
                    created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL);
                PRAGMA user_version=1;
                COMMIT;",
            )?;
        }
        if version < 2 {
            db.execute_batch(
                "BEGIN IMMEDIATE;
                ALTER TABLE sessions ADD COLUMN rank TEXT;
                ALTER TABLE sessions ADD COLUMN supervisor_id TEXT REFERENCES sessions(id);
                ALTER TABLE operations ADD COLUMN actor_session_id TEXT REFERENCES sessions(id);
                ALTER TABLE operations ADD COLUMN actor_kind TEXT;
                ALTER TABLE requests ADD COLUMN actor_session_id TEXT REFERENCES sessions(id);
                ALTER TABLE requests ADD COLUMN actor_kind TEXT;
                ALTER TABLE requests ADD COLUMN authority TEXT;
                ALTER TABLE requests ADD COLUMN control_generation TEXT;
                ALTER TABLE requests ADD COLUMN purpose TEXT;
                ALTER TABLE requests ADD COLUMN about_request_id TEXT REFERENCES requests(id);
                ALTER TABLE requests ADD COLUMN dispatch_mode TEXT;
                ALTER TABLE requests ADD COLUMN expected_turn_id TEXT;
                ALTER TABLE requests ADD COLUMN error_code TEXT;
                UPDATE sessions SET rank='crew' WHERE kind='codex';",
            )?;
            let invalid: i64 = db.query_row(
                "SELECT count(*) FROM sessions WHERE kind NOT IN ('codex','shell')",
                [],
                |r| r.get(0),
            )?;
            ensure!(invalid == 0, "unsupported instance kind in migration");
            db.execute_batch("PRAGMA user_version=2; COMMIT;")?;
        }
        if version < 3 {
            db.execute_batch(
                "BEGIN IMMEDIATE;
                ALTER TABLE sessions ADD COLUMN name TEXT;
                UPDATE sessions SET name=(SELECT name FROM workers WHERE workers.session_id=sessions.id);
                PRAGMA user_version=3;
                COMMIT;",
            )?;
        }
        let invalid: i64 = db.query_row("SELECT count(*) FROM sessions WHERE kind NOT IN ('codex','shell') OR (kind='codex' AND (rank IS NULL OR rank NOT IN ('admiral','commodore','captain','crew'))) OR (kind='shell' AND rank IS NOT NULL)", [], |r| r.get(0))?;
        ensure!(invalid == 0, "invalid instance kind or rank in database");
        if version < 4 {
            db.execute_batch(
                "BEGIN IMMEDIATE;
                CREATE TABLE runtime_generations (
                    session_id TEXT NOT NULL REFERENCES sessions(id), generation INTEGER NOT NULL,
                    operation_id TEXT NOT NULL UNIQUE, server TEXT NOT NULL,
                    state TEXT NOT NULL, settings TEXT,
                    PRIMARY KEY(session_id,generation));
                CREATE UNIQUE INDEX runtime_exclusive ON runtime_generations(session_id)
                    WHERE state IN ('starting','running','unknown','uncertain');
                INSERT INTO runtime_generations
                    SELECT session_id,0,launch_id,s.server,w.state,NULL FROM workers w
                    JOIN sessions s ON s.id=w.session_id WHERE w.state IN ('stopped','exited')
                    AND NOT EXISTS(SELECT 1 FROM operations o
                      WHERE json_extract(o.receipt,'$.session_id')=s.id
                      AND json_extract(o.receipt,'$.state') IN ('pending','uncertain'));
                PRAGMA user_version=4; COMMIT;",
            )?;
        }
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
            "INSERT INTO sessions (id,server,native_id,native_session_id,cwd,registered_ms,rank) VALUES (?1,?2,?3,?4,?5,?6,'crew')",
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
        let mut query = self.0.prepare("SELECT s.id,s.server,s.native_id,s.native_session_id,s.cwd,s.registered_ms,w.parent_id,COALESCE((SELECT state FROM runtime_generations g WHERE g.session_id=s.id ORDER BY generation DESC LIMIT 1),w.state),w.launch_id,s.name,s.kind,s.removed_ms,s.capture_generation,s.rank,s.supervisor_id,(SELECT recorded_ms FROM events e WHERE e.session_id=s.id ORDER BY seq DESC LIMIT 1) FROM sessions s LEFT JOIN workers w ON w.session_id=s.id ORDER BY registered_ms")?;
        Ok(query.query_map([], |r| {
            let parent: Option<String> = r.get(6)?;
            let managed: Option<String> = r.get(8)?;
            Ok(json!({"id":r.get::<_,String>(0)?,"server":r.get::<_,String>(1)?,"native_thread_id":r.get::<_,String>(2)?,"native_session_id":r.get::<_,Option<String>>(3)?,"cwd":r.get::<_,String>(4)?,"registered_ms":r.get::<_,i64>(5)?,"ownership":if managed.is_some(){"managed"}else{"external"},"parent_id":parent,"worker_state":r.get::<_,Option<String>>(7)?,"name":r.get::<_,Option<String>>(9)?,"kind":r.get::<_,String>(10)?,"removed_ms":r.get::<_,Option<i64>>(11)?,"capture_generation":r.get::<_,i64>(12)?,"rank":r.get::<_,Option<String>>(13)?,"supervisor_id":r.get::<_,Option<String>>(14)?,"last_activity_ms":r.get::<_,Option<i64>>(15)?}))
        })?.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn session(&self, id: &str) -> Result<Value> {
        self.sessions()?
            .into_iter()
            .find(|s| s["id"] == id)
            .context("unknown session")
    }

    pub fn launch(&self, id: &str) -> Result<Option<Value>> {
        Ok(self.0.query_row("SELECT parent_id,cwd,prompt,state,session_id,pid,name,kind FROM workers WHERE launch_id=?1",[id],|r|Ok(json!({"launch_id":id,"parent_id":r.get::<_,Option<String>>(0)?,"cwd":r.get::<_,String>(1)?,"prompt":r.get::<_,Option<String>>(2)?,"state":r.get::<_,String>(3)?,"session_id":r.get::<_,Option<String>>(4)?,"pid":r.get::<_,Option<u32>>(5)?,"name":r.get::<_,Option<String>>(6)?,"kind":r.get::<_,String>(7)?}))).optional()?)
    }

    pub fn begin_launch(
        &self,
        id: &str,
        parent: Option<&str>,
        cwd: &str,
        prompt: Option<&str>,
        name: Option<&str>,
    ) -> Result<()> {
        let active: i64 = self.0.query_row(
            "SELECT count(*) FROM workers WHERE state='unknown'",
            [],
            |r| r.get(0),
        )?;
        ensure!(
            active == 0,
            "resolve unknown process ownership before creating more instances"
        );
        self.0.execute(
            "INSERT INTO workers (launch_id,parent_id,cwd,prompt,state,session_id,pid,name) VALUES (?1,?2,?3,?4,'starting',NULL,NULL,?5)",
            params![id, parent, cwd, prompt, name],
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
        let id = self
            .operation(launch)?
            .and_then(|(v, _)| v["new_session_id"].as_str().map(str::to_owned))
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let native = metadata["id"].as_str().context("missing worker thread")?;
        let tx = self.0.transaction()?;
        tx.execute(
            "INSERT INTO sessions (id,server,native_id,native_session_id,cwd,registered_ms,rank) VALUES (?1,?2,?3,?4,?5,?6,'crew')",
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
        tx.execute(
            "UPDATE sessions SET kind=?2,rank=CASE WHEN ?2='shell' THEN NULL ELSE 'crew' END,name=(SELECT name FROM workers WHERE workers.session_id=sessions.id) WHERE id=?1",
            params![id, metadata["kind"].as_str().unwrap_or("codex")],
        )?;
        tx.execute(
            "INSERT INTO runtime_generations VALUES (?1,1,?2,?3,'running',?4)",
            params![
                id,
                launch,
                server,
                metadata
                    .get("resume_settings")
                    .filter(|v| v.is_object())
                    .map(Value::to_string)
            ],
        )?;
        tx.commit()?;
        self.local(
            &id,
            "session.registered",
            json!({"ownership":"managed","capture_policy":if metadata["kind"]=="shell"{"shell-commands-v1"}else{"conversation-v1"}}),
        )?;
        Ok(id)
    }

    pub fn worker_state(&self, launch: &str, state: &str) -> Result<()> {
        self.0.execute(
            "UPDATE runtime_generations SET state=?2 WHERE operation_id=?1",
            params![launch, state],
        )?;
        self.0.execute(
            "UPDATE workers SET state=?2 WHERE launch_id=?1",
            params![launch, state],
        )?;
        Ok(())
    }

    pub fn runtime_observation(&self, session: &str, live: bool, external: bool) -> Result<Value> {
        let saved: Option<(i64, String)> = self.0.query_row(
            "SELECT generation,state FROM runtime_generations WHERE session_id=?1 ORDER BY generation DESC LIMIT 1",
            [session], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        let state = if external {
            "external"
        } else if live {
            "running"
        } else if saved
            .as_ref()
            .is_some_and(|(_, s)| matches!(s.as_str(), "stopped" | "exited"))
        {
            "stopped"
        } else if saved.as_ref().is_some_and(|(_, s)| s == "starting") {
            "starting"
        } else {
            "unknown"
        };
        Ok(json!({"runtime":state,"runtime_generation":saved.map(|s|s.0)}))
    }

    pub fn save_resume_settings(&self, operation: &str, settings: Option<&Value>) -> Result<()> {
        self.0.execute(
            "UPDATE runtime_generations SET settings=?2 WHERE operation_id=?1",
            params![operation, settings.map(Value::to_string)],
        )?;
        Ok(())
    }

    pub fn resume_record(&self, session: &str) -> Result<Option<Value>> {
        self.0.query_row("SELECT generation,state,settings,operation_id FROM runtime_generations WHERE session_id=?1 ORDER BY generation DESC LIMIT 1",[session],|r|{
            let settings: Option<String> = r.get(2)?;
            Ok(json!({"generation":r.get::<_,i64>(0)?,"state":r.get::<_,String>(1)?,"settings":settings.and_then(|s|serde_json::from_str::<Value>(&s).ok()),"request_id":r.get::<_,String>(3)?}))
        }).optional().map_err(Into::into)
    }

    pub fn claim_resume(&self, request: &Value, expected: i64, settings: &Value) -> Result<Value> {
        let session = request["session_id"]
            .as_str()
            .context("invalid_input: missing session")?;
        let id = request["request_id"]
            .as_str()
            .context("invalid_input: missing request")?;
        let tx = self.0.unchecked_transaction()?;
        let previous = self
            .resume_record(session)?
            .context("outcome_unknown: runtime generation is unverified")?;
        ensure!(
            previous["generation"] == expected
                && ["stopped", "exited"]
                    .iter()
                    .any(|s| previous["state"] == *s),
            "outcome_unknown: runtime changed or its stop is unverified"
        );
        let generation = expected
            .checked_add(1)
            .context("invalid_input: runtime generation overflow")?;
        let receipt = json!({"request_id":id,"session_id":session,"action":"resume-instance","state":"pending","runtime":"starting","runtime_generation":generation,"window":"closed","registration":"active","actor":request["actor"],"effects":[{"phase":"start","state":"requested"}],"event_seq":null});
        self.begin_operation(id, request, &receipt)?;
        self.0.execute(
            "INSERT INTO runtime_generations VALUES (?1,?2,?3,'','starting',?4)",
            params![session, generation, id, settings.to_string()],
        )?;
        tx.commit()?;
        Ok(receipt)
    }

    pub fn register_resumed(
        &self,
        session: &str,
        generation: i64,
        operation: &str,
        server: &str,
        metadata: &Value,
    ) -> Result<()> {
        let tx = self.0.unchecked_transaction()?;
        ensure!(
            self.session(session)?["native_thread_id"] == metadata["id"],
            "thread_unavailable: saved conversation identity changed"
        );
        ensure!(self.0.execute("UPDATE runtime_generations SET state='running',server=?4,settings=?5 WHERE session_id=?1 AND generation=?2 AND operation_id=?3 AND state='starting'",params![session,generation,operation,server,metadata.get("resume_settings").map(Value::to_string)])? == 1,"outcome_unknown: runtime admission changed");
        ensure!(self.0.execute("UPDATE sessions SET server=?2,capture_generation=capture_generation+1 WHERE id=?1 AND removed_ms IS NULL",params![session,server])? == 1,"registration_removed: conversation registration changed");
        self.local(session,"capture.gap",json!({"reason":"conversation_resumed","replay_available":false,"runtime_generation":generation}))?;
        tx.commit()?;
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

    pub(crate) fn insert(
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

    pub fn record(&self, session: &str, generation: i64, observation: Observation) -> Result<()> {
        if self.generation(session)? != Some(generation) {
            return Ok(());
        }
        self.insert(
            session,
            observation.kind,
            observation.turn.as_deref(),
            Some(&observation.key),
            observation.occurred_ms,
            observation.payload,
        )
    }

    pub fn generation(&self, session: &str) -> Result<Option<i64>> {
        Ok(self.0.query_row("SELECT CASE WHEN removed_ms IS NULL THEN capture_generation ELSE NULL END FROM sessions WHERE id=?1", [session], |r| r.get(0)).optional()?.flatten())
    }

    pub fn require_registered(&self, session: &str) -> Result<()> {
        self.session(session)?;
        ensure!(
            self.generation(session)?.is_some(),
            "removed: instance is deregistered"
        );
        Ok(())
    }

    pub fn capture_local(
        &self,
        session: &str,
        generation: i64,
        kind: &str,
        payload: Value,
    ) -> Result<()> {
        if self.generation(session)? == Some(generation) {
            self.local(session, kind, payload)?;
        }
        Ok(())
    }

    pub fn remove(&self, session: &str) -> Result<()> {
        let transaction = self.0.unchecked_transaction()?;
        self.0.execute(
            "UPDATE sessions SET removed_ms=COALESCE(removed_ms,?2) WHERE id=?1",
            params![session, now()],
        )?;
        self.0.execute(
            "UPDATE runtime_generations SET settings=NULL WHERE session_id=?1",
            [session],
        )?;
        let edges: Vec<Value> = self
            .sessions()?
            .into_iter()
            .filter(|s| s["id"] == session || s["supervisor_id"] == session)
            .map(|s| json!({"session_id":s["id"],"supervisor_id":s["supervisor_id"]}))
            .collect();
        self.0.execute(
            "UPDATE sessions SET supervisor_id=NULL WHERE id=?1 OR supervisor_id=?1",
            [session],
        )?;
        self.local(
            session,
            "session.removed",
            json!({"history_retained":true,"cleared_assignments":edges}),
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn reactivate(&self, session: &str) -> Result<i64> {
        self.0.execute("UPDATE sessions SET removed_ms=NULL,capture_generation=capture_generation+1 WHERE id=?1", [session])?;
        self.generation(session)?.context("registration missing")
    }

    pub fn operation(&self, id: &str) -> Result<Option<(Value, Value)>> {
        let row: Option<(String, String)> = self
            .0
            .query_row(
                "SELECT inputs,receipt FROM operations WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        row.map(|(inputs, receipt)| {
            Ok((
                serde_json::from_str(&inputs)?,
                serde_json::from_str(&receipt)?,
            ))
        })
        .transpose()
    }

    pub(crate) fn viewer_receipt(&self, session: &str) -> Result<Option<Value>> {
        let receipt: Option<String> = self.0.query_row(
            "SELECT receipt FROM operations WHERE json_extract(receipt,'$.session_id')=?1 AND (json_type(receipt,'$.pid')='integer' OR json_extract(inputs,'$.op')='open') ORDER BY created_ms DESC,rowid DESC LIMIT 1",
            [session], |row| row.get(0),
        ).optional()?;
        receipt
            .map(|s| serde_json::from_str(&s).map_err(Into::into))
            .transpose()
    }

    pub fn begin_operation(&self, id: &str, inputs: &Value, receipt: &Value) -> Result<()> {
        self.0.execute(
            "INSERT INTO operations (id,inputs,receipt,created_ms,updated_ms,actor_session_id,actor_kind) VALUES (?1,?2,?3,?4,?4,?5,?6)",
            params![id, inputs.to_string(), receipt.to_string(), now(), inputs["actor"]["session_id"].as_str(), inputs["actor"]["kind"].as_str()],
        )?;
        Ok(())
    }

    pub fn save_operation(&self, id: &str, receipt: &Value) -> Result<()> {
        self.0.execute(
            "UPDATE operations SET receipt=?2,updated_ms=?3 WHERE id=?1",
            params![id, receipt.to_string(), now()],
        )?;
        Ok(())
    }

    pub fn reconcile_coordination(&self) -> Result<()> {
        let rows = {
            let mut query = self.0.prepare("SELECT id,inputs,receipt FROM operations WHERE json_extract(inputs,'$.op') IN ('adjudicate','escalate') AND json_extract(receipt,'$.delivery')='recorded' AND json_type(receipt,'$.task_request_id')='text'")?;
            query
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let transaction = self.0.unchecked_transaction()?;
        for (id, inputs, receipt) in rows {
            let inputs: Value = serde_json::from_str(&inputs)?;
            let mut receipt: Value = serde_json::from_str(&receipt)?;
            let task_id = receipt["task_request_id"]
                .as_str()
                .context("missing coordination task identity")?;
            let task = self.request(task_id)?;
            let (delivery, reason) = match task.as_ref() {
                Some(task)
                    if task["state"] == "accepted"
                        && task["native_turn_id"]
                            .as_str()
                            .is_some_and(|id| !id.is_empty()) =>
                {
                    ("accepted", None)
                }
                Some(task) if task["state"] == "failed" => (
                    "failed",
                    Some(task["error_code"].as_str().unwrap_or("provider_failed")),
                ),
                Some(task) if task["state"] == "pending" && task["dispatch_mode"].is_null() => {
                    ("failed", Some("service_restarted_before_dispatch"))
                }
                None => ("failed", Some("service_restarted_before_dispatch")),
                Some(_) => ("uncertain", Some("service_restarted_delivery_unconfirmed")),
            };
            receipt["delivery"] = json!(delivery);
            if let Some(reason) = reason {
                receipt["error"] = json!(format!(
                    "Native delivery {delivery}: {reason}; no automatic replay."
                ));
            } else {
                receipt
                    .as_object_mut()
                    .context("invalid coordination receipt")?
                    .remove("error");
            }
            self.local(receipt["session_id"].as_str().context("missing coordination sender")?, "coordination.delivery", json!({"request_id":id,"destination":receipt["destination"],"delivery":delivery,"actor":inputs["actor"],"reason":reason,"replay_available":false}))?;
            receipt["native_request"] = json!(task);
            self.save_operation(&id, &receipt)?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn events(&self, after: i64) -> Result<Value> {
        ensure!(after >= 0, "cursor must be nonnegative");
        let mut query = self.0.prepare("SELECT seq,event_id,session_id,e.kind,native_turn_id,source_key,occurred_ms,recorded_ms,payload,s.kind FROM events e JOIN sessions s ON s.id=e.session_id WHERE seq>?1 ORDER BY seq LIMIT 100")?;
        let rows = query.query_map([after], |r| {
            let raw: String = r.get(8)?;
            let payload: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            Ok(json!({"sequence":r.get::<_,i64>(0)?,"event_id":r.get::<_,String>(1)?,"session_id":r.get::<_,String>(2)?,"type":r.get::<_,String>(3)?,"native_turn_id":r.get::<_,Option<String>>(4)?,"source_key":r.get::<_,Option<String>>(5)?,"occurred_ms":r.get::<_,Option<i64>>(6)?,"recorded_ms":r.get::<_,i64>(7)?,"payload":payload,"schema_version":1,"capture_policy":if r.get::<_,String>(9)?=="shell"{"shell-commands-v1"}else{"conversation-v1"}}))
        })?.collect::<rusqlite::Result<Vec<_>>>()?;
        let cursor = rows
            .last()
            .and_then(|v| v["sequence"].as_i64())
            .unwrap_or(after);
        Ok(json!({"events":rows,"cursor":cursor}))
    }

    pub fn request(&self, id: &str) -> Result<Option<Value>> {
        Ok(self.0.query_row("SELECT session_id,message,state,native_turn_id,actor_session_id,actor_kind,authority,control_generation,purpose,about_request_id,dispatch_mode,expected_turn_id,error_code FROM requests WHERE id=?1",[id],|r|Ok(json!({"request_id":id,"session_id":r.get::<_,String>(0)?,"message":r.get::<_,String>(1)?,"state":r.get::<_,String>(2)?,"native_turn_id":r.get::<_,Option<String>>(3)?,"actor_session_id":r.get::<_,Option<String>>(4)?,"actor_kind":r.get::<_,Option<String>>(5)?,"authority":r.get::<_,Option<String>>(6)?,"control_generation":r.get::<_,Option<String>>(7)?,"purpose":r.get::<_,Option<String>>(8)?,"about_request_id":r.get::<_,Option<String>>(9)?,"dispatch_mode":r.get::<_,Option<String>>(10)?,"expected_turn_id":r.get::<_,Option<String>>(11)?,"error_code":r.get::<_,Option<String>>(12)?}))).optional()?)
    }

    pub fn begin_request(&self, id: &str, session: &str, message: &str) -> Result<()> {
        self.0.execute(
            "INSERT INTO requests (id,session_id,message,state,native_turn_id,created_ms) VALUES (?1,?2,?3,'pending',NULL,?4)",
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
