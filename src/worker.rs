use crate::{codex::Codex, events, store::Store};
use anyhow::{Context, Result, bail, ensure};
use nix::sys::signal::Signal;
use serde_json::{Value, json};
use std::{
    fs,
    os::unix::process::CommandExt,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

mod process;
mod settings;
use process::Process;
pub use settings::Settings;

pub struct Resume {
    pub session: String,
    pub native: String,
    pub generation: i64,
}
pub enum ThreadStart {
    New(Option<String>),
    Resume(Resume),
}

pub struct Worker {
    process: Process,
    pub connection: Option<Codex>,
    pub session: String,
    pub native: String,
    pub launch: String,
    pub server: String,
    pub executable: String,
    pub alive: bool,
    pub generation: i64,
    stopping: bool,
}

impl Worker {
    pub fn begin(
        state: &Path,
        binary: &Path,
        executable: &str,
        launch: &str,
        cwd: &str,
        mode: ThreadStart,
        context: &Path,
    ) -> Result<StartingWorker> {
        let dir = state.join(format!("w-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir(&dir)?;
        let socket = dir.join("c.sock");
        ensure!(
            socket.as_os_str().len() < 104,
            "worker socket path too long; use a shorter --state path"
        );
        let resume_identity = match &mode {
            ThreadStart::Resume(r) => Some((r.session.clone(), r.generation)),
            _ => None,
        };
        let child = Command::new(executable)
            .arg("app-server")
            .args(["--listen", &format!("unix://{}", socket.display())])
            .arg("-c")
            .arg(format!(
                "shell_environment_policy.set.VOYAGER_STATE={}",
                json!(state)
            ))
            .arg("-c")
            .arg(format!(
                "shell_environment_policy.set.VOYAGER_BIN={}",
                json!(binary)
            ))
            .arg("-c")
            .arg("shell_environment_policy.set.VOYAGER_CALLER=\"instance\"")
            .arg("-c")
            .arg(format!(
                "shell_environment_policy.set.VOYAGER_SESSION_CONTEXT={}",
                json!(context)
            ))
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .context("start worker Codex server")?;
        let server = socket.to_string_lossy().into_owned();
        let cwd = cwd.to_owned();
        let provider_executable = executable.to_owned();
        let (sender, ready) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let mut load_requested = false;
            let result = (|| -> Result<(Codex, Value)> {
                let deadline = Instant::now() + Duration::from_secs(10);
                while !socket.exists() {
                    ensure!(Instant::now() < deadline, "worker socket startup timed out");
                    thread::sleep(Duration::from_millis(20));
                }
                let mut connection = Codex::connect(&socket)?;
                let settings = Settings::current(&mut connection, &cwd)?;
                let mut params = settings.parameters();
                let (reply, name) = match mode {
                    ThreadStart::New(name) => {
                        params["historyMode"] = json!("legacy");
                        params["developerInstructions"] = json!(include_str!("orchestration.md"));
                        let reply = connection.rpc("thread/start", params)?;
                        settings.verify(&reply)?;
                        (reply, name)
                    }
                    ThreadStart::Resume(resume) => {
                        let goal = connection.rpc("thread/goal/get",json!({"threadId":resume.native})).context("provider_failed: Codex could not inspect the saved conversation before resume")?;
                        ensure!(
                            goal.get("goal").is_some_and(Value::is_null),
                            "settings_unavailable: this conversation has a goal or its goal state cannot be verified; it was not loaded"
                        );
                        params["threadId"] = json!(resume.native);
                        params["excludeTurns"] = json!(true);
                        load_requested = true;
                        let reply = connection.rpc("thread/resume",params).context("provider_failed: Codex could not reopen this conversation with current settings")?;
                        ensure!(
                            reply["thread"]["id"] == resume.native,
                            "thread_unavailable: provider returned another conversation"
                        );
                        ensure!(
                            reply["thread"]["status"]["type"] == "idle",
                            "outcome_unknown: resumed conversation did not report idle"
                        );
                        settings.verify(&reply)?;
                        let current = connection.rpc(
                            "thread/read",
                            json!({"threadId":resume.native,"includeTurns":false}),
                        )?;
                        ensure!(
                            current["thread"]["status"]["type"] == "idle"
                                && !connection.pending.iter().any(|e| matches!(
                                    e["method"].as_str(),
                                    Some("turn/started" | "item/started")
                                )),
                            "outcome_unknown: unexpected work started during resume"
                        );
                        connection.pending.clear();
                        (reply, None)
                    }
                };
                let mut metadata = reply["thread"].clone();
                if let Ok(snapshot) =
                    Settings::capture(&mut connection, &reply, &provider_executable)
                {
                    metadata["resume_settings"] = snapshot;
                }
                if let Some(name) = name {
                    connection.rpc(
                        "thread/name/set",
                        json!({"threadId":metadata["id"],"name":name}),
                    )?;
                }
                Ok((connection, metadata))
            })();
            let _ = sender.send((load_requested, result));
        });
        Ok(StartingWorker {
            process: Some(Process::Child(child)),
            ready,
            resume: resume_identity,
            load_requested: None,
            cleanup: None,
            launch: launch.into(),
            server,
            executable: executable.into(),
            deadline: Instant::now() + Duration::from_secs(10),
        })
    }

    pub(crate) fn recover(
        record: &Value,
        receipt: &Value,
        operation: &str,
        context: &Path,
        deadline: Instant,
        cancelled: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<Self> {
        let server = record["server"]
            .as_str()
            .context("native endpoint missing")?;
        let native = record["native_thread_id"]
            .as_str()
            .context("native conversation missing")?;
        let mut connection = Codex::connect_cancellable(
            Path::new(server),
            deadline,
            std::sync::Arc::clone(cancelled),
        )?;
        ensure!(
            receipt["runtime_pid"].as_u64() == Some(u64::from(connection.peer_pid)),
            "native server process differs from the saved runtime"
        );
        let mut process = Process::checked(connection.peer_pid)?;
        let identity = process.identity()?;
        if let Some(saved) = receipt.get("process_identity") {
            ensure!(*saved == identity, "native server process identity changed");
        }
        let command = fs::read(format!("/proc/{}/cmdline", process.id()))?;
        let args: Vec<_> = command.split(|b| *b == 0).collect();
        let endpoint = format!("unix://{server}");
        let locator = format!(
            "shell_environment_policy.set.VOYAGER_SESSION_CONTEXT={}",
            json!(context)
        );
        ensure!(
            args.contains(&b"app-server".as_slice())
                && args.contains(&endpoint.as_bytes())
                && args.contains(&locator.as_bytes()),
            "native process does not match the saved managed launch"
        );
        ensure!(
            connection.loaded()?.iter().any(|id| id == native),
            "saved conversation is not loaded in this runtime"
        );
        let before = connection.metadata(native)?;
        ensure!(
            before["id"] == native && before["status"]["type"] != "notLoaded",
            "native conversation is unavailable"
        );
        connection.pending.clear();
        ensure!(
            !cancelled.load(std::sync::atomic::Ordering::Acquire),
            "Vessel changed during connection check"
        );
        let reply = connection.rpc(
            "thread/resume",
            json!({"threadId":native,"excludeTurns":true}),
        )?;
        ensure!(
            reply["thread"]["id"] == native,
            "native subscription returned another conversation"
        );
        ensure!(
            process.try_wait()?.is_none() && process.identity()? == identity,
            "native server exited during recovery"
        );
        connection.finish_connection_check()?;
        Ok(Self {
            process,
            connection: Some(connection),
            session: record["id"]
                .as_str()
                .context("Vessel identity missing")?
                .into(),
            native: native.into(),
            launch: operation.into(),
            server: server.into(),
            executable: identity["executable"]
                .as_str()
                .context("native executable missing")?
                .into(),
            alive: true,
            generation: 0,
            stopping: false,
        })
    }

    pub(crate) fn identity(&self) -> Result<Value> {
        self.process.identity()
    }

    pub fn client(&mut self) -> Result<&mut Codex> {
        ensure!(self.alive, "worker process ended");
        self.connection
            .as_mut()
            .context("worker capture disconnected; no automatic reconnect")
    }

    pub fn attach(&self) -> Result<Value> {
        ensure!(self.alive, "worker process ended");
        ensure!(self.connection.is_some(), "worker capture is disconnected");
        Ok(
            json!({"executable":self.executable,"args":["--remote",format!("unix://{}",self.server),"resume",self.native,"--no-alt-screen"],"pid":self.process.id(),"native_thread_id":self.native,"session_id":self.session}),
        )
    }

    fn persist(&self, store: &Store, message: Value) -> Result<()> {
        if message["method"] == "thread/settings/updated"
            && message["params"]["threadId"] == self.native
            && store.generation(&self.session)? == Some(self.generation)
        {
            if let Some(saved) = store.resume_record(&self.session)? {
                let updated = Settings::refresh(
                    &saved["settings"],
                    &message["params"]["threadSettings"],
                    &self.executable,
                );
                store.save_resume_settings(&self.launch, updated.as_ref().ok())?;
            }
        }
        if let Some(event) = events::normalize(&message) {
            if event.thread == self.native {
                store.record(&self.session, self.generation, event)?;
            }
        }
        Ok(())
    }

    pub fn observe(&mut self, store: &Store) -> Result<()> {
        let pending: Vec<_> = self
            .connection
            .as_mut()
            .map(|c| c.pending.drain(..).collect())
            .unwrap_or_default();
        for event in pending {
            self.persist(store, event)?;
        }
        if let Some(c) = self.connection.as_mut() {
            match c.read() {
                Ok(Some(event)) => self.persist(store, event)?,
                Ok(None) => (),
                Err(_) => {
                    if !self.stopping {
                        store.save_resume_settings(&self.launch, None)?;
                    }
                    store.local(
                        &self.session,
                        "capture.gap",
                        json!({"reason":"worker_disconnected","replay_available":false}),
                    )?;
                    self.connection = None;
                }
            }
        }
        if self.alive {
            if let Some(exit) = self.process.try_wait()? {
                if !self.stopping {
                    store.save_resume_settings(&self.launch, None)?;
                }
                self.alive = false;
                self.connection = None;
                store.worker_state(&self.launch, "exited")?;
                store.local(
                    &self.session,
                    "worker.exited",
                    json!({"exit_code":exit.code(),"task_outcome":"unknown_without_turn_evidence"}),
                )?;
            }
        }
        Ok(())
    }

    pub fn request_stop(&mut self, force: bool) -> Result<()> {
        self.stopping = true;
        if self.process.try_wait()?.is_none() {
            self.process.signal(if force {
                Signal::SIGKILL
            } else {
                Signal::SIGTERM
            })?;
        }
        Ok(())
    }

    pub fn stopped(&self, store: &Store) -> Result<()> {
        store.worker_state(&self.launch, "stopped")?;
        store.local(
            &self.session,
            "worker.stopped",
            json!({"unfinished_turn_outcome":"uncertain"}),
        )
    }
}

struct Cleanup {
    error: String,
    force_at: Instant,
    forced: bool,
}
pub struct StartingWorker {
    process: Option<Process>,
    ready: std::sync::mpsc::Receiver<(bool, Result<(Codex, Value)>)>,
    pub load_requested: Option<bool>,
    cleanup: Option<Cleanup>,
    launch: String,
    server: String,
    executable: String,
    resume: Option<(String, i64)>,
    deadline: Instant,
}

impl StartingWorker {
    pub fn begin_cleanup(&mut self, error: String) -> Result<()> {
        let process = self.process.as_mut().context("startup process missing")?;
        if process.try_wait()?.is_none() {
            process.signal(Signal::SIGTERM)?;
        }
        self.cleanup = Some(Cleanup {
            error,
            force_at: Instant::now() + Duration::from_secs(2),
            forced: false,
        });
        Ok(())
    }
    pub fn cleaning(&self) -> bool {
        self.cleanup.is_some()
    }
    pub fn poll_cleanup(&mut self) -> Result<Option<(String, bool)>> {
        let cleanup = self.cleanup.as_mut().context("cleanup missing")?;
        let process = self.process.as_mut().context("startup process missing")?;
        if process.try_wait()?.is_some() {
            return Ok(Some((
                cleanup.error.clone(),
                self.load_requested == Some(false),
            )));
        }
        if Instant::now() >= cleanup.force_at && !cleanup.forced {
            process.signal(Signal::SIGKILL)?;
            cleanup.forced = true;
        }
        Ok(None)
    }

    pub fn poll(&mut self, store: &mut Store) -> Result<Option<Worker>> {
        let process = self.process.as_mut().context("startup process missing")?;
        ensure!(
            process.try_wait()?.is_none(),
            "provider_failed: native server exited during startup"
        );
        ensure!(
            Instant::now() < self.deadline,
            "outcome_unknown: native startup timed out"
        );
        let (connection, metadata) = match self.ready.try_recv() {
            Ok((load_requested, result)) => {
                self.load_requested = Some(load_requested);
                result?
            }
            Err(std::sync::mpsc::TryRecvError::Empty) => return Ok(None),
            Err(_) => bail!("outcome_unknown: native startup connection ended"),
        };
        let native = metadata["id"]
            .as_str()
            .context("native identity missing")?
            .to_owned();
        let session = if let Some((session, generation)) = &self.resume {
            store.register_resumed(session, *generation, &self.launch, &self.server, &metadata)?;
            session.clone()
        } else {
            store.register_worker(&self.launch, &self.server, &metadata, process.id())?
        };
        let capture_generation = store.session(&session)?["capture_generation"]
            .as_i64()
            .context("missing capture generation")?;
        store.local(
            &session,
            "worker.started",
            json!({"pid":process.id(),"launch_id":self.launch,"ownership":"managed"}),
        )?;
        Ok(Some(Worker {
            process: self.process.take().context("startup process missing")?,
            connection: Some(connection),
            session,
            native,
            launch: self.launch.clone(),
            server: self.server.clone(),
            executable: self.executable.clone(),
            alive: true,
            generation: capture_generation,
            stopping: false,
        }))
    }
}
