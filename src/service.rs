use crate::{codex::Codex, control::Control, events, store::Store, terminal, worker::Worker};
use anyhow::{Context, Result, bail, ensure};
use nix::{
    fcntl::{Flock, FlockArg},
    sys::{
        socket::{getsockopt, sockopt},
        stat::{Mode, umask},
    },
    unistd::Uid,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::{self, DirBuilder, OpenOptions},
    io::{self, BufRead, BufReader, Read, Write},
    os::unix::{
        fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt},
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    process::Child,
    time::Duration,
};

const REQUEST_LIMIT: u64 = 64 * 1024;

pub fn private_dir(path: &Path) -> Result<()> {
    if !path.exists() {
        DirBuilder::new().recursive(true).mode(0o700).create(path)?;
    }
    let meta = fs::symlink_metadata(path)?;
    ensure!(
        meta.is_dir() && meta.uid() == Uid::effective().as_raw() && meta.mode() & 0o077 == 0,
        "state directory must be private, owned by this user and not a symlink"
    );
    Ok(())
}

fn frame(stream: &mut UnixStream) -> Result<Value> {
    let mut bytes = Vec::new();
    BufReader::new(stream)
        .take(REQUEST_LIMIT + 1)
        .read_until(b'\n', &mut bytes)?;
    ensure!(
        bytes.len() as u64 <= REQUEST_LIMIT && bytes.ends_with(b"\n"),
        "invalid or oversized request"
    );
    serde_json::from_slice(&bytes).context("invalid request JSON")
}

