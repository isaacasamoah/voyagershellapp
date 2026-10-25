use super::{Runtime, Terminal, string};
use crate::{
    actions::{self, Action, PendingOperation, Phase},
    authority,
    codex::Codex,
    events,
    shell::Shell,
    terminal, viewer,
    worker::Worker,
};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    time::{Duration, Instant},
};

mod resume;

impl Runtime {
    pub(super) fn rename_instance(&mut self, request: &Value) -> Result<Value> {
        let id = actions::request_id(request)?;
        if let Some((inputs, receipt)) = self.store.operation(id)? {
            ensure!(
                inputs == *request,
                "request_conflict: rename ID has different inputs"
            );
            return Ok(receipt);
        }
        ensure!(
            self.store.request(id)?.is_none(),
            "request_conflict: ID already names a task"
        );
        let session = string(request, "session_id")?;
        let previous = self.store.session(session)?;
        let name = actions::name(string(request, "name")?)?;
        let transaction = self.store.0.unchecked_transaction()?;
        self.store.0.execute(
            "UPDATE sessions SET name=?2 WHERE id=?1",
            rusqlite::params![session, name],
        )?;
        self.store.local(
            session,
            "session.renamed",
            json!({"previous_name":previous["name"],"name":name,"request_id":id}),
        )?;
        let receipt = json!({"request_id":id,"session_id":session,"state":"completed","action":"rename","name":name,"event_seq":self.store.0.last_insert_rowid(),"actor":request["actor"]});
        self.store.begin_operation(id, request, &receipt)?;
        transaction.commit()?;
        Ok(receipt)
    }

    pub(super) fn create_operation(&mut self, request: &Value) -> Result<Value> {
        let id = actions::request_id(request)?;
        ensure!(
            id.len() <= 100,
            "invalid_input: creation ID must be at most 100 bytes"
        );
        let open = request.get("open").map_or(Ok(true), |v| {
            v.as_bool().context("invalid_input: open must be boolean")
        })?;
        let viewer = request
            .get("terminal")
            .map(viewer::Kind::parse)
            .transpose()?
            .unwrap_or(viewer::Kind::Ghostty);
        let (rank, supervisor) = authority::creation(
            &self.store,
            &request["actor"],
            self.control.session(),
            request,
        )?;
        let mut inputs = request.clone();
        if let Some(rank) = rank {
            inputs["rank"] = json!(rank.as_str());
        }
        if let Some(supervisor) = supervisor {
            inputs["supervisor_id"] = json!(supervisor);
        }
        inputs["open"] = json!(open);
        inputs["terminal"] = json!(viewer.as_str());
        if let Some((mut previous, receipt)) = self.store.operation(id)? {
            previous
                .as_object_mut()
                .context("creation inputs")?
                .remove("new_session_id");
            ensure!(
                previous == inputs,
                "request_conflict: creation ID has different inputs"
            );
            return Ok(receipt);
        }
        ensure!(
            self.store.launch(id)?.is_none(),
            "outcome_unknown: this launch predates operation receipts; inspect the existing instance"
        );
        ensure!(
            self.store.request(id)?.is_none(),
            "request_conflict: ID already names a task"
        );
        let cwd = fs::canonicalize(string(request, "cwd")?)
            .context("invalid_input: choose an existing folder")?;
        ensure!(cwd.is_dir(), "invalid_input: choose a folder, not a file");
        let cwd = cwd.to_str().context("invalid_input: folder is not UTF-8")?;
        let op = string(request, "op")?;
        let (kind, name, parent, prompt) = if op == "create" {
            let kind = string(request, "kind")?;
            ensure!(
                ["codex", "shell"].contains(&kind),
                "unsupported: instance kind"
            );
            let name = actions::name(string(request, "name")?)?;
            (kind, Some(name), None, None)
        } else {
            let parent = string(request, "parent_id")?;
            self.ensure_connected(parent)?;
            let prompt = string(request, "prompt")?;
            ensure!(
                prompt.len() <= events::TEXT_LIMIT,
                "invalid_input: initial task too long"
            );
            ("codex", None, Some(parent), Some(prompt))
        };
        inputs["new_session_id"] = json!(uuid::Uuid::new_v4().to_string());
        let receipt = json!({"request_id":id,"actor":request["actor"],"action":op,"session_id":null,"state":"pending","runtime":"unknown","window":"closed","registration":null,"effects":[{"phase":"start","state":"requested"}],"event_seq":null});
        self.store.begin_launch(id, parent, cwd, prompt, name)?;
        self.store.begin_operation(id, &inputs, &receipt)?;
        self.store
            .0
            .execute("UPDATE workers SET kind=?2 WHERE launch_id=?1", [id, kind])?;
        let context = match self.credentials.issue(
            &self.state,
            &self.instance,
            string(&inputs, "new_session_id")?,
            id,
        ) {
            Ok(context) => context,
            Err(error) => {
                self.fail_creation(id, error.to_string())?;
                return Ok(self
                    .store
                    .operation(id)?
                    .context("creation receipt missing")?
                    .1);
            }
        };
        if kind == "shell" {
            match Shell::start(&mut self.store, &self.state, &self.binary, id, cwd) {
                Ok(shell) => {
                    let session = shell.session.clone();
                    self.shells.insert(session.clone(), shell);
                    self.finish_creation(&inputs, &session)?;
                }
                Err(error) => self.fail_creation(id, error.to_string())?,
            }
        } else {
            match Worker::begin(
                &self.state,
                &self.binary,
                &self.executable,
                id,
                cwd,
                crate::worker::ThreadStart::New(name.map(str::to_owned)),
                &context,
            ) {
                Ok(startup) => {
                    self.creations.insert(id.into(), (inputs, startup));
                }
                Err(error) => self.fail_creation(id, error.to_string())?,
            }
        }
        Ok(self
            .store
            .operation(id)?
            .context("creation receipt missing")?
            .1)
    }

