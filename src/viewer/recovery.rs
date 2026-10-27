use super::Kind;
use crate::{control, terminal};
use anyhow::{Context, Result, ensure};
use nix::{
    libc,
    poll::{PollFd, PollFlags, poll},
};
use serde_json::Value;
use std::{
    fs,
    os::fd::{AsFd, FromRawFd, OwnedFd},
    process::Child,
};

pub(crate) enum Process {
    Child(Child),
    Existing {
        identity: control::Process,
        handle: OwnedFd,
    },
}

impl Process {
    pub(crate) fn id(&self) -> u32 {
        match self {
            Self::Child(child) => child.id(),
            Self::Existing { identity, .. } => identity.pid(),
        }
    }

    pub(crate) fn finished(&mut self) -> Result<bool> {
        match self {
            Self::Child(child) => Ok(child.try_wait()?.is_some()),
            Self::Existing { handle, .. } => {
                let mut fds = [PollFd::new(handle.as_fd(), PollFlags::POLLIN)];
                poll(&mut fds, 0u8)?;
                if fds[0]
                    .revents()
                    .is_some_and(|f| f.contains(PollFlags::POLLIN))
                {
                    return Ok(true);
                }
                Ok(false)
            }
        }
    }

    pub(crate) fn reap(&mut self) -> Result<()> {
        if let Self::Child(child) = self {
            child.wait()?;
        }
        Ok(())
    }
}

pub(crate) enum Recovery {
    Open {
        kind: Kind,
        process: Process,
        window: u32,
    },
    Closed,
    Unknown(String),
}

pub(crate) fn recover(saved: Option<&Value>, attachment: &Value) -> Result<Recovery> {
    let Some(saved) = saved else {
        return Ok(Recovery::Closed);
    };
    let pid = saved["pid"]
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .filter(|pid| *pid > 0)
        .context("saved viewer has no established process identity")?;
    match fs::metadata(format!("/proc/{pid}")) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Recovery::Closed),
        Err(error) => return Err(error.into()),
    }
    let identity = control::Process::read(pid)?;
    let executable = fs::read_link(format!("/proc/{pid}/exe"))?;
    let kind =
        Kind::from_executable(&executable).context("saved viewer is not a supported terminal")?;
    let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
    ensure!(
        fd >= 0,
        "open viewer process handle: {}",
        std::io::Error::last_os_error()
    );
    let handle = unsafe { OwnedFd::from_raw_fd(i32::try_from(fd)?) };
    ensure!(identity.live(), "terminal changed during discovery");
    let Some(window) = terminal::window(pid)? else {
        return Ok(Recovery::Closed);
    };
    if let Some(saved_window) = saved["window_id"].as_u64() {
        ensure!(
            u64::from(window) == saved_window,
            "saved terminal window changed"
        );
    }
    let expected = attachment["args"]
        .as_array()
        .context("native viewer arguments unavailable")?
        .iter()
        .map(|a| a.as_str().context("invalid native argument"))
        .collect::<Result<Vec<_>>>()?;
    let native = fs::canonicalize(
        attachment["executable"]
            .as_str()
            .context("native executable unavailable")?,
    )?;
    let mut frontends = Vec::new();
    for task in fs::read_dir(format!("/proc/{pid}/task"))? {
        let task = task?;
        let children = fs::read_to_string(task.path().join("children"))?;
        for child in children.split_whitespace() {
            let child: u32 = child.parse()?;
            let path = format!("/proc/{child}");
            let command = match fs::read(format!("{path}/cmdline")) {
                Ok(command) => command,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            let args = command
                .split(|b| *b == 0)
                .filter(|b| !b.is_empty())
                .skip(1)
                .map(std::str::from_utf8)
                .collect::<std::result::Result<Vec<_>, _>>()?;
            if args == expected && fs::read_link(format!("{path}/exe"))? == native {
                frontends.push(control::Process::read(child)?);
            }
        }
    }
    ensure!(
        frontends.len() == 1,
        "terminal does not have one verified client of this runtime"
    );
    ensure!(
        frontends[0].live() && identity.live() && terminal::window(pid)? == Some(window),
        "terminal or native client changed during discovery"
    );
    Ok(Recovery::Open {
        kind,
        process: Process::Existing { identity, handle },
        window,
    })
}
