use super::*;

#[test]
fn resume_keeps_identity_and_history_without_submitting_work() {
    let mut f = Fixture::new();
    fs::write(f.dir.join("verified-settings"), "1").unwrap();
    f.start();
    let created = f.call(json!({"op":"create","open":false,"kind":"codex","request_id":"resume-original","name":"Same conversation","cwd":f.dir}));
    let id = created["session_id"].clone();
    let thread = f.call(json!({"op":"list"}))[0]["native_thread_id"].clone();
    f.call(json!({"op":"stop-instance","session_id":id}));
    let before = f.events()["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["type"] == "turn.started")
        .count();
    assert_eq!(
        f.call(json!({"op":"list"}))[0]["resume"]["state"],
        "eligible"
    );
    let request = json!({"op":"resume-instance","session_id":id,"request_id":"resume-same","expected_runtime_generation":1});
    let resumed = f.call(request.clone());
    assert_eq!(resumed["state"], "completed");
    assert_eq!(resumed["runtime_generation"], 2);
    assert_ne!(resumed["runtime_pid"], created["runtime_pid"]);
    assert_eq!(resumed["session_id"], id);
    assert_eq!(resumed["window"], "closed");
    assert_eq!(f.call(request), resumed);
    let row = f.call(json!({"op":"list"}))[0].clone();
    assert_eq!(row["native_thread_id"], thread);
    assert_eq!(row["capture_generation"], 2);
    assert_eq!(
        row["lifecycle"],
        json!({"runtime":"running","runtime_generation":2})
    );
    assert_eq!(
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["type"] == "turn.started")
            .count(),
        before
    );
    f.call(json!({"op":"stop-instance","session_id":id}));
}

#[test]
#[ignore = "Uses real Codex to resume one disposable saved conversation"]
fn native_resume_preserves_saved_context_and_waits_for_new_work() {
    native_saved_resume_case(false);
}

#[test]
#[ignore = "Uses real Codex after narrowing permissions through its native API"]
fn native_yolo_resume_preserves_context_after_an_old_permission_change() {
    native_saved_resume_case(true);
}

fn native_saved_resume_case(restrictive: bool) {
    assert!(std::env::var("VOYAGER_NATIVE_RESUME_PROVIDER").is_ok());
    let evidence = PathBuf::from(std::env::var("VOYAGER_NATIVE_RESUME_EVIDENCE").unwrap());
    fs::create_dir(&evidence).unwrap();
    let mut f = Fixture::new();
    fs::write(f.dir.join("AGENTS.md"),"Do not use tools in this disposable proof. Remember requested markers and reply concisely.").unwrap();
    f.start();
    let created = f.call(json!({"op":"create","open":false,"kind":"codex","request_id":"native-resume-original","name":"Disposable saved conversation","cwd":f.dir}));
    let id = created["session_id"].clone();
    let initial = f.call(json!({"op":"list"}))[0].clone();
    if restrictive {
        let mut native =
            voyager_shell::codex::Codex::connect(Path::new(initial["server"].as_str().unwrap()))
                .unwrap();
        native.rpc("thread/settings/update",json!({"threadId":initial["native_thread_id"],"approvalPolicy":"on-request","sandboxPolicy":{"type":"readOnly","networkAccess":false}})).unwrap();
        let db = rusqlite::Connection::open(f.dir.join("events.sqlite")).unwrap();
        wait(|| {
            let encoded: Option<String> = db
                .query_row(
                    "SELECT settings FROM runtime_generations WHERE session_id=?1",
                    [id.as_str().unwrap()],
                    |r| r.get(0),
                )
                .unwrap();
            encoded
                .and_then(|v| serde_json::from_str::<Value>(&v).ok())
                .is_some_and(|v| v["effective"]["sandbox"]["type"] == "readOnly")
        });
        drop(native);
    }
    let submitted = f.call(json!({"op":"send","session_id":id,"request_id":"save-native-marker","message":"Remember this exact marker: RESUME_CONTEXT_619. Reply only SAVED. Do not use tools."}));
    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        if f.events()["events"].as_array().unwrap().iter().any(|e| {
            e["type"] == "turn.completed" && e["native_turn_id"] == submitted["native_turn_id"]
        }) {
            break;
        }
        assert!(Instant::now() < deadline, "marker turn did not complete");
        thread::sleep(Duration::from_millis(50));
    }
    f.call(json!({"op":"stop-instance","session_id":id}));
    let start = Instant::now();
    let resumed = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"native-resume-same","expected_runtime_generation":1}));
    fs::write(
        evidence.join("resume-receipt.json"),
        serde_json::to_vec_pretty(&resumed).unwrap(),
    )
    .unwrap();
    assert_eq!(resumed["state"], "completed");
    let ready_ms = start.elapsed().as_millis();
    let row = f.call(json!({"op":"list"}))[0].clone();
    assert_eq!(row["native_thread_id"], initial["native_thread_id"]);
    let mut connection =
        voyager_shell::codex::Codex::connect(Path::new(row["server"].as_str().unwrap())).unwrap();
    let effective = connection
        .rpc(
            "thread/resume",
            json!({"threadId":row["native_thread_id"],"excludeTurns":true}),
        )
        .unwrap();
    assert_eq!(effective["sandbox"], json!({"type":"dangerFullAccess"}));
    assert_eq!(effective["approvalPolicy"], "never");
    let history = connection
        .rpc(
            "thread/read",
            json!({"threadId":row["native_thread_id"],"includeTurns":true}),
        )
        .unwrap();
    assert!(history.to_string().contains("RESUME_CONTEXT_619"));
    thread::sleep(Duration::from_secs(5));
    let events = f.events();
    assert_eq!(
        events["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["type"] == "turn.started" && e["session_id"] == id)
            .count(),
        1
    );
    fs::write(evidence.join("resume-proof.json"), serde_json::to_vec_pretty(&json!({"service":env!("CARGO_BIN_EXE_voyager"),"original":created,"resumed":resumed,"observed":row,"ready_ms":ready_ms,"idle_seconds":5,"saved_marker_available":true})).unwrap()).unwrap();
    f.call(json!({"op":"stop-instance","session_id":id}));
}

