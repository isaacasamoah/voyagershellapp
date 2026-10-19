use serde_json::{Value, json};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    process::{Child, Command},
    thread,
    time::{Duration, Instant},
};
use voyager_shell::service::client;

struct Service(Child, PathBuf);
impl Drop for Service {
    fn drop(&mut self) {
        if let Ok(sessions) = client(&self.1, json!({"op":"list"})) {
            for session in sessions.as_array().unwrap() {
                if session["ownership"] == "managed" {
                    let request = uuid::Uuid::new_v4().to_string();
                    let _ = client(
                        &self.1,
                        json!({"op":"remove","session_id":session["id"],"request_id":request,"stop":true}),
                    );
                    let end = Instant::now() + Duration::from_secs(12);
                    while Instant::now() < end {
                        if client(&self.1, json!({"op":"operation","request_id":request}))
                            .is_ok_and(|r| r["state"] != "pending")
                        {
                            break;
                        }
                        thread::sleep(Duration::from_millis(50));
                    }
                }
            }
        }
        let _ = client(&self.1, json!({"op":"stop"}));
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn wait(mut check: impl FnMut() -> bool) {
    let end = Instant::now() + Duration::from_secs(15);
    while !check() {
        assert!(Instant::now() < end, "native shell check timed out");
        thread::sleep(Duration::from_millis(50));
    }
}

#[test]
#[ignore = "Opens real Ghostty; requires a fresh VOYAGER_NATIVE_SHELL_DIR and desktop access"]
fn shell_viewer_survives_a_service_binary_replacement() {
    let state = PathBuf::from(std::env::var_os("VOYAGER_NATIVE_SHELL_DIR").unwrap());
    fs::create_dir(&state).unwrap();
    fs::set_permissions(&state, fs::Permissions::from_mode(0o700)).unwrap();
    let binary = state.join("voyager");
    fs::copy(env!("CARGO_BIN_EXE_voyager"), &binary).unwrap();
    let mut service = Service(
        Command::new(&binary)
            .args(["--state", state.to_str().unwrap(), "serve"])
            .env("VOYAGER_VOICE_FOLLOWS_DOCK", "0")
            .spawn()
            .unwrap(),
        state.clone(),
    );
    wait(|| client(&state, json!({"op":"status"})).is_ok());
    let replacement = state.join("replacement");
    fs::copy(env!("CARGO_BIN_EXE_voyager"), &replacement).unwrap();
    fs::rename(&replacement, &binary).unwrap();
    let process_exe = fs::read_link(format!("/proc/{}/exe", service.0.id())).unwrap();
    assert!(process_exe.to_string_lossy().ends_with(" (deleted)"));
    let call = |request: Value| {
        let mut result = client(&state, request).unwrap();
        wait(|| {
            if result["state"] == "pending" {
                result = client(
                    &state,
                    json!({"op":"operation","request_id":result["request_id"]}),
                )
                .unwrap();
            }
            result["state"] != "pending"
        });
        result
    };
    let created = call(
        json!({"op":"create","kind":"shell","name":"Voyager rebuild check","cwd":state,"request_id":"create","open":true,"terminal":"ghostty"}),
    );
    assert_eq!(created["state"], "completed", "{created}");
    let session = &created["session_id"];
    let attachment = call(json!({"op":"attach-info","session_id":session}));
    assert_eq!(attachment["executable"], binary.to_str().unwrap());
    wait(|| call(json!({"op":"shell-read","session_id":session}))["ready"] == true);
    call(
        json!({"op":"shell-exec","session_id":session,"request_id":"check-cli","command":"\"$VOYAGER_BIN\" --state \"$VOYAGER_STATE\" capabilities > cli.json"}),
    );
    wait(|| {
        fs::read_to_string(state.join("cli.json"))
            .is_ok_and(|s| serde_json::from_str::<Value>(&s).is_ok())
    });
    let background =
        call(json!({"op":"background","session_id":session,"request_id":"background"}));
    assert_eq!(background["state"], "completed", "{background}");
    let reopened =
        call(json!({"op":"open","session_id":session,"request_id":"reopen","terminal":"ghostty"}));
    assert_eq!(reopened["state"], "completed", "{reopened}");
    assert_eq!(
        call(json!({"op":"attach-info","session_id":session}))["pid"],
        attachment["pid"]
    );
    assert_eq!(
        call(json!({"op":"background","session_id":session,"request_id":"before-failure"}))["state"],
        "completed"
    );
    fs::copy("/bin/false", &replacement).unwrap();
    fs::rename(&replacement, &binary).unwrap();
    let failed = call(
        json!({"op":"open","session_id":session,"request_id":"failed-client","terminal":"ghostty"}),
    );
    assert!(
        failed["state"] == "partial" || failed["state"] == "uncertain",
        "{failed}"
    );
    assert!(
        !failed["effects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["phase"] == "open" && e["state"] == "confirmed")
    );
    let retry = call(
        json!({"op":"open","session_id":session,"request_id":"focus-failed-client","terminal":"ghostty"}),
    );
    assert_ne!(retry["state"], "completed", "{retry}");
    assert_eq!(
        call(json!({"op":"background","session_id":session,"request_id":"close-failed-viewer"}))["state"],
        "completed"
    );
    fs::copy(env!("CARGO_BIN_EXE_voyager"), &replacement).unwrap();
    fs::rename(&replacement, &binary).unwrap();
    let recovered = call(
        json!({"op":"open","session_id":session,"request_id":"repair-client","terminal":"ghostty"}),
    );
    assert_eq!(recovered["state"], "completed", "{recovered}");
    let removed =
        call(json!({"op":"remove","session_id":session,"request_id":"cleanup","stop":true}));
    assert_eq!(removed["state"], "completed", "{removed}");
    let result = json!({"verdict":"pass","replaced_process_executable":process_exe,"attachment":attachment,"created":created,"background":background,"reopened":reopened,"failed_client":failed,"retry":retry,"recovered":recovered,"removed":removed,"limits":"Real Ghostty and Bash. No model turn, microphone or voice transport is exercised."});
    fs::write(
        state.join("proof.json"),
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .unwrap();
    client(&state, json!({"op":"stop"})).unwrap();
    wait(|| service.0.try_wait().unwrap().is_some());
}
