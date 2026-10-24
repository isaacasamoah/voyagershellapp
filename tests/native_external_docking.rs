use anyhow::{Context, Result, ensure};
use serde_json::json;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use voyager_shell::{codex::Codex, service};

struct Owned(Child);
impl Drop for Owned {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
#[ignore = "Starts disposable Codex servers and real native windows; needs VOYAGER_EXTERNAL_DOCK_DIR"]
fn external_codex_refuses_while_managed_codex_docks() -> Result<()> {
    let state = PathBuf::from(std::env::var("VOYAGER_EXTERNAL_DOCK_DIR")?);
    fs::create_dir(&state)?;
    fs::set_permissions(&state, fs::Permissions::from_mode(0o700))?;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let manifest = || -> Result<serde_json::Value> {
        let output = Command::new("python3")
            .arg(root.join("desktop/test/candidate-manifest.py"))
            .output()?;
        ensure!(output.status.success(), "candidate manifest failed");
        Ok(serde_json::from_slice(&output.stdout)?)
    };
    let launched = manifest()?;
    fs::write(
        state.join("launch-manifest.json"),
        serde_json::to_vec_pretty(&launched)?,
    )?;
    let socket = state.join("external.sock");
    let codex = std::env::var("VOYAGER_CODEX_BIN").unwrap_or_else(|_| "codex".into());
    let log = || -> Result<Stdio> { Ok(fs::File::create(state.join("external.log"))?.into()) };
    let mut external = Owned(
        Command::new(&codex)
            .args([
                "app-server",
                "--listen",
                &format!("unix://{}", socket.display()),
            ])
            .stderr(log()?)
            .stdout(Stdio::null())
            .spawn()?,
    );
    let deadline = Instant::now() + Duration::from_secs(20);
    while !socket.exists() {
        ensure!(external.0.try_wait()?.is_none(), "external Codex exited");
        ensure!(Instant::now() < deadline, "external socket not ready");
        thread::sleep(Duration::from_millis(50));
    }
    let socket = fs::canonicalize(socket)?;
    let mut native = Codex::connect(&socket)?;
    let created = native.rpc(
        "thread/start",
        json!({"cwd":state,"approvalPolicy":"on-request","sandbox":"read-only","historyMode":"legacy"}),
    )?;
    let thread_id = created["thread"]["id"]
        .as_str()
        .context("native thread ID")?;
    let turn = native.rpc("turn/start", json!({"threadId":thread_id,"input":[{"type":"text","text":"Reply exactly DOCK_TEST_READY. Do not use tools."}]}))?;
    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        ensure!(
            Instant::now() < deadline,
            "external setup turn did not complete"
        );
        let event = match native.pending.pop_front() {
            Some(event) => Some(event),
            None => native.read()?,
        };
        if let Some(event) = event {
            if event["method"] == "turn/completed"
                && event["params"]["turn"]["id"] == turn["turn"]["id"]
            {
                ensure!(
                    event["params"]["turn"]["status"] == "completed",
                    "external setup turn failed"
                );
                break;
            }
        }
    }
    let viewer = std::env::var("VOYAGER_PROOF_TERMINAL").unwrap_or_else(|_| "xterm".into());
    ensure!(
        ["xterm", "ghostty"].contains(&viewer.as_str()),
        "unsupported test viewer"
    );
    let mut terminal = Command::new(&viewer);
    if viewer == "ghostty" {
        terminal
            .args([
                "--gtk-single-instance=false",
                "--title=External Codex docking test",
            ])
            .env("GDK_BACKEND", "x11");
    } else {
        terminal.args(["-title", "External Codex docking test"]);
    }
    let terminal = Owned(
        terminal
            .arg("-e")
            .arg(&codex)
            .args([
                "--remote",
                &format!("unix://{}", socket.display()),
                "resume",
                thread_id,
                "--no-alt-screen",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?,
    );
    let packaged = std::env::var_os("VOYAGER_PROOF_APP").map(PathBuf::from);
    let service_binary = match &packaged {
        Some(app) => app
            .parent()
            .context("package directory")?
            .join("resources/bin/voyager"),
        None => PathBuf::from(env!("CARGO_BIN_EXE_voyager")),
    };
    let service_log = fs::File::create(state.join("service.log"))?;
    let mut daemon = Owned(
        Command::new(&service_binary)
            .arg("--state")
            .arg(&state)
            .arg("serve")
            .arg(&socket)
            .stdout(Stdio::null())
            .stderr(service_log)
            .spawn()?,
    );
    let deadline = Instant::now() + Duration::from_secs(20);
    while service::client(&state, json!({"op":"status"})).is_err() {
        ensure!(daemon.0.try_wait()?.is_none(), "candidate service exited");
        ensure!(Instant::now() < deadline, "candidate service not ready");
        thread::sleep(Duration::from_millis(50));
    }
    let desktop_log = fs::File::create(state.join("desktop.log"))?;
    let mut app_command = Command::new(
        packaged
            .as_ref()
            .cloned()
            .unwrap_or_else(|| root.join("desktop/node_modules/electron/dist/electron")),
    );
    if packaged.is_none() {
        app_command.arg(root.join("desktop"));
    }
    let mut desktop = Owned(
        app_command
            .args(["--ozone-platform=x11", "--expanded", "--proof-docking"])
            .env("VOYAGER_PROOF_DIRECTORY", root.join("desktop/test"))
            .env("VOYAGER_STATE", &state)
            .env("VOYAGER_PROOF_EXTERNAL_PID", terminal.0.id().to_string())
            .env("VOYAGER_PROOF_EXTERNAL_THREAD", thread_id)
            .env("VOYAGER_PROOF_KIND", "codex")
            .stdout(Stdio::null())
            .stderr(desktop_log)
            .spawn()?,
    );
    let deadline = Instant::now() + Duration::from_secs(240);
    let result = loop {
        if let Some(status) = desktop.0.try_wait()? {
            break Ok(status);
        }
        if Instant::now() >= deadline {
            break Err(anyhow::anyhow!("desktop proof timed out"));
        }
        thread::sleep(Duration::from_millis(100));
    };
    if let Ok(rows) = service::client(&state, json!({"op":"list","include_removed":true})) {
        for row in rows.as_array().context("registrations")? {
            if row["ownership"] == "managed" && row["worker_state"] == "running" {
                let request = uuid::Uuid::new_v4().to_string();
                let receipt = service::client(
                    &state,
                    json!({"op":"stop-instance","session_id":row["id"],"request_id":request}),
                )?;
                let deadline = Instant::now() + Duration::from_secs(15);
                while receipt["state"] == "pending" && Instant::now() < deadline {
                    if service::client(&state, json!({"op":"operation","request_id":request}))?["state"]
                        != "pending"
                    {
                        break;
                    }
                    thread::sleep(Duration::from_millis(50));
                }
            }
        }
    }
    let alive = external.0.try_wait()?.is_none();
    let thread_still_loaded = native
        .rpc(
            "thread/read",
            json!({"threadId":thread_id,"includeTurns":false}),
        )
        .is_ok();
    let stopped = service::client(&state, json!({"op":"stop"}))?;
    fs::write(
        state.join("external-owner-proof.json"),
        serde_json::to_vec_pretty(
            &json!({"server_pid":external.0.id(),"terminal_pid":terminal.0.id(),"thread_id":thread_id,"server_alive_after_drops":alive,"thread_read_after_drops":thread_still_loaded,"service_stop":stopped,"terminal":viewer,"provider_version":Command::new(&codex).arg("--version").output().ok().map(|r|String::from_utf8_lossy(&r.stdout).trim().to_string())}),
        )?,
    )?;
    let finished = manifest()?;
    fs::write(
        state.join("finish-manifest.json"),
        serde_json::to_vec_pretty(&finished)?,
    )?;
    ensure!(
        launched["hashes"] == finished["hashes"],
        "candidate files changed during the trial"
    );
    let proof: serde_json::Value =
        serde_json::from_slice(&fs::read(state.join("docking-proof.json"))?)?;
    ensure!(
        proof["verdict"] == "pass",
        "native docking proof failed: {}",
        proof["error"]
    );
    ensure!(
        result?.success(),
        "desktop proof failed; inspect docking-proof.json"
    );
    ensure!(
        alive && thread_still_loaded,
        "docking affected external Codex ownership"
    );
    Ok(())
}
