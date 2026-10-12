//! A real interactive Bash behind a service-owned PTY. The attach client only
//! transports bytes; Ghostty remains the terminal emulator. Capture comes from
//! Bash's command boundaries, never from guessing at rendered terminal text.
use crate::{shell_transport::Viewer, store::Store};
use anyhow::{Context, Result, bail, ensure};
use nix::{
    fcntl::{FcntlArg, FdFlag, OFlag, fcntl},
    pty::{Winsize, openpty},
    sys::{
        signal::{Signal, kill, killpg},
        socket::{getsockopt, sockopt},
    },
    unistd::{Pid, Uid},
};
use serde_json::{Value, json};
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    os::{
        fd::AsRawFd,
        unix::{
            net::{UnixListener, UnixStream},
            process::CommandExt,
        },
    },
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

const BUFFER_LIMIT: usize = 64 * 1024;

fn transient(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}
fn nonblocking(fd: &impl std::os::fd::AsFd) -> Result<()> {
    fcntl(fd, FcntlArg::F_SETFL(OFlag::O_NONBLOCK))?;
    Ok(())
}
fn resize(fd: i32, rows: u16, cols: u16) -> Result<()> {
    ensure!(rows > 0 && cols > 0, "invalid terminal dimensions");
    let size = Winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // SAFETY: fd is a live PTY and size points to a valid winsize for this call.
    ensure!(
        unsafe { nix::libc::ioctl(fd, nix::libc::TIOCSWINSZ, &size) } == 0,
        "resize PTY failed"
    );
    Ok(())
}

pub struct Shell {
    process: Child,
    master: File,
    hooks: UnixStream,
    hook_bytes: Vec<u8>,
    listener: UnixListener,
    viewer: Option<Viewer>,
    socket: PathBuf,
    output: Vec<u8>,
    output_start: u64,
    pending: Option<String>,
    command: Option<String>,
    pub session: String,
    launch: String,
    pub alive: bool,
    ready: bool,
    untouched: bool,
    capture: bool,
}

