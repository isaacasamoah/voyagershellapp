use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use voyager_shell::service;

struct Trial {
    state: PathBuf,
    process: Child,
}

impl Drop for Trial {
    fn drop(&mut self) {
        if let Ok(rows) = service::client(&self.state, json!({"op":"list","include_removed":true}))
        {
            for row in rows.as_array().into_iter().flatten() {
                if row["ownership"] == "managed" && row["worker_state"] == "running" {
                    let _ = action(
                        &self.state,
                        json!({"op":"stop-instance","session_id":row["id"],"close_window":true,"request_id":uuid::Uuid::new_v4().to_string()}),
                    );
                }
            }
        }
        let _ = service::client(&self.state, json!({"op":"stop"}));
        let _ = self.process.kill();
        let _ = self.process.wait();
    }
}

fn action(state: &Path, request: Value) -> Result<Value> {
    let mut receipt = service::client(state, request)?;
    let deadline = Instant::now() + Duration::from_secs(25);
    while receipt["state"] == "pending" {
        ensure!(
            Instant::now() < deadline,
            "action did not finish: {receipt}"
        );
        thread::sleep(Duration::from_millis(50));
        receipt = service::client(
            state,
            json!({"op":"operation","request_id":receipt["request_id"]}),
        )?;
    }
    ensure!(receipt["state"] == "completed", "action failed: {receipt}");
    Ok(receipt)
}

fn wait_turn(state: &Path, turn: &str) -> Result<Vec<Value>> {
    let deadline = Instant::now() + Duration::from_secs(180);
    let mut cursor = 0;
    let mut events = Vec::new();
    loop {
        let page = service::client(state, json!({"op":"events","after":cursor}))?;
        cursor = page["cursor"].as_i64().context("missing event cursor")?;
        for event in page["events"].as_array().context("missing events")? {
            events.push(event.clone());
            if event["native_turn_id"] == turn && event["type"] == "turn.completed" {
                ensure!(
                    event["payload"]["status"] == "completed",
                    "native task failed: {event}"
                );
                return Ok(events);
            }
        }
        ensure!(Instant::now() < deadline, "native task timed out: {turn}");
        thread::sleep(Duration::from_millis(100));
    }
}

fn load(path: impl AsRef<Path>) -> Result<Value> {
    serde_json::from_slice(&fs::read(path)?).context("invalid saved native result")
}