    fn fail_creation(&mut self, id: &str, error: String) -> Result<()> {
        self.store.worker_state(id, "failed")?;
        let (inputs, mut receipt) = self
            .store
            .operation(id)?
            .context("creation receipt missing")?;
        if let Some(session) = inputs["new_session_id"].as_str() {
            self.credentials.revoke(session)?;
        }
        receipt["state"] = json!("partial");
        receipt["error"] = json!(error);
        receipt["effects"][0]["state"] = json!("failed");
        self.store.save_operation(id, &receipt)
    }

    fn complete_creation(&mut self, request: &Value, session: &str) -> Result<()> {
        let id = actions::request_id(request)?;
        authority::creation(
            &self.store,
            &request["actor"],
            self.control.session(),
            request,
        )?;
        self.store.0.execute(
            "UPDATE sessions SET rank=?2,supervisor_id=?3 WHERE id=?1",
            rusqlite::params![
                session,
                request["rank"].as_str(),
                request["supervisor_id"].as_str()
            ],
        )?;
        let kind = viewer::Kind::parse(&request["terminal"])?;
        self.viewer_choices.insert(session.to_owned(), kind);
        let mut operation = PendingOperation::new(id, session, Action::Open(kind));
        operation.receipt["actor"] = request["actor"].clone();
        operation.receipt["action"] = request["op"].clone();
        let record = self.store.session(session)?;
        for field in ["name", "cwd", "parent_id", "kind", "rank", "supervisor_id"] {
            operation.receipt[field] = record[field].clone();
        }
        operation.receipt["runtime_pid"] =
            self.store.launch(id)?.context("launch missing")?["pid"].clone();
        operation.receipt["native_thread_id"] =
            self.store.session(session)?["native_thread_id"].clone();
        operation.effect("start", "confirmed");
        self.snapshot_operation(&mut operation)?;
        if request["op"] == "launch" {
            let native = self.store.session(session)?["native_thread_id"]
                .as_str()
                .context("native identity missing")?
                .to_owned();
            let native_request = self.connection(session)?.begin_rpc(
                "thread/read",
                json!({"threadId":native,"includeTurns":false}),
            )?;
            operation.phase = Phase::LaunchIdle {
                request: native_request,
            };
            self.store.local(
                string(request, "parent_id")?,
                "worker.launched",
                json!({"worker_session_id":session,"launch_id":id,"scope":"private"}),
            )?;
        } else if request["open"] == false {
            operation.receipt["state"] = json!("completed");
        }
        self.store.save_operation(id, &operation.receipt)?;
        if operation.receipt["state"] == "pending" {
            self.operations.insert(id.into(), operation);
        }
        Ok(())
    }

