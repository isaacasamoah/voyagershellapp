use crate::{
    actions::{Action, PendingOperation},
    authority::{self, Credentials},
    codex::Codex,
    control::Control,
    events,
    shell::Shell,
    store::Store,
    terminal,
    worker::{StartingWorker, Worker},
};
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
    os::unix::process::CommandExt,
    os::unix::{
        fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt},
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    process::Child,
    process::{Command, Stdio},
    time::Duration,
};

mod authority_ops;
mod conversation;
mod conversation_tools;
mod development_ops;
mod fleets;
mod lifecycle;
mod native;
mod voice;
use native::NativeCall;

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

pub fn client(state: &Path, mut request: Value) -> Result<Value> {
    let instance = std::env::var_os("VOYAGER_CALLER").is_some()
        || std::env::var_os("VOYAGER_SESSION_CONTEXT").is_some();
    if instance {
        ensure!(
            std::env::var("VOYAGER_CALLER").ok().as_deref() == Some("instance"),
            "forbidden: invalid instance caller context"
        );
        let path = PathBuf::from(
            std::env::var_os("VOYAGER_SESSION_CONTEXT")
                .context("forbidden: missing instance context")?,
        );
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(nix::libc::O_NOFOLLOW)
            .open(path)
            .context("forbidden: unavailable instance context")?;
        let meta = file.metadata()?;
        ensure!(
            meta.is_file()
                && meta.uid() == Uid::effective().as_raw()
                && meta.mode() & 0o077 == 0
                && meta.len() <= 4096,
            "forbidden: context must be a private regular file"
        );
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        request["credential"] =
            serde_json::from_slice(&bytes).context("forbidden: invalid instance context")?;
    }
    exchange(state, request, instance)
}

