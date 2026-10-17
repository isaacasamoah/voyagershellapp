use anyhow::{Context, Result, ensure};
use nix::{libc, unistd::Uid};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::MetadataExt,
    },
    path::{Path, PathBuf},
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::Duration,
};
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt};

pub struct Process {
    pub pid: u32,
    pub start: u64,
    pub session: u32,
    pub executable: PathBuf,
    handle: File,
}

impl Process {
    pub fn open(pid: u32) -> Result<Self> {
        let identity = || -> Result<(u64, u32)> {
            let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
            let fields: Vec<_> = stat
                .rsplit_once(')')
                .context("invalid process identity")?
                .1
                .split_whitespace()
                .collect();
            Ok((
                fields.get(19).context("missing process start")?.parse()?,
                fields.get(3).context("missing process session")?.parse()?,
            ))
        };
        ensure!(
            fs::metadata(format!("/proc/{pid}"))?.uid() == Uid::current().as_raw(),
            "different-user process"
        );
        let (start, session) = identity()?;
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
        ensure!(fd >= 0, "pidfd_open: {}", io::Error::last_os_error());
        let handle = unsafe { File::from_raw_fd(fd as i32) };
        ensure!(
            identity()? == (start, session),
            "process changed during inspection"
        );
        let process = Self {
            pid,
            start,
            session,
            executable: fs::read_link(format!("/proc/{pid}/exe"))?,
            handle,
        };
        ensure!(process.alive()?, "process exited during inspection");
        Ok(process)
    }

    pub fn alive(&self) -> Result<bool> {
        let mut p = libc::pollfd {
            fd: self.handle.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        let result = unsafe { libc::poll(&mut p, 1, 0) };
        ensure!(result >= 0, "poll: {}", io::Error::last_os_error());
        Ok(result == 0)
    }

    pub fn signal(&self, signal: i32) -> Result<()> {
        let result = unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                self.handle.as_raw_fd(),
                signal,
                std::ptr::null::<libc::siginfo_t>(),
                0,
            )
        };
        ensure!(result == 0, "signal: {}", io::Error::last_os_error());
        Ok(())
    }

    fn duplicate(&self, fd: i32) -> Result<File> {
        let result =
            unsafe { libc::syscall(libc::SYS_pidfd_getfd, self.handle.as_raw_fd(), fd, 0) };
        ensure!(
            result >= 0,
            "pidfd_getfd: {}; system policy is unchanged",
            io::Error::last_os_error()
        );
        Ok(unsafe { File::from_raw_fd(result as i32) })
    }
}

pub fn children(pid: u32) -> Result<BTreeSet<u32>> {
    let mut children = BTreeSet::new();
    for task in fs::read_dir(format!("/proc/{pid}/task"))? {
        let text = match fs::read_to_string(task?.path().join("children")) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        for child in text.split_whitespace() {
            children.insert(child.parse()?);
        }
    }
    Ok(children)
}

pub fn window_owner(window: u32) -> Result<u32> {
    let (connection, _) = x11rb::connect(None)?;
    let atom = connection.intern_atom(false, b"_NET_WM_PID")?.reply()?.atom;
    connection.get_window_attributes(window)?.reply()?;
    let pid = connection
        .get_property(false, window, atom, AtomEnum::CARDINAL, 0, 1)?
        .reply()?
        .value32()
        .and_then(|mut v| v.next())
        .context("window has no process identity")?;
    ensure!(
        crate::terminal::window(pid)? == Some(window),
        "window identity is ambiguous"
    );
    Ok(pid)
}

pub struct Candidate {
    pub window: u32,
    pub terminal: Process,
    pub shell: Process,
    pub master: File,
    pub master_fd: i32,
    pub tty: PathBuf,
}