pub(super) fn stopped_saved_agent(f: &mut Fixture) -> Value {
    fs::write(f.dir.join("verified-settings"), "1").unwrap();
    f.start();
    let created = f.call(json!({"op":"create","open":false,"kind":"codex","request_id":"saved-agent","name":"Saved agent","cwd":f.dir}));
    assert_eq!(created["state"], "completed", "{created}");
    f.call(json!({"op":"stop-instance","session_id":created["session_id"]}));
    created["session_id"].clone()
}

#[test]
fn saved_goal_refuses_before_load_and_keeps_a_confirmed_stopped_runtime() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    fs::write(f.dir.join("active-goal"), "1").unwrap();
    let result = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"goal-refusal","expected_runtime_generation":1}));
    assert_eq!(result["state"], "partial");
    assert_eq!(result["runtime"], "stopped");
    assert!(result["error"].as_str().unwrap().contains("goal"));
    assert_eq!(f.call(json!({"op":"status"}))["owns_agents"], false);
}

#[test]
fn changed_settings_after_load_leave_an_uncertain_receipt_without_replay() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    fs::write(f.dir.join("resume-setting-mismatch"), "1").unwrap();
    let request = json!({"op":"resume-instance","session_id":id,"request_id":"uncertain-resume","expected_runtime_generation":1});
    let result = f.call(request.clone());
    assert_eq!(result["state"], "uncertain");
    assert_eq!(f.call(request), result);
    assert_eq!(
        f.call(json!({"op":"list"}))[0]["lifecycle"]["runtime"],
        "unknown"
    );
    assert!(client(&f.dir,json!({"op":"resume-instance","session_id":id,"request_id":"bypass-uncertain","expected_runtime_generation":2})).is_err());
    assert_eq!(f.call(json!({"op":"status"}))["owns_agents"], false);
}