#[test]
#[ignore = "Uses real Codex tools and Ghostty; requires a fresh VOYAGER_NATIVE_AUTHORITY_DIR"]
fn native_captain_and_crew_use_their_bound_cli_identity() -> Result<()> {
    let state = PathBuf::from(
        std::env::var("VOYAGER_NATIVE_AUTHORITY_DIR")
            .context("provide a fresh private state directory")?,
    );
    ensure!(!state.exists(), "state directory already exists");
    service::private_dir(&state)?;
    let bin = state.join("bin");
    fs::create_dir(&bin)?;
    let executable = bin.join("voyager");
    fs::copy(env!("CARGO_BIN_EXE_voyager"), &executable)?;
    let log = fs::File::create(state.join("service.log"))?;
    let _trial = Trial {
        state: state.clone(),
        process: Command::new(&executable)
            .args(["--state", state.to_str().context("UTF-8 state")?, "serve"])
            .env_remove("VOYAGER_CALLER")
            .env_remove("VOYAGER_SESSION_CONTEXT")
            .env("VOYAGER_VOICE_FOLLOWS_DOCK", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log)
            .spawn()?,
    };
    let deadline = Instant::now() + Duration::from_secs(10);
    while service::client(&state, json!({"op":"status"})).is_err() {
        ensure!(Instant::now() < deadline, "service startup failed");
        thread::sleep(Duration::from_millis(50));
    }
    let mut created = Vec::new();
    for (name, rank) in [("Captain", "captain"), ("Crew", "crew"), ("Peer", "crew")] {
        let cwd = state.join(name.to_lowercase());
        fs::create_dir(&cwd)?;
        created.push(action(&state, json!({"op":"create","kind":"codex","request_id":name,"name":name,"cwd":cwd,"rank":rank}))?);
    }
    let captain = created[0]["session_id"]
        .as_str()
        .context("captain identity")?;
    let crew = created[1]["session_id"].as_str().context("crew identity")?;
    let peer = created[2]["session_id"].as_str().context("peer identity")?;
    action(
        &state,
        json!({"op":"supervise","session_id":crew,"supervisor_id":captain,"request_id":"assign-crew"}),
    )?;
    let message = format!(
        "Use one native shell tool to run these commands directly, without Python. Do not read or print the session context file. First run \"$VOYAGER_BIN\" --state \"$VOYAGER_STATE\" capabilities > capabilities.json. Then run \"$VOYAGER_BIN\" --state \"$VOYAGER_STATE\" send {crew} delegated-native 'Reply exactly: CREW_NATIVE_42' > delegated.json. Finally, if \"$VOYAGER_BIN\" --state \"$VOYAGER_STATE\" send {peer} forbidden-native 'Reply exactly SHOULD_NOT_RUN.' > refused.json 2> refused.txt; then printf unexpected > permission-result; else printf refused > permission-result; fi. Reply with the actor session ID from capabilities and the two outcomes."
    );
    let sent = service::client(
        &state,
        json!({"op":"send","session_id":captain,"request_id":"captain-native-task","message":message}),
    )?;
    wait_turn(
        &state,
        sent["native_turn_id"].as_str().context("captain turn")?,
    )?;
    let capabilities = load(state.join("captain/capabilities.json"))?;
    ensure!(
        capabilities["actor"]["session_id"] == captain && capabilities["rank"] == "captain",
        "native tool identity mismatch"
    );
    let delegated = load(state.join("captain/delegated.json"))?;
    ensure!(
        delegated["state"] == "accepted" && delegated["actor_session_id"] == captain,
        "native delegation lacks authenticated source"
    );
    let events = wait_turn(
        &state,
        delegated["native_turn_id"]
            .as_str()
            .context("delegated turn")?,
    )?;
    ensure!(
        events.iter().any(|e| e["session_id"] == crew
            && e["payload"]["role"] == "assistant"
            && e["payload"]["text"] == "CREW_NATIVE_42"),
        "crew marker missing"
    );
    ensure!(
        fs::read_to_string(state.join("captain/permission-result"))? == "refused",
        "other-chain instruction was accepted"
    );
    let denied = fs::read_to_string(state.join("captain/refused.txt"))?;
    ensure!(denied.contains("forbidden"), "expected authority refusal");
    let crew_message = format!(
        "Run these commands directly through your native shell tool, without Python. Do not read or print the session context file. Run \"$VOYAGER_BIN\" --state \"$VOYAGER_STATE\" capabilities > capabilities.json. Then if \"$VOYAGER_BIN\" --state \"$VOYAGER_STATE\" send {peer} crew-forbidden-native 'Reply exactly SHOULD_NOT_RUN.' > refused.json 2> refused.txt; then printf unexpected > permission-result; else printf refused > permission-result; fi. Run \"$VOYAGER_BIN\" --state \"$VOYAGER_STATE\" escalate crew-question 'Can you confirm the next task?' > escalation.json. Reply exactly: CREW_CHECKED_42"
    );
    let sent = service::client(
        &state,
        json!({"op":"send","session_id":crew,"request_id":"crew-native-task","message":crew_message}),
    )?;
    wait_turn(
        &state,
        sent["native_turn_id"].as_str().context("crew check turn")?,
    )?;
    let crew_capabilities = load(state.join("crew/capabilities.json"))?;
    ensure!(
        crew_capabilities["actor"]["session_id"] == crew && crew_capabilities["rank"] == "crew",
        "crew native tool identity mismatch"
    );
    ensure!(
        fs::read_to_string(state.join("crew/permission-result"))? == "refused",
        "crew instructed a peer"
    );
    let escalation = load(state.join("crew/escalation.json"))?;
    ensure!(
        escalation["destination"] == captain && escalation["delivery"] == "accepted",
        "escalation did not reach assigned captain"
    );
    let mut secret_absent = true;
    ensure!(
        fs::metadata(state.join("contexts"))?.permissions().mode() & 0o777 == 0o700,
        "context directory mode"
    );
    for (name, instance) in ["Captain", "Crew", "Peer"].into_iter().zip(&created) {
        let context = state.join("contexts").join(format!("{name}.json"));
        ensure!(
            fs::metadata(&context)?.permissions().mode() & 0o777 == 0o600,
            "context file mode"
        );
        let token = load(&context)?["token"]
            .as_str()
            .context("context token")?
            .to_owned();
        for file in ["events.sqlite", "service.log"] {
            secret_absent &= !fs::read(state.join(file))?
                .windows(token.len())
                .any(|bytes| bytes == token.as_bytes());
        }
        let pid = instance["runtime_pid"]
            .as_u64()
            .context("native server PID")?;
        secret_absent &= !fs::read(format!("/proc/{pid}/cmdline"))?
            .windows(token.len())
            .any(|bytes| bytes == token.as_bytes());
    }
    ensure!(secret_absent, "a credential entered stored evidence");
    fs::write(
        state.join("authority-native-proof.json"),
        serde_json::to_vec_pretty(
            &json!({"verdict":"pass","surface":"real native Codex tool calls and Ghostty viewers","created":created,"captain_capabilities":capabilities,"crew_capabilities":crew_capabilities,"delegated":delegated,"escalation":escalation,"credentials_absent_from_capture":secret_absent,"limits":["Programmatic creation; physical docking is separate.","Native voice and explicit interruption are outside this increment."]}),
        )?,
    )?;
    Ok(())
}
