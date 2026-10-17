use anyhow::{Context, Result, ensure};
use nix::{libc, unistd::Uid};
use serde_json::json;
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{self, BufRead, Write},
    os::{fd::FromRawFd, unix::fs::MetadataExt},
    path::PathBuf,
};
use voyager_shell::terminal;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt};

struct Process {
    pid: u32,
    start: u64,
    session: u32,
    executable: PathBuf,
    handle: File,
}

impl Process {
    fn open(pid: u32) -> Result<Self> {
        let before = fs::read_to_string(format!("/proc/{pid}/stat"))?;
        ensure!(
            fs::metadata(format!("/proc/{pid}"))?.uid() == Uid::current().as_raw(),
            "target belongs to another user"
        );
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
        ensure!(fd >= 0, "pidfd_open: {}", io::Error::last_os_error());
        let handle = unsafe { File::from_raw_fd(fd as i32) };
        let after = fs::read_to_string(format!("/proc/{pid}/stat"))?;
        let parse = |stat: &str| -> Result<(u64, u32)> {
            let fields: Vec<_> = stat
                .rsplit_once(')')
                .context("invalid process identity")?
                .1
                .split_whitespace()
                .collect();
            Ok((
                fields.get(19).context("missing start time")?.parse()?,
                fields.get(3).context("missing session")?.parse()?,
            ))
        };
        let (start, session) = parse(&before)?;
        ensure!(
            parse(&after)? == (start, session),
            "process identity changed"
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

    fn alive(&self) -> Result<bool> {
        use std::os::fd::AsRawFd;
        let mut poll = libc::pollfd {
            fd: self.handle.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        let result = unsafe { libc::poll(&mut poll, 1, 0) };
        ensure!(result >= 0, "poll: {}", io::Error::last_os_error());
        Ok(result == 0)
    }

    fn json(&self) -> serde_json::Value {
        json!({"pid":self.pid,"start":self.start,"session":self.session,
            "executable":self.executable})
    }
}

fn children(pid: u32) -> Result<BTreeSet<u32>> {
    let mut result = BTreeSet::new();
    for task in fs::read_dir(format!("/proc/{pid}/task"))? {
        let path = task?.path().join("children");
        let text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        for child in text.split_whitespace() {
            result.insert(child.parse()?);
        }
    }
    Ok(result)
}

fn owner(window: u32) -> Result<u32> {
    let (connection, _) = x11rb::connect(None)?;
    let pid = connection.intern_atom(false, b"_NET_WM_PID")?.reply()?.atom;
    connection.get_window_attributes(window)?.reply()?;
    let owner = connection
        .get_property(false, window, pid, AtomEnum::CARDINAL, 0, 1)?
        .reply()?
        .value32()
        .and_then(|mut values| values.next())
        .context("window has no process identity")?;
    ensure!(
        terminal::window(owner)? == Some(window),
        "window identity is ambiguous"
    );
    Ok(owner)
}

fn retain_master(terminal: &Process, shell: &Process) -> Result<(File, PathBuf)> {
    use std::os::fd::AsRawFd;
    let tty = fs::read_link(format!("/proc/{}/fd/0", shell.pid))?;
    ensure!(
        tty.parent() == Some(std::path::Path::new("/dev/pts")),
        "not a PTY shell"
    );
    let index: u32 = tty
        .file_name()
        .context("missing PTY number")?
        .to_str()
        .context("invalid PTY number")?
        .parse()?;
    let mut matches = Vec::new();
    for fd in fs::read_dir(format!("/proc/{}/fdinfo", terminal.pid))? {
        let fd = fd?;
        let contents = match fs::read_to_string(fd.path()) {
            Ok(contents) => contents,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        if contents.lines().any(|line| {
            line.strip_prefix("tty-index:")
                .and_then(|value| value.trim().parse::<u32>().ok())
                == Some(index)
        }) {
            matches.push(
                fd.file_name()
                    .to_str()
                    .context("invalid FD")?
                    .parse::<i32>()?,
            );
        }
    }
    ensure!(
        matches.len() == 1,
        "PTY master identity is ambiguous or unavailable"
    );
    let fd = unsafe {
        libc::syscall(
            libc::SYS_pidfd_getfd,
            terminal.handle.as_raw_fd(),
            matches[0],
            0,
        )
    };
    ensure!(
        fd >= 0,
        "pidfd_getfd refused: {}; system policy is unchanged",
        io::Error::last_os_error()
    );
    let master = unsafe { File::from_raw_fd(fd as i32) };
    let mut number: libc::c_uint = 0;
    let result = unsafe { libc::ioctl(master.as_raw_fd(), libc::TIOCGPTN, &mut number) };
    ensure!(
        result == 0 && number == index,
        "PTY changed during inspection"
    );
    ensure!(
        terminal.alive()? && shell.alive()?,
        "target exited during inspection"
    );
    Ok((master, tty))
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    ensure!(
        args.len() == 1 || (args.len() == 2 && args[1] == "--retain"),
        "usage: adoption_inspect WINDOW_ID [--retain]"
    );
    let window: u32 = args[0].parse()?;
    let terminal = Process::open(owner(window)?)?;
    ensure!(
        terminal.executable == std::path::Path::new("/usr/bin/ghostty"),
        "this experiment supports Ghostty only"
    );
    let descendants = children(terminal.pid)?;
    ensure!(
        descendants.len() == 1,
        "terminal has multiple or no direct children"
    );
    let shell = Process::open(*descendants.first().context("missing child")?)?;
    ensure!(
        shell
            .executable
            .file_name()
            .is_some_and(|name| name == "bash"),
        "ordinary Bash is required for this experiment"
    );
    ensure!(
        shell.session == shell.pid,
        "Bash is not the terminal session leader"
    );
    let (master, tty) = retain_master(&terminal, &shell)?;
    ensure!(
        owner(window)? == terminal.pid,
        "window changed during inspection"
    );
    println!(
        "{}",
        json!({"state":"not_adopted","window":window,"terminal":terminal.json(),"shell":shell.json(),"tty":tty,"master_retained":true,"shell_children":children(shell.pid)?,"reason":"Retaining handles does not transfer lifecycle. Native close still owns shell shutdown."})
    );
    io::stdout().flush()?;
    if args.len() == 2 {
        for line in io::stdin().lock().lines() {
            ensure!(
                line? == "status",
                "only status is supported; close stdin to release handles"
            );
            println!(
                "{}",
                json!({"terminal_alive":terminal.alive()?,"shell_alive":shell.alive()?})
            );
            io::stdout().flush()?;
        }
    }
    drop(master);
    Ok(())
}