#[test]
fn changed_configuration_uses_current_model_and_effort() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    fs::write(f.dir.join("config-changed"), "1").unwrap();
    let result = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"changed-config","expected_runtime_generation":1}));
    assert_eq!(result["state"], "completed", "{result}");
    let db = rusqlite::Connection::open(f.dir.join("events.sqlite")).unwrap();
    let encoded: String = db
        .query_row(
            "SELECT settings FROM runtime_generations WHERE session_id=?1 AND generation=2",
            [id.as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    let saved: Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(saved["effective"]["model"], "changed-model");
    assert_eq!(saved["effective"]["reasoningEffort"], "low");
    assert_eq!(saved["effective"]["approvalPolicy"], "never");
    assert_eq!(
        saved["effective"]["sandbox"],
        json!({"type":"dangerFullAccess"})
    );
    f.call(json!({"op":"stop-instance","session_id":id}));
}

#[test]
fn explicit_native_permission_default_is_used_for_launch_and_resume() {
    let mut f = Fixture::new();
    fs::write(f.dir.join("launch-mode"), "config").unwrap();
    let id = stopped_saved_agent(&mut f);
    let result = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"restrictive-resume","expected_runtime_generation":1}));
    assert_eq!(result["state"], "completed");
    let db = rusqlite::Connection::open(f.dir.join("events.sqlite")).unwrap();
    let encoded: String = db
        .query_row(
            "SELECT settings FROM runtime_generations WHERE session_id=?1 AND generation=2",
            [id.as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    let saved: Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(saved["effective"]["approvalPolicy"], "on-request");
    assert_eq!(
        saved["effective"]["sandbox"],
        json!({"type":"readOnly","networkAccess":false})
    );
    let initial: String = db
        .query_row(
            "SELECT settings FROM runtime_generations WHERE session_id=?1 AND generation=1",
            [id.as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&initial).unwrap()["effective"]["approvalPolicy"],
        "on-request"
    );
    f.call(json!({"op":"stop-instance","session_id":id}));
}

#[test]
fn missing_historic_settings_do_not_block_a_confirmed_stopped_conversation() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    let db = rusqlite::Connection::open(f.dir.join("events.sqlite")).unwrap();
    db.execute(
        "UPDATE runtime_generations SET settings=NULL WHERE session_id=?1",
        [id.as_str().unwrap()],
    )
    .unwrap();
    assert_eq!(
        f.call(json!({"op":"list"}))[0]["resume"]["state"],
        "eligible"
    );
    let result = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"no-old-settings","expected_runtime_generation":1}));
    assert_eq!(result["state"], "completed", "{result}");
    f.call(json!({"op":"stop-instance","session_id":id}));
}

#[test]
fn incomplete_native_settings_update_makes_saved_settings_unavailable() {
    let mut f = Fixture::new();
    fs::write(f.dir.join("verified-settings"), "1").unwrap();
    f.start();
    let created = f.call(json!({"op":"create","open":false,"kind":"codex","request_id":"settings-change","name":"Settings change","cwd":f.dir}));
    fs::write(f.dir.join("incomplete-settings-update"), "1").unwrap();
    f.call(json!({"op":"send","session_id":created["session_id"],"request_id":"observe-settings-change","message":"fixture settings change"}));
    let db = rusqlite::Connection::open(f.dir.join("events.sqlite")).unwrap();
    wait(|| {
        db.query_row(
            "SELECT settings IS NULL FROM runtime_generations WHERE session_id=?1",
            [created["session_id"].as_str().unwrap()],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    });
    f.call(json!({"op":"stop-instance","session_id":created["session_id"]}));
    assert_eq!(
        f.call(json!({"op":"list"}))[0]["resume"]["state"],
        "eligible"
    );
}

#[test]
fn starting_resume_does_not_add_an_unready_voice_participant() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    let selected = f.call(json!({"op":"voice","target":"app","request_id":"voice-before-resume"}));
    assert_eq!(selected["state"], "completed");
    assert_ne!(f.call(json!({"op":"status"}))["voice"]["state"], "failed");
    fs::write(f.dir.join("slow-resume"), "1").unwrap();
    let resumed = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"resume-with-voice","expected_runtime_generation":1}));
    assert_eq!(resumed["state"], "completed");
    assert_ne!(f.call(json!({"op":"status"}))["voice"]["state"], "failed");
    f.call(json!({"op":"stop-instance","session_id":id}));
}

