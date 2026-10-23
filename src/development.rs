use crate::service;
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Manual,
    Polish,
}

impl Mode {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "manual" => Ok(Self::Manual),
            "polish" => Ok(Self::Polish),
            _ => bail!("invalid_input: test mode must be manual or polish"),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Polish => "polish",
        }
    }
}

pub struct Candidate {
    pub checkout: PathBuf,
    pub binary: PathBuf,
    pub electron: PathBuf,
}

impl Candidate {
    pub fn inspect(checkout: &Path) -> Result<Self> {
        ensure!(
            checkout.is_absolute(),
            "invalid_input: checkout must be absolute"
        );
        let checkout = fs::canonicalize(checkout)?;
        let artifact = |relative: &str, executable: bool| -> Result<PathBuf> {
            let path = fs::canonicalize(checkout.join(relative))
                .with_context(|| format!("invalid_input: build candidate artifact {relative}"))?;
            let meta = fs::metadata(&path)?;
            ensure!(
                path.starts_with(&checkout)
                    && meta.is_file()
                    && (!executable || meta.mode() & 0o111 != 0),
                "invalid_input: candidate artifact must be a file inside the granted checkout: {relative}"
            );
            Ok(path)
        };
        let binary = artifact("target/debug/voyager", true)?;
        let electron = artifact("desktop/node_modules/electron/dist/electron", true)?;
        artifact("target/debug/voyager-windows", true)?;
        artifact("desktop/package.json", false)?;
        artifact("desktop/src/main.cjs", false)?;
        Ok(Self {
            checkout,
            binary,
            electron,
        })
    }
}

pub fn private_file(path: &Path) -> Result<File> {
    Ok(OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?)
}

pub fn read_page(path: &Path, offset: u64, limit: u64) -> Result<(Vec<u8>, u64)> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(path)?;
    ensure!(
        file.metadata()?.is_file(),
        "invalid_input: evidence must be a regular file"
    );
    file.seek(SeekFrom::Start(offset))?;
    let mut bytes = Vec::new();
    file.take(limit).read_to_end(&mut bytes)?;
    let next = offset + bytes.len() as u64;
    Ok((bytes, next))
}

pub fn read_json(path: &Path) -> Result<Value> {
    let (bytes, _) = read_page(path, 0, 1024 * 1024 + 1)?;
    ensure!(
        bytes.len() <= 1024 * 1024,
        "invalid_input: evidence exceeds 1 MiB"
    );
    Ok(serde_json::from_slice(&bytes)?)
}

fn stopped(receiver: &mpsc::Receiver<()>) -> bool {
    !matches!(receiver.try_recv(), Err(mpsc::TryRecvError::Empty))
}

pub fn run(checkout: &Path, state: &Path, mode: Mode) -> Result<()> {
    ensure!(
        std::env::var_os("VOYAGER_CALLER").is_none()
            && std::env::var_os("VOYAGER_SESSION_CONTEXT").is_none(),
        "forbidden: only the owner service can host a development run"
    );
    service::private_dir(state)?;
    for entry in fs::read_dir(state)? {
        ensure!(
            entry?.file_name() == "test.log",
            "invalid_input: development host requires fresh state"
        );
    }
    let mut output = private_file(&state.join("test-result.json"))?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut byte = [0];
        let _ = std::io::stdin().read(&mut byte);
        let _ = sender.send(());
    });
    let started = Instant::now();
    let mut backend = None;
    let mut desktop = None;
    let result = journey(checkout, state, mode, &receiver, &mut backend, &mut desktop);
    let cleanup = cleanup(state, &mut backend, &mut desktop);
    let value = json!({
        "mode":mode.as_str(), "elapsed_ms":started.elapsed().as_millis(),
        "outcome":result.as_ref().ok(), "error":result.as_ref().err().map(|e|format!("{e:#}")),
        "cleanup":if cleanup.is_ok(){"completed"}else{"uncertain"},
        "cleanup_error":cleanup.err().map(|e|format!("{e:#}"))
    });
    writeln!(output, "{value}")?;
    output.sync_all()?;
    Ok(())
}

