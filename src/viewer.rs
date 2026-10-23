use anyhow::{Context, Result, bail, ensure};
use serde_json::Value;
use std::{
    os::unix::process::CommandExt,
    path::Path,
    process::{Child, Command, Stdio},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Ghostty,
    Xterm,
}

impl Kind {
    pub const ALL: [Self; 2] = [Self::Ghostty, Self::Xterm];

    pub fn parse(value: &Value) -> Result<Self> {
        match value.as_str() {
            Some("ghostty") => Ok(Self::Ghostty),
            Some("xterm") => Ok(Self::Xterm),
            _ => bail!("unsupported: choose ghostty or xterm"),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ghostty => "ghostty",
            Self::Xterm => "xterm",
        }
    }

    pub fn executable(self) -> &'static Path {
        Path::new(match self {
            Self::Ghostty => "/usr/bin/ghostty",
            Self::Xterm => "/usr/bin/xterm",
        })
    }

    pub fn from_executable(path: &Path) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.executable() == path)
    }

    fn command(self, cwd: &Path, title: &str) -> Command {
        let mut command = Command::new(self.executable());
        match self {
            Self::Ghostty => {
                command
                    .args([
                        "--gtk-single-instance=false",
                        "--confirm-close-surface=false",
                        &format!("--title={title}"),
                    ])
                    .env("GDK_BACKEND", "x11");
            }
            Self::Xterm => {
                command.args([
                    "-T",
                    title,
                    "-fa",
                    "monospace",
                    "-fs",
                    "12",
                    "-u8",
                    "-xrm",
                    "XTerm*resizeByPixel: true",
                ]);
            }
        }
        command
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        command
    }
}

pub fn open_instance(kind: Kind, info: &Value, session: &Value) -> Result<Child> {
    let cwd = session["cwd"]
        .as_str()
        .context("missing instance directory")?;
    let title = session["name"].as_str().unwrap_or("Voyager agent");
    let executable = info["executable"]
        .as_str()
        .context("missing native executable")?;
    if Path::new(executable).is_absolute() {
        use std::os::unix::fs::PermissionsExt;
        let metadata = std::fs::metadata(executable)
            .with_context(|| format!("native executable unavailable: {executable}"))?;
        ensure!(
            metadata.is_file() && metadata.permissions().mode() & 0o111 != 0,
            "native executable is not executable: {executable}"
        );
    }
    let args = info["args"]
        .as_array()
        .context("missing native arguments")?
        .iter()
        .map(|v| v.as_str().context("invalid native argument"))
        .collect::<Result<Vec<_>>>()?;
    kind.command(Path::new(cwd), title)
        .arg("-e")
        .arg(executable)
        .args(args)
        .spawn()
        .with_context(|| format!("open native {} viewer", kind.as_str()))
}