impl Candidate {
    pub fn inspect(window: u32) -> Result<Self> {
        let terminal = Process::open(window_owner(window)?)?;
        ensure!(
            terminal.executable == Path::new("/usr/bin/ghostty"),
            "unsupported: Ghostty is required"
        );
        static SUPPORTED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        ensure!(
            *SUPPORTED.get_or_init(|| {
                std::process::Command::new("/usr/bin/ghostty")
                    .arg("--version")
                    .output()
                    .ok()
                    .is_some_and(|out| {
                        out.status.success()
                            && String::from_utf8_lossy(&out.stdout)
                                .lines()
                                .next()
                                .and_then(|line| line.strip_prefix("Ghostty "))
                                .is_some_and(|version| version.split('-').next() == Some("1.1.3"))
                    })
            }),
            "unsupported: native handoff is pinned to Ghostty 1.1.3"
        );
        let descendants = children(terminal.pid)?;
        ensure!(
            descendants.len() == 1,
            "unsupported: use a Ghostty window with one shell"
        );
        let shell = Process::open(*descendants.first().context("missing shell")?)?;
        ensure!(
            shell.executable.file_name().is_some_and(|n| n == "bash") && shell.session == shell.pid,
            "unsupported: an ordinary Bash session is required"
        );
        let tty = fs::read_link(format!("/proc/{}/fd/0", shell.pid))?;
        ensure!(
            tty.parent() == Some(Path::new("/dev/pts")),
            "unsupported: no PTY"
        );
        let index: u32 = tty
            .file_name()
            .context("missing PTY")?
            .to_str()
            .context("invalid PTY")?
            .parse()?;
        let mut matches = Vec::new();
        for entry in fs::read_dir(format!("/proc/{}/fdinfo", terminal.pid))? {
            let entry = entry?;
            let info = match fs::read_to_string(entry.path()) {
                Ok(text) => text,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            if info.lines().any(|line| {
                line.strip_prefix("tty-index:")
                    .and_then(|n| n.trim().parse::<u32>().ok())
                    == Some(index)
            }) {
                matches.push(
                    entry
                        .file_name()
                        .to_str()
                        .context("invalid FD")?
                        .parse::<i32>()?,
                );
            }
        }
        ensure!(matches.len() == 1, "unsupported: PTY identity is ambiguous");
        let master_fd = matches[0];
        let master = terminal.duplicate(master_fd)?;
        let mut number: libc::c_uint = 0;
        ensure!(
            unsafe { libc::ioctl(master.as_raw_fd(), libc::TIOCGPTN, &mut number) } == 0
                && number == index,
            "PTY changed during inspection"
        );
        ensure!(
            terminal.alive()? && shell.alive()? && window_owner(window)? == terminal.pid,
            "native target changed"
        );
        Ok(Self {
            window,
            terminal,
            shell,
            master,
            master_fd,
            tty,
        })
    }
}

pub enum NativeEvent {
    Output(Vec<u8>),
    Input(Vec<u8>),
    Released,
    Failed(String),
}

pub struct Handoff {
    pub events: Receiver<NativeEvent>,
    stop: Sender<()>,
}

impl Drop for Handoff {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

#[cfg(target_arch = "x86_64")]
mod linux {
    use super::*;

    #[derive(Clone, Copy)]
    enum Exit {
        Pass,
        Read { address: u64, length: usize },
        Write { address: u64, length: usize },
        Retained,
        Released { status: u64 },
    }

    fn ptrace(request: u32, tid: i32, address: usize, data: usize) -> Result<i64> {
        let result = unsafe {
            libc::ptrace(
                request,
                tid,
                address as *mut libc::c_void,
                data as *mut libc::c_void,
            )
        };
        ensure!(
            result >= 0,
            "ptrace {request} on {tid}: {}",
            io::Error::last_os_error()
        );
        Ok(result)
    }

    fn registers(tid: i32) -> Result<libc::user_regs_struct> {
        let mut regs = unsafe { std::mem::zeroed::<libc::user_regs_struct>() };
        ptrace(libc::PTRACE_GETREGS, tid, 0, &mut regs as *mut _ as usize)?;
        Ok(regs)
    }

