use super::*;
use nix::{libc, sys::signal::Signal};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

#[test]
fn restarted_service_does_not_report_an_unverified_saved_viewer_closed() {
    let mut f = Fixture::new();
    f.start();
    let created = f.call(json!({"op":"create","kind":"codex","open":false,"request_id":"viewer-runtime","name":"Viewer","cwd":f.dir}));
    let id = created["session_id"].as_str().unwrap();
    let _owned = OwnedFixture::new(created["runtime_pid"].as_u64().unwrap() as u32);
    let store = Store::open(&f.dir.join("events.sqlite")).unwrap();
    store.begin_operation("saved-viewer", &json!({"op":"open","session_id":id}), &json!({"state":"completed","session_id":id,"pid":std::process::id(),"window_id":1,"terminal":"xterm","effects":[{"phase":"open","state":"confirmed"}]})).unwrap();
    store
        .begin_operation(
            "failed-open",
            &json!({"op":"open","session_id":id}),
            &json!({"state":"partial","session_id":id,"effects":[],"error":"viewer_conflict"}),
        )
        .unwrap();
    lose_service(&mut f);
    f.start();
    wait(|| f.call(json!({"op":"list"}))[0]["capture"] == "connected");
    let row = &f.call(json!({"op":"list"}))[0];
    assert_eq!(row["window"], "unknown");
    assert_eq!(row["lifecycle"]["runtime"], "running");
    assert!(
        !row["window_reason"]
            .as_str()
            .unwrap()
            .contains("no established process identity")
    );
    store
        .begin_operation(
            "uncertain-open",
            &json!({"op":"open","session_id":id}),
            &json!({"state":"uncertain","session_id":id,"effects":[]}),
        )
        .unwrap();
    lose_service(&mut f);
    f.start();
    wait(|| f.call(json!({"op":"list"}))[0]["capture"] == "connected");
    let uncertain = &f.call(json!({"op":"list"}))[0];
    assert_eq!(uncertain["window"], "unknown");
    assert!(
        uncertain["window_reason"]
            .as_str()
            .unwrap()
            .contains("no established process identity")
    );
    f.call(json!({"op":"stop-instance","session_id":id,"close_window":false}));
    f.halt();
}

struct OwnedFixture(OwnedFd);

impl OwnedFixture {
    fn new(pid: u32) -> Self {
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
        assert!(fd >= 0);
        Self(unsafe { OwnedFd::from_raw_fd(fd as i32) })
    }
}

impl Drop for OwnedFixture {
    fn drop(&mut self) {
        unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                self.0.as_raw_fd(),
                Signal::SIGKILL as i32,
                std::ptr::null::<libc::siginfo_t>(),
                libc::PIDFD_SIGNAL_PROCESS_GROUP,
            );
        }
    }
}

fn lose_service(f: &mut Fixture) {
    let mut service = f.service.take().unwrap();
    service.kill().unwrap();
    service.wait().unwrap();
}

#[test]
fn background_runtime_reconnects_after_service_loss_without_repeating_work() {
    let mut f = Fixture::new();
    f.start();
    let created = f.call(json!({"op":"create","kind":"codex","open":false,"request_id":"reconnect-existing","name":"Existing","cwd":f.dir}));
    let session = created["session_id"].as_str().unwrap();
    let _owned = OwnedFixture::new(created["runtime_pid"].as_u64().unwrap() as u32);
    let before = f.call(json!({"op":"list"}))[0].clone();
    let context = voyager_shell::authority::Credentials::locator(&f.dir, "reconnect-existing");
    let old_context: Value = serde_json::from_slice(&fs::read(&context).unwrap()).unwrap();
    lose_service(&mut f);
    let store = Store::open(&f.dir.join("events.sqlite")).unwrap();
    let (_, mut receipt) = store.operation("reconnect-existing").unwrap().unwrap();
    receipt.as_object_mut().unwrap().remove("process_identity");
    store
        .save_operation("reconnect-existing", &receipt)
        .unwrap();
    drop(store);
    f.start();
    wait(|| f.call(json!({"op":"list"}))[0]["capture"] == "connected");
    let after = f.call(json!({"op":"list"}))[0].clone();
    assert_eq!(after["lifecycle"], before["lifecycle"]);
    assert_eq!(after["id"], session);
    assert_eq!(after["native_thread_id"], before["native_thread_id"]);
    assert_eq!(
        f.call(json!({"op":"attach-info","session_id":session}))["pid"],
        created["runtime_pid"]
    );
    let new_context: Value = serde_json::from_slice(&fs::read(&context).unwrap()).unwrap();
    assert_ne!(new_context, old_context);
    let old_path = f.dir.join("old-context.json");
    fs::write(&old_path, serde_json::to_vec(&old_context).unwrap()).unwrap();
    fs::set_permissions(&old_path, fs::Permissions::from_mode(0o600)).unwrap();
    for (path, accepted) in [(&old_path, false), (&context, true)] {
        let result = Command::new(env!("CARGO_BIN_EXE_voyager"))
            .env("VOYAGER_CALLER", "instance")
            .env("VOYAGER_SESSION_CONTEXT", path)
            .args(["--state", f.dir.to_str().unwrap(), "capabilities"])
            .output()
            .unwrap();
        assert_eq!(result.status.success(), accepted);
    }
    assert!(
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["type"] != "turn.started")
    );
    let stopped = f.call(json!({"op":"stop-instance","session_id":session}));
    assert_eq!(stopped["runtime"], "stopped");
}