fn journey(
    checkout: &Path,
    state: &Path,
    mode: Mode,
    receiver: &mpsc::Receiver<()>,
    backend: &mut Option<Child>,
    desktop: &mut Option<Child>,
) -> Result<Value> {
    let candidate = Candidate::inspect(checkout)?;
    let service_child = backend.insert(
        Command::new(&candidate.binary)
            .args(["--state"])
            .arg(state)
            .arg("serve")
            .current_dir(&candidate.checkout)
            .stdin(Stdio::null())
            .spawn()?,
    );
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        ensure!(
            service_child.try_wait()?.is_none(),
            "candidate service exited during startup"
        );
        if stopped(receiver) {
            return Ok(json!({"reason":"stop_requested"}));
        }
        if state.join("service.sock").exists() {
            service::client(state, json!({"op":"status"}))?;
            break;
        }
        ensure!(
            Instant::now() < deadline,
            "candidate service startup timed out"
        );
        thread::sleep(Duration::from_millis(50));
    }
    let mut command = Command::new(&candidate.electron);
    command
        .arg(candidate.checkout.join("desktop"))
        .arg("--expanded")
        .current_dir(&candidate.checkout)
        .env("VOYAGER_STATE", state)
        .env("VOYAGER_BIN", &candidate.binary)
        .stdin(Stdio::null());
    if mode == Mode::Polish {
        command
            .arg("--proof-polish")
            .env("VOYAGER_PROOF_TERMINAL", "xterm");
    }
    let app = desktop.insert(command.spawn()?);
    let deadline =
        Instant::now() + Duration::from_secs(if mode == Mode::Manual { 4 * 3600 } else { 300 });
    loop {
        ensure!(
            service_child.try_wait()?.is_none(),
            "candidate service exited; runtime ownership is uncertain"
        );
        if stopped(receiver) {
            return Ok(json!({"reason":"stop_requested"}));
        }
        if mode == Mode::Polish && state.join("polish-proof.json").exists() {
            if let Ok(proof) = read_json(&state.join("polish-proof.json")) {
                ensure!(
                    matches!(proof["verdict"].as_str(), Some("pass" | "rework")),
                    "invalid proof verdict"
                );
                return Ok(json!({"reason":"proof_finished","proof":proof}));
            }
        }
        if let Some(exit) = app.try_wait()? {
            ensure!(
                mode == Mode::Manual && exit.success(),
                "candidate desktop exited before a completed proof: {exit}"
            );
            return Ok(json!({"reason":"desktop_closed"}));
        }
        ensure!(
            Instant::now() < deadline,
            "development run reached its time limit"
        );
        thread::sleep(Duration::from_millis(100));
    }
}

fn cleanup(state: &Path, backend: &mut Option<Child>, desktop: &mut Option<Child>) -> Result<()> {
    let desktop_error = if let Some(app) = desktop.as_mut() {
        (|| -> Result<()> {
            if app.try_wait()?.is_none() {
                app.kill()?;
            }
            app.wait()?;
            Ok(())
        })()
        .err()
    } else {
        None
    };
    if let Some(service_child) = backend.as_mut() {
        ensure!(
            service_child.try_wait()?.is_none(),
            "candidate service already exited; cannot confirm runtime cleanup"
        );
        let sessions = service::client(state, json!({"op":"list","include_removed":true}))?;
        for session in sessions
            .as_array()
            .context("candidate list must be an array")?
        {
            if session["ownership"] != "managed" {
                continue;
            }
            let id = session["id"]
                .as_str()
                .context("candidate session ID missing")?;
            let mut receipt = service::client(
                state,
                json!({"op":"stop-instance","session_id":id,"close_window":true,"request_id":format!("test-cleanup-{id}")}),
            )?;
            let deadline = Instant::now() + Duration::from_secs(30);
            while receipt["state"] == "pending" {
                ensure!(
                    Instant::now() < deadline,
                    "candidate runtime stop timed out"
                );
                thread::sleep(Duration::from_millis(100));
                receipt = service::client(
                    state,
                    json!({"op":"operation","request_id":receipt["request_id"]}),
                )?;
            }
            ensure!(
                receipt["state"] == "completed",
                "candidate stop incomplete: {receipt}"
            );
        }
        service::client(state, json!({"op":"stop"}))?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while service_child.try_wait()?.is_none() {
            ensure!(
                Instant::now() < deadline,
                "candidate service did not exit after stop"
            );
            thread::sleep(Duration::from_millis(50));
        }
    }
    if let Some(error) = desktop_error {
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn evidence_reads_are_bounded_and_do_not_follow_links() {
        let dir = std::env::temp_dir().join(format!("v-evidence-{}", uuid::Uuid::new_v4()));
        service::private_dir(&dir).unwrap();
        fs::write(dir.join("log"), b"abcdefgh").unwrap();
        let (bytes, next) = read_page(&dir.join("log"), 2, 3).unwrap();
        assert_eq!(bytes, b"cde");
        assert_eq!(next, 5);
        symlink(dir.join("log"), dir.join("link")).unwrap();
        assert!(read_page(&dir.join("link"), 0, 32).is_err());
        fs::write(dir.join("large.json"), vec![b' '; 1024 * 1024 + 1]).unwrap();
        assert!(
            read_json(&dir.join("large.json"))
                .unwrap_err()
                .to_string()
                .contains("exceeds")
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
