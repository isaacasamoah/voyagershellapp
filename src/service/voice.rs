use super::{Runtime, string};
use crate::{actions, authority, codex::Codex, terminal};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    time::{Duration, Instant},
};

#[derive(Clone)]
struct Target {
    id: String,
    server: PathBuf,
    native: String,
}
#[derive(Clone)]
struct Plan {
    id: String,
    target: String,
    generation: u64,
    terminal: Option<Value>,
    private_stop: String,
}
enum Command {
    Sync(Vec<Target>),
    Select(Plan),
}
struct Update {
    id: String,
    generation: u64,
    result: Result<Value, String>,
}
pub(super) struct Voice {
    commands: Sender<Command>,
    updates: Receiver<Update>,
    generation: Arc<AtomicU64>,
    pending: Option<Plan>,
    pub(super) dock_generation: Option<String>,
    signature: String,
    state: Value,
}
impl Voice {
    pub(super) fn new() -> Self {
        let (commands, input) = mpsc::channel();
        let (output, updates) = mpsc::channel();
        let generation = Arc::new(AtomicU64::new(0));
        let current = generation.clone();
        std::thread::spawn(move || run(input, output, current));
        Self {
            commands,
            updates,
            generation,
            pending: None,
            dock_generation: None,
            signature: String::new(),
            state: json!({"target":"none","state":"off"}),
        }
    }
    pub(super) fn status(&self, config: Value) -> Value {
        let mut status = self.state.clone();
        status["follows_dock"] = config["follows_dock"].clone();
        status
    }
    pub(super) fn permits_app(&self) -> bool {
        self.state["target"] == "app" && self.state["state"] == "ready"
    }
}
fn stop(target: &Target, connection: &mut Codex) -> Result<()> {
    connection.pending.clear();
    connection.rpc("thread/realtime/stop", json!({"threadId":target.native}))?;
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        let note = match connection.pending.pop_front() {
            Some(value) => Some(value),
            None => connection.read()?,
        };
        if note.is_some_and(|value| {
            value["method"] == "thread/realtime/closed"
                && value["params"]["threadId"] == target.native
        }) {
            return Ok(());
        }
    }
    anyhow::bail!("outcome_unknown: native voice stop did not complete")
}
fn run(input: Receiver<Command>, output: Sender<Update>, generation: Arc<AtomicU64>) {
    let mut connections: HashMap<String, (Target, Codex)> = HashMap::new();
    let mut desired = String::from("none");
    let mut selected_generation = 0;
    let mut expected = Vec::new();
    loop {
        match input.recv_timeout(Duration::from_millis(25)) {
            Ok(Command::Sync(targets)) => {
                expected = targets.iter().map(|t| t.id.clone()).collect();
                connections.retain(|id, _| targets.iter().any(|t| &t.id == id));
                for target in targets {
                    if connections.contains_key(&target.id) {
                        continue;
                    }
                    let joined = (|| -> Result<Codex> {
                        let mut connection = Codex::connect(&target.server)?;
                        connection.rpc(
                            "thread/resume",
                            json!({"threadId":target.native,"excludeTurns":true}),
                        )?;
                        stop(&target, &mut connection)?;
                        Ok(connection)
                    })();
                    match joined {
                        Ok(connection) => {
                            if desired == target.id {
                                let _ = output.send(Update {
                                    id: String::new(),
                                    generation: selected_generation,
                                    result: Ok(json!({"target":desired,"state":"off"})),
                                });
                            }
                            connections.insert(target.id.clone(), (target, connection));
                        }
                        Err(error) => {
                            let _ = output.send(Update { id:String::new(), generation:selected_generation,
                                result:Err(format!("outcome_unknown: could not reconcile participating voice: {error}")) });
                        }
                    }
                }
            }
            Ok(Command::Select(plan)) => {
                desired = plan.target.clone();
                selected_generation = plan.generation;
                let result = (|| -> Result<Value> {
                    ensure!(expected.iter().all(|id| connections.contains_key(id)), "outcome_unknown: cannot confirm voice stopped for every participating vessel");
                    for (target, connection) in connections.values_mut() {
                        stop(target, connection)?;
                    }
                    ensure!(generation.load(Ordering::SeqCst) == plan.generation, "stale_control: voice target changed");
                    if let Some(attachment) = &plan.terminal {
                        let (target, connection) = connections.get_mut(&plan.target).context("native voice connection is unavailable")?;
                        connection.pending.clear();
                        terminal::voice_toggle(attachment)?;
                        let deadline = Instant::now()+Duration::from_secs(12);
                        loop {
                            ensure!(generation.load(Ordering::SeqCst) == plan.generation, "stale_control: voice target changed");
                            ensure!(Instant::now() < deadline, "outcome_unknown: native voice did not confirm startup; shortcut was not retried");
                            let note = match connection.pending.pop_front() { Some(v)=>Some(v), None=>connection.read()? };
                            if let Some(note) = note {
                                if note["params"]["threadId"] != target.native { continue; }
                                match note["method"].as_str() {
                                    Some("thread/realtime/started")=>break,
                                    Some("thread/realtime/error"|"thread/realtime/closed")=>anyhow::bail!("native voice could not start"),
                                    _=>(),
                                }
                            }
                            std::thread::sleep(Duration::from_millis(5));
                        }
                    }
                    Ok(json!({"target":plan.target,"state":if plan.terminal.is_some(){"on"}else if plan.target=="app"{"ready"}else{"off"}}))
                })().map_err(|e| e.to_string());
                if result.is_err() {
                    desired = "none".into();
                    for (target, connection) in connections.values_mut() {
                        let _ = connection
                            .rpc("thread/realtime/stop", json!({"threadId":target.native}));
                    }
                }
                let _ = output.send(Update {
                    id: plan.id,
                    generation: plan.generation,
                    result,
                });
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => (),
        }
        let mut disconnected = Vec::new();
        for (id, (target, connection)) in &mut connections {
            let note = match connection.pending.pop_front() {
                Some(note) => Some(note),
                None => match connection.read() {
                    Ok(note) => note,
                    Err(_) => {
                        disconnected.push(id.clone());
                        None
                    }
                },
            };
            if let Some(note) = note {
                if note["params"]["threadId"] != target.native {
                    continue;
                }
                if note["method"] == "thread/realtime/started" && id != &desired {
                    let _ =
                        connection.rpc("thread/realtime/stop", json!({"threadId":target.native}));
                } else if id == &desired
                    && ["thread/realtime/closed", "thread/realtime/error"]
                        .iter()
                        .any(|name| note["method"] == *name)
                {
                    let _ = output.send(Update {
                        id: String::new(),
                        generation: selected_generation,
                        result: Ok(json!({"target":id,"state":"off"})),
                    });
                }
            }
        }
        if !disconnected.is_empty() {
            for id in disconnected {
                connections.remove(&id);
            }
            for (target, connection) in connections.values_mut() {
                let _ = stop(target, connection);
            }
            desired = "none".into();
            let _ = output.send(Update {
                id: String::new(),
                generation: selected_generation,
                result: Err("outcome_unknown: participating voice connection was lost".into()),
            });
        }
    }
    for (target, connection) in connections.values_mut() {
        let _ = connection.rpc("thread/realtime/stop", json!({"threadId":target.native}));
    }
}
impl Runtime {
    pub(super) fn select_voice(&mut self, request: &Value) -> Result<Value> {
        ensure!(
            authority::is_owner(&request["actor"]),
            "forbidden: voice belongs to the owner"
        );
        let id = actions::request_id(request)?;
        if let Some((inputs, receipt)) = self.store.operation(id)? {
            ensure!(
                inputs == *request,
                "request_conflict: voice request changed"
            );
            return Ok(receipt);
        }
        let target = string(request, "target")?;
        let attachment = if ["app", "none"].contains(&target) {
            ensure!(
                target != "app" || self.control.session().is_none(),
                "forbidden: docked voice belongs to the vessel"
            );
            None
        } else {
            ensure!(
                self.control.session() == Some(target),
                "stale_control: voice target is not docked"
            );
            let session = self.store.session(target)?;
            ensure!(
                session["kind"] == "codex",
                "unsupported: this vessel has no native voice adapter"
            );
            let mut attachment = self.control.current();
            attachment["server"] = session["server"].clone();
            attachment["native_thread_id"] = session["native_thread_id"].clone();
            attachment["executable"] = json!(self.executable);
            Some(attachment)
        };
        ensure!(
            self.store.request(id)?.is_none(),
            "request_conflict: ID already names a task"
        );
        let private_stop = self.conversation.quiesce_voice()?;
        let generation = self.voice.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(previous) = self.voice.pending.take() {
            let mut receipt = self
                .store
                .operation(&previous.id)?
                .context("voice receipt missing")?
                .1;
            receipt["state"] = json!("cancelled");
            self.store.save_operation(&previous.id, &receipt)?;
        }
        self.voice.signature.clear();
        let receipt = json!({"request_id":id,"action":"voice","state":"pending","target":target,"actor":request["actor"]});
        self.store.begin_operation(id, request, &receipt)?;
        self.voice.state = json!({"target":target,"state":"switching"});
        self.voice.pending = Some(Plan {
            id: id.into(),
            target: target.into(),
            generation,
            terminal: attachment,
            private_stop,
        });
        Ok(receipt)
    }
    pub(super) fn observe_voice(&mut self) -> Result<()> {
        let mut targets: Vec<_> = self
            .store
            .sessions()?
            .into_iter()
            .filter(|s| {
                s["kind"] == "codex"
                    && s["removed_ms"].is_null()
                    && !["stopped", "exited", "failed"]
                        .iter()
                        .any(|state| s["worker_state"] == *state)
            })
            .collect();
        if self.control.voice()["follows_dock"] != true
            && self.voice.state["target"] == "none"
            && self.voice.pending.is_none()
        {
            targets.clear();
        }
        let signature = serde_json::to_string(
            &targets
                .iter()
                .map(|s| (&s["id"], &s["server"]))
                .collect::<Vec<_>>(),
        )?;
        if self.voice.signature != signature {
            self.voice.commands.send(Command::Sync(
                targets
                    .iter()
                    .map(|s| Target {
                        id: s["id"].as_str().unwrap().into(),
                        server: s["server"].as_str().unwrap().into(),
                        native: s["native_thread_id"].as_str().unwrap().into(),
                    })
                    .collect(),
            ))?;
            self.voice.signature = signature;
        }
        while let Ok(update) = self.voice.updates.try_recv() {
            if update.id.is_empty() {
                if update.generation == self.voice.generation.load(Ordering::SeqCst) {
                    match update.result {
                        Ok(status) => self.voice.state = status,
                        Err(error) => {
                            let _ = self.conversation.quiesce_voice();
                            self.voice.state =
                                json!({"target":"none","state":"failed","error":error});
                        }
                    }
                }
                continue;
            }
            let mut receipt = self
                .store
                .operation(&update.id)?
                .context("voice receipt missing")?
                .1;
            if update.generation != self.voice.generation.load(Ordering::SeqCst) {
                receipt["state"] = json!("cancelled");
            } else {
                match update.result {
                    Ok(state) => {
                        self.voice.state = state;
                        receipt["state"] = json!("completed");
                    }
                    Err(error) => {
                        self.voice.state["state"] = json!("failed");
                        self.voice.state["error"] = json!(error);
                        receipt["state"] = json!("uncertain");
                        receipt["error"] = json!(error);
                    }
                }
            }
            self.store.save_operation(&update.id, &receipt)?;
        }
        if let Some(plan) = &self.voice.pending {
            let receipt = self.conversation.receipt(&plan.private_stop)?;
            if receipt["state"] == "completed" {
                self.voice
                    .commands
                    .send(Command::Select(self.voice.pending.take().unwrap()))?;
            } else if receipt["state"] == "uncertain" {
                let plan = self.voice.pending.take().unwrap();
                let mut receipt = self.store.operation(&plan.id)?.unwrap().1;
                receipt["state"] = json!("uncertain");
                receipt["error"] = json!("Could not confirm the previous voice stopped.");
                self.store.save_operation(&plan.id, &receipt)?;
                self.voice.state["state"] = json!("failed");
            }
        }
        let dock = self.control.current()["generation"]
            .as_str()
            .map(str::to_owned);
        if dock != self.voice.dock_generation {
            self.voice.dock_generation = dock.clone();
            if self.control.voice()["follows_dock"] == true
                || (dock.is_none()
                    && !["app", "none"]
                        .iter()
                        .any(|name| self.voice.state["target"] == *name))
            {
                let target = if let Some(id) = self.control.session() {
                    if self.store.session(id)?["kind"] == "codex" {
                        id.to_owned()
                    } else {
                        "none".into()
                    }
                } else {
                    "none".into()
                };
                let _=self.select_voice(&json!({"op":"voice","target":target,"request_id":uuid::Uuid::new_v4().to_string(),"actor":authority::owner()}));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::net::UnixListener, thread};
    use tungstenite::Message;

    #[test]
    fn stop_waits_for_matching_native_closure_after_acceptance() {
        let path = std::env::temp_dir().join(format!("vvoice-{}", uuid::Uuid::new_v4().simple()));
        let listener = UnixListener::bind(&path).unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            loop {
                let message = socket.read().unwrap();
                if !message.is_text() {
                    continue;
                }
                let request: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                if request.get("id").is_none() {
                    continue;
                }
                socket
                    .send(Message::Text(
                        json!({"id":request["id"],"result":{}}).to_string().into(),
                    ))
                    .unwrap();
                if request["method"] == "thread/realtime/stop" {
                    socket.send(Message::Text(json!({"method":"thread/realtime/closed","params":{"threadId":"other"}}).to_string().into())).unwrap();
                    thread::sleep(Duration::from_millis(75));
                    socket.send(Message::Text(json!({"method":"thread/realtime/closed","params":{"threadId":"native"}}).to_string().into())).unwrap();
                    break;
                }
            }
        });
        let mut connection = Codex::connect(&path).unwrap();
        let target = Target {
            id: "vessel".into(),
            native: "native".into(),
            server: path.clone(),
        };
        let start = Instant::now();
        stop(&target, &mut connection).unwrap();
        assert!(start.elapsed() >= Duration::from_millis(75));
        server.join().unwrap();
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn losing_a_nonselected_observer_revokes_app_voice() {
        let path = std::env::temp_dir().join(format!("vvoice-{}", uuid::Uuid::new_v4().simple()));
        let listener = UnixListener::bind(&path).unwrap();
        let (close, closing) = mpsc::channel();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            let mut stops = 0;
            loop {
                let message = socket.read().unwrap();
                if !message.is_text() {
                    continue;
                }
                let request: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                if request.get("id").is_none() {
                    continue;
                }
                socket
                    .send(Message::Text(
                        json!({"id":request["id"],"result":{}}).to_string().into(),
                    ))
                    .unwrap();
                if request["method"] == "thread/realtime/stop" {
                    socket.send(Message::Text(json!({"method":"thread/realtime/closed","params":{"threadId":"native"}}).to_string().into())).unwrap();
                    stops += 1;
                    if stops == 2 {
                        closing.recv().unwrap();
                        break;
                    }
                }
            }
        });
        let (commands, input) = mpsc::channel();
        let (output, updates) = mpsc::channel();
        let generation = Arc::new(AtomicU64::new(1));
        let worker = thread::spawn(move || run(input, output, generation));
        commands
            .send(Command::Sync(vec![Target {
                id: "vessel".into(),
                native: "native".into(),
                server: path.clone(),
            }]))
            .unwrap();
        commands
            .send(Command::Select(Plan {
                id: "app".into(),
                target: "app".into(),
                generation: 1,
                terminal: None,
                private_stop: "confirmed".into(),
            }))
            .unwrap();
        assert_eq!(
            updates
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .result
                .unwrap()["state"],
            "ready"
        );
        close.send(()).unwrap();
        let failed = updates.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(failed.generation, 1);
        assert!(
            failed
                .result
                .unwrap_err()
                .contains("participating voice connection was lost")
        );
        drop(commands);
        worker.join().unwrap();
        server.join().unwrap();
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn unobserved_participant_refuses_app_selection() {
        let (commands, input) = mpsc::channel();
        let (output, updates) = mpsc::channel();
        let generation = Arc::new(AtomicU64::new(1));
        let worker = thread::spawn(move || run(input, output, generation));
        commands
            .send(Command::Sync(vec![Target {
                id: "unreachable".into(),
                native: "native".into(),
                server: PathBuf::from("/missing-voyager-voice-test.sock"),
            }]))
            .unwrap();
        commands
            .send(Command::Select(Plan {
                id: "select-app".into(),
                target: "app".into(),
                generation: 1,
                terminal: None,
                private_stop: "confirmed".into(),
            }))
            .unwrap();
        let update = loop {
            let update = updates.recv_timeout(Duration::from_secs(2)).unwrap();
            if update.id == "select-app" {
                break update;
            }
        };
        assert!(
            update
                .result
                .unwrap_err()
                .contains("every participating vessel")
        );
        drop(commands);
        worker.join().unwrap();
    }
}
