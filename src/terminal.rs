use anyhow::{Context, Result, ensure};
use serde_json::Value;
use std::path::Path;

pub fn window(pid: u32) -> Result<Option<u32>> {
    use x11rb::{
        connection::Connection,
        protocol::xproto::{AtomEnum, ConnectionExt},
    };
    let (conn, screen) = x11rb::connect(None).context("connect to desktop")?;
    let root = conn.setup().roots[screen].root;
    let atom = |name: &[u8]| -> Result<u32> { Ok(conn.intern_atom(false, name)?.reply()?.atom) };
    let clients = conn
        .get_property(
            false,
            root,
            atom(b"_NET_CLIENT_LIST")?,
            AtomEnum::WINDOW,
            0,
            4096,
        )?
        .reply()?;
    let pid_atom = atom(b"_NET_WM_PID")?;
    let mut matches = Vec::new();
    for window in clients.value32().into_iter().flatten() {
        if let Ok(reply) = conn
            .get_property(false, window, pid_atom, AtomEnum::CARDINAL, 0, 1)?
            .reply()
        {
            if reply.value32().and_then(|mut ids| ids.next()) == Some(pid) {
                matches.push(window);
            }
        }
    }
    ensure!(
        matches.len() <= 1,
        "outcome_unknown: more than one window belongs to this terminal"
    );
    Ok(matches.first().copied())
}

fn request(pid: u32, name: &[u8]) -> Result<u32> {
    use x11rb::{
        connection::Connection,
        protocol::xproto::{ClientMessageEvent, ConnectionExt, EventMask},
    };
    let window = window(pid)?.context("outcome_unknown: terminal window is not identified")?;
    let (conn, screen) = x11rb::connect(None)?;
    let root = conn.setup().roots[screen].root;
    let atom = conn.intern_atom(false, name)?.reply()?.atom;
    conn.send_event(
        false,
        root,
        EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
        ClientMessageEvent::new(
            32,
            window,
            atom,
            if name == b"_NET_CLOSE_WINDOW" {
                [x11rb::CURRENT_TIME, 2, 0, 0, 0]
            } else {
                [2, x11rb::CURRENT_TIME, 0, 0, 0]
            },
        ),
    )?
    .check()?;
    conn.flush()?;
    Ok(window)
}

pub fn focus(pid: u32) -> Result<u32> {
    request(pid, b"_NET_ACTIVE_WINDOW")
}

pub fn close(pid: u32) -> Result<u32> {
    request(pid, b"_NET_CLOSE_WINDOW")
}

pub fn exists(window: u32) -> Result<bool> {
    use x11rb::protocol::xproto::ConnectionExt;
    let (conn, _) = x11rb::connect(None)?;
    match conn.get_window_attributes(window)?.reply() {
        Ok(_) => Ok(true),
        Err(x11rb::errors::ReplyError::X11Error(error))
            if error.error_kind == x11rb::protocol::ErrorKind::Window =>
        {
            Ok(false)
        }
        Err(error) => Err(error.into()),
    }
}