    fn finish_creation(&mut self, request: &Value, session: &str) -> Result<()> {
        if let Err(error) = self.complete_creation(request, session) {
            let id = actions::request_id(request)?;
            let mut receipt = self
                .store
                .operation(id)?
                .context("creation receipt missing")?
                .1;
            receipt["session_id"] = json!(session);
            receipt["state"] = json!("partial");
            receipt["runtime"] = json!("running");
            receipt["registration"] = json!("active");
            receipt["error"] = json!(error.to_string());
            self.store.save_operation(id, &receipt)?;
        }
        Ok(())
    }

    pub(super) fn advance_creations(&mut self) -> Result<()> {
        let ids: Vec<_> = self.creations.keys().cloned().collect();
        for id in ids {
            let (request, mut startup) = self.creations.remove(&id).context("startup missing")?;
            if startup.cleaning() {
                if let Some((error, no_effect)) = startup.poll_cleanup()? {
                    self.fail_resume(&id, error, no_effect)?;
                } else {
                    self.creations.insert(id, (request, startup));
                }
                continue;
            }
            match startup.poll(&mut self.store) {
                Ok(Some(worker)) => {
                    let session = worker.session.clone();
                    self.workers.insert(session.clone(), worker);
                    if request["op"] == "resume-instance" {
                        self.finish_resume(&request, &session)?;
                    } else {
                        self.finish_creation(&request, &session)?;
                    }
                }
                Ok(None) => {
                    self.creations.insert(id, (request, startup));
                }
                Err(error) => {
                    if request["op"] == "resume-instance" {
                        startup.begin_cleanup(error.to_string())?;
                        self.creations.insert(id, (request, startup));
                    } else {
                        self.fail_creation(&id, error.to_string())?;
                    }
                }
            }
        }
        Ok(())
    }

    pub(super) fn begin_action(&mut self, request: &Value, action: Action) -> Result<Value> {
        let id = actions::request_id(request)?;
        let session = string(request, "session_id")?;
        let mut inputs = action.inputs(session, request.get("control_generation"));
        inputs["actor"] = request["actor"].clone();
        if let Some((previous, receipt)) = self.store.operation(id)? {
            ensure!(
                previous == inputs,
                "request_conflict: operation ID has different inputs"
            );
            return Ok(receipt);
        }
        ensure!(
            self.store.request(id)?.is_none(),
            "request_conflict: ID already names a task"
        );
        let record = self.store.session(session)?;
        ensure!(
            !self
                .creations
                .values()
                .any(|(r, _)| r["op"] == "resume-instance" && r["session_id"] == session),
            "busy: conversation resume is pending"
        );
        ensure!(
            !self
                .native_calls
                .iter()
                .any(|p| p.targets(session, record["native_thread_id"].as_str().unwrap_or(""))),
            "busy: a native action on this instance is pending"
        );
        ensure!(
            !self.operations.values().any(|p| p.session == session),
            "busy: another lifecycle action is pending"
        );
        if matches!(
            action,
            Action::Stop { .. }
                | Action::Background
                | Action::Open(_)
                | Action::Remove { stop: true }
        ) {
            ensure!(
                record["ownership"] == "managed",
                "external_owner: Voyager does not own this runtime or window"
            );
            ensure!(
                self.workers.contains_key(session) || self.shells.contains_key(session),
                "outcome_unknown: runtime ownership was lost; inspect before acting"
            );
        }
        let mut pending = PendingOperation::new(id, session, action);
        pending.receipt["actor"] = request["actor"].clone();
        self.snapshot_operation(&mut pending)?;
        self.store.begin_operation(id, &inputs, &pending.receipt)?;
        let receipt = pending.receipt.clone();
        self.operations.insert(id.into(), pending);
        Ok(receipt)
    }