#[test]
fn connection_loss_keeps_active_work_and_credentials_without_resubmission() {
    let mut f = Fixture::new();
    f.start();
    fs::write(f.dir.join("hold-turn"), "1").unwrap();
    let created = f.call(json!({"op":"create","kind":"codex","open":false,"request_id":"active-reconnect","name":"Active","cwd":f.dir}));
    let session = &created["session_id"];
    let before = f.call(json!({"op":"list"}))[0].clone();
    let context = voyager_shell::authority::Credentials::locator(&f.dir, "active-reconnect");
    let original = fs::read(&context).unwrap();
    let sent = f.call(json!({"op":"send","session_id":session,"request_id":"single-turn","message":"keep working"}));
    let mut control = Codex::connect(Path::new(before["server"].as_str().unwrap())).unwrap();
    control.rpc("fixture/disconnect", json!({})).unwrap();
    wait(|| f.call(json!({"op":"list"}))[0]["capture_generation"] != before["capture_generation"]);
    let after = f.call(json!({"op":"list"}))[0].clone();
    assert_eq!(after["lifecycle"], before["lifecycle"]);
    assert_eq!(fs::read(&context).unwrap(), original);
    assert_eq!(
        control.metadata("worker-thread").unwrap()["status"]["type"],
        "active"
    );
    fs::remove_file(f.dir.join("hold-turn")).unwrap();
    wait(|| {
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "turn.completed" && e["native_turn_id"] == sent["native_turn_id"])
    });
    assert_eq!(control.rpc("fixture/count", json!({})).unwrap()["turns"], 1);
    f.call(json!({"op":"stop-instance","session_id":session}));
}

#[test]
fn resumed_generation_renews_its_current_locator() {
    let mut f = Fixture::new();
    let session = super::resume::stopped_saved_agent(&mut f);
    let resumed = f.call(json!({"op":"resume-instance","session_id":session,"request_id":"latest-runtime","expected_runtime_generation":1}));
    let _owned = OwnedFixture::new(resumed["runtime_pid"].as_u64().unwrap() as u32);
    lose_service(&mut f);
    f.start();
    wait(|| f.call(json!({"op":"list"}))[0]["capture"] == "connected");
    assert_eq!(
        f.call(json!({"op":"list"}))[0]["lifecycle"]["runtime_generation"],
        2
    );
    assert!(voyager_shell::authority::Credentials::locator(&f.dir, "latest-runtime").is_file());
    assert!(!voyager_shell::authority::Credentials::locator(&f.dir, "saved-agent").exists());
    f.call(json!({"op":"stop-instance","session_id":session}));
}

#[test]
fn changed_native_thread_cannot_claim_the_surviving_managed_process() {
    let mut f = Fixture::new();
    f.start();
    let created = f.call(json!({"op":"create","kind":"codex","open":false,"request_id":"different-thread","name":"Control","cwd":f.dir}));
    let _owned = OwnedFixture::new(created["runtime_pid"].as_u64().unwrap() as u32);
    let before = f.call(json!({"op":"list"}))[0].clone();
    lose_service(&mut f);
    let store = Store::open(&f.dir.join("events.sqlite")).unwrap();
    store
        .0
        .execute(
            "UPDATE sessions SET native_id='another-thread' WHERE id=?1",
            [created["session_id"].as_str().unwrap()],
        )
        .unwrap();
    drop(store);
    f.start();
    wait(|| f.call(json!({"op":"list"}))[0]["recovery"]["state"] == "disconnected");
    assert_eq!(f.call(json!({"op":"status"}))["owns_agents"], false);
    assert!(!voyager_shell::authority::Credentials::locator(&f.dir, "different-thread").exists());
    let mut native = Codex::connect(Path::new(before["server"].as_str().unwrap())).unwrap();
    assert_eq!(
        native.metadata("worker-thread").unwrap()["id"],
        "worker-thread"
    );
}

#[test]
fn capture_change_during_verification_rejects_the_old_result() {
    let mut f = Fixture::new();
    f.start();
    let created = f.call(json!({"op":"create","kind":"codex","open":false,"request_id":"stale-check","name":"Stale","cwd":f.dir}));
    let id = created["session_id"].as_str().unwrap();
    let _owned = OwnedFixture::new(created["runtime_pid"].as_u64().unwrap() as u32);
    fs::write(f.dir.join("hold-reconnect"), "1").unwrap();
    lose_service(&mut f);
    f.start();
    wait(|| f.dir.join("reconnect-pending").exists());
    let store = Store::open(&f.dir.join("events.sqlite")).unwrap();
    let generation = store.reactivate(id).unwrap();
    drop(store);
    fs::remove_file(f.dir.join("hold-reconnect")).unwrap();
    wait(|| f.call(json!({"op":"list"}))[0]["recovery"]["state"] == "disconnected");
    let row = f.call(json!({"op":"list"}))[0].clone();
    assert_eq!(row["capture_generation"], generation);
    assert_eq!(row["capture"], "disconnected");
    assert!(!voyager_shell::authority::Credentials::locator(&f.dir, "stale-check").exists());
    assert_eq!(f.call(json!({"op":"status"}))["owns_agents"], false);
}

#[test]
fn later_native_calls_share_the_original_connection_deadline() {
    let mut f = Fixture::new();
    f.start();
    let created = f.call(json!({"op":"create","kind":"codex","open":false,"request_id":"deadline","name":"Deadline","cwd":f.dir}));
    let row = f.call(json!({"op":"list"}))[0].clone();
    let mut native = Codex::connect_before(
        Path::new(row["server"].as_str().unwrap()),
        Instant::now() + Duration::from_millis(200),
    )
    .unwrap();
    thread::sleep(Duration::from_millis(100));
    assert!(native.rpc("fixture/slow", json!({})).is_err());
    f.call(json!({"op":"stop-instance","session_id":created["session_id"]}));
}