    fn read_memory(tid: i32, address: u64, length: usize) -> Result<Vec<u8>> {
        ensure!(
            length <= 1024 * 1024,
            "native I/O chunk exceeds capture limit"
        );
        let mut data = vec![0; length];
        let local = libc::iovec {
            iov_base: data.as_mut_ptr().cast(),
            iov_len: length,
        };
        let remote = libc::iovec {
            iov_base: address as *mut _,
            iov_len: length,
        };
        ensure!(
            unsafe { libc::process_vm_readv(tid, &local, 1, &remote, 1, 0) } == length as isize,
            "native read: {}",
            io::Error::last_os_error()
        );
        Ok(data)
    }

    fn write_status(tid: i32, address: u64) -> Result<()> {
        if address == 0 {
            return Ok(());
        }
        let mut status: i32 = 0;
        let local = libc::iovec {
            iov_base: (&mut status as *mut i32).cast(),
            iov_len: 4,
        };
        let remote = libc::iovec {
            iov_base: address as *mut _,
            iov_len: 4,
        };
        ensure!(
            unsafe { libc::process_vm_writev(tid, &local, 1, &remote, 1, 0) } == 4,
            "native release acknowledgement failed"
        );
        Ok(())
    }

    fn run(
        pid: u32,
        shell: u32,
        master: i32,
        events: mpsc::SyncSender<NativeEvent>,
        ready: mpsc::SyncSender<Result<()>>,
        stop: Receiver<()>,
    ) -> Result<()> {
        let mut threads = BTreeMap::new();
        for entry in fs::read_dir(format!("/proc/{pid}/task"))? {
            let tid: i32 = entry?
                .file_name()
                .to_str()
                .context("invalid TID")?
                .parse()?;
            ptrace(
                libc::PTRACE_SEIZE,
                tid,
                0,
                (libc::PTRACE_O_TRACESYSGOOD | libc::PTRACE_O_TRACECLONE) as usize,
            )?;
            threads.insert(tid, Exit::Pass);
            ptrace(libc::PTRACE_INTERRUPT, tid, 0, 0)?;
        }
        let mut waiting: BTreeSet<_> = threads.keys().copied().collect();
        let mut announced = false;
        let mut releasing = false;
        while !threads.is_empty() {
            if !matches!(stop.try_recv(), Err(mpsc::TryRecvError::Empty)) {
                return Ok(());
            }
            let mut status = 0;
            let tid = unsafe {
                libc::waitpid(
                    -1,
                    &mut status,
                    libc::__WALL | libc::__WNOTHREAD | libc::WNOHANG,
                )
            };
            if tid == 0 {
                thread::sleep(Duration::from_micros(200));
                continue;
            }
            ensure!(
                tid > 0,
                "native tracer wait: {}",
                io::Error::last_os_error()
            );
            if libc::WIFEXITED(status) || libc::WIFSIGNALED(status) {
                threads.remove(&tid);
                waiting.remove(&tid);
                continue;
            }
            ensure!(libc::WIFSTOPPED(status), "unexpected native tracer state");
            let event = status >> 16;
            let signal = libc::WSTOPSIG(status);
            let mut deliver = 0;
            if event == libc::PTRACE_EVENT_CLONE {
                let mut child: libc::c_ulong = 0;
                ptrace(
                    libc::PTRACE_GETEVENTMSG,
                    tid,
                    0,
                    &mut child as *mut _ as usize,
                )?;
                threads.insert(child as i32, Exit::Pass);
            } else if signal == (libc::SIGTRAP | 0x80) {
                let mut info = [0u64; 16];
                ptrace(
                    0x420e,
                    tid,
                    std::mem::size_of_val(&info),
                    info.as_mut_ptr() as usize,
                )?;
                let entry = info[0] as u8 == 1;
                let mut regs = registers(tid)?;
                if entry {
                    let action = match regs.orig_rax as i64 {
                        libc::SYS_read if regs.rdi as i32 == master => Exit::Read {
                            address: regs.rsi,
                            length: regs.rdx as usize,
                        },
                        libc::SYS_write if regs.rdi as i32 == master => Exit::Write {
                            address: regs.rsi,
                            length: regs.rdx as usize,
                        },
                        libc::SYS_kill
                            if regs.rdi as i32 == -(shell as i32)
                                && regs.rsi == libc::SIGHUP as u64 =>
                        {
                            releasing = true;
                            Exit::Retained
                        }
                        libc::SYS_wait4
                            if releasing
                                && regs.rdi == shell as u64
                                && regs.rdx & libc::WNOHANG as u64 != 0 =>
                        {
                            Exit::Released { status: regs.rsi }
                        }
                        _ => Exit::Pass,
                    };
                    if matches!(action, Exit::Retained | Exit::Released { .. }) {
                        regs.orig_rax = u64::MAX;
                        ptrace(libc::PTRACE_SETREGS, tid, 0, &mut regs as *mut _ as usize)?;
                    }
                    threads.insert(tid, action);
                } else if info[0] as u8 == 2 {
                    match threads.insert(tid, Exit::Pass).unwrap_or(Exit::Pass) {
                        Exit::Read { address, length } | Exit::Write { address, length }
                            if regs.rax as i64 > 0 =>
                        {
                            let bytes = read_memory(tid, address, (regs.rax as usize).min(length))?;
                            let event = if regs.orig_rax == libc::SYS_read as u64 {
                                NativeEvent::Output(bytes)
                            } else {
                                NativeEvent::Input(bytes)
                            };
                            events
                                .try_send(event)
                                .context("native capture queue unavailable")?;
                        }
                        Exit::Retained => {
                            regs.rax = 0;
                            ptrace(libc::PTRACE_SETREGS, tid, 0, &mut regs as *mut _ as usize)?;
                        }
                        Exit::Released { status } => {
                            write_status(tid, status)?;
                            regs.rax = shell as u64;
                            ptrace(libc::PTRACE_SETREGS, tid, 0, &mut regs as *mut _ as usize)?;
                        }
                        _ => (),
                    }
                }
            } else if event == 0 {
                deliver = signal;
            }
            waiting.remove(&tid);
            ptrace(libc::PTRACE_SYSCALL, tid, 0, deliver as usize)?;
            if !announced && waiting.is_empty() {
                let _ = ready.send(Ok(()));
                announced = true;
            }
        }
        let _ = events.try_send(NativeEvent::Released);
        Ok(())
    }

    pub(super) fn start(candidate: &Candidate) -> Result<Handoff> {
        let (events_tx, events) = mpsc::sync_channel(512);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let (stop, stop_rx) = mpsc::channel();
        let (pid, shell, master) = (
            candidate.terminal.pid,
            candidate.shell.pid,
            candidate.master_fd,
        );
        thread::spawn(move || {
            if let Err(error) = run(
                pid,
                shell,
                master,
                events_tx.clone(),
                ready_tx.clone(),
                stop_rx,
            ) {
                let reason = error.to_string();
                let _ = ready_tx.try_send(Err(error));
                let _ = events_tx.try_send(NativeEvent::Failed(reason));
            }
        });
        ready_rx
            .recv_timeout(Duration::from_secs(3))
            .context("native handoff did not acknowledge attachment")??;
        ensure!(
            candidate.terminal.alive()? && candidate.shell.alive()?,
            "native target exited during handoff"
        );
        Ok(Handoff { events, stop })
    }
}

impl Candidate {
    #[cfg(target_arch = "x86_64")]
    pub fn handoff(&self) -> Result<Handoff> {
        linux::start(self)
    }
}