    fn snapshot_operation(&mut self, operation: &mut PendingOperation) -> Result<()> {
        let id = &operation.session;
        let record = self.store.session(id)?;
        operation.receipt["registration"] = json!(if record["removed_ms"].is_null() {
            "active"
        } else {
            "removed"
        });
        operation.receipt["runtime"] = json!(if record["ownership"] == "external" {
            "external"
        } else if self.workers.get(id).is_some_and(|w| w.alive)
            || self.shells.get(id).is_some_and(|s| s.alive)
        {
            "running"
        } else if self.workers.contains_key(id) || self.shells.contains_key(id) {
            "stopped"
        } else {
            "unknown"
        });
        let mut window_state = "closed";
        for terminal in self.terminals.iter_mut().filter(|t| &t.session == id) {
            match terminal.window_state() {
                "open" => {
                    window_state = "open";
                    break;
                }
                "unknown" if terminal.window.is_some() || terminal.child.try_wait()?.is_none() => {
                    window_state = "unknown";
                }
                _ => {}
            }
        }
        operation.receipt["window"] = json!(if matches!(operation.phase, Phase::WaitOpen) {
            "unknown"
        } else if matches!(operation.phase, Phase::WaitClose { .. }) {
            "close_requested"
        } else {
            window_state
        });
        Ok(())
    }

    pub(super) fn advance_operations(&mut self) -> Result<()> {
        let ids: Vec<_> = self.operations.keys().cloned().collect();
        for id in ids {
            let mut operation = self
                .operations
                .remove(&id)
                .context("pending operation missing")?;
            match self.advance_operation(&mut operation) {
                Ok(done) => {
                    self.snapshot_operation(&mut operation)?;
                    if done {
                        operation.receipt["state"] = json!("completed");
                    }
                }
                Err(error) => {
                    self.snapshot_operation(&mut operation)?;
                    operation.receipt["state"] = json!(if operation.receipt["effects"]
                        .as_array()
                        .is_some_and(|e| e.iter().any(|e| e["state"] == "requested"))
                    {
                        "uncertain"
                    } else {
                        "partial"
                    });
                    operation.receipt["error"] = json!(error.to_string());
                }
            }
            if operation.receipt["state"] != "pending" {
                self.store.local(&operation.session, "operation.finished", json!({"request_id":id,"action":operation.action.name(),"state":operation.receipt["state"]}))?;
                operation.receipt["event_seq"] = json!(self.store.0.query_row(
                    "SELECT max(seq) FROM events WHERE session_id=?1",
                    [&operation.session],
                    |r| r.get::<_, Option<i64>>(0)
                )?);
            }
            self.store.save_operation(&id, &operation.receipt)?;
            if operation.receipt["state"] == "pending" {
                self.operations.insert(id, operation);
            }
        }
        Ok(())
    }

