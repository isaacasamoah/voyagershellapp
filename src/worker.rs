use crate::{codex::Codex, events, store::Store};
use anyhow::{Context, Result, bail, ensure};
use nix::{
    sys::signal::{Signal, killpg},
    unistd::Pid,
};
use serde_json::{Value, json};
use std::{
    fs,
    os::unix::process::CommandExt,
    path::Path,
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

struct Process(Child);
impl Process {
    fn stop(&mut self) -> Result<ExitStatus> {
        if let Some(status) = self.0.try_wait()? {
            return Ok(status);
        }
        killpg(Pid::from_raw(self.0.id() as i32), Signal::SIGTERM)?;
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if let Some(status) = self.0.try_wait()? {
                return Ok(status);
            }
            thread::sleep(Duration::from_millis(20));
        }
        killpg(Pid::from_raw(self.0.id() as i32), Signal::SIGKILL)?;
        Ok(self.0.wait()?)
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.stop();
    }
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
}

impl Worker {
    pub fn begin(
        state: &Path,
        executable: &str,
        launch: &str,
        cwd: &str,
        name: Option<&str>,
    ) -> Result<StartingWorker> {
        let dir = state.join(format!("w-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir(&dir)?;
        let socket = dir.join("c.sock");
        ensure!(
            socket.as_os_str().len() < 104,
            "worker socket path too long; use a shorter --state path"
        );
        let binary = std::env::current_exe()?;
        let child = Command::new(executable)
            .args([
                "app-server",
                "-c",
                "sandbox_mode=\"danger-full-access\"",
                "-c",
                "approval_policy=\"never\"",
                "--listen",
                &format!("unix://{}", socket.display()),
            ])
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
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .context("start worker Codex server")?;
        let server = socket.to_string_lossy().into_owned();
        let cwd = cwd.to_owned();
        let name = name.map(str::to_owned);
        let (sender, ready) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let result = (|| -> Result<(Codex, Value)> {
                let deadline = Instant::now() + Duration::from_secs(10);
                while !socket.exists() {
                    ensure!(Instant::now() < deadline, "worker socket startup timed out");
                    thread::sleep(Duration::from_millis(20));
                }
                let mut connection = Codex::connect(&socket)?;
                let reply=connection.rpc("thread/start",json!({"cwd":cwd,"approvalPolicy":"never","sandbox":"danger-full-access","historyMode":"legacy","developerInstructions":include_str!("orchestration.md")}))?;
                let metadata = reply["thread"].clone();
                if let Some(name) = name {
                    connection.rpc(
                        "thread/name/set",
                        json!({"threadId":metadata["id"],"name":name}),
                    )?;
                }
                Ok((connection, metadata))
            })();
            let _ = sender.send(result);
        });
        Ok(StartingWorker {
            process: Some(Process(child)),
            ready,
            launch: launch.into(),
            server,
            executable: executable.into(),
            deadline: Instant::now() + Duration::from_secs(10),
        })
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
            json!({"executable":self.executable,"args":["--remote",format!("unix://{}",self.server),"resume",self.native,"--no-alt-screen"],"pid":self.process.0.id(),"native_thread_id":self.native,"session_id":self.session}),
        )
    }

    fn persist(&self, store: &Store, message: Value) -> Result<()> {
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
            if let Some(exit) = self.process.0.try_wait()? {
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
        if self.process.0.try_wait()?.is_none() {
            killpg(
                Pid::from_raw(self.process.0.id() as i32),
                if force {
                    Signal::SIGKILL
                } else {
                    Signal::SIGTERM
                },
            )?;
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

pub struct StartingWorker {
    process: Option<Process>,
    ready: std::sync::mpsc::Receiver<Result<(Codex, Value)>>,
    launch: String,
    server: String,
    executable: String,
    deadline: Instant,
}

impl StartingWorker {
    pub fn poll(&mut self, store: &mut Store) -> Result<Option<Worker>> {
        let process = self.process.as_mut().context("startup process missing")?;
        ensure!(
            process.0.try_wait()?.is_none(),
            "provider_failed: native server exited during startup"
        );
        ensure!(
            Instant::now() < self.deadline,
            "outcome_unknown: native startup timed out"
        );
        let (connection, metadata) = match self.ready.try_recv() {
            Ok(result) => result?,
            Err(std::sync::mpsc::TryRecvError::Empty) => return Ok(None),
            Err(_) => bail!("outcome_unknown: native startup connection ended"),
        };
        let native = metadata["id"]
            .as_str()
            .context("native identity missing")?
            .to_owned();
        let session =
            store.register_worker(&self.launch, &self.server, &metadata, process.0.id())?;
        store.local(
            &session,
            "worker.started",
            json!({"pid":process.0.id(),"launch_id":self.launch,"ownership":"managed"}),
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
            generation: 1,
        }))
    }
}
