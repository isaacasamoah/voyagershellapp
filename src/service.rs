use crate::{codex::Codex, events, store::Store};
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

pub fn serve(state: &Path, codex_path: &Path) -> Result<()> {
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
    for session in store.sessions()? {
        store.local(
            session["id"].as_str().unwrap(),
            "capture.gap",
            json!({"reason":"service_restarted","replay_available":false}),
        )?;
    }
    let server = fs::canonicalize(codex_path)?.to_string_lossy().into_owned();
    let mut runtime = Runtime {
        store,
        codex: Some(Codex::connect(Path::new(&server))?),
        server,
        registered: HashMap::new(),
        instance: uuid::Uuid::new_v4().to_string(),
    };
    let listener = UnixListener::bind(&socket_path)?;
    let _socket = SocketPath(socket_path);
    listener.set_nonblocking(true)?;
    eprintln!("Voyager ready; native agents remain externally owned");
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
                    runtime.dispatch(frame(&mut stream)?)
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
    runtime.gap("service_stopped")?;
    Ok(())
}

struct Runtime {
    store: Store,
    codex: Option<Codex>,
    server: String,
    registered: HashMap<String, String>, // native thread -> Voyager registration
    instance: String,
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
        let value = match string(&request, "op")? {
            "status" => {
                json!({"instance":self.instance,"codex_connected":self.codex.is_some(),"capturing":self.registered.len(),"owns_agents":false})
            }
            "discover" => {
                let c = self.codex()?;
                let mut threads = Vec::new();
                for id in c.loaded()? {
                    threads.push(c.metadata(&id)?);
                }
                json!(threads)
            }
            "list" => {
                let mut sessions = self.store.sessions()?;
                for session in &mut sessions {
                    let captured = self
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
                let id = self.store.register(&self.server, &metadata)?;
                self.store.local(&id,"capture.started",json!({"source":"codex_app_server","history_imported":false,"replay_available":false}))?;
                self.registered.insert(thread.to_owned(), id.clone());
                json!({"session_id":id,"native_thread_id":thread,"ownership":"external","capture":"connected"})
            }
            "send" => {
                let session = string(&request, "session_id")?;
                let request_id = string(&request, "request_id")?;
                let message = string(&request, "message")?;
                ensure!(
                    request_id.len() <= 128 && message.len() <= events::TEXT_LIMIT,
                    "request ID or message too long"
                );
                if let Some(previous) = self.store.request(request_id)? {
                    ensure!(
                        previous["session_id"] == session && previous["message"] == message,
                        "request ID conflicts with previous inputs"
                    );
                    return Ok((previous, false));
                }
                let native = self.store.native(session, &self.server)?;
                ensure!(
                    self.registered.get(&native).map(String::as_str) == Some(session),
                    "session is not currently registered for capture"
                );
                let metadata = self.codex()?.metadata(&native)?;
                ensure!(
                    metadata["status"]["type"] == "idle",
                    "agent is not idle; leave its current work alone"
                );
                self.store.begin_request(request_id, session, message)?;
                let result = self.codex()?.rpc("turn/start",json!({"threadId":native,"clientUserMessageId":request_id,"input":[{"type":"text","text":message}]}))?;
                let turn = result["turn"]["id"]
                    .as_str()
                    .context("no turn identity; request remains uncertain")?;
                self.store.accepted(request_id, turn)?;
                self.store.request(request_id)?.unwrap()
            }
            "events" => self.store.events(request["after"].as_i64().unwrap_or(0))?,
            "stop" => return Ok((json!({"stopping":true,"native_agents_stopped":false}), true)),
            _ => bail!("unsupported operation"),
        };
        Ok((value, false))
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
