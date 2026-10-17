use crate::{
    adoption::{Candidate, Handoff, NativeEvent, Process, children},
    shell_transport::Viewer,
    store::Store,
};
use anyhow::{Context, Result, ensure};
use nix::{
    libc,
    sys::socket::{getsockopt, sockopt},
    unistd::Uid,
};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    fs,
    io::{self, Read, Write},
    os::{
        fd::AsRawFd,
        unix::net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

const LIMIT: usize = 1024 * 1024;

pub struct AgentFrontend {
    pub process: Process,
    pub server: PathBuf,
}

pub struct AgentIdentity {
    pub frontend: AgentFrontend,
    pub thread: String,
}

impl AgentFrontend {
    pub fn inspect(candidate: &Candidate) -> Result<Option<Self>> {
        let mut pending: Vec<_> = children(candidate.shell.pid)?.into_iter().collect();
        let mut found = Vec::new();
        let mut count = 0;
        while let Some(pid) = pending.pop() {
            count += 1;
            ensure!(count <= 256, "unsupported: process tree too large");
            let Ok(process) = Process::open(pid) else {
                continue;
            };
            pending.extend(children(pid)?);
            if fs::read_link(format!("/proc/{pid}/fd/0")).ok().as_ref() != Some(&candidate.tty) {
                continue;
            }
            if process
                .executable
                .file_name()
                .is_some_and(|name| name == "codex" || name == "codex-tui")
            {
                let server = Self::server(&process)?;
                found.push(Self { process, server });
            }
        }
        ensure!(
            found.len() <= 1,
            "unsupported: multiple Codex frontends on this terminal"
        );
        Ok(found.pop())
    }

    fn server(process: &Process) -> Result<PathBuf> {
        let mut peers = std::collections::BTreeSet::new();
        for entry in fs::read_dir(format!("/proc/{}/fd", process.pid))? {
            let entry = entry?;
            if !fs::read_link(entry.path())
                .ok()
                .is_some_and(|p| p.to_string_lossy().starts_with("socket:"))
            {
                continue;
            }
            let number: i32 = entry
                .file_name()
                .to_str()
                .context("invalid descriptor")?
                .parse()?;
            let Ok(file) = process.duplicate(number) else {
                continue;
            };
            let socket = UnixStream::from(std::os::fd::OwnedFd::from(file));
            let Ok(address) = socket.peer_addr() else {
                continue;
            };
            let Some(path) = address.as_pathname() else {
                continue;
            };
            let peer = getsockopt(&socket, sockopt::PeerCredentials)?;
            if peer.uid() != Uid::current().as_raw() {
                continue;
            }
            let server = Process::open(peer.pid() as u32)?;
            if server
                .executable
                .file_name()
                .is_some_and(|name| name == "codex" || name == "codex-app-server")
            {
                peers.insert(path.to_path_buf());
            }
        }
        ensure!(
            peers.len() == 1,
            "unsupported: native Codex needs one identifiable local app-server connection"
        );
        peers.pop_first().context("native server unavailable")
    }

    pub fn verify(&self) -> Result<()> {
        ensure!(self.process.alive()?, "native Codex frontend exited");
        ensure!(
            Self::server(&self.process)? == self.server,
            "native Codex server changed"
        );
        Ok(())
    }
}

pub struct NativeInstance {
    pub candidate: Candidate,
    pub agent: Option<AgentIdentity>,
    pub session: String,
    pub launch: String,
    pub alive: bool,
    pub capture: bool,
    pub generation: i64,
    handoff: Handoff,
    released: bool,
    listener: UnixListener,
    socket: PathBuf,
    viewer: Option<Viewer>,
    output: Vec<u8>,
    output_start: u64,
    osc: Vec<u8>,
    title: Option<String>,
    command: Option<String>,
    pending: Option<String>,
    input: VecDeque<u8>,
    pub handoff_error: Option<String>,
}

impl NativeInstance {
    pub fn acquire(
        candidate: Candidate,
        frontend: Option<AgentFrontend>,
        state: &Path,
        launch: &str,
    ) -> Result<Self> {
        ensure!(
            Command::new("python3")
                .arg("-c")
                .arg(include_str!("../integrations/ghostty/confirm_close.py"))
                .arg("--check")
                .status()?
                .success(),
            "unsupported: native Ghostty close adapter needs Python, PyGObject and AT-SPI"
        );
        let handoff = candidate.handoff()?;
        let (agent, output) = if let Some(frontend) = frontend {
            frontend.verify()?;
            let status = crate::native_status::read(&candidate, Some(&handoff), &frontend.process)?;
            (
                Some(AgentIdentity {
                    frontend,
                    thread: status.thread?,
                }),
                status.output,
            )
        } else {
            (None, Vec::new())
        };
        let socket = state.join(format!("native-{}.sock", uuid::Uuid::new_v4()));
        let listener = UnixListener::bind(&socket)?;
        if let Err(error) = listener.set_nonblocking(true) {
            let _ = fs::remove_file(&socket);
            return Err(error.into());
        }
        Ok(Self {
            candidate,
            agent,
            session: String::new(),
            launch: launch.into(),
            alive: true,
            capture: true,
            generation: 1,
            handoff,
            released: false,
            listener,
            socket,
            viewer: None,
            output,
            output_start: 0,
            osc: Vec::new(),
            title: None,
            command: None,
            pending: None,
            input: VecDeque::new(),
            handoff_error: None,
        })
    }

    pub fn verify(&mut self, store: &Store) -> Result<()> {
        let Some(agent) = &self.agent else {
            return Ok(());
        };
        agent.frontend.verify()?;
        let expected = agent.thread.clone();
        let status = crate::native_status::read(
            &self.candidate,
            (!self.released).then_some(&self.handoff),
            &agent.frontend.process,
        )?;
        self.observe_bytes(store, &status.output)?;
        ensure!(
            status.thread? == expected,
            "native conversation changed; return to the adopted conversation before controlling it"
        );
        Ok(())
    }

    pub fn attach(&self, state: &Path) -> Result<Value> {
        ensure!(
            self.alive && self.handoff_error.is_none(),
            "native runtime has ended or handoff failed"
        );
        Ok(
            json!({"executable":std::env::current_exe()?,"args":["--state",state,"shell-attach",self.session],"pid":self.candidate.shell.pid,"socket":self.socket,"kind":"shell","session_id":self.session}),
        )
    }

    pub fn output(&self, after: u64) -> Value {
        let end = self.output_start + self.output.len() as u64;
        let offset = after.clamp(self.output_start, end) - self.output_start;
        json!({"session_id":self.session,"text":String::from_utf8_lossy(&self.output[offset as usize..]),"cursor":end,"gap":after<self.output_start,"alive":self.alive})
    }

    fn observe_bytes(&mut self, store: &Store, bytes: &[u8]) -> Result<()> {
        if let Some(viewer) = &mut self.viewer {
            if viewer.output(bytes).is_err() {
                self.viewer = None;
            }
        }
        self.output.extend_from_slice(bytes);
        if self.output.len() > LIMIT {
            let remove = self.output.len() - LIMIT;
            self.output.drain(..remove);
            self.output_start += remove as u64;
        }
        if self.agent.is_some() {
            return Ok(());
        }
        self.osc.extend_from_slice(bytes);
        while let Some(start) = self.osc.windows(2).position(|b| b == b"\x1b]") {
            self.osc.drain(..start);
            let bell = self.osc.iter().position(|b| *b == 7).map(|n| (n, 1));
            let st = self
                .osc
                .windows(2)
                .position(|b| b == b"\x1b\\")
                .map(|n| (n, 2));
            let Some((end, width)) = bell.into_iter().chain(st).min_by_key(|(n, _)| *n) else {
                break;
            };
            let text = String::from_utf8_lossy(&self.osc[2..end]).into_owned();
            self.osc.drain(..end + width);
            if let Some(title) = text.strip_prefix("2;") {
                self.title = Some(title.to_owned());
            }
            if text.starts_with("133;C;") {
                let id = self
                    .pending
                    .take()
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                if self.capture {
                    store.capture_local(&self.session, self.generation, "shell.command", json!({"command_id":id,"text":self.title.take(),"source":"ghostty_shell_integration","cwd":fs::read_link(format!("/proc/{}/cwd",self.candidate.shell.pid)).ok()}))?;
                }
                self.command = Some(id);
            }
            if let Some(rest) = text.strip_prefix("133;D;") {
                if let Some(id) = self.command.take() {
                    if self.capture {
                        store.capture_local(&self.session, self.generation, "shell.completed", json!({"command_id":id,"exit_code":rest.split(';').next().and_then(|v|v.parse::<i32>().ok())}))?;
                    }
                }
            }
        }
        if !self.osc.starts_with(b"\x1b]") {
            let escape = self.osc.last() == Some(&27);
            self.osc.clear();
            if escape {
                self.osc.push(27);
            }
        }
        if self.osc.len() > 16384 {
            self.osc.clear();
            self.title = None;
            if self.capture {
                store.local(
                    &self.session,
                    "capture.gap",
                    json!({"reason":"native shell marker exceeds capture limit"}),
                )?;
            }
        }
        Ok(())
    }

    pub fn observe(&mut self, store: &Store) -> Result<()> {
        while let Ok(event) = self.handoff.events.try_recv() {
            match event {
                NativeEvent::Output(bytes) => self.observe_bytes(store, &bytes)?,
                NativeEvent::Released => {
                    self.released = true;
                    let fd = self.candidate.master.as_raw_fd();
                    ensure!(
                        unsafe { libc::fcntl(fd, libc::F_SETFL, libc::O_NONBLOCK) } >= 0,
                        "native PTY flags failed"
                    );
                    store.local(
                        &self.session,
                        "interface.handoff",
                        json!({"shell_pid":self.candidate.shell.pid,"runtime_restarted":false}),
                    )?;
                }
                NativeEvent::Failed(reason) => {
                    self.capture = false;
                    self.handoff_error = Some(reason.clone());
                    store.local(
                        &self.session,
                        "capture.gap",
                        json!({"reason":reason,"lifecycle_control":"uncertain"}),
                    )?;
                }
            }
        }
        if self.released {
            let mut bytes = [0; 8192];
            for _ in 0..32 {
                match self.candidate.master.read(&mut bytes) {
                    Ok(0) => break,
                    Ok(n) => self.observe_bytes(store, &bytes[..n])?,
                    Err(e)
                        if e.kind() == io::ErrorKind::WouldBlock
                            || e.raw_os_error() == Some(libc::EIO) =>
                    {
                        break;
                    }
                    Err(e) => return Err(e.into()),
                }
            }
        }
        if let Ok((mut socket, _)) = self.listener.accept() {
            socket.set_read_timeout(Some(Duration::from_millis(1)))?;
            socket.set_write_timeout(Some(Duration::from_millis(50)))?;
            if !self.released
                || self.viewer.is_some()
                || getsockopt(&socket, sockopt::PeerCredentials)?.uid() != Uid::current().as_raw()
            {
                let _ = writeln!(
                    socket,
                    "{}",
                    json!({"error":"The original native terminal is still attached."})
                );
            } else {
                let mut viewer = Viewer {
                    socket,
                    input: Vec::new(),
                };
                if viewer.output(&self.output).is_ok() {
                    self.viewer = Some(viewer);
                }
            }
        }
        let frames = match self.viewer.as_mut().map(Viewer::read).transpose() {
            Ok(frames) => frames.unwrap_or_default(),
            Err(_) => {
                self.viewer = None;
                Vec::new()
            }
        };
        for frame in frames {
            if self.accept_input(frame).is_err() {
                self.viewer = None;
                self.input.clear();
                break;
            }
        }
        if !self.input.is_empty() {
            let result = self.candidate.master.write(self.input.make_contiguous());
            match result {
                Ok(n) => {
                    self.input.drain(..n);
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => (),
                Err(_) => {
                    self.viewer = None;
                    self.input.clear();
                }
            }
        }
        if self.alive && !self.candidate.shell.alive()? {
            self.alive = false;
            self.viewer = None;
            store.worker_state(&self.launch, "stopped")?;
            store.local(
                &self.session,
                "instance.stopped",
                json!({"shell_pid":self.candidate.shell.pid}),
            )?;
        }
        Ok(())
    }

    fn accept_input(&mut self, frame: Value) -> Result<()> {
        if let Some(value) = frame.get("input") {
            let bytes: Vec<u8> = serde_json::from_value(value.clone())?;
            ensure!(
                bytes.len() <= 4096 && self.input.len() + bytes.len() <= 65536,
                "native input queue full"
            );
            self.input.extend(bytes);
        }
        if let Some(value) = frame.get("resize") {
            let size = value
                .as_array()
                .filter(|s| s.len() == 2)
                .context("invalid size")?;
            let dimension = |v: &Value| {
                v.as_u64()
                    .filter(|n| *n > 0 && *n <= 1000)
                    .context("invalid dimension")
            };
            let size = libc::winsize {
                ws_row: dimension(&size[0])? as u16,
                ws_col: dimension(&size[1])? as u16,
                ws_xpixel: 0,
                ws_ypixel: 0,
            };
            ensure!(
                unsafe { libc::ioctl(self.candidate.master.as_raw_fd(), libc::TIOCSWINSZ, &size) }
                    == 0,
                "native resize failed"
            );
        }
        Ok(())
    }

    pub fn submit(&mut self, store: &Store, request: &str, command: &str) -> Result<Value> {
        ensure!(self.agent.is_none(), "use send for a Codex conversation");
        ensure!(
            !request.is_empty()
                && request.len() <= 128
                && !command.trim().is_empty()
                && command.len() <= 4096
                && !command.chars().any(char::is_control),
            "invalid_input: provide one command line"
        );
        if let Some(previous) = store.request(request)? {
            ensure!(
                previous["session_id"] == self.session && previous["message"] == command,
                "request_conflict: different command"
            );
            return Ok(previous);
        }
        ensure!(
            self.alive && self.capture && self.pending.is_none(),
            "native shell is unavailable or has a pending command"
        );
        empty_prompt(&self.candidate)?;
        store.begin_request(request, &self.session, command)?;
        self.pending = Some(request.into());
        let line = format!("{command}\n");
        self.candidate.master.write_all(line.as_bytes())?;
        store.accepted(request, request)?;
        store.request(request)?.context("missing command receipt")
    }

    pub fn stop(&self, force: bool) -> Result<()> {
        if !self.candidate.shell.alive()? {
            return Ok(());
        }
        self.candidate
            .shell
            .signal(if force { libc::SIGKILL } else { libc::SIGHUP })
    }

    pub fn deregister(&mut self) {
        self.capture = false;
        self.command = None;
        self.title = None;
        self.osc.clear();
    }

    pub fn reactivate(&mut self, generation: i64) -> Result<()> {
        if self.agent.is_none() {
            empty_prompt(&self.candidate)?;
        }
        self.generation = generation;
        self.capture = true;
        Ok(())
    }
}

impl Drop for NativeInstance {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.socket);
    }
}

