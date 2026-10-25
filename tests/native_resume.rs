#[path = "support/resume_provider.rs"]
mod provider;
use anyhow::{Context, Result, ensure};
use provider::*;
use serde_json::json;
use std::{
    fs,
    path::Path,
    process::Command,
    time::{Duration, Instant},
};

#[test]
fn rejected_preflight_never_loads_a_thread() {
    for reply in [
        json!({}),
        json!({"goal":{"status":"active"}}),
        json!({"error":"unavailable"}),
    ] {
        assert!(after_preflight(&reply, || panic!("unsafe load submitted")).is_err());
    }
}
#[test]
fn missing_settings_cannot_compare_as_equal() {
    let complete = json!({"model":"m","modelProvider":"p","cwd":"/tmp","approvalPolicy":"on-request","approvalsReviewer":"user","sandbox":{"type":"readOnly","networkAccess":false},"activePermissionProfile":null});
    assert!(settings(&complete).is_ok());
    for key in complete.as_object().unwrap().keys() {
        let mut missing = complete.clone();
        missing.as_object_mut().unwrap().remove(key);
        assert!(settings(&missing).is_err(), "missing {key} was accepted");
    }
}
#[test]
fn active_status_is_not_idle_without_a_turn_event() {
    assert!(!idle(&[
        json!({"method":"thread/status/changed","params":{"status":{"type":"active"}}})
    ]));
    assert!(require_idle(&json!({"thread":{"status":{"type":"active"}}})).is_err());
}
#[test]
#[ignore = "Uses authenticated Codex and disposable saved conversations"]
fn saved_thread_idle_gate() -> Result<()> {
    let root = std::env::var("VOYAGER_RESUME_PROOF_STATE")
        .context("Set a fresh private proof directory")?;
    let root = Path::new(&root);
    fs::create_dir(root)?;
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(root, fs::Permissions::from_mode(0o700))?;
    let version = Command::new(std::env::var("VOYAGER_CODEX_BIN").unwrap_or("codex".into()))
        .arg("--version")
        .output()?;
    fs::write(root.join("provider-version.txt"), version.stdout)?;
    let (process, mut connection) = connect(root, "original")?;
    let requested = json!({"cwd":root,"approvalPolicy":"on-request","sandbox":"read-only","historyMode":"legacy"});
    let original = connection.rpc("thread/start", requested.clone())?;
    save(&root.join("original.json"), &original)?;
    ensure!(
        original["sandbox"] == json!({"type":"readOnly","networkAccess":false})
            && original["approvalPolicy"] == "on-request",
        "restrictive settings were not effective"
    );
    ensure!(
        original["cwd"] == root.to_str().unwrap(),
        "working folder changed"
    );
    let expected = settings(&original)?;
    let id = thread_id(&original)?.to_owned();
    connection.rpc("turn/start", json!({"threadId":id,"input":[{"type":"text","text":"Remember this exact marker: VOYAGER_RESUME_MARKER_73. Reply only SAVED. Do not use tools."}]}))?;
    let deadline = Instant::now() + Duration::from_secs(90);
    let mut completed = false;
    while Instant::now() < deadline && !completed {
        completed = observe(&mut connection, 1)?.iter().any(|v| {
            v["method"] == "turn/completed" && v["params"]["turn"]["status"] == "completed"
        });
    }
    ensure!(completed, "marker turn did not complete");
    drop(connection);
    process.stop()?;
    let (process, mut connection) = connect(root, "reopened")?;
    let mut resume = requested.clone();
    resume.as_object_mut().unwrap().remove("historyMode");
    resume["threadId"] = json!(id);
    let reopened = plain_resume(&mut connection, resume)?;
    save(&root.join("reopened.json"), &reopened)?;
    ensure!(
        expected == settings(&reopened)?,
        "effective settings changed"
    );
    ensure!(thread_id(&reopened)? == id, "thread identity changed");
    require_idle(&reopened)?;
    let events = observe(&mut connection, 5)?;
    save(&root.join("idle-events.json"), &json!(events))?;
    ensure!(idle(&events), "reopening submitted work");
    let history = connection.rpc("thread/read", json!({"threadId":id,"includeTurns":true}))?;
    ensure!(
        history.to_string().contains("VOYAGER_RESUME_MARKER_73"),
        "saved marker missing"
    );
    drop(connection);
    process.stop()?;
    let (process, mut connection) = connect(root, "changed-setting")?;
    let changed = plain_resume(
        &mut connection,
        json!({"threadId":id,"sandbox":"danger-full-access"}),
    )?;
    save(&root.join("changed-setting.json"), &changed)?;
    ensure!(
        settings(&changed)? != expected,
        "negative settings control did not differ"
    );
    drop(connection);
    process.stop()?;
    let (process, mut connection) = connect(root, "goal-original")?;
    let goal_thread = connection.rpc("thread/start", requested)?;
    let goal_id = thread_id(&goal_thread)?;
    let goal = connection.rpc("thread/goal/set", json!({"threadId":goal_id,"origin":"user","objective":"On continuation reply CONTINUED. Keep this goal active until ten continuations have occurred. Do not use tools.","tokenBudget":1000}))?;
    save(&root.join("saved-goal.json"), &goal)?;
    drop(connection);
    process.stop()?;
    let (process, mut connection) = connect(root, "goal-preflight")?;
    ensure!(connection.loaded()?.is_empty(), "unexpected loaded thread");
    let preflight = connection.rpc("thread/goal/get", json!({"threadId":goal_id}))?;
    save(&root.join("saved-goal-preflight.json"), &preflight)?;
    ensure!(
        preflight["goal"]["status"] == "active",
        "active goal not preserved"
    );
    ensure!(
        plain_resume(&mut connection, json!({"threadId":goal_id})).is_err(),
        "active goal was loaded"
    );
    ensure!(
        connection.loaded()?.is_empty() && idle(&observe(&mut connection, 5)?),
        "preflight started work"
    );
    drop(connection);
    process.stop()?;
    save(
        &root.join("result.json"),
        &json!({"thread_id":id,"idle_seconds":5,"status":"supported-with-preflight","active_goal":"refused-before-loading"}),
    )?;
    Ok(())
}
