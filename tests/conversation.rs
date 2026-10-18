use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use voyager_shell::service::client;

struct Trial {
    state: PathBuf,
    child: Child,
}
impl Trial {
    fn start(executable: &str) -> Self {
        let state = std::env::temp_dir().join(format!("vchat-{}", uuid::Uuid::new_v4().simple()));
        let child = Command::new(env!("CARGO_BIN_EXE_voyager"))
            .args(["--state", state.to_str().unwrap(), "serve"])
            .env("VOYAGER_CODEX_BIN", executable)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let trial = Self { state, child };
        wait(|| client(&trial.state, json!({"op":"status"})).is_ok());
        trial
    }
    fn call(&self, input: Value) -> Value {
        client(&self.state, input).unwrap()
    }
    fn ready(&self) {
        wait(|| self.call(json!({"op":"status"}))["conversation"]["phase"] == "ready");
    }
}
impl Drop for Trial {
    fn drop(&mut self) {
        let _ = client(&self.state, json!({"op":"stop"}));
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.state);
    }
}
fn wait(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(8);
    while !condition() {
        assert!(Instant::now() < deadline, "condition timed out");
        thread::sleep(Duration::from_millis(15));
    }
}
const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/conversation_server.py");

#[test]
fn private_runtime_starts_once_stays_out_of_registry_and_reaps_on_stop() {
    let trial = Trial::start(FIXTURE);
    trial.ready();
    let status = trial.call(json!({"op":"status"}));
    let pid = status["conversation"]["pid"].as_u64().unwrap();
    assert_eq!(status["owns_agents"], false);
    assert_eq!(status["conversation"]["effort"], "medium");
    assert_eq!(trial.call(json!({"op":"list"})), json!([]));
    let start = Command::new(env!("CARGO_BIN_EXE_voyager"))
        .args(["--state", trial.state.to_str().unwrap(), "start"])
        .output()
        .unwrap();
    let again: Value = serde_json::from_slice(&start.stdout).unwrap();
    assert_eq!(again["conversation"]["pid"], pid);
    let request = json!({"op":"conversation-send","request_id":"one","text":"hello"});
    assert_eq!(trial.call(request.clone())["state"], "pending");
    let begin = Instant::now();
    trial.call(json!({"op":"status"}));
    assert!(begin.elapsed() < Duration::from_millis(300));
    assert!(
        client(
            &trial.state,
            json!({"op":"conversation-send","request_id":"one","text":"changed"})
        )
        .is_err()
    );
    wait(|| {
        trial.call(json!({"op":"conversation-operation","request_id":"one"}))["state"]
            == "completed"
    });
    assert_eq!(trial.call(request)["state"], "completed");
    let page = trial.call(json!({"op":"conversation","after":0}));
    assert_eq!(
        page["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["type"] == "message")
            .count(),
        2
    );
    assert_eq!(
        trial.call(json!({"op":"events","after":0}))["events"],
        json!([])
    );
    let mut stream = UnixStream::connect(trial.state.join("instances.sock")).unwrap();
    writeln!(stream, "{}", json!({"op":"conversation","credential":{}})).unwrap();
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply).unwrap();
    assert!(reply.contains("forbidden"));
    let helper_pid = fs::read_to_string(trial.state.join("conversation-helper.pid")).unwrap();
    drop(trial);
    assert!(!PathBuf::from(format!("/proc/{pid}")).exists());
    wait(
        || match fs::read_to_string(format!("/proc/{helper_pid}/stat")) {
            Ok(stat) => stat.split_whitespace().nth(2) == Some("Z"),
            Err(_) => true,
        },
    );
}

#[test]
fn voice_lease_disconnect_stops_voice_without_stopping_conversation() {
    let trial = Trial::start(FIXTURE);
    trial.ready();
    let mut stream = UnixStream::connect(trial.state.join("service.sock")).unwrap();
    writeln!(
        stream,
        "{}",
        json!({"op":"conversation-attach","client_id":"desktop"})
    )
    .unwrap();
    let mut reply = String::new();
    BufReader::new(stream.try_clone().unwrap())
        .read_line(&mut reply)
        .unwrap();
    assert!(reply.contains("active"));
    assert!(client(&trial.state,json!({"op":"conversation-voice-start","request_id":"bad","client_id":"other","sdp":"offer"})).is_err());
    trial.call(json!({"op":"conversation-voice-start","request_id":"voice","client_id":"desktop","sdp":"offer"}));
    wait(|| trial.call(json!({"op":"status"}))["conversation"]["voice"] == "on");
    for input in [
        json!({"op":"conversation"}),
        json!({"op":"conversation","client_id":"other"}),
    ] {
        assert!(
            !trial.call(input)["events"]
                .as_array()
                .unwrap()
                .iter()
                .any(|event| event["type"] == "voice-sdp")
        );
    }
    assert!(
        trial.call(json!({"op":"conversation","client_id":"desktop"}))["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["type"] == "voice-sdp")
    );
    drop(stream);
    wait(|| trial.call(json!({"op":"status"}))["conversation"]["voice"] == "off");
    assert_eq!(
        trial.call(json!({"op":"status"}))["conversation"]["phase"],
        "ready"
    );
}

#[test]
fn missing_provider_and_uncertain_turn_do_not_break_service_or_replay() {
    let missing = Trial::start("/no/such/codex");
    assert_eq!(
        missing.call(json!({"op":"status"}))["conversation"]["phase"],
        "failed"
    );
    assert_eq!(missing.call(json!({"op":"list"})), json!([]));
    drop(missing);
    let trial = Trial::start(FIXTURE);
    trial.ready();
    let request = json!({"op":"conversation-send","request_id":"lost","text":"disconnect"});
    trial.call(request.clone());
    wait(|| trial.call(json!({"op":"status"}))["conversation"]["phase"] == "failed");
    assert_eq!(trial.call(request)["state"], "uncertain");
    assert_eq!(trial.call(json!({"op":"list"})), json!([]));
}
