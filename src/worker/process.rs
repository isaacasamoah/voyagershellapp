use anyhow::{Context, Result, ensure};
use nix::{
    libc,
    poll::{PollFd, PollFlags, poll},
    sys::signal::{Signal, killpg},
    unistd::Pid,
};
use std::{
    fs, io,
    os::fd::{AsFd, AsRawFd, FromRawFd, OwnedFd},
    process::{Child, ExitStatus},
    thread,
    time::{Duration, Instant},
};

pub(super) enum Process {
    Child(Child),
    Checked { handle: OwnedFd, pid: u32 },
}

pub(super) enum Exit {
    Reaped(ExitStatus),
    Observed,
}

impl Exit {
    pub(super) fn code(&self) -> Option<i32> {
        match self {
            Self::Reaped(status) => status.code(),
            Self::Observed => None,
        }
    }
}

impl Process {
    pub(super) fn checked(pid: u32) -> Result<Self> {
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
        ensure!(
            fd >= 0,
            "open process handle: {}",
            io::Error::last_os_error()
        );
        let handle = unsafe { OwnedFd::from_raw_fd(i32::try_from(fd)?) };
        ensure!(
            nix::unistd::getpgid(Some(Pid::from_raw(i32::try_from(pid)?)))?.as_raw()
                == i32::try_from(pid)?,
            "native server is not its managed process-group leader"
        );
        let process = Self::Checked { handle, pid };
        ensure!(
            process.executable()?.is_absolute(),
            "native executable is unavailable"
        );
        Ok(process)
    }

    pub(super) fn executable(&self) -> Result<std::path::PathBuf> {
        fs::read_link(format!("/proc/{}/exe", self.id())).context("read native executable")
    }

    pub(super) fn identity(&self) -> Result<serde_json::Value> {
        let stat = fs::read_to_string(format!("/proc/{}/stat", self.id()))?;
        let fields: Vec<_> = stat
            .rsplit_once(')')
            .context("invalid process stat")?
            .1
            .split_whitespace()
            .collect();
        Ok(
            serde_json::json!({"pid":self.id(),"start":fields.get(19).context("process start unavailable")?,"executable":self.executable()?}),
        )
    }

    pub(super) fn id(&self) -> u32 {
        match self {
            Self::Child(child) => child.id(),
            Self::Checked { pid, .. } => *pid,
        }
    }

    pub(super) fn try_wait(&mut self) -> Result<Option<Exit>> {
        match self {
            Self::Child(child) => Ok(child.try_wait()?.map(Exit::Reaped)),
            Self::Checked { handle, .. } => {
                let mut fds = [PollFd::new(handle.as_fd(), PollFlags::POLLIN)];
                poll(&mut fds, 0u8)?;
                Ok(fds[0]
                    .revents()
                    .filter(|flags| flags.contains(PollFlags::POLLIN))
                    .map(|_| Exit::Observed))
            }
        }
    }

    pub(super) fn signal(&mut self, signal: Signal) -> Result<()> {
        if self.try_wait()?.is_some() {
            return Ok(());
        }
        match self {
            Self::Child(child) => killpg(Pid::from_raw(i32::try_from(child.id())?), signal)?,
            Self::Checked { handle, .. } => {
                let result = unsafe {
                    libc::syscall(
                        libc::SYS_pidfd_send_signal,
                        handle.as_raw_fd(),
                        signal as i32,
                        std::ptr::null::<libc::siginfo_t>(),
                        libc::PIDFD_SIGNAL_PROCESS_GROUP,
                    )
                };
                ensure!(
                    result == 0,
                    "signal managed process group: {}",
                    io::Error::last_os_error()
                );
            }
        }
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        self.signal(Signal::SIGTERM)?;
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if self.try_wait()?.is_some() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(20));
        }
        self.signal(Signal::SIGKILL)?;
        if let Self::Child(child) = self {
            child.wait()?;
        }
        Ok(())
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        if matches!(self, Self::Child(_)) {
            let _ = self.stop();
        }
    }
}