    fn advance_operation(&mut self, operation: &mut PendingOperation) -> Result<bool> {
        ensure!(
            Instant::now() < operation.deadline,
            "outcome_unknown: lifecycle acknowledgement timed out; inspect this operation before trying another action"
        );
        let id = operation.session.clone();
        if matches!(
            operation.phase,
            Phase::Start | Phase::Close | Phase::Remove | Phase::LaunchIdle { .. }
        ) {
            let inputs = self
                .store
                .operation(&operation.id)?
                .context("operation missing")?
                .0;
            self.authorize(&inputs)?;
        }
        if let Some(generation) = self
            .store
            .operation(&operation.id)?
            .and_then(|(inputs, _)| inputs["control_generation"].as_str().map(str::to_owned))
        {
            if matches!(
                operation.phase,
                Phase::Start | Phase::Close | Phase::LaunchIdle { .. }
            ) {
                self.control.require(&generation)?;
            }
        }
        match std::mem::replace(&mut operation.phase, Phase::Start) {
            Phase::Start => match operation.action {
                Action::Open(kind) => {
                    for terminal in self.terminals.iter_mut().rev().filter(|t| t.session == id) {
                        if terminal.child.try_wait()?.is_some() {
                            ensure!(
                                terminal.window.map(terminal::exists).transpose()? != Some(true),
                                "outcome_unknown: the previous terminal window is still closing"
                            );
                        } else {
                            let window = terminal.window.context(
                                "outcome_unknown: terminal opening has not been identified",
                            )?;
                            if !terminal::exists(window)? {
                                continue;
                            }
                            ensure!(
                                terminal::window(terminal.child.id())? == Some(window),
                                "outcome_unknown: terminal window identity changed"
                            );
                            ensure!(
                                self.shells
                                    .get(&id)
                                    .is_none_or(|shell| shell.viewer_connected()),
                                "provider_failed: terminal has no attached shell viewer; close it before reopening"
                            );
                            ensure!(
                                terminal.kind == kind,
                                "viewer_conflict: background the current viewer before selecting another terminal"
                            );
                            terminal::focus(terminal.child.id())?;
                            operation.receipt["terminal"] = json!(kind.as_str());
                            operation.receipt["window_id"] = json!(window);
                            operation.receipt["pid"] = json!(terminal.child.id());
                            operation.effect("open", "confirmed");
                            self.store.local(
                                &id,
                                "interface.focus_requested",
                                json!({"window_id":window,"request_id":operation.id}),
                            )?;
                            return Ok(true);
                        }
                    }
                    let info = self.attachment(&id)?;
                    let child = viewer::open_instance(kind, &info, &self.store.session(&id)?)?;
                    let pid = child.id();
                    self.viewer_choices.insert(id.clone(), kind);
                    operation.receipt["terminal"] = json!(kind.as_str());
                    self.terminals.push(Terminal {
                        kind,
                        session: id.clone(),
                        child,
                        window: None,
                    });
                    operation.receipt["pid"] = json!(pid);
                    operation.effect("open", "requested");
                    operation.phase = Phase::WaitOpen;
                    self.store.local(
                        &id,
                        "interface.open_requested",
                        json!({"pid":pid,"request_id":operation.id}),
                    )?;
                    Ok(false)
                }
                Action::Background => {
                    operation.phase = Phase::Close;
                    Ok(false)
                }
                Action::Remove { stop: false } => {
                    operation.phase = Phase::Remove;
                    Ok(false)
                }
                Action::Stop { .. } | Action::Remove { stop: true } => {
                    if operation.receipt["runtime"] == "stopped" {
                        operation.effect("stop", "confirmed");
                        operation.phase = if operation.action == (Action::Stop { close: false }) {
                            return Ok(true);
                        } else {
                            Phase::Close
                        };
                        return Ok(false);
                    }
                    self.store.local(
                        &id,
                        "instance.stop_requested",
                        json!({"request_id":operation.id}),
                    )?;
                    if let Some(worker) = self.workers.get_mut(&id) {
                        worker.request_stop(false)?;
                    } else {
                        self.shells
                            .get_mut(&id)
                            .context("outcome_unknown: no owned process")?
                            .request_stop(false)?;
                    }
                    operation.effect("stop", "requested");
                    operation.phase = Phase::WaitStop {
                        force_at: Instant::now() + Duration::from_secs(2),
                        forced: false,
                    };
                    Ok(false)
                }
                Action::Register => {
                    ensure!(
                        self.store.generation(&id)?.is_none(),
                        "invalid_input: instance is already registered"
                    );
                    if let Some(shell) = self.shells.get_mut(&id) {
                        let next = self.store.session(&id)?["capture_generation"]
                            .as_i64()
                            .context("capture generation missing")?
                            + 1;
                        shell.require_registration_boundary()?;
                        self.store.reactivate(&id)?;
                        let launch: String = self.store.0.query_row(
                            "SELECT launch_id FROM workers WHERE session_id=?1",
                            [&id],
                            |r| r.get(0),
                        )?;
                        self.credentials
                            .issue(&self.state, &self.instance, &id, &launch)?;
                        shell.reactivate(next);
                        self.store.local(
                            &id,
                            "capture.started",
                            json!({"history_imported":false,"generation":next}),
                        )?;
                        operation.effect("register", "confirmed");
                        Ok(true)
                    } else {
                        let server = self.store.session(&id)?["server"]
                            .as_str()
                            .context("native server missing")?
                            .to_owned();
                        if let Some(worker) = self.workers.get(&id) {
                            ensure!(worker.alive, "outcome_unknown: native runtime ended");
                        }
                        operation.phase = Phase::RegisterConnect {
                            connection: std::thread::spawn(move || {
                                Codex::connect(Path::new(&server))
                            }),
                        };
                        Ok(false)
                    }
                }
            },
            Phase::WaitStop { force_at, forced } => {
                let alive = self.workers.get(&id).is_some_and(|w| w.alive)
                    || self.shells.get(&id).is_some_and(|s| s.alive);
                if !alive {
                    if let Some(worker) = self.workers.get(&id) {
                        worker.stopped(&self.store)?;
                    }
                    if let Some(shell) = self.shells.get(&id) {
                        shell.stopped(&self.store)?;
                    }
                    operation.effect("stop", "confirmed");
                    if operation.action == (Action::Stop { close: false }) {
                        return Ok(true);
                    }
                    operation.phase = Phase::Close;
                } else {
                    let escalate = !forced && Instant::now() >= force_at;
                    if escalate {
                        if let Some(worker) = self.workers.get_mut(&id) {
                            worker.request_stop(true)?;
                        }
                        if let Some(shell) = self.shells.get_mut(&id) {
                            shell.request_stop(true)?;
                        }
                    }
                    operation.phase = Phase::WaitStop {
                        force_at,
                        forced: forced || escalate,
                    };
                }
                Ok(false)
            }
            Phase::Close => {
                if let Some(terminal) = self.terminals.iter_mut().rev().find(|t| t.session == id) {
                    if let Some(window) = terminal.window {
                        if terminal::exists(window)? {
                            if terminal.child.try_wait()?.is_none() {
                                ensure!(
                                    terminal::window(terminal.child.id())? == Some(window),
                                    "outcome_unknown: terminal window identity changed"
                                );
                                terminal::close(terminal.child.id())?;
                            }
                            operation.effect("close", "requested");
                            operation.phase = Phase::WaitClose { window };
                            return Ok(false);
                        }
                    } else {
                        ensure!(
                            terminal.child.try_wait()?.is_some(),
                            "outcome_unknown: terminal opening has not been identified"
                        );
                    }
                }
                self.finish_close(operation)
            }
            Phase::WaitClose { window } => {
                if !terminal::exists(window)? {
                    self.finish_close(operation)
                } else {
                    operation.phase = Phase::WaitClose { window };
                    Ok(false)
                }
            }
            Phase::WaitOpen => {
                let pid = operation.receipt["pid"]
                    .as_u64()
                    .context("opening process missing")?;
                let terminal = self
                    .terminals
                    .iter_mut()
                    .find(|t| t.session == id && u64::from(t.child.id()) == pid)
                    .context("provider_failed: terminal exited before opening")?;
                ensure!(
                    terminal.child.try_wait()?.is_none(),
                    "provider_failed: terminal exited before opening"
                );
                if let Some(window) = terminal::window(terminal.child.id())? {
                    terminal.window = Some(window);
                    operation.receipt["window_id"] = json!(window);
                    if self
                        .shells
                        .get(&id)
                        .is_some_and(|shell| !shell.viewer_connected())
                    {
                        operation.phase = Phase::WaitOpen;
                        return Ok(false);
                    }
                    operation.effect("open", "confirmed");
                    Ok(true)
                } else {
                    operation.phase = Phase::WaitOpen;
                    Ok(false)
                }
            }
            Phase::Remove => {
                self.store.remove(&id)?;
                self.credentials.revoke(&id)?;
                if let Some(shell) = self.shells.get_mut(&id) {
                    shell.deregister();
                }
                let native = self.store.session(&id)?["native_thread_id"]
                    .as_str()
                    .context("native identity missing")?
                    .to_owned();
                self.registered.remove(&native);
                self.captures.remove(&id);
                if self.control.session() == Some(id.as_str()) {
                    self.control.release(&self.store, None, "removed")?;
                }
                operation.effect("remove", "confirmed");
                Ok(true)
            }
            Phase::LaunchIdle { request } => {
                if let Some(metadata) = self.connection(&id)?.poll_rpc(request)? {
                    ensure!(
                        metadata["thread"]["status"]["type"] == "idle",
                        "busy: new worker is not idle"
                    );
                    let inputs = self
                        .store
                        .operation(&operation.id)?
                        .context("launch missing")?
                        .0;
                    let task = format!("launch:{}", operation.id);
                    let prompt = string(&inputs, "prompt")?;
                    self.store.begin_request(&task, &id, prompt)?;
                    self.store.0.execute("UPDATE requests SET actor_kind=?2,actor_session_id=?3,authority=?4,control_generation=?5,purpose='instruction',dispatch_mode='start',state='uncertain' WHERE id=?1",rusqlite::params![task,inputs["actor"]["kind"].as_str(),inputs["actor"]["session_id"].as_str(),if crate::authority::is_owner(&inputs["actor"]) {"owner"} else {"supervisor"},inputs["control_generation"].as_str()])?;
                    let native = self.store.session(&id)?["native_thread_id"]
                        .as_str()
                        .context("native identity missing")?
                        .to_owned();
                    operation.effect("dispatch", "requested");
                    self.store
                        .save_operation(&operation.id, &operation.receipt)?;
                    let request=self.connection(&id)?.begin_rpc("turn/start",json!({"threadId":native,"clientUserMessageId":task,"input":[{"type":"text","text":prompt}]}))?;
                    operation.phase = Phase::LaunchTurn { request };
                    Ok(false)
                } else {
                    operation.phase = Phase::LaunchIdle { request };
                    Ok(false)
                }
            }
            Phase::LaunchTurn { request } => {
                if let Some(reply) = self.connection(&id)?.poll_rpc(request)? {
                    let task = format!("launch:{}", operation.id);
                    self.store.accepted(
                        &task,
                        reply["turn"]["id"]
                            .as_str()
                            .context("outcome_unknown: initial task has no turn identity")?,
                    )?;
                    operation.receipt["initial_request"] = json!(self.store.request(&task)?);
                    operation.receipt["task_state"] = json!("accepted");
                    operation.effect("dispatch", "confirmed");
                    let inputs = self
                        .store
                        .operation(&operation.id)?
                        .context("launch missing")?
                        .0;
                    if inputs["open"] == false {
                        Ok(true)
                    } else {
                        operation.phase = Phase::Start;
                        Ok(false)
                    }
                } else {
                    operation.phase = Phase::LaunchTurn { request };
                    Ok(false)
                }
            }
            Phase::RegisterConnect { connection } => {
                if !connection.is_finished() {
                    operation.phase = Phase::RegisterConnect { connection };
                    return Ok(false);
                }
                let mut connection = connection.join().map_err(|_| {
                    anyhow::anyhow!("provider_failed: native connection thread ended")
                })??;
                let native = self.store.session(&id)?["native_thread_id"]
                    .as_str()
                    .context("native identity missing")?
                    .to_owned();
                let request = connection.begin_rpc(
                    "thread/resume",
                    json!({"threadId":native,"excludeTurns":true}),
                )?;
                operation.phase = Phase::RegisterResume {
                    connection: Box::new(connection),
                    request,
                };
                Ok(false)
            }
            Phase::RegisterResume {
                mut connection,
                request,
            } => {
                if let Some(reply) = connection.poll_rpc(request)? {
                    let native = self.store.session(&id)?["native_thread_id"]
                        .as_str()
                        .context("native identity missing")?
                        .to_owned();
                    ensure!(
                        reply["thread"]["id"] == native,
                        "provider_failed: native subscription identity mismatch"
                    );
                    connection.pending.clear();
                    let generation = self.store.reactivate(&id)?;
                    let launch = self
                        .store
                        .sessions()?
                        .into_iter()
                        .find(|s| s["id"] == id)
                        .and_then(|s| {
                            self.store
                                .0
                                .query_row(
                                    "SELECT launch_id FROM workers WHERE session_id=?1",
                                    [s["id"].as_str().unwrap_or("")],
                                    |r| r.get::<_, String>(0),
                                )
                                .ok()
                        })
                        .unwrap_or_else(|| id.clone());
                    self.credentials
                        .issue(&self.state, &self.instance, &id, &launch)?;
                    if let Some(worker) = self.workers.get_mut(&id) {
                        worker.connection = Some(*connection);
                        worker.generation = generation;
                    } else {
                        self.captures.insert(id.clone(), (*connection, generation));
                    }
                    self.store.local(&id,"capture.started",json!({"generation":generation,"history_imported":false,"source":"new_native_subscription"}))?;
                    operation.effect("register", "confirmed");
                    Ok(true)
                } else {
                    operation.phase = Phase::RegisterResume {
                        connection,
                        request,
                    };
                    Ok(false)
                }
            }
        }
    }

    pub(super) fn capture_count(&self) -> Result<usize> {
        let mut count = self.registered.len() + self.captures.len();
        for worker in self.workers.values() {
            if worker.connection.is_some() && self.store.generation(&worker.session)?.is_some() {
                count += 1;
            }
        }
        count += self.shells.values().filter(|s| s.connected()).count();
        Ok(count)
    }

    fn finish_close(&self, operation: &mut PendingOperation) -> Result<bool> {
        operation.effect("close", "confirmed");
        self.store.local(&operation.session,"interface.closed",json!({"request_id":operation.id,"runtime_stopped":operation.action != Action::Background}))?;
        if operation.action == (Action::Remove { stop: true }) {
            operation.phase = Phase::Remove;
            Ok(false)
        } else {
            Ok(true)
        }
    }
}