pub fn voice_toggle(attachment: &Value) -> Result<()> {
    let identity = &attachment["terminal"];
    let window_id = attachment["window_id"]
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .context("invalid native window")?;
    use nix::libc;
    use std::{
        fs,
        io::{self, Write},
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::fs::MetadataExt,
        },
    };
    let pid = identity["pid"]
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .context("invalid terminal process")?;
    let check = || -> Result<()> {
        let path = format!("/proc/{pid}");
        ensure!(
            fs::metadata(&path)?.uid() == nix::unistd::Uid::effective().as_raw(),
            "different-user terminal"
        );
        ensure!(
            crate::viewer::Kind::from_executable(&fs::read_link(format!("{path}/exe"))?).is_some(),
            "unsupported terminal"
        );
        let stat = fs::read_to_string(format!("{path}/stat"))?;
        let fields: Vec<_> = stat
            .rsplit_once(')')
            .context("invalid process identity")?
            .1
            .split_whitespace()
            .collect();
        ensure!(
            fields.get(19).copied() == identity["start"].as_str() && fields.first() != Some(&"Z"),
            "terminal process changed"
        );
        ensure!(window(pid)? == Some(window_id), "terminal window changed");
        Ok(())
    };
    check()?;
    let handle = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
    ensure!(handle >= 0, "pidfd_open: {}", io::Error::last_os_error());
    let handle = unsafe { fs::File::from_raw_fd(handle as i32) };
    check()?;
    let mut masters = Vec::new();
    for entry in fs::read_dir(format!("/proc/{pid}/fdinfo"))? {
        let entry = entry?;
        if fs::read_to_string(entry.path())
            .is_ok_and(|info| info.lines().any(|line| line.starts_with("tty-index:")))
        {
            masters.push(entry.file_name().to_string_lossy().parse::<i32>()?);
        }
    }
    ensure!(
        masters.len() == 1,
        "unsupported: native voice requires one terminal surface"
    );
    let fd = unsafe { libc::syscall(libc::SYS_pidfd_getfd, handle.as_raw_fd(), masters[0], 0) };
    ensure!(
        fd >= 0,
        "native terminal input is unavailable: {}; system policy unchanged",
        io::Error::last_os_error()
    );
    let mut input = unsafe { fs::File::from_raw_fd(fd as i32) };
    check()?;
    let mut index = 0u32;
    ensure!(
        unsafe { libc::ioctl(input.as_raw_fd(), libc::TIOCGPTN, &mut index) } == 0,
        "native input is no longer a terminal master"
    );
    let frontend = attachment["frontend"]["pid"]
        .as_u64()
        .context("missing native client")?;
    let path = format!("/proc/{frontend}");
    let stat = fs::read_to_string(format!("{path}/stat"))?;
    let fields: Vec<_> = stat
        .rsplit_once(')')
        .context("invalid client identity")?
        .1
        .split_whitespace()
        .collect();
    ensure!(
        fields.get(19).copied() == attachment["frontend"]["start"].as_str(),
        "native client changed"
    );
    let executable = attachment["executable"]
        .as_str()
        .context("missing native executable")?;
    let executable = if executable.contains('/') {
        fs::canonicalize(executable)?
    } else {
        std::env::split_paths(&std::env::var_os("PATH").context("PATH missing")?)
            .map(|dir| dir.join(executable))
            .find(|path| path.is_file())
            .context("native executable unavailable")?
            .canonicalize()?
    };
    ensure!(
        fs::read_link(format!("{path}/exe"))? == executable,
        "native executable changed"
    );
    let command = fs::read(format!("{path}/cmdline"))?;
    let args: Vec<_> = command
        .split(|b| *b == 0)
        .filter(|part| !part.is_empty())
        .skip(1)
        .map(std::str::from_utf8)
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let server = format!(
        "unix://{}",
        attachment["server"]
            .as_str()
            .context("missing native server")?
    );
    let native = attachment["native_thread_id"]
        .as_str()
        .context("missing native thread")?;
    ensure!(
        args == ["--remote", server.as_str(), "resume", native]
            || args
                == [
                    "--remote",
                    server.as_str(),
                    "resume",
                    native,
                    "--no-alt-screen"
                ],
        "native conversation changed"
    );
    let group = fields[2].parse::<i32>()?;
    ensure!(
        unsafe { libc::tcgetpgrp(input.as_raw_fd()) } == group,
        "native client no longer owns terminal input"
    );
    ensure!(
        fs::read_link(format!("{path}/fd/0"))? == Path::new(&format!("/dev/pts/{index}")),
        "native terminal no longer belongs to this client"
    );
    ensure!(
        input.write(b"\x1b[19~")? == 5,
        "outcome_unknown: native voice shortcut write was incomplete; not retried"
    );
    Ok(())
}
