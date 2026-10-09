//! One service-owned Codex server. Native terminal clients attach independently.
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
        // This process group was created by this exact Child. Never recover ownership from a PID.
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
}

impl Worker {
    pub fn start(
        store: &mut Store,
        state: &Path,
        executable: &str,
        launch: &str,
        cwd: &str,
    ) -> Result<Self> {
        // Each launch has a new private socket; a stale endpoint is never reused.
        let dir = state.join(format!("w-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir(&dir)?;
        let socket = dir.join("c.sock");
        ensure!(
            socket.as_os_str().len() < 104,
            "worker socket path too long; use a shorter --state path"
        );
        let child = Command::new(executable)
            .args([
                "app-server",
                "--listen",
                &format!("unix://{}", socket.display()),
            ])
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .context("start worker Codex server")?;
        let mut process = Process(child);
        let deadline = Instant::now() + Duration::from_secs(10);
        while !socket.exists() {
            ensure!(
                process.0.try_wait()?.is_none(),
                "worker server exited before creating its socket"
            );
            ensure!(Instant::now() < deadline, "worker socket startup timed out");
            thread::sleep(Duration::from_millis(20));
        }
        let mut connection = Codex::connect(&socket)?;
        let reply = connection.rpc("thread/start", json!({"cwd":cwd}))?;
        let metadata = &reply["thread"];
        let native = metadata["id"]
            .as_str()
            .context("worker has no native identity")?
            .to_owned();
        let server = socket.to_string_lossy().into_owned();
        let session = store.register_worker(launch, &server, metadata, process.0.id())?;
        store.local(
            &session,
            "worker.started",
            json!({"pid":process.0.id(),"launch_id":launch,"ownership":"managed"}),
        )?;
        Ok(Self {
            process,
            connection: Some(connection),
            session,
            native,
            launch: launch.to_owned(),
            server,
            executable: executable.to_owned(),
            alive: true,
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
                store.record(&self.session, event)?;
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

    pub fn stop(&mut self, store: &Store) -> Result<Value> {
        if !self.alive {
            bail!("worker already ended");
        }
        store.local(&self.session, "worker.stop_requested", json!({}))?;
        let exit = self.process.stop()?;
        self.alive = false;
        self.connection = None;
        store.worker_state(&self.launch, "stopped")?;
        store.local(
            &self.session,
            "worker.stopped",
            json!({"exit_code":exit.code(),"unfinished_turn_outcome":"uncertain"}),
        )?;
        Ok(json!({"session_id":self.session,"state":"stopped","exit_code":exit.code()}))
    }
}