fn exchange(state: &Path, request: Value, instance: bool) -> Result<Value> {
    let mut stream = UnixStream::connect(state.join(if instance {
        "instances.sock"
    } else {
        "service.sock"
    }))
    .context("Voyager service unavailable")?;
    ensure!(
        getsockopt(&stream, sockopt::PeerCredentials)?.uid() == Uid::effective().as_raw(),
        "different-user service"
    );
    stream.set_read_timeout(Some(Duration::from_secs(20)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    writeln!(stream, "{request}")?;
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

pub fn hold_dock(state: &Path, request: Value) -> Result<()> {
    ensure!(
        std::env::var_os("VOYAGER_CALLER").is_none()
            && std::env::var_os("VOYAGER_SESSION_CONTEXT").is_none(),
        "forbidden: only owner can claim a dock"
    );
    let mut stream =
        UnixStream::connect(state.join("service.sock")).context("Voyager service unavailable")?;
    ensure!(
        getsockopt(&stream, sockopt::PeerCredentials)?.uid() == Uid::effective().as_raw(),
        "different-user service"
    );
    stream.set_read_timeout(Some(Duration::from_secs(20)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    writeln!(stream, "{request}")?;
    let response = frame(&mut stream)?;
    if let Some(error) = response["error"].as_str() {
        bail!("{error}");
    }
    let result = response.get("result").context("missing dock result")?;
    println!("{}", serde_json::to_string(result)?);
    io::stdout().flush()?;
    if result["active"] == true {
        stream.set_read_timeout(None)?;
        io::copy(&mut stream, &mut io::sink())?;
    }
    Ok(())
}

struct SocketPath(PathBuf);
impl Drop for SocketPath {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn codex_executable() -> String {
    let program = std::env::var("VOYAGER_CODEX_BIN").unwrap_or_else(|_| "codex".into());
    let candidates = if program.contains('/') {
        vec![PathBuf::from(&program)]
    } else {
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|dir| dir.join(&program))
            .collect()
    };
    candidates
        .into_iter()
        .find(|path| {
            path.metadata()
                .is_ok_and(|meta| meta.is_file() && meta.mode() & 0o111 != 0)
        })
        .and_then(|path| fs::canonicalize(path).ok())
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or(program)
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
        fs::remove_file(&socket_path)?;
    }
    let db_path = state.join("events.sqlite");
    if let Ok(meta) = fs::symlink_metadata(&db_path) {
        ensure!(
            meta.is_file() && meta.uid() == Uid::effective().as_raw() && meta.mode() & 0o077 == 0,
            "database must be a private regular file"
        );
    }
    let store = Store::open(&db_path)?;
    store.0.execute("UPDATE requests SET state='failed',error_code='service_restarted_before_dispatch' WHERE state='pending'", [])?;
    store.reconcile_coordination()?;
    store.0.execute("UPDATE operations SET receipt=json_set(receipt,'$.run_state','uncertain','$.error','Parent service restarted; grants expired and runner ownership was not restored.') WHERE json_extract(receipt,'$.action')='test-start' AND json_extract(receipt,'$.run_state') IN ('starting','running','stopping')", [])?;
    store.0.execute("UPDATE operations SET receipt=json_set(receipt,'$.state','uncertain','$.error','Service restarted; inspect the existing instance before any new action.') WHERE json_extract(receipt,'$.state')='pending'", [])?;
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
    Credentials::clear_stale(state)?;
    let executable = codex_executable();
    let mut runtime = Runtime {
        conversation: conversation::Conversation::start(&executable, state),
        voice: voice::Voice::new(),
        credentials: Credentials::new(),
        control: Control::new(&store)?,
        store,
        codex,
        server: server.map(|p| p.to_string_lossy().into_owned()),
        registered: HashMap::new(),
        captures: HashMap::new(),
        instance: uuid::Uuid::new_v4().to_string(),
        workers: HashMap::new(),
        shells: HashMap::new(),
        terminals: Vec::new(),
        viewer_choices: HashMap::new(),
        tests: development_ops::Tests::default(),
        operations: HashMap::new(),
        creations: HashMap::new(),
        native_calls: Vec::new(),
        state: fs::canonicalize(state)?,
        binary: std::env::current_exe()?,
        executable,
    };
    let listener = UnixListener::bind(&socket_path)?;
    let _socket = SocketPath(socket_path);
    listener.set_nonblocking(true)?;
    let instance_path = state.join("instances.sock");
    if let Ok(meta) = fs::symlink_metadata(&instance_path) {
        ensure!(
            meta.file_type().is_socket() && meta.uid() == Uid::effective().as_raw(),
            "refusing to replace non-socket instance state"
        );
        fs::remove_file(&instance_path)?;
    }
    let instance_listener = UnixListener::bind(&instance_path)?;
    let _instance_socket = SocketPath(instance_path);
    instance_listener.set_nonblocking(true)?;
    eprintln!("Voyager ready; external registrations and managed launches remain separate");
    loop {
        let (accepted, instance_entry) = match instance_listener.accept() {
            Ok(v) => (Ok(v), true),
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => (listener.accept(), false),
            Err(e) => return Err(e.into()),
        };
        let idle = matches!(&accepted, Err(error) if error.kind() == io::ErrorKind::WouldBlock);
        match accepted {
            Ok((mut stream, _)) => {
                stream.set_read_timeout(Some(Duration::from_secs(1)))?;
                stream.set_write_timeout(Some(Duration::from_secs(1)))?;
                let result = (|| -> Result<Option<(Value, bool)>> {
                    ensure!(
                        getsockopt(&stream, sockopt::PeerCredentials)?.uid()
                            == Uid::effective().as_raw(),
                        "different-user peer"
                    );
                    let mut request = frame(&mut stream)?;
                    ensure!(
                        request.is_object(),
                        "invalid_input: request must be an object"
                    );
                    ensure!(
                        !["purpose", "coordination_id", "new_session_id"]
                            .iter()
                            .any(|field| request.get(*field).is_some()),
                        "invalid_input: reserved service field"
                    );
                    let actor = if instance_entry {
                        runtime.credentials.actor(
                            &runtime.store,
                            &request["credential"],
                            &runtime.instance,
                        )?
                    } else {
                        authority::owner()
                    };
                    request
                        .as_object_mut()
                        .context("invalid_input: request")?
                        .remove("credential");
                    request["actor"] = actor;
                    runtime.observe()?;
                    runtime.authorize(&request)?;
                    if request.get("control_generation").is_none()
                        && request["actor"]["kind"] == "instance"
                        && runtime.control.session() == request["actor"]["session_id"].as_str()
                        && [
                            "send",
                            "create",
                            "launch",
                            "open",
                            "background",
                            "stop-instance",
                            "shell-exec",
                            "adjudicate",
                            "move-vessel",
                        ]
                        .iter()
                        .any(|op| request["op"] == *op)
                    {
                        request["control_generation"] =
                            runtime.control.current()["generation"].clone();
                    }
                    if request["op"] == "conversation-attach" {
                        let result = runtime
                            .conversation
                            .attach(string(&request, "client_id")?, stream.try_clone()?)?;
                        return Ok(Some((result, false)));
                    }
                    if request["op"] == "dock" {
                        runtime.ensure_connected(string(&request, "session_id")?)?;
                        let peer =
                            u32::try_from(getsockopt(&stream, sockopt::PeerCredentials)?.pid())?;
                        return Ok(Some((
                            runtime.control.dock(
                                &runtime.store,
                                &request,
                                peer,
                                stream.try_clone()?,
                            )?,
                            false,
                        )));
                    }
                    if ["discover", "register", "send"]
                        .iter()
                        .any(|op| request["op"] == *op)
                    {
                        return Ok(runtime
                            .begin_native(request, Some(stream.try_clone()?))?
                            .map(|v| (v, false)));
                    }
                    runtime.dispatch(request).map(Some)
                })();
                let (reply, stop) = match result {
                    Ok(Some((value, stop))) => (json!({"result":value}), stop),
                    Ok(None) => continue,
                    Err(error) => {
                        let message = error.to_string();
                        let code = message
                            .split(':')
                            .next()
                            .filter(|c| {
                                [
                                    "invalid_input",
                                    "not_found",
                                    "forbidden",
                                    "stale_control",
                                    "removed",
                                    "external_owner",
                                    "busy",
                                    "unsupported",
                                    "request_conflict",
                                    "outcome_unknown",
                                ]
                                .contains(c)
                            })
                            .unwrap_or("provider_failed");
                        (json!({"error":message,"code":code}), false)
                    }
                };

                let _ = writeln!(stream, "{reply}");
                if stop {
                    break;
                }
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
            Err(e) => return Err(e.into()),
        }
        runtime.observe()?;
        if idle && runtime.codex.is_none() {
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
    voice: voice::Voice,
    conversation: conversation::Conversation,
    credentials: Credentials,
    control: Control,
    store: Store,
    codex: Option<Codex>,
    server: Option<String>,
    registered: HashMap<String, (String, i64)>,
    captures: HashMap<String, (Codex, i64)>,
    instance: String,
    workers: HashMap<String, Worker>,
    shells: HashMap<String, Shell>,
    terminals: Vec<Terminal>,
    viewer_choices: HashMap<String, crate::viewer::Kind>,
    tests: development_ops::Tests,
    operations: HashMap<String, PendingOperation>,
    creations: HashMap<String, (Value, StartingWorker)>,
    native_calls: Vec<NativeCall>,
    state: PathBuf,
    binary: PathBuf,
    executable: String,
}

struct Terminal {
    kind: crate::viewer::Kind,
    session: String,
    child: Child,
    window: Option<u32>,
}

impl Terminal {
    fn window_state(&self) -> &'static str {
        match self.window.map(terminal::exists) {
            Some(Ok(true)) => "open",
            Some(Ok(false)) => "closed",
            _ => "unknown",
        }
    }

    fn finished(&mut self) -> Result<bool> {
        Ok(self.child.try_wait()?.is_some()
            && (self.window.is_none() || self.window_state() == "closed"))
    }
}

fn string<'a>(v: &'a Value, field: &str) -> Result<&'a str> {
    v[field]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .with_context(|| format!("invalid_input: missing {field}"))
}

impl Runtime {
    fn codex(&mut self) -> Result<&mut Codex> {
        self.codex
            .as_mut()
            .context("Codex disconnected; restart Voyager and register again")
    }

    fn check_control(&self, request: &Value) -> Result<()> {
        if let Some(generation) = request.get("control_generation") {
            ensure!(
                [
                    "send",
                    "create",
                    "launch",
                    "open",
                    "background",
                    "stop-instance",
                    "shell-exec",
                    "adjudicate",
                    "move-vessel"
                ]
                .contains(&string(request, "op")?),
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
        Ok(())
    }

    fn dispatch(&mut self, request: Value) -> Result<(Value, bool)> {
        self.authorize(&request)?;
        self.check_control(&request)?;
        if let Some(action) = Action::parse(&request)? {
            return Ok((self.begin_action(&request, action)?, false));
        }
        if ["shell-exec", "shell-read", "send"].contains(&string(&request, "op")?) {
            self.store
                .require_registered(string(&request, "session_id")?)?;
        }
        let value = match string(&request, "op")? {
            "test-grant" | "test-revoke" | "test-start" | "test-stop" | "test-runs"
            | "test-read" => self.test_operation(&request)?,
            "rank" | "supervise" | "report" | "adjudicate" | "escalate" => {
                self.authority_operation(&request)?
            }
            "conversation" => self.conversation.snapshot(
                request["after"].as_u64().unwrap_or(0),
                request["client_id"].as_str(),
            ),
            "conversation-voice-activity" => self.conversation.voice_activity(&request)?,
            "conversation-operation" => {
                self.conversation.receipt(string(&request, "request_id")?)?
            }
            "conversation-send" | "conversation-voice-start" | "conversation-voice-stop" => {
                if request["op"] == "conversation-voice-start" {
                    ensure!(
                        self.voice.permits_app() && self.control.session().is_none(),
                        "forbidden: app voice is not the selected voice surface"
                    );
                }
                self.conversation.request(&request)?
            }
            "fleets" | "create-fleet" | "rename-fleet" | "move-vessel" | "remove-fleet" => {
                self.fleet_operation(&request)?
            }
            "voice" => self.select_voice(&request)?,
            "rename" => self.rename_instance(&request)?,
            "capabilities" => self.capabilities(&request)?,
            "escalations" => self.escalations()?,
            "create" | "launch" => self.create_operation(&request)?,
            "operation" => {
                let id = string(&request, "request_id")?;
                let (inputs, mut receipt) = if let Some(operation) = self.store.operation(id)? {
                    operation
                } else {
                    let task = self.store.request(id)?.context("not_found: operation")?;
                    (
                        json!({"actor":{"kind":task["actor_kind"],"session_id":task["actor_session_id"]}}),
                        task,
                    )
                };
                if !authority::is_owner(&request["actor"]) {
                    let own = inputs["actor"] == request["actor"];
                    ensure!(
                        own || receipt["session_id"]
                            .as_str()
                            .is_some_and(|s| self.can_read(&request["actor"], s).unwrap_or(false)),
                        "forbidden: operation outside caller scope"
                    );
                }
                receipt
                    .as_object_mut()
                    .context("operation receipt")?
                    .remove("message");
                receipt
            }
            "status" => {
                json!({"terminal_viewers":crate::viewer::Kind::ALL.map(|kind|json!({"id":kind.as_str(),"executable":kind.executable()})),"instance":self.instance,"conversation":self.conversation.status(),"codex_connected":self.codex.is_some(),"capturing":self.capture_count()?,"owns_agents":!self.creations.is_empty() || self.workers.values().any(|w|w.alive),"owns_shells":self.shells.values().any(|s|s.alive),"control":self.control.current(),"voice":self.voice.status(self.control.voice())})
            }
            "undock" => {
                json!({"released":self.control.release(&self.store, Some(string(&request,"generation")?), "undocked")?})
            }
            "connection-info" => {
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
                ensure!(
                    request
                        .get("include_removed")
                        .is_none_or(|v| v.is_boolean()),
                    "invalid_input: include_removed must be boolean"
                );
                let mut sessions = self.store.sessions()?;
                for session in &mut sessions {
                    session["terminal"] = json!(
                        self.viewer_choices
                            .get(session["id"].as_str().unwrap_or(""))
                            .copied()
                            .unwrap_or(crate::viewer::Kind::Ghostty)
                            .as_str()
                    );
                    let captured = self
                        .workers
                        .values()
                        .any(|w| session["id"] == w.session && w.connection.is_some())
                        || self
                            .shells
                            .values()
                            .any(|s| session["id"] == s.session && s.connected())
                        || self
                            .registered
                            .get(session["native_thread_id"].as_str().unwrap())
                            .is_some_and(|(id, _)| session["id"] == *id)
                        || self.captures.contains_key(session["id"].as_str().unwrap());
                    session["window"] = json!(if session["ownership"] != "managed" {
                        "unknown"
                    } else if let Some(viewer) = self
                        .terminals
                        .iter()
                        .rev()
                        .find(|t| session["id"] == t.session)
                    {
                        viewer.window_state()
                    } else {
                        "closed"
                    });
                    session["capture"] = json!(if captured && session["removed_ms"].is_null() {
                        "connected"
                    } else {
                        "disconnected"
                    });
                }
                if request["include_removed"] != true {
                    sessions.retain(|s| s["removed_ms"].is_null());
                }
                if !authority::is_owner(&request["actor"]) {
                    for session in &mut sessions {
                        session
                            .as_object_mut()
                            .context("session metadata")?
                            .retain(|key, _| {
                                [
                                    "id",
                                    "name",
                                    "kind",
                                    "rank",
                                    "supervisor_id",
                                    "worker_state",
                                    "capture",
                                    "ownership",
                                    "window",
                                    "terminal",
                                    "removed_ms",
                                ]
                                .contains(&key.as_str())
                            });
                    }
                }
                json!(sessions)
            }
            "shell-exec" => self
                .shells
                .get_mut(string(&request, "session_id")?)
                .context("not a managed shell")?
                .submit(
                    &self.store,
                    string(&request, "request_id")?,
                    string(&request, "command")?,
                )?,
            "shell-read" => self
                .shells
                .get(string(&request, "session_id")?)
                .context("not a managed shell")?
                .output(request["after"].as_u64().unwrap_or(0)),
            "attach-info" => self.attachment(string(&request, "session_id")?)?,
            "events" => {
                let mut page = self.store.events(request["after"].as_i64().unwrap_or(0))?;
                if let Some(target) = request.get("session_id") {
                    let id = target.as_str().context("invalid_input: event session ID")?;
                    ensure!(
                        self.can_read(&request["actor"], id)?,
                        "forbidden: event target outside caller scope"
                    );
                    page["events"]
                        .as_array_mut()
                        .context("event page")?
                        .retain(|event| event["session_id"] == id);
                }
                if !authority::is_owner(&request["actor"]) {
                    let mut permitted = Vec::new();
                    for event in page["events"].as_array().context("events missing")? {
                        if self.can_read(&request["actor"], string(event, "session_id")?)? {
                            permitted.push(event.clone());
                        }
                    }
                    page["events"] = json!(permitted);
                }
                page
            }
            "stop" => {
                ensure!(
                    self.creations.is_empty()
                        && !self.tests.active()
                        && !self.workers.values().any(|w| w.alive)
                        && !self.shells.values().any(|s| s.alive),
                    "stop managed instances explicitly before stopping Voyager"
                );
                return Ok((json!({"stopping":true,"native_agents_stopped":false}), true));
            }
            _ => bail!("unsupported operation"),
        };
        Ok((value, false))
    }

    fn ensure_connected(&mut self, session: &str) -> Result<()> {
        self.store.require_registered(session)?;
        if let Some(shell) = self.shells.get(session) {
            ensure!(shell.connected(), "shell is disconnected");
            return Ok(());
        }
        self.connection(session)?;
        Ok(())
    }

    fn connection(&mut self, session: &str) -> Result<&mut Codex> {
        if let Some(worker) = self.workers.get_mut(session) {
            return worker.client();
        }
        if let Some((connection, _)) = self.captures.get_mut(session) {
            return Ok(connection);
        }
        let native = self.store.native(
            session,
            self.server
                .as_deref()
                .context("no external server configured")?,
        )?;
        ensure!(
            self.registered.get(&native).map(|(id, _)| id.as_str()) == Some(session),
            "session is not currently registered for capture"
        );
        self.codex.as_mut().context("Codex disconnected")
    }

    fn attachment(&self, id: &str) -> Result<Value> {
        if let Some(shell) = self.shells.get(id) {
            return shell.attach(&self.state);
        }
        let worker = self
            .workers
            .get(id)
            .context("not a live managed instance")?;
        worker.attach()
    }

    fn persist(&self, message: Value) -> Result<()> {
        if let Some(observation) = events::normalize(&message) {
            if let Some((session, generation)) = self.registered.get(&observation.thread) {
                self.store.record(session, *generation, observation)?;
            }
        }
        Ok(())
    }

    fn observe(&mut self) -> Result<()> {
        self.observe_tests()?;
        self.conversation.observe();
        if self.conversation.questions_due() {
            let mut questions = self
                .escalations()?
                .as_array()
                .cloned()
                .context("owner escalations")?;
            questions.retain(|q| q["registered"] == true);
            self.conversation.questions(questions);
        }
        for index in (0..self.terminals.len()).rev() {
            if self.terminals[index].finished()? {
                self.terminals.swap_remove(index).child.wait()?;
            }
        }
        for shell in self.shells.values_mut() {
            shell.observe(&self.store)?;
        }
        for worker in self.workers.values_mut() {
            worker.observe(&self.store)?;
        }
        let mut disconnected = Vec::new();
        for (session, (connection, generation)) in &mut self.captures {
            let native = self.store.session(session)?["native_thread_id"]
                .as_str()
                .context("native identity missing")?
                .to_owned();
            let mut notes: Vec<_> = connection.pending.drain(..).collect();
            match connection.read() {
                Ok(Some(note)) => notes.push(note),
                Ok(None) => (),
                Err(_) => disconnected.push(session.clone()),
            }
            for note in notes {
                if let Some(event) = events::normalize(&note) {
                    if event.thread == native {
                        self.store.record(session, *generation, event)?;
                    }
                }
            }
        }
        for session in disconnected {
            self.captures.remove(&session);
            self.store.local(
                &session,
                "capture.gap",
                json!({"reason":"native_disconnected","replay_available":false}),
            )?;
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
        self.observe_control()?;
        self.observe_voice()?;
        self.advance_native()?;
        self.advance_creations()?;
        self.advance_operations()?;
        Ok(())
    }

    fn observe_control(&mut self) -> Result<()> {
        self.control.observe(&self.store)?;
        if let Some(session) = self.control.session().map(str::to_owned) {
            if self.ensure_connected(&session).is_err() {
                self.control
                    .release(&self.store, None, "capture_disconnected")?;
            }
        }
        Ok(())
    }

    fn gap(&self, reason: &str) -> Result<()> {
        for (session, _) in self.registered.values() {
            self.store.local(
                session,
                "capture.gap",
                json!({"reason":reason,"replay_available":false}),
            )?;
        }
        Ok(())
    }
}
pub fn start(state: &Path) -> Result<Value> {
    private_dir(state)?;
    if let Ok(status) = client(state, json!({"op":"status"})) {
        return Ok(status);
    }
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .custom_flags(nix::libc::O_NOFOLLOW)
        .open(state.join("service.log"))?;
    let meta = log.metadata()?;
    ensure!(
        meta.is_file() && meta.uid() == Uid::effective().as_raw() && meta.mode() & 0o077 == 0,
        "service log must be private"
    );
    let mut command = Command::new(std::env::current_exe()?);
    command
        .args(["--state"])
        .arg(state)
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log));
    unsafe {
        command.pre_exec(|| {
            if nix::libc::setsid() < 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = command.spawn().context("start Voyager service")?;
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        if let Ok(status) = client(state, json!({"op":"status"})) {
            return Ok(status);
        }
        ensure!(
            child.try_wait()?.is_none(),
            "Voyager failed to start; inspect service.log"
        );
        ensure!(
            std::time::Instant::now() < deadline,
            "service startup not confirmed; inspect service.log before retrying"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(test)]
mod viewer_tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn unavailable_display_does_not_confirm_viewer_closure() {
        if std::env::var("VOYAGER_TEST_UNAVAILABLE_DISPLAY").as_deref() != Ok("1") {
            let output = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "service::viewer_tests::unavailable_display_does_not_confirm_viewer_closure",
                    "--nocapture",
                ])
                .env("VOYAGER_TEST_UNAVAILABLE_DISPLAY", "1")
                .env("DISPLAY", "invalid-display")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stdout)
            );
            return;
        }
        assert!(terminal::exists(1).is_err());
        let mut child = Command::new("/bin/true").spawn().unwrap();
        child.wait().unwrap();
        let mut viewer = Terminal {
            kind: crate::viewer::Kind::Xterm,
            session: "fixture".into(),
            child,
            window: Some(1),
        };
        assert_eq!(viewer.window_state(), "unknown");
        assert!(!viewer.finished().unwrap());
        viewer.window = None;
        assert!(viewer.finished().unwrap());
    }
}
