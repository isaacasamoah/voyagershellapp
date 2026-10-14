use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use voyager_shell::{codex::Codex, service};

struct NativeProof(Child);
impl Drop for NativeProof {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn action(state: &Path, request: Value) -> Result<Value> {
    let mut receipt = service::client(state, request)?;
    let deadline = Instant::now() + Duration::from_secs(20);
    while receipt["state"] == "pending" {
        ensure!(Instant::now() < deadline, "lifecycle did not finish");
        thread::sleep(Duration::from_millis(50));
        receipt = service::client(
            state,
            json!({"op":"operation","request_id":receipt["request_id"]}),
        )?;
    }
    ensure!(receipt["state"] == "completed", "action failed: {receipt}");
    Ok(receipt)
}

fn finished(connection: &mut Codex, turn: &str) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        let message = match connection.pending.pop_front() {
            Some(message) => Some(message),
            None => connection.read()?,
        };
        if let Some(message) = message {
            if message["method"] == "turn/completed" && message["params"]["turn"]["id"] == turn {
                ensure!(
                    message["params"]["turn"]["status"] == "completed",
                    "native turn failed: {message}"
                );
                return Ok(());
            }
        }
    }
    anyhow::bail!("native task completion was not observed")
}

fn history(state: &Path) -> Result<Vec<Value>> {
    let mut cursor = 0;
    let mut events = Vec::new();
    loop {
        let page = service::client(state, json!({"op":"events","after":cursor}))?;
        let rows = page["events"].as_array().context("events missing")?;
        events.extend(rows.iter().cloned());
        if rows.len() < 100 {
            return Ok(events);
        }
        cursor = page["cursor"].as_i64().context("cursor missing")?;
    }
}

#[test]
#[ignore = "Uses the real Codex account and Ghostty desktop; requires a fresh VOYAGER_NATIVE_PROOF_DIR"]
fn native_codex_lifecycle_and_capture_cutoff() -> Result<()> {
    let state = std::env::var("VOYAGER_NATIVE_PROOF_DIR")
        .context("provide a fresh private proof directory")?;
    let state = Path::new(&state);
    ensure!(!state.exists(), "use a fresh directory");
    service::private_dir(state)?;
    let log = fs::File::create(state.join("service.log"))?;
    let mut daemon = NativeProof(
        Command::new(env!("CARGO_BIN_EXE_voyager"))
            .args([
                "--state",
                state.to_str().context("UTF-8 state path")?,
                "serve",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log)
            .spawn()?,
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    while service::client(state, json!({"op":"status"})).is_err() {
        ensure!(Instant::now() < deadline, "service startup failed");
        thread::sleep(Duration::from_millis(50));
    }
    let created = action(
        state,
        json!({"op":"create","kind":"codex","request_id":"native-lifecycle","name":"Lifecycle Codex","cwd":state}),
    )?;
    fs::write(
        state.join("created.json"),
        serde_json::to_vec_pretty(&created)?,
    )?;
    let session = created["session_id"].as_str().context("created identity")?;
    let record = service::client(state, json!({"op":"list"}))?[0].clone();
    let mut native = Codex::connect(Path::new(record["server"].as_str().context("server")?))?;
    let thread = record["native_thread_id"].clone();
    native.rpc(
        "thread/resume",
        json!({"threadId":thread,"excludeTurns":true}),
    )?;
    let output = state.join("task-finished.txt");
    let before = format!(
        "Run exactly one shell command: sleep 5; printf 'completed' > '{}'. Then reply exactly BEFORE_CAPTURE_47.",
        output.display()
    );
    let accepted = service::client(
        state,
        json!({"op":"send","session_id":session,"request_id":"native-before","message":before}),
    )?;
    let background = action(
        state,
        json!({"op":"background","session_id":session,"request_id":"native-background"}),
    )?;
    ensure!(
        background["window"] == "closed" && background["runtime"] == "running",
        "background did not detach only its frontend"
    );
    finished(
        &mut native,
        accepted["native_turn_id"]
            .as_str()
            .context("accepted turn")?,
    )?;
    ensure!(
        fs::read_to_string(output)? == "completed",
        "native work did not survive backgrounding"
    );
    let opened = action(
        state,
        json!({"op":"open","session_id":session,"terminal":"ghostty","request_id":"native-reopen"}),
    )?;
    ensure!(opened["runtime"] == "running", "reopen lost runtime");
    ensure!(
        service::client(state, json!({"op":"attach-info","session_id":session}))?["pid"]
            == created["runtime_pid"],
        "reopen replaced runtime"
    );
    let removed = action(
        state,
        json!({"op":"remove","session_id":session,"request_id":"native-remove"}),
    )?;
    let reply = native.rpc("turn/start",json!({"threadId":thread,"input":[{"type":"text","text":"Reply exactly REMOVED_ONLY_47."}]}))?;
    finished(
        &mut native,
        reply["turn"]["id"].as_str().context("native turn")?,
    )?;
    thread::sleep(Duration::from_millis(300));
    let cut = history(state)?;
    ensure!(
        !cut.iter().any(|e| e["payload"]["text"]
            .as_str()
            .is_some_and(|t| t.contains("REMOVED_ONLY_47"))),
        "removed native content leaked into capture"
    );
    let registered = action(
        state,
        json!({"op":"register-instance","session_id":session,"request_id":"native-register-again"}),
    )?;
    let fresh = service::client(
        state,
        json!({"op":"send","session_id":session,"request_id":"native-after","message":"Reply exactly NEW_CAPTURE_47."}),
    )?;
    finished(
        &mut native,
        fresh["native_turn_id"].as_str().context("fresh turn")?,
    )?;
    thread::sleep(Duration::from_millis(300));
    let events = history(state)?;
    for marker in ["BEFORE_CAPTURE_47", "NEW_CAPTURE_47"] {
        ensure!(
            events.iter().any(|e| e["payload"]["role"] == "assistant"
                && e["payload"]["text"]
                    .as_str()
                    .is_some_and(|t| t.contains(marker))),
            "expected assistant capture missing: {marker}"
        );
    }
    ensure!(
        !events.iter().any(|e| e["payload"]["text"]
            .as_str()
            .is_some_and(|t| t.contains("REMOVED_ONLY_47"))),
        "re-register imported removed history"
    );
    let stopped = action(
        state,
        json!({"op":"remove","session_id":session,"stop":true,"request_id":"native-stop-remove"}),
    )?;
    ensure!(
        stopped["runtime"] == "stopped"
            && stopped["window"] == "closed"
            && stopped["registration"] == "removed",
        "combined stop/remove failed"
    );
    fs::write(
        state.join("native-proof.json"),
        serde_json::to_vec_pretty(
            &json!({"verdict":"pass","created":created,"background":background,"reopened":opened,"removed":removed,"registered":registered,"stopped":stopped,"events":events,"limits":["Real native Codex turns and Ghostty windows through the backend; physical gestures, voice and Electron Codex creation remain separate checks."]}),
        )?,
    )?;
    service::client(state, json!({"op":"stop"}))?;
    ensure!(daemon.0.wait()?.success(), "service shutdown failed");
    Ok(())
}
