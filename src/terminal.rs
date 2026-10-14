use anyhow::{Context, Result, ensure};
use serde_json::Value;
use std::{
    os::unix::process::CommandExt,
    path::Path,
    process::{Child, Command, Stdio},
};

fn ghostty(cwd: &Path, title: &str) -> Command {
    let mut command = Command::new("ghostty");
    command
        .args([
            "--gtk-single-instance=false",
            "--confirm-close-surface=false",
            &format!("--title={title}"),
        ])
        .env("GDK_BACKEND", "x11")
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0);
    command
}

pub fn open_instance(info: &Value, session: &Value) -> Result<Child> {
    let cwd = session["cwd"]
        .as_str()
        .context("missing instance directory")?;
    let title = session["name"].as_str().unwrap_or("Voyager agent");
    let executable = info["executable"]
        .as_str()
        .context("missing native executable")?;
    let args = info["args"]
        .as_array()
        .context("missing native arguments")?
        .iter()
        .map(|v| v.as_str().context("invalid native argument"))
        .collect::<Result<Vec<_>>>()?;
    ghostty(Path::new(cwd), title)
        .arg("-e")
        .arg(executable)
        .args(args)
        .spawn()
        .context("open native Ghostty client")
}
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
    Ok(conn.get_window_attributes(window)?.reply().is_ok())
}