#[test]
fn confirmed_exit_with_unread_settings_can_use_current_defaults() {
    let mut f = Fixture::new();
    fs::write(f.dir.join("verified-settings"), "1").unwrap();
    f.start();
    let created = f.call(json!({"op":"create","open":false,"kind":"codex","request_id":"buffered-exit","name":"Buffered settings","cwd":f.dir}));
    let row = f.call(json!({"op":"list"}))[0].clone();
    let mut native = Codex::connect(Path::new(row["server"].as_str().unwrap())).unwrap();
    let mut blocked = UnixStream::connect(f.dir.join("service.sock")).unwrap();
    blocked.write_all(b"{").unwrap();
    thread::sleep(Duration::from_millis(50));
    let service_pid = nix::unistd::Pid::from_raw(f.service.as_ref().unwrap().id() as i32);
    nix::sys::signal::kill(service_pid, nix::sys::signal::Signal::SIGSTOP).unwrap();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        wait(|| {
            fs::read_to_string(format!("/proc/{service_pid}/stat"))
                .unwrap()
                .rsplit_once(')')
                .unwrap()
                .1
                .trim_start()
                .starts_with('T')
        });
        let _ = native.rpc("fixture/exit-with-settings", json!({}));
        let worker_pid = created["runtime_pid"].as_u64().unwrap();
        wait(|| {
            fs::read_to_string(format!("/proc/{worker_pid}/stat"))
                .map(|s| s.rsplit_once(')').unwrap().1.trim_start().starts_with('Z'))
                .unwrap_or(true)
        });
    }));
    nix::sys::signal::kill(service_pid, nix::sys::signal::Signal::SIGCONT).unwrap();
    drop(blocked);
    outcome.unwrap();
    wait(|| f.call(json!({"op":"list"}))[0]["lifecycle"]["runtime"] == "stopped");
    let observed = f.call(json!({"op":"list"}))[0].clone();
    assert_eq!(observed["resume"]["state"], "eligible");
}

#[test]
fn cli_resume_returns_the_saved_runtime_receipt() {
    let mut f = Fixture::new();
    fs::write(f.dir.join("verified-settings"), "1").unwrap();
    f.start();
    let created = f.call(json!({"op":"create","open":false,"kind":"codex","request_id":"cli-resume-original","name":"CLI resume","cwd":f.dir}));
    let id = created["session_id"].as_str().unwrap();
    f.call(json!({"op":"stop-instance","session_id":id}));
    let output = f.cli(&["resume-instance", id, "cli-resume", "1"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(receipt["state"], "completed");
    assert_eq!(receipt["session_id"], id);
    assert_eq!(receipt["runtime_generation"], 2);
    assert_eq!(receipt["window"], "closed");
    assert_eq!(
        f.call(json!({"op":"operation","request_id":"cli-resume"})),
        receipt
    );
}

#[test]
fn cli_operation_reads_a_failed_receipt_without_retrying() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    fs::write(f.dir.join("active-goal"), "1").unwrap();
    let expected = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"failed-for-inspection","expected_runtime_generation":1}));
    let output = f.cli(&["operation", "failed-for-inspection"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        expected
    );
}

#[test]
fn invalid_launch_mode_refuses_without_starting_a_vessel() {
    let mut f = Fixture::new();
    fs::write(f.dir.join("launch-mode"), "invalid").unwrap();
    f.start();
    let result = f.call(json!({"op":"create","open":false,"kind":"codex","request_id":"invalid-launch-mode","name":"Invalid mode","cwd":f.dir}));
    assert_eq!(result["state"], "partial");
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .contains("must be yolo or config")
    );
    assert!(f.call(json!({"op":"list"})).as_array().unwrap().is_empty());
    assert_eq!(f.call(json!({"op":"status"}))["owns_agents"], false);
}

#[test]
fn absent_model_and_effort_use_current_provider_defaults() {
    let mut f = Fixture::new();
    fs::write(f.dir.join("default-model"), "1").unwrap();
    let id = stopped_saved_agent(&mut f);
    let result = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"default-model-resume","expected_runtime_generation":1}));
    assert_eq!(result["state"], "completed", "{result}");
    f.call(json!({"op":"stop-instance","session_id":id}));
}