impl Shell {
    pub fn start(store: &mut Store, state: &Path, launch: &str, cwd: &str) -> Result<Self> {
        let dir = state.join(format!("s-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir(&dir)?;
        let socket = dir.join("t.sock");
        ensure!(socket.as_os_str().len() < 104, "shell socket path too long");
        let listener = UnixListener::bind(&socket)?;
        listener.set_nonblocking(true)?;
        let rc = dir.join("shell.bash");
        fs::write(&rc, include_str!("shell.bash"))?;
        let pty = openpty(
            Some(&Winsize {
                ws_row: 24,
                ws_col: 100,
                ws_xpixel: 0,
                ws_ypixel: 0,
            }),
            None,
        )?;
        for fd in [&pty.master, &pty.slave] {
            fcntl(fd, FcntlArg::F_SETFD(FdFlag::FD_CLOEXEC))?;
        }
        let (hooks, child_hooks) = UnixStream::pair()?;
        hooks.set_nonblocking(true)?;
        let event_fd = child_hooks.as_raw_fd();
        let mut command = Command::new("/bin/bash");
        command
            .args(["--noprofile", "--rcfile"])
            .arg(&rc)
            .arg("-i")
            .current_dir(cwd)
            .env("TERM", "xterm-256color")
            .env("VOYAGER_STATE", state)
            .env("VOYAGER_BIN", std::env::current_exe()?)
            .stdin(Stdio::from(pty.slave.try_clone()?))
            .stdout(Stdio::from(pty.slave.try_clone()?))
            .stderr(Stdio::from(pty.slave));
        // SAFETY: only async-signal-safe syscalls between fork and exec. Standard
        // descriptors are already the slave PTY; fd 9 is deliberately inherited.
        unsafe {
            command.pre_exec(move || {
                if nix::libc::setsid() < 0
                    || nix::libc::ioctl(0, nix::libc::TIOCSCTTY, 0) < 0
                    || nix::libc::dup2(event_fd, 9) < 0
                    || nix::libc::fcntl(9, nix::libc::F_SETFD, 0) < 0
                {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let process = command.spawn().context("start interactive Bash")?;
        drop(child_hooks);
        let master = File::from(pty.master);
        nonblocking(&master)?;
        let mut shell = Self {
            process,
            master,
            hooks,
            hook_bytes: Vec::new(),
            listener,
            viewer: None,
            socket,
            output: Vec::new(),
            output_start: 0,
            pending: None,
            command: None,
            session: String::new(),
            launch: launch.into(),
            alive: true,
            ready: false,
            untouched: true,
            capture: true,
        };
        shell.session = store.register_worker(
            launch,
            shell.socket.to_str().context("socket UTF-8")?,
            &json!({"id":launch,"cwd":cwd,"kind":"shell"}),
            shell.process.id(),
        )?;
        store.local(
            &shell.session,
            "shell.started",
            json!({"pid":shell.process.id(),"shell":"bash","capture_policy":"shell-commands-v1"}),
        )?;
        Ok(shell)
    }
    pub fn connected(&self) -> bool {
        self.alive && self.capture
    }
    pub fn attach(&self, state: &Path) -> Result<Value> {
        ensure!(
            self.connected(),
            "shell ended or command capture unavailable"
        );
        Ok(
            json!({"executable":std::env::current_exe()?,"args":["--state",state,"shell-attach",self.session],
            "pid":self.process.id(),"session_id":self.session,"socket":self.socket,"kind":"shell"}),
        )
    }
    pub fn output(&self, after: u64) -> Value {
        let end = self.output_start + self.output.len() as u64;
        let offset = after.max(self.output_start).min(end) - self.output_start;
        json!({"session_id":self.session,"text":String::from_utf8_lossy(&self.output[offset as usize..]),
            "cursor":end,"gap":after < self.output_start,"ready":self.ready && self.untouched && self.pending.is_none(),"alive":self.alive})
    }
    pub fn submit(&mut self, store: &Store, id: &str, text: &str) -> Result<Value> {
        ensure!(
            id.len() <= 128
                && !id.is_empty()
                && !text.trim().is_empty()
                && text.len() <= 4096
                && !text.chars().any(char::is_control),
            "provide one shell command line without control characters"
        );
        if let Some(previous) = store.request(id)? {
            ensure!(
                previous["session_id"] == self.session && previous["message"] == text,
                "request ID conflicts with previous inputs"
            );
            return Ok(previous);
        }
        ensure!(
            self.connected() && self.ready && self.untouched && self.pending.is_none(),
            "shell is busy or has human input; finish or cancel that line first"
        );
        store.begin_request(id, &self.session, text)?;
        self.pending = Some(id.into());
        self.ready = false;
        self.untouched = false;
        // A partial write is uncertain and is never replayed. This also closes the
        // gate to competing agent submissions before any command bytes are sent.
        self.master.write_all(text.as_bytes())?;
        self.master.write_all(b"\n")?;
        self.untouched = true;
        store.accepted(id, id)?;
        store.request(id)?.context("missing command receipt")
    }
    fn hook(&mut self, store: &Store, kind: &str, value: &str, cwd: &str) -> Result<()> {
        match kind {
            "begin" => {
                self.ready = false;
                // `history 1` prefixes the entered line with its decimal index.
                let line = value
                    .trim_start()
                    .trim_start_matches(|c: char| c.is_ascii_digit())
                    .trim_start();
                // A queued human command may reach Bash before our submitted
                // line. Never attribute that earlier command to the agent.
                let matched = self
                    .pending
                    .as_deref()
                    .map(|id| store.request(id))
                    .transpose()?
                    .flatten()
                    .is_some_and(|r| r["message"] == line);
                let request = if matched { self.pending.take() } else { None };
                let id = request
                    .clone()
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                let (text, truncated) = crate::events::text(&json!(line));
                store.local(
                    &self.session,
                    "shell.command",
                    json!({"command_id":id,"request_id":request,
                    "actor":if request.is_some(){"agent"}else{"human"},"text":text,"truncated":truncated,"cwd":cwd}),
                )?;
                self.command = Some(id);
            }
            "end" => {
                if let Some(id) = self.command.take() {
                    store.local(
                        &self.session,
                        "shell.completed",
                        json!({"command_id":id,"exit_code":value.parse::<i32>()?,"cwd":cwd}),
                    )?;
                }
                self.ready = true;
            }
            _ => bail!("unknown Bash event"),
        }
        Ok(())
    }
    fn observe_hooks(&mut self, store: &Store) -> Result<()> {
        let mut bytes = [0; 8192];
        for _ in 0..16 {
            match self.hooks.read(&mut bytes) {
                Ok(0) => {
                    ensure!(
                        self.process.try_wait()?.is_some(),
                        "Bash event channel closed"
                    );
                    break;
                }
                Ok(n) => self.hook_bytes.extend_from_slice(&bytes[..n]),
                Err(e) if transient(&e) => break,
                Err(e) => return Err(e.into()),
            }
        }
        ensure!(
            self.hook_bytes.len() <= BUFFER_LIMIT,
            "Bash event too large"
        );
        loop {
            let ends: Vec<_> = self
                .hook_bytes
                .iter()
                .enumerate()
                .filter(|(_, b)| **b == 0)
                .take(3)
                .map(|(i, _)| i)
                .collect();
            if ends.len() < 3 {
                break;
            }
            let kind = String::from_utf8(self.hook_bytes[..ends[0]].to_vec())?;
            let value =
                String::from_utf8_lossy(&self.hook_bytes[ends[0] + 1..ends[1]]).into_owned();
            let cwd = String::from_utf8_lossy(&self.hook_bytes[ends[1] + 1..ends[2]]).into_owned();
            self.hook_bytes.drain(..=ends[2]);
            self.hook(store, &kind, &value, &cwd)?;
        }
        Ok(())
    }
    fn observe_viewer(&mut self) -> Result<()> {
        if let Ok((mut stream, _)) = self.listener.accept() {
            let same_user =
                getsockopt(&stream, sockopt::PeerCredentials)?.uid() == Uid::effective().as_raw();
            stream.set_read_timeout(Some(Duration::from_millis(1)))?;
            stream.set_write_timeout(Some(Duration::from_millis(20)))?;
            if !same_user || self.viewer.is_some() {
                let _ = writeln!(
                    stream,
                    "{}",
                    json!({"error":"This shell already has an attached terminal."})
                );
            } else {
                let mut viewer = Viewer {
                    socket: stream,
                    input: Vec::new(),
                };
                for chunk in self.output.chunks(4096) {
                    viewer.send(json!({"output":chunk,"replay":true}))?;
                }
                self.viewer = Some(viewer);
            }
        }
        if let Some(viewer) = &mut self.viewer {
            for frame in viewer.read()? {
                if let Some(raw) = frame.get("input") {
                    let bytes: Vec<u8> = serde_json::from_value(raw.clone())?;
                    ensure!(bytes.len() <= 4096, "input chunk too large");
                    if let Some(last) = bytes.last() {
                        // Do not clear typeahead at command completion. Only a
                        // submitted/cancelled line makes the input boundary clean.
                        self.untouched = matches!(*last, b'\n' | b'\r' | 3);
                        if self.untouched {
                            self.ready = false;
                        }
                    }
                    self.master.write_all(&bytes)?;
                } else if let Some(size) = frame["resize"].as_array() {
                    ensure!(size.len() == 2, "invalid resize");
                    resize(
                        self.master.as_raw_fd(),
                        size[0]
                            .as_u64()
                            .and_then(|n| u16::try_from(n).ok())
                            .context("invalid rows")?,
                        size[1]
                            .as_u64()
                            .and_then(|n| u16::try_from(n).ok())
                            .context("invalid cols")?,
                    )?;
                } else {
                    bail!("invalid terminal frame");
                }
            }
        }
        Ok(())
    }
    pub fn observe(&mut self, store: &Store) -> Result<()> {
        if !self.alive {
            return Ok(());
        }
        if self.capture && self.observe_hooks(store).is_err() {
            self.capture = false;
            store.local(
                &self.session,
                "capture.gap",
                json!({"reason":"shell_hook_failed","replay_available":false}),
            )?;
        }
        // Apply shell boundaries before newly arrived keystrokes. A prompt event
        // must never erase our knowledge that a person has begun editing a line.
        if let Err(error) = self.observe_viewer() {
            eprintln!("shell client disconnected: {error}");
            self.viewer = None;
        }
        let mut bytes = [0; 4096];
        for _ in 0..16 {
            match self.master.read(&mut bytes) {
                Ok(0) => break,
                Ok(n) => {
                    self.output.extend_from_slice(&bytes[..n]);
                    if self.output.len() > BUFFER_LIMIT {
                        let removed = self.output.len() - BUFFER_LIMIT;
                        self.output.drain(..removed);
                        self.output_start += removed as u64;
                    }
                    if let Some(viewer) = &mut self.viewer {
                        if viewer.send(json!({"output":&bytes[..n]})).is_err() {
                            self.viewer = None;
                        }
                    }
                }
                Err(e) if transient(&e) || e.raw_os_error() == Some(nix::libc::EIO) => break,
                Err(e) => return Err(e.into()),
            }
        }
        if let Some(status) = self.process.try_wait()? {
            self.alive = false;
            self.viewer = None;
            store.worker_state(&self.launch, "exited")?;
            store.local(
                &self.session,
                "shell.exited",
                json!({"exit_code":status.code()}),
            )?;
        }
        Ok(())
    }
    fn halt(&mut self) -> Result<()> {
        if self.process.try_wait()?.is_some() {
            return Ok(());
        }
        // Interactive Bash forwards HUP to its jobs. A disowned process is outside
        // this ownership contract. Do not kill processes recovered from stored PIDs.
        let _ = kill(Pid::from_raw(self.process.id() as i32), Signal::SIGHUP);
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if self.process.try_wait()?.is_some() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let _ = killpg(Pid::from_raw(self.process.id() as i32), Signal::SIGKILL);
        self.process.wait()?;
        Ok(())
    }
    pub fn stop(&mut self, store: &Store) -> Result<Value> {
        self.halt()?;
        self.alive = false;
        self.viewer = None;
        store.worker_state(&self.launch, "stopped")?;
        store.local(&self.session, "shell.stopped", json!({}))?;
        Ok(json!({"session_id":self.session,"state":"stopped"}))
    }
}
impl Drop for Shell {
    fn drop(&mut self) {
        let _ = self.halt();
    }
}
