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
        if let Ok(rows) = client(&self.state, json!({"op":"list","include_removed":true})) {
            for row in rows.as_array().into_iter().flatten() {
                let id = uuid::Uuid::new_v4().to_string();
                let _ = client(
                    &self.state,
                    json!({"op":"stop-instance","session_id":row["id"],"request_id":id,"close_window":false}),
                );
                let deadline = Instant::now() + Duration::from_secs(4);
                while Instant::now() < deadline {
                    if client(&self.state, json!({"op":"operation","request_id":id}))
                        .is_ok_and(|r| r["state"] != "pending")
                    {
                        break;
                    }
                    thread::sleep(Duration::from_millis(20));
                }
            }
        }
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
    let cli = Command::new(env!("CARGO_BIN_EXE_voyager"))
        .args([
            "--state",
            trial.state.to_str().unwrap(),
            "chat",
            "cli-chat",
            "hello from CLI",
        ])
        .output()
        .unwrap();
    assert!(
        cli.status.success(),
        "{}",
        String::from_utf8_lossy(&cli.stderr)
    );
    let receipt: Value = serde_json::from_slice(&cli.stdout).unwrap();
    assert!(["accepted", "completed"].contains(&receipt["state"].as_str().unwrap()));
    wait(|| {
        trial.call(json!({"op":"conversation-operation","request_id":"cli-chat"}))["state"]
            == "completed"
    });

    let page = trial.call(json!({"op":"conversation","after":0}));
    assert_eq!(
        page["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["type"] == "message")
            .count(),
        4
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

fn tool(trial: &Trial, name: &str, arguments: Value) -> Value {
    let id = uuid::Uuid::new_v4().to_string();
    trial.call(json!({"op":"conversation-send","request_id":id,"text":format!("tool|{}",json!({"tool":name,"arguments":arguments}))}));
    wait(|| {
        trial.call(json!({"op":"conversation-operation","request_id":id}))["state"] == "completed"
    });
    let page = trial.call(json!({"op":"conversation"}));
    let event = page["events"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|e| e["type"] == "message" && e["data"]["role"] == "assistant")
        .unwrap();
    serde_json::from_str(event["data"]["text"].as_str().unwrap()).unwrap()
}
fn finish(trial: &Trial, receipt: Value) -> Value {
    let id = receipt["request_id"].clone();
    wait(|| trial.call(json!({"op":"operation","request_id":id}))["state"] != "pending");
    let result = trial.call(json!({"op":"operation","request_id":id}));
    assert_eq!(result["state"], "completed", "{result}");
    result
}

#[test]
fn conversation_tools_use_real_service_actions_and_preserve_human_escalation_answers() {
    let trial = Trial::start(FIXTURE);
    trial.ready();
    let created = tool(
        &trial,
        "voyager_create",
        json!({"kind":"codex","name":"A real fixture vessel","cwd":trial.state,"rank":"crew","supervisor_id":null,"open":false}),
    );
    let creation_id = created["request_id"].as_str().unwrap().to_owned();
    let vessel = finish(&trial, created)["session_id"].clone();
    assert_eq!(
        trial.call(json!({"op":"list"})).as_array().unwrap().len(),
        1
    );
    assert_eq!(
        tool(&trial, "voyager_status", json!({}))["owns_agents"],
        true
    );
    let fleet = tool(
        &trial,
        "voyager_create_fleet",
        json!({"goal":"Compiler research"}),
    )["fleets"][0]["id"]
        .clone();
    let moved = tool(
        &trial,
        "voyager_move_to_fleet",
        json!({"session_id":vessel,"fleet_id":fleet}),
    );
    assert_eq!(moved["assignments"][vessel.as_str().unwrap()], fleet);
    assert!(tool(&trial, "voyager_status", json!({"op":"stop"}))["error"].is_string());
    let mut lease = UnixStream::connect(trial.state.join("service.sock")).unwrap();
    writeln!(
        lease,
        "{}",
        json!({"op":"conversation-attach","client_id":"voice-test"})
    )
    .unwrap();
    let mut attached = String::new();
    BufReader::new(lease.try_clone().unwrap())
        .read_line(&mut attached)
        .unwrap();
    trial.call(json!({"op":"conversation-voice-start","request_id":"start-question-voice","client_id":"voice-test","sdp":"fixture"}));
    wait(|| trial.call(json!({"op":"status"}))["conversation"]["voice"] == "on");
    trial.call(json!({"op":"conversation-voice-activity","client_id":"voice-test","speaker":"human","active":true}));
    let question = "owner-question";
    let credential: Value = serde_json::from_slice(
        &fs::read(
            trial
                .state
                .join("contexts")
                .join(format!("{creation_id}.json")),
        )
        .unwrap(),
    )
    .unwrap();
    let mut stream = UnixStream::connect(trial.state.join("instances.sock")).unwrap();
    writeln!(stream,"{}",json!({"op":"escalate","credential":credential,"request_id":question,"message":"Should I continue?"})).unwrap();
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).unwrap();
    assert!(!line.contains("error"), "{line}");
    wait(|| {
        trial.call(json!({"op":"conversation"}))["presentations"][question]["text"].is_string()
    });
    let answer = tool(&trial, "voyager_answer", json!({"escalation_id":question}));
    assert_eq!(answer["reply_to"], question);
    let saved = trial.call(json!({"op":"escalations"}));
    let record = saved
        .as_array()
        .unwrap()
        .iter()
        .find(|q| q["request_id"] == question)
        .unwrap();
    assert_eq!(record["answer"]["decision"], "resolve");
    let source = record["answer"]["message"].as_str().unwrap();
    assert!(source.starts_with("tool|"));
    assert!(tool(&trial, "voyager_answer", json!({"escalation_id":question}))["error"].is_string());
    trial.call(json!({"op":"conversation-voice-activity","client_id":"voice-test","speaker":"human","active":false}));
    thread::sleep(Duration::from_millis(1600));
    let methods = fs::read_to_string(trial.state.join("conversation-methods.jsonl")).unwrap();
    assert!(
        !methods.contains("thread/realtime/appendSpeech"),
        "Answered question must not be spoken later"
    );
    drop(lease);
    finish(
        &trial,
        tool(&trial, "voyager_stop", json!({"session_id":vessel})),
    );
    finish(
        &trial,
        tool(
            &trial,
            "voyager_remove",
            json!({"session_id":vessel,"stop":true}),
        ),
    );
    assert_eq!(trial.call(json!({"op":"list"})), json!([]));
}
