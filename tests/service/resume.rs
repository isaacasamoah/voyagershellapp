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
fn absent_model_and_effort_use_current_provider_defaults() {
    let mut f = Fixture::new();
    fs::write(f.dir.join("default-model"), "1").unwrap();
    let id = stopped_saved_agent(&mut f);
    let result = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"default-model-resume","expected_runtime_generation":1}));
    assert_eq!(result["state"], "completed", "{result}");
    f.call(json!({"op":"stop-instance","session_id":id}));
}

#[test]
fn an_unrelated_configuration_edit_does_not_block_resume() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    fs::write(f.dir.join("unrelated-config"), "1").unwrap();
    let result = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"unrelated-config","expected_runtime_generation":1}));
    assert_eq!(result["state"], "completed", "{result}");
    f.call(json!({"op":"stop-instance","session_id":id}));
}

#[test]
fn invalid_current_configuration_fails_before_loading() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    fs::write(f.dir.join("invalid-config"), "1").unwrap();
    let result = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"invalid-current-config","expected_runtime_generation":1}));
    assert_eq!(result["state"], "partial", "{result}");
    assert_eq!(result["runtime"], "stopped");
    assert_eq!(
        f.call(json!({"op":"list"}))[0]["native_thread_id"],
        "worker-thread"
    );
    assert_eq!(f.call(json!({"op":"status"}))["owns_agents"], false);
}
