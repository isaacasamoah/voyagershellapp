//! Native window opening, separate from agent ownership and event capture.
//! First target: a dedicated Ghostty XWayland window on Linux.
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
        .args(["--gtk-single-instance=false", &format!("--title={title}")])
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

/// Ask the window manager to activate the one window owned by a live terminal
/// Child. The caller rechecks Child::try_wait first; titles never select a target.
/// This changes presentation only, without changing the control attachment.
pub fn focus(pid: u32) -> Result<u32> {
    use x11rb::{
        connection::Connection,
        protocol::xproto::{AtomEnum, ClientMessageEvent, ConnectionExt, EventMask},
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
        // Other windows may close during inventory; they are not candidates.
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
        matches.len() == 1,
        "Cannot identify a single terminal window to bring forward."
    );
    let window = matches[0];
    conn.send_event(
        false,
        root,
        EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
        ClientMessageEvent::new(
            32,
            window,
            atom(b"_NET_ACTIVE_WINDOW")?,
            [2, x11rb::CURRENT_TIME, 0, 0, 0],
        ),
    )?
    .check()?;
    conn.flush()?;
    Ok(window)
}