fn empty_prompt(candidate: &Candidate) -> Result<()> {
    let pid = candidate.shell.pid;
    ensure!(
        candidate.shell.alive()?
            && unsafe { libc::tcgetpgrp(candidate.master.as_raw_fd()) } == pid as i32,
        "busy: foreground work is running"
    );
    let symbols = Command::new("nm")
        .arg("-D")
        .arg(&candidate.shell.executable)
        .output()?;
    ensure!(
        symbols.status.success(),
        "unsupported: Bash readline symbols unavailable"
    );
    let maps = fs::read_to_string(format!("/proc/{pid}/maps"))?;
    let base = maps
        .lines()
        .find_map(|line| {
            let f: Vec<_> = line.split_whitespace().collect();
            (f.get(2) == Some(&"00000000")
                && f.get(5)
                    .is_some_and(|p| Path::new(p) == candidate.shell.executable))
            .then(|| u64::from_str_radix(f[0].split('-').next().unwrap(), 16).ok())
            .flatten()
        })
        .context("unsupported: Bash mapping unavailable")?;
    let symbol = |name: &str| -> Result<i32> {
        let offset = String::from_utf8_lossy(&symbols.stdout)
            .lines()
            .find_map(|line| {
                let f: Vec<_> = line.split_whitespace().collect();
                (f.get(2) == Some(&name))
                    .then(|| u64::from_str_radix(f[0], 16).ok())
                    .flatten()
            })
            .context("unsupported: Bash readline symbol missing")?;
        let mut value = 0i32;
        let local = libc::iovec {
            iov_base: (&mut value as *mut i32).cast(),
            iov_len: 4,
        };
        let remote = libc::iovec {
            iov_base: (base + offset) as *mut _,
            iov_len: 4,
        };
        ensure!(
            unsafe { libc::process_vm_readv(pid as i32, &local, 1, &remote, 1, 0) } == 4,
            "cannot inspect native draft"
        );
        Ok(value)
    };
    let mut queued = 0i32;
    ensure!(
        unsafe { libc::ioctl(candidate.master.as_raw_fd(), libc::TIOCINQ, &mut queued) } == 0,
        "cannot inspect terminal queue"
    );
    ensure!(
        symbol("rl_end")? == 0 && symbol("rl_done")? == 0 && queued == 0,
        "busy: finish or cancel the human draft first"
    );
    Ok(())
}
