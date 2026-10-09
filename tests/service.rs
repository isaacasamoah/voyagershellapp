use serde_json::{Value, json};
use std::{
    fs,
    io::{self, Write},
    os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use tungstenite::Message;
use voyager_shell::{codex::Codex, events, service::client, store::Store};

struct Fixture {
    dir: PathBuf,
    socket: PathBuf,
    stop: Arc<AtomicBool>,
    sends: Arc<Mutex<u64>>,
    server: Option<thread::JoinHandle<()>>,
    service: Option<Child>,
}

fn metadata(id: &str) -> Value {
    json!({"id":id,"sessionId":id,"cwd":"/synthetic","source":"vscode","status":{"type":"idle"}})
}

fn note(method: &str, params: Value) -> Value {
    json!({"method":method,"params":params})
}

impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("voyager-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        let socket = dir.join("codex.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let sends = Arc::new(Mutex::new(0));
        let stopped = stop.clone();
        let sent = sends.clone();
        let server = thread::spawn(move || {
            let mut handlers = Vec::new();
            while !stopped.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let end = stopped.clone();
                        let count = sent.clone();
                        handlers.push(thread::spawn(move || {
                            stream.set_read_timeout(Some(Duration::from_millis(100))).unwrap();
                            stream.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
                            let Ok(mut ws)=tungstenite::accept(stream) else { return; };
                            while !end.load(Ordering::SeqCst) {
                                let request=match ws.read() {
                                    Ok(Message::Text(s)) => serde_json::from_str::<Value>(&s).unwrap(),
                                    Err(tungstenite::Error::Io(e)) if matches!(e.kind(),io::ErrorKind::TimedOut|io::ErrorKind::WouldBlock) => continue,
                                    _ => break,
                                };
                                if request.get("id").is_none() { continue; }
                                let p=&request["params"];
                                let result=match request["method"].as_str().unwrap() {
                                    "initialize" => json!({"userAgent":"fixture"}),
                                    "thread/loaded/list" => json!({"data":["live-thread"],"nextCursor":null}),
                                    "thread/read" => json!({"thread":metadata(p["threadId"].as_str().unwrap())}),
                                    "thread/resume" => {
                                        assert_eq!(*p,json!({"threadId":"live-thread","excludeTurns":true}));
                                        json!({"thread":metadata("live-thread")})
                                    }
                                    "turn/start" => {
                                        assert_eq!(p["threadId"],"live-thread");
                                        // No model or permission override is allowed in this adapter.
                                        assert_eq!(p.as_object().unwrap().len(),3);
                                        let count={ let mut c=count.lock().unwrap(); *c+=1; *c };
                                        let message=p["input"][0]["text"].as_str().unwrap();
                                        if message=="disconnect" { break; }
                                        if message=="malformed" {
                                            let _=ws.send(Message::Text("not JSON".into()));
                                            // Leave the transport open: a lost observation must
                                            // still invalidate capture, not wait for EOF.
                                            continue;
                                        }
                                        if message=="overflow" {
                                            for _ in 0..513 {
                                                if ws.send(Message::Text(note("unknown/future",json!({})).to_string().into())).is_err() { break; }
                                            }
                                            continue;
                                        }
                                        let turn=format!("turn-{count}");
                                        let observations=vec![
                                            note("turn/started",json!({"threadId":"live-thread","turn":{"id":turn,"status":"inProgress"}})),
                                            note("item/completed",json!({"threadId":"live-thread","turnId":turn,"item":{"id":"reasoning","type":"reasoning","text":"EXCLUDED_SECRET"}})),
                                            note("item/completed",json!({"threadId":"unregistered","turnId":turn,"item":{"id":"other","type":"agentMessage","text":"EXCLUDED_SECRET"}})),
                                            note("item/completed",json!({"threadId":"live-thread","turnId":turn,"item":{"id":format!("user-{count}"),"type":"userMessage","content":[{"type":"text","text":message}]}})),
                                            note("item/started",json!({"threadId":"live-thread","turnId":turn,"item":{"id":"tool","type":"commandExecution","command":"EXCLUDED_SECRET","status":"inProgress"}})),
                                            note("item/completed",json!({"threadId":"live-thread","turnId":turn,"item":{"id":format!("assistant-{count}"),"type":"agentMessage","text":"fixture reply","phase":"final"}})),
                                            note("turn/completed",json!({"threadId":"live-thread","turn":{"id":turn,"status":"completed"}})),
                                        ];
                                        for value in observations { ws.send(Message::Text(value.to_string().into())).unwrap(); }
                                        json!({"turn":{"id":turn,"status":"inProgress"}})
                                    }
                                    method => panic!("unexpected Codex call {method}"),
                                };
                                if ws.send(Message::Text(json!({"id":request["id"],"result":result}).to_string().into())).is_err() { break; }
                            }
                        }));
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10))
                    }
                    Err(e) => panic!("{e}"),
                }
            }
            for handler in handlers {
                handler.join().unwrap();
            }
        });
        Self {
            dir,
            socket,
            stop,
            sends,
            server: Some(server),
            service: None,
        }
    }
    fn start(&mut self) {
        self.service = Some(
            Command::new(env!("CARGO_BIN_EXE_voyager"))
                .env(
                    "VOYAGER_CODEX_BIN",
                    concat!(env!("CARGO_MANIFEST_DIR"), "/tests/worker_server.py"),
                )
                .args([
                    "--state",
                    self.dir.to_str().unwrap(),
                    "serve",
                    self.socket.to_str().unwrap(),
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        wait(|| client(&self.dir, json!({"op":"status"})).is_ok());
    }
    fn call(&self, v: Value) -> Value {
        client(&self.dir, v).unwrap()
    }
    fn events(&self) -> Value {
        self.call(json!({"op":"events","after":0}))
    }
    fn halt(&mut self) {
        self.call(json!({"op":"stop"}));
        let child = self.service.as_mut().unwrap();
        wait(|| child.try_wait().unwrap().is_some());
        self.service.take();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if self.service.is_some() {
            if let Ok(sessions) = client(&self.dir, json!({"op":"list"})) {
                for session in sessions.as_array().unwrap() {
                    if session["ownership"] == "managed" && session["worker_state"] == "running" {
                        let _ = client(
                            &self.dir,
                            json!({"op":"stop-worker","session_id":session["id"]}),
                        );
                    }
                }
            }
        }
        if let Some(mut child) = self.service.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.stop.store(true, Ordering::SeqCst);
        if let Some(server) = self.server.take() {
            server.join().unwrap();
        }
        fs::remove_dir_all(&self.dir).unwrap();
    }
}
fn wait(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        if predicate() {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }
    panic!("bounded observation timed out");
}

#[test]
fn register_converse_isolate_restart_and_leave_native_owner_running() {
    let mut f = Fixture::new();
    f.start();
    let instance = f.call(json!({"op":"status"}))["instance"].clone();
    let duplicate = Command::new(env!("CARGO_BIN_EXE_voyager"))
        .args([
            "--state",
            f.dir.to_str().unwrap(),
            "serve",
            f.socket.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(!duplicate.status.success());
    assert_eq!(f.call(json!({"op":"status"}))["instance"], instance);
    assert!(
        client(
            &f.dir,
            json!({"op":"register","thread_id":"historical-thread"})
        )
        .is_err()
    );
    let registration = f.call(json!({"op":"register","thread_id":"live-thread"}));
    let session = &registration["session_id"];
    assert_eq!(
        f.call(json!({"op":"register","thread_id":"live-thread"}))["session_id"],
        *session
    );
    let send = json!({"op":"send","session_id":session,"request_id":"first","message":"hello"});
    assert_eq!(f.call(send.clone())["state"], "accepted");
    assert_eq!(f.call(send)["native_turn_id"], "turn-1");
    assert!(
        client(
            &f.dir,
            json!({"op":"send","session_id":session,"request_id":"first","message":"changed"})
        )
        .is_err()
    );
    wait(|| {
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "turn.completed")
    });
    let recorded = f.events();
    assert!(!recorded.to_string().contains("EXCLUDED_SECRET"));
    assert_eq!(
        recorded["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["type"] == "message")
            .count(),
        2
    );
    assert_eq!(*f.sends.lock().unwrap(), 1);
    // Client disconnect before a response must not terminate capture.
    let mut caller = UnixStream::connect(f.dir.join("service.sock")).unwrap();
    writeln!(
        caller,
        "{}",
        json!({"op":"send","session_id":session,"request_id":"second","message":"after disconnect"})
    )
    .unwrap();
    drop(caller);
    wait(|| {
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["native_turn_id"] == "turn-2" && e["type"] == "turn.completed")
    });
    let cursor = f.events()["cursor"].clone();
    f.halt();
    assert_eq!(
        Codex::connect(&f.socket).unwrap().loaded().unwrap(),
        vec!["live-thread"]
    );
    f.start();
    assert_ne!(f.call(json!({"op":"status"}))["instance"], instance);
    assert_eq!(f.call(json!({"op":"list"}))[0]["capture"], "disconnected");
    assert!(
        f.call(json!({"op":"events","after":cursor}))["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "capture.gap")
    );
    assert_eq!(
        f.call(json!({"op":"register","thread_id":"live-thread"}))["session_id"],
        *session
    );
    // Lost ACK must remain uncertain and must never submit again on retry.
    let uncertain =
        json!({"op":"send","session_id":session,"request_id":"uncertain","message":"disconnect"});
    assert!(client(&f.dir, uncertain.clone()).is_err());
    assert_eq!(f.call(uncertain)["state"], "uncertain");
    assert_eq!(*f.sends.lock().unwrap(), 3);
    wait(|| f.call(json!({"op":"status"}))["codex_connected"] == false);
    assert!(
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["payload"]["reason"] == "codex_disconnected")
    );
}

#[test]
fn interrupted_launch_is_unknown_and_never_automatically_replaced() {
    let mut f = Fixture::new();
    let db = f.dir.join("events.sqlite");
    let store = Store::open(&db).unwrap();
    fs::set_permissions(&db, fs::Permissions::from_mode(0o600)).unwrap();
    let parent = store
        .register(f.socket.to_str().unwrap(), &metadata("live-thread"))
        .unwrap();
    // Reachable crash point: intent committed, worker launch not yet acknowledged.
    store
        .begin_launch(
            "interrupted",
            &parent,
            f.dir.to_str().unwrap(),
            "original task",
        )
        .unwrap();
    drop(store);
    f.start();
    f.call(json!({"op":"register","thread_id":"live-thread"}));
    let old=f.call(json!({"op":"launch","parent_id":parent,"request_id":"interrupted","cwd":f.dir,"prompt":"original task"}));
    assert_eq!(old["state"], "unknown");
    assert!(old["session_id"].is_null());
    assert!(client(&f.dir,json!({"op":"launch","parent_id":parent,"request_id":"replacement","cwd":f.dir,"prompt":"another task"})).is_err());
    assert_eq!(f.call(json!({"op":"status"}))["owns_agents"], false);
    f.halt();
}

#[test]
fn owned_worker_survives_clients_and_requires_explicit_stop() {
    let mut f = Fixture::new();
    f.start();
    let parent = f.call(json!({"op":"register","thread_id":"live-thread"}))["session_id"].clone();
    let launch = json!({"op":"launch","parent_id":parent,"request_id":"worker-1","cwd":f.dir,"prompt":"read the fixture"});
    let receipt = f.call(launch.clone());
    assert_eq!(receipt["state"], "running");
    assert_eq!(receipt["initial_request"]["state"], "accepted");
    let session = receipt["session_id"].clone();
    assert_eq!(f.call(launch)["pid"], receipt["pid"]);
    assert!(client(&f.dir,json!({"op":"launch","parent_id":parent,"request_id":"worker-1","cwd":f.dir,"prompt":"changed"})).is_err());
    assert!(client(&f.dir,json!({"op":"launch","parent_id":parent,"request_id":"worker-2","cwd":f.dir,"prompt":"second"})).is_err());
    assert!(client(&f.dir, json!({"op":"stop"})).is_err());
    assert!(client(&f.dir, json!({"op":"stop-worker","session_id":parent})).is_err());
    let info = f.call(json!({"op":"attach-info","session_id":session}));
    assert_eq!(info["pid"], receipt["pid"]);
    let socket = info["args"][1]
        .as_str()
        .unwrap()
        .strip_prefix("unix://")
        .unwrap();
    let mut terminal = Codex::connect(Path::new(socket)).unwrap();
    assert_eq!(
        terminal.metadata("worker-thread").unwrap()["status"]["type"],
        "active"
    );
    drop(terminal); // Native transport client leaves while the task is active.
    wait(|| {
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["session_id"] == session && e["type"] == "turn.completed")
    });
    let mut reconnected = Codex::connect(Path::new(socket)).unwrap();
    assert_eq!(
        reconnected.metadata("worker-thread").unwrap()["status"]["type"],
        "idle"
    );
    assert_eq!(
        f.call(json!({"op":"attach-info","session_id":session}))["pid"],
        receipt["pid"]
    );
    let rows = f.call(json!({"op":"list"}));
    let worker = rows
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == session)
        .unwrap();
    assert_eq!(worker["ownership"], "managed");
    assert_eq!(worker["parent_id"], parent);
    // Known-different arm: explicit stop during a second turn ends the owned server.
    f.call(json!({"op":"send","session_id":session,"request_id":"second-turn","message":"still working"}));
    assert_eq!(
        f.call(json!({"op":"stop-worker","session_id":session}))["state"],
        "stopped"
    );
    assert!(reconnected.metadata("worker-thread").is_err());
    assert_eq!(f.call(json!({"op":"status"}))["owns_agents"], false);
    let events = f.events();
    assert!(
        !events["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["native_turn_id"] == "worker-turn-2" && e["type"] == "turn.completed")
    );
    assert!(
        events["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "worker.stopped")
    );
    // The external parent server still responds; stopping the worker did not touch it.
    assert_eq!(f.call(json!({"op":"discover"}))[0]["id"], "live-thread");
    f.halt();
}

#[test]
fn lost_observation_during_rpc_marks_a_gap_even_with_an_open_transport() {
    for message in ["malformed", "overflow"] {
        let mut f = Fixture::new();
        f.start();
        let registration = f.call(json!({"op":"register","thread_id":"live-thread"}));
        let request = json!({"op":"send","session_id":registration["session_id"],"request_id":"lost","message":message});
        assert!(client(&f.dir, request.clone()).is_err());
        wait(|| f.call(json!({"op":"status"}))["codex_connected"] == false);
        assert_eq!(f.call(request)["state"], "uncertain");
        assert_eq!(*f.sends.lock().unwrap(), 1);
        assert!(
            f.events()["events"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["type"] == "capture.gap")
        );
    }
}

#[test]
fn source_ids_deduplicate_and_unicode_truncation_is_explicit() {
    let store = Store::open(Path::new(":memory:")).unwrap();
    let session = store.register("fixture", &metadata("live-thread")).unwrap();
    let event = note(
        "item/completed",
        json!({"threadId":"live-thread","turnId":"turn","completedAtMs":42,"item":{"id":"answer","type":"agentMessage","text":"é".repeat(20000)}}),
    );
    for _ in 0..2 {
        store
            .record(&session, events::normalize(&event).unwrap())
            .unwrap();
    }
    let values = store.events(0).unwrap();
    let messages: Vec<_> = values["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["type"] == "message")
        .collect();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["payload"]["truncated"], true);
    assert!(messages[0]["payload"]["text"].as_str().unwrap().len() <= events::TEXT_LIMIT);
    assert_eq!(messages[0]["occurred_ms"], 42);
}