pub fn client(state: &Path, request: Value) -> Result<Value> {
    let mut stream =
        UnixStream::connect(state.join("service.sock")).context("Voyager service unavailable")?;
    ensure!(
        getsockopt(&stream, sockopt::PeerCredentials)?.uid() == Uid::effective().as_raw(),
        "different-user service"
    );
    stream.set_read_timeout(Some(Duration::from_secs(20)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    writeln!(stream, "{request}")?;
    // A paged response contains at most 100 bounded event payloads.
    let mut bytes = Vec::new();
    BufReader::new(stream)
        .take(4 * 1024 * 1024)
        .read_until(b'\n', &mut bytes)?;
    ensure!(bytes.ends_with(b"\n"), "incomplete service response");
    let response: Value = serde_json::from_slice(&bytes)?;
    if let Some(error) = response.get("error") {
        bail!("{}", error.as_str().unwrap_or("service error"));
    }
    response
        .get("result")
        .cloned()
        .context("missing service result")
}

struct SocketPath(PathBuf);
impl Drop for SocketPath {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub fn serve(state: &Path, codex_path: Option<&Path>) -> Result<()> {
    umask(Mode::from_bits_truncate(0o077));
    private_dir(state)?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(nix::libc::O_NOFOLLOW)
        .open(state.join("service.lock"))?;
    let _lock = Flock::lock(lock, FlockArg::LockExclusiveNonblock)
        .map_err(|(_, e)| anyhow::anyhow!("service already running or lock unavailable: {e}"))?;
    let socket_path = state.join("service.sock");
    if let Ok(meta) = fs::symlink_metadata(&socket_path) {
        ensure!(
            meta.file_type().is_socket() && meta.uid() == Uid::effective().as_raw(),
            "refusing to replace non-socket state"
        );
        fs::remove_file(&socket_path)?; // Exclusive lock proves no current service owns it.
    }
    let db_path = state.join("events.sqlite");
    if let Ok(meta) = fs::symlink_metadata(&db_path) {
        ensure!(
            meta.is_file() && meta.uid() == Uid::effective().as_raw() && meta.mode() & 0o077 == 0,
            "database must be a private regular file"
        );
    }
    let store = Store::open(&db_path)?;
    store.0.execute(
        "UPDATE workers SET state='unknown' WHERE state IN ('starting','running')",
        [],
    )?;
    for session in store.sessions()? {
        store.local(
            session["id"].as_str().unwrap(),
            "capture.gap",
            json!({"reason":"service_restarted","replay_available":false}),
        )?;
    }
    let server = codex_path.map(fs::canonicalize).transpose()?;
    let codex = server.as_deref().map(Codex::connect).transpose()?;
    let mut runtime = Runtime {
        control: Control::new(&store)?,
        store,
        codex,
        server: server.map(|p| p.to_string_lossy().into_owned()),
        registered: HashMap::new(),
        instance: uuid::Uuid::new_v4().to_string(),
        worker: None,
        terminals: Vec::new(),
        state: fs::canonicalize(state)?,
        executable: std::env::var("VOYAGER_CODEX_BIN").unwrap_or_else(|_| "codex".into()),
    };
    let listener = UnixListener::bind(&socket_path)?;
    let _socket = SocketPath(socket_path);
    listener.set_nonblocking(true)?;
    eprintln!("Voyager ready; external registrations and managed launches remain separate");
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_read_timeout(Some(Duration::from_secs(1)))?;
                stream.set_write_timeout(Some(Duration::from_secs(1)))?;
                let result = (|| -> Result<(Value, bool)> {
                    ensure!(
                        getsockopt(&stream, sockopt::PeerCredentials)?.uid()
                            == Uid::effective().as_raw(),
                        "different-user peer"
                    );
                    let request = frame(&mut stream)?;
                    runtime.observe_control()?;
                    if request["op"] == "dock" {
                        runtime.connection(string(&request, "session_id")?)?;
                        let peer =
                            u32::try_from(getsockopt(&stream, sockopt::PeerCredentials)?.pid())?;
                        return Ok((
                            runtime.control.dock(
                                &runtime.store,
                                &request,
                                peer,
                                stream.try_clone()?,
                            )?,
                            false,
                        ));
                    }
                    runtime.dispatch(request)
                })();
                let (reply, stop) = match result {
                    Ok((value, stop)) => (json!({"result":value}), stop),
                    Err(error) => (json!({"error":error.to_string()}), false),
                };
                // A disappeared CLI client is not a reason to stop capture.
                let _ = writeln!(stream, "{reply}");
                if stop {
                    break;
                }
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
            Err(e) => return Err(e.into()),
        }
        runtime.observe()?;
        if runtime.codex.is_none() {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    runtime
        .control
        .release(&runtime.store, None, "service_stopped")?;
    runtime.gap("service_stopped")?;
    Ok(())
}

struct Runtime {
    control: Control,
    store: Store,
    codex: Option<Codex>,
    server: Option<String>,
    registered: HashMap<String, String>, // native thread -> Voyager registration
    instance: String,
    worker: Option<Worker>,
    terminals: Vec<Child>,
    state: PathBuf,
    executable: String,
}

fn string<'a>(v: &'a Value, field: &str) -> Result<&'a str> {
    v[field]
        .as_str()
        .filter(|s| !s.is_empty())
        .with_context(|| format!("missing {field}"))
}

impl Runtime {
    fn codex(&mut self) -> Result<&mut Codex> {
        self.codex
            .as_mut()
            .context("Codex disconnected; restart Voyager and register again")
    }

    fn dispatch(&mut self, request: Value) -> Result<(Value, bool)> {
        // Optional current-control precondition for commands sent on the human's
        // behalf. Direct local CLI access remains available; this is coordination,
        // not isolation between programs running as the same Unix user.
        if let Some(generation) = request.get("control_generation") {
            ensure!(
                ["send", "launch", "stop-worker"].contains(&string(&request, "op")?),
                "control precondition is only for agent commands"
            );
            let source = self
                .control
                .require(generation.as_str().context("invalid control generation")?)?;
            if request["op"] == "launch" {
                ensure!(
                    request["parent_id"] == source,
                    "launch parent must be the current control session"
                );
            }
        }
        let value = match string(&request, "op")? {
            "status" => {
                json!({"instance":self.instance,"codex_connected":self.codex.is_some(),"capturing":self.registered.len()+usize::from(self.worker.as_ref().is_some_and(|w|w.connection.is_some())),"owns_agents":self.worker.as_ref().is_some_and(|w|w.alive),"control":self.control.current(),"voice":self.control.voice()})
            }
            "undock" => {
                json!({"released":self.control.release(&self.store, Some(string(&request,"generation")?), "undocked")?})
            }
            "discover" => {
                let c = self.codex()?;
                let mut threads = Vec::new();
                for id in c.loaded()? {
                    threads.push(c.metadata(&id)?);
                }
                json!(threads)
            }
            "connection-info" => {
                // Metadata only: discoverability never subscribes a thread or imports history.
                let pid = self.codex()?.peer_pid;
                let executable = if self.executable.contains('/') {
                    fs::canonicalize(&self.executable)?
                } else {
                    std::env::split_paths(&std::env::var_os("PATH").context("PATH is missing")?)
                        .map(|dir| dir.join(&self.executable))
                        .find(|path| path.is_file())
                        .context("native Codex executable is unavailable")?
                        .canonicalize()?
                };
                json!({"server":self.server,"pid":pid,"executable":executable})
            }
            "list" => {
                let mut sessions = self.store.sessions()?;
                for session in &mut sessions {
                    let captured = self
                        .worker
                        .as_ref()
                        .is_some_and(|w| session["id"] == w.session && w.connection.is_some())
                        || self
                            .registered
                            .get(session["native_thread_id"].as_str().unwrap())
                            == session["id"].as_str().map(|s| s.to_owned()).as_ref();
                    session["capture"] = json!(if captured {
                        "connected"
                    } else {
                        "disconnected"
                    });
                }
                json!(sessions)
            }
            "register" => {
                let thread = string(&request, "thread_id")?;
                ensure!(
                    self.codex()?.loaded()?.iter().any(|id| id == thread),
                    "thread is not loaded; refusing to create or resume a replacement"
                );
                if let Some(id) = self.registered.get(thread) {
                    return Ok((json!({"session_id":id,"already_registered":true}), false));
                }
                let metadata = self.codex()?.metadata(thread)?;
                ensure!(metadata["id"] == thread, "thread identity mismatch");
                let reply = self.codex()?.rpc(
                    "thread/resume",
                    json!({"threadId":thread,"excludeTurns":true}),
                )?;
                ensure!(
                    reply["thread"]["id"] == thread,
                    "subscription identity mismatch"
                );
                // Preserve other registrations' events while dropping this new
                // target's pre-registration notifications and snapshot/history.
                let pending: Vec<_> = self.codex()?.pending.drain(..).collect();
                for message in pending {
                    self.persist(message)?;
                }
                let id = self.store.register(
                    self.server
                        .as_deref()
                        .context("no external server configured")?,
                    &metadata,
                )?;
                self.store.local(&id,"capture.started",json!({"source":"codex_app_server","history_imported":false,"replay_available":false}))?;
                self.registered.insert(thread.to_owned(), id.clone());
                json!({"session_id":id,"native_thread_id":thread,"ownership":"external","capture":"connected"})
            }
            "send" => {
                let session = string(&request, "session_id")?;
                let request_id = string(&request, "request_id")?;
                let message = string(&request, "message")?;
                self.send(session, request_id, message)?
            }
            "create" => {
                let id = string(&request, "request_id")?;
                let name = string(&request, "name")?;
                ensure!(
                    id.len() <= 100
                        && name.len() <= 100
                        && !name.trim().is_empty()
                        && !name.chars().any(char::is_control),
                    "invalid request ID or name"
                );
                let cwd = fs::canonicalize(string(&request, "cwd")?)?;
                ensure!(cwd.is_dir(), "instance cwd must be a directory");
                let cwd = cwd.to_str().context("instance cwd must be UTF-8")?;
                if let Some(previous) = self.store.launch(id)? {
                    ensure!(
                        previous["parent_id"].is_null()
                            && previous["prompt"].is_null()
                            && previous["cwd"] == cwd
                            && previous["name"] == name,
                        "launch ID conflicts with previous inputs"
                    );
                } else {
                    self.store.begin_launch(id, None, cwd, None, Some(name))?;
                    match Worker::start(
                        &mut self.store,
                        &self.state,
                        &self.executable,
                        id,
                        cwd,
                        Some(name),
                    ) {
                        Ok(worker) => self.worker = Some(worker),
                        Err(error) => {
                            self.store.worker_state(id, "failed")?;
                            return Err(error);
                        }
                    }
                }
                self.store.launch(id)?.context("creation receipt missing")?
            }
            "open" => {
                ensure!(
                    string(&request, "terminal")? == "ghostty",
                    "terminal not supported yet"
                );
                let session = string(&request, "session_id")?;
                let info = self.attachment(session)?;
                let record = self.store.session(session)?;
                let child = terminal::open_agent(&info, &record)?;
                let pid = child.id();
                self.terminals.push(child);
                self.store.local(
                    session,
                    "interface.open_requested",
                    json!({"terminal":"ghostty","pid":pid}),
                )?;
                json!({"session_id":session,"terminal":"ghostty","pid":pid,"state":"opening","docked":false})
            }
            "open-shell" => {
                ensure!(
                    string(&request, "terminal")? == "ghostty",
                    "terminal not supported yet"
                );
                let cwd = fs::canonicalize(string(&request, "cwd")?)?;
                ensure!(cwd.is_dir(), "shell cwd must be a directory");
                let child = terminal::open_shell(&cwd)?;
                let pid = child.id();
                self.terminals.push(child);
                json!({"terminal":"ghostty","pid":pid,"state":"opening","registered":false,"capturing":false,"ownership":"terminal"})
            }
            "launch" => {
                let id = string(&request, "request_id")?;
                let parent = string(&request, "parent_id")?;
                let prompt = string(&request, "prompt")?;
                ensure!(
                    id.len() <= 100 && prompt.len() <= events::TEXT_LIMIT,
                    "launch ID or prompt too long"
                );
                let cwd = fs::canonicalize(string(&request, "cwd")?)?;
                ensure!(cwd.is_dir(), "worker cwd must be a directory");
                let cwd = cwd.to_str().context("worker cwd must be UTF-8")?;
                if let Some(previous) = self.store.launch(id)? {
                    ensure!(
                        previous["parent_id"] == parent
                            && previous["cwd"] == cwd
                            && previous["prompt"] == prompt,
                        "launch ID conflicts with previous inputs"
                    );
                } else {
                    self.connection(parent)?; // Parent must be connected at acceptance.
                    self.store
                        .begin_launch(id, Some(parent), cwd, Some(prompt), None)?;
                    match Worker::start(
                        &mut self.store,
                        &self.state,
                        &self.executable,
                        id,
                        cwd,
                        None,
                    ) {
                        Ok(worker) => self.worker = Some(worker),
                        Err(error) => {
                            self.store.worker_state(id, "failed")?;
                            return Err(error);
                        }
                    }
                    let session = self.worker.as_ref().unwrap().session.clone();
                    self.store.local(
                        parent,
                        "worker.launched",
                        json!({"worker_session_id":session,"launch_id":id,"scope":"private"}),
                    )?;
                    // A lost acknowledgement is stored as uncertain, never silently replayed.
                    if let Err(error) = self.send(&session, &format!("launch:{id}"), prompt) {
                        self.store.local(&session,"task.submission_error",json!({"request_id":format!("launch:{id}"),"error":error.to_string(),"request":self.store.request(&format!("launch:{id}"))?,"automatic_retry":false}))?;
                    }
                }
                let mut receipt = self.store.launch(id)?.unwrap();
                receipt["initial_request"] = json!(self.store.request(&format!("launch:{id}"))?);
                receipt
            }
            "attach-info" => self.attachment(string(&request, "session_id")?)?,
            "stop-worker" => {
                let id = string(&request, "session_id")?;
                self.worker
                    .as_mut()
                    .filter(|w| w.session == id)
                    .context("not a live managed worker; external sessions cannot be stopped")?
                    .stop(&self.store)?
            }
            "events" => self.store.events(request["after"].as_i64().unwrap_or(0))?,
            "stop" => {
                ensure!(
                    !self.worker.as_ref().is_some_and(|w| w.alive),
                    "stop the managed worker explicitly before stopping Voyager"
                );
                return Ok((json!({"stopping":true,"native_agents_stopped":false}), true));
            }
            _ => bail!("unsupported operation"),
        };
        Ok((value, false))
    }

    fn connection(&mut self, session: &str) -> Result<&mut Codex> {
        if self.worker.as_ref().is_some_and(|w| w.session == session) {
            return self.worker.as_mut().unwrap().client();
        }
        let native = self.store.native(
            session,
            self.server
                .as_deref()
                .context("no external server configured")?,
        )?;
        ensure!(
            self.registered.get(&native).map(String::as_str) == Some(session),
            "session is not currently registered for capture"
        );
        self.codex()
    }

    fn attachment(&self, id: &str) -> Result<Value> {
        let worker = self
            .worker
            .as_ref()
            .filter(|w| w.session == id)
            .context("not a live managed instance")?;
        let launch = self
            .store
            .launch(&worker.launch)?
            .context("launch receipt missing")?;
        if !launch["prompt"].is_null() {
            let request = self.store.request(&format!("launch:{}", worker.launch))?;
            ensure!(
                request.as_ref().is_some_and(|r| r["state"] == "accepted"),
                "initial task has no accepted acknowledgement; inspect events before attaching"
            );
        }
        worker.attach()
    }

    fn send(&mut self, session: &str, request_id: &str, message: &str) -> Result<Value> {
        ensure!(
            request_id.len() <= 128 && message.len() <= events::TEXT_LIMIT,
            "request ID or message too long"
        );
        if let Some(previous) = self.store.request(request_id)? {
            ensure!(
                previous["session_id"] == session && previous["message"] == message,
                "request ID conflicts with previous inputs"
            );
            return Ok(previous);
        }
        let native = self.store.session(session)?["native_thread_id"]
            .as_str()
            .context("missing native thread")?
            .to_owned();
        let metadata = self.connection(session)?.metadata(&native)?;
        ensure!(
            metadata["status"]["type"] == "idle",
            "agent is not idle; leave its current work alone"
        );
        self.store.begin_request(request_id, session, message)?;
        let result=self.connection(session)?.rpc("turn/start",json!({"threadId":native,"clientUserMessageId":request_id,"input":[{"type":"text","text":message}]}))?;
        let turn = result["turn"]["id"]
            .as_str()
            .context("no turn identity; request remains uncertain")?;
        self.store.accepted(request_id, turn)?;
        Ok(self.store.request(request_id)?.unwrap())
    }

    fn persist(&self, message: Value) -> Result<()> {
        if let Some(observation) = events::normalize(&message) {
            if let Some(session) = self.registered.get(&observation.thread) {
                self.store.record(session, observation)?;
            }
        }
        Ok(())
    }

    fn observe(&mut self) -> Result<()> {
        // Reap only clients we launched. Closing them never stops a managed agent.
        for index in (0..self.terminals.len()).rev() {
            if self.terminals[index].try_wait()?.is_some() {
                self.terminals.swap_remove(index).wait()?;
            }
        }
        if let Some(worker) = self.worker.as_mut() {
            worker.observe(&self.store)?;
        }
        let pending: Vec<_> = self
            .codex
            .as_mut()
            .map(|c| c.pending.drain(..).collect())
            .unwrap_or_default();
        for message in pending {
            self.persist(message)?;
        }
        if let Some(codex) = self.codex.as_mut() {
            match codex.read() {
                Ok(Some(message)) => self.persist(message)?,
                Ok(None) => {}
                Err(_) => {
                    self.gap("codex_disconnected")?;
                    self.codex = None;
                    self.registered.clear();
                    eprintln!(
                        "Codex disconnected; capture stopped; native work is not controlled by Voyager"
                    );
                }
            }
        }
        self.observe_control()
    }

    fn observe_control(&mut self) -> Result<()> {
        self.control.observe(&self.store)?;
        if let Some(session) = self.control.session().map(str::to_owned) {
            if self.connection(&session).is_err() {
                self.control
                    .release(&self.store, None, "capture_disconnected")?;
            }
        }
        Ok(())
    }

    fn gap(&self, reason: &str) -> Result<()> {
        for session in self.registered.values() {
            self.store.local(
                session,
                "capture.gap",
                json!({"reason":reason,"replay_available":false}),
            )?;
        }
        Ok(())
    }
}
