//! Native window opening, separate from agent ownership and event capture.
//! First target: a dedicated Ghostty XWayland window on Linux.
use anyhow::{Context, Result};
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
