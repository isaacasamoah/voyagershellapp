use serde_json::{Value, json};
use std::{
    fs,
    io::{self, BufRead, BufReader, Write},
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

#[test]
fn cli_option_spelling_in_message_or_name_remains_data() {
    let mut f = Fixture::new();
    f.start();
    let registration = f.call(json!({"op":"register","thread_id":"live-thread"}));
    let output = Command::new(env!("CARGO_BIN_EXE_voyager"))
        .args([
            "--state",
            f.dir.to_str().unwrap(),
            "send",
            registration["session_id"].as_str().unwrap(),
            "cli-data",
            "--background",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let reply: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(reply["message"], "--background");
    let output = Command::new(env!("CARGO_BIN_EXE_voyager"))
        .args([
            "--state",
            f.dir.to_str().unwrap(),
            "create",
            "shell",
            "cli-name",
            "--background",
            f.dir.to_str().unwrap(),
            "--background",
            "--terminal",
            "ghostty",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let reply: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(reply["name"], "--background");
    assert_eq!(reply["window"], "closed");
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
                                    "thread/loaded/list" => json!({"data":["live-thread","other-thread"],"nextCursor":null}),
                                    "thread/read" => json!({"thread":metadata(p["threadId"].as_str().unwrap())}),
                                    "thread/resume" => {
                                        assert_eq!(p["excludeTurns"],true);
                                        assert_eq!(p.as_object().unwrap().len(),2);
                                        json!({"thread":metadata(p["threadId"].as_str().unwrap())})
                                    }
                                    "turn/start" => {
                                        assert_eq!(p["threadId"],"live-thread");
                                        assert_eq!(p.as_object().unwrap().len(),3);
                                        let count={ let mut c=count.lock().unwrap(); *c+=1; *c };
                                        let message=p["input"][0]["text"].as_str().unwrap();
                                        if message=="disconnect" { break; }
                                        if message=="malformed" {
                                            let _=ws.send(Message::Text("not JSON".into()));
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
        self.start_with_voice("0");
    }
    fn start_with_voice(&mut self, voice: &str) {
        self.service = Some(
            Command::new(env!("CARGO_BIN_EXE_voyager"))
                .env("VOYAGER_VOICE_FOLLOWS_DOCK", voice)
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
    fn call(&self, mut v: Value) -> Value {
        if [
            "open",
            "background",
            "stop-instance",
            "remove",
            "register-instance",
        ]
        .contains(&v["op"].as_str().unwrap_or(""))
            && v["request_id"].is_null()
        {
            v["request_id"] = json!(uuid::Uuid::new_v4().to_string());
        }
        let mut receipt = client(&self.dir, v).unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        while receipt["state"] == "pending" {
            assert!(
                Instant::now() < deadline,
                "pending operation timed out: {receipt}"
            );
            thread::sleep(Duration::from_millis(20));
            receipt = client(
                &self.dir,
                json!({"op":"operation","request_id":receipt["request_id"]}),
            )
            .unwrap();
        }
        receipt
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
                            json!({"op":"stop-instance","session_id":session["id"]}),
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
    let connection = f.call(json!({"op":"connection-info"}));
    assert_eq!(connection["server"], f.socket.to_str().unwrap());
    assert_eq!(connection["pid"], std::process::id());
    assert!(f.call(json!({"op":"list"})).as_array().unwrap().is_empty());
    assert!(
        f.call(json!({"op":"events","after":0}))["events"]
            .as_array()
            .unwrap()
            .is_empty()
    );
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
        vec!["live-thread", "other-thread"]
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
fn named_instance_starts_without_parent_prompt_or_external_server() {
    let mut f = Fixture::new();
    f.service = Some(
        Command::new(env!("CARGO_BIN_EXE_voyager"))
            .env(
                "VOYAGER_CODEX_BIN",
                concat!(env!("CARGO_MANIFEST_DIR"), "/tests/worker_server.py"),
            )
            .args(["--state", f.dir.to_str().unwrap(), "serve"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    wait(|| client(&f.dir, json!({"op":"status"})).is_ok());
    assert_eq!(f.call(json!({"op":"status"}))["capturing"], 0);
    assert_eq!(f.call(json!({"op":"list"})), json!([]));
    let create = json!({"op":"create","open":false,"kind":"codex","request_id":"named-1","name":"My agent","cwd":f.dir});
    let mut invalid = create.clone();
    invalid["cwd"] = json!(f.dir.join("not-a-directory"));
    assert!(client(&f.dir, invalid).is_err());
    assert!(f.call(json!({"op":"list"})).as_array().unwrap().is_empty());
    let receipt = f.call(create.clone());
    let session = &receipt["session_id"];
    assert!(receipt["parent_id"].is_null());
    assert!(receipt["prompt"].is_null());
    assert_eq!(receipt["name"], "My agent");
    assert_eq!(f.call(create.clone()), receipt);
    let mut conflicting = create.clone();
    conflicting["name"] = json!("Different agent");
    assert!(client(&f.dir, conflicting).is_err());
    let listed = f.call(json!({"op":"list"}));
    assert_eq!(listed[0]["ownership"], "managed");
    assert_eq!(listed[0]["name"], "My agent");
    assert_eq!(listed[0]["capture"], "connected");
    assert!(f.call(json!({"op":"status"}))["control"].is_null());
    assert_eq!(
        f.call(json!({"op":"attach-info","session_id":session}))["session_id"],
        *session
    );
    assert!(
        !f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "message" || e["type"] == "turn.started")
    );
    assert!(
        client(
            &f.dir,
            json!({"op":"open","session_id":session,"terminal":"unimplemented"})
        )
        .is_err()
    );
    f.call(json!({"op":"send","session_id":session,"request_id":"real-first-task","message":"first actual request"}));
    wait(|| {
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "turn.completed")
    });
    assert!(client(&f.dir, json!({"op":"stop"})).is_err());
    f.call(json!({"op":"stop-instance","session_id":session}));
    assert_eq!(f.call(create)["state"], "completed");
    assert_eq!(f.call(json!({"op":"list"}))[0]["worker_state"], "stopped");
    f.halt();
}

#[test]
fn missing_native_executable_leaves_failed_creation_without_registration() {
    let mut f = Fixture::new();
    f.service = Some(
        Command::new(env!("CARGO_BIN_EXE_voyager"))
            .env("VOYAGER_CODEX_BIN", f.dir.join("missing-codex"))
            .args(["--state", f.dir.to_str().unwrap(), "serve"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    wait(|| client(&f.dir, json!({"op":"status"})).is_ok());
    let create = json!({"op":"create","open":false,"kind":"codex","request_id":"unavailable","name":"My agent","cwd":f.dir});
    assert_eq!(client(&f.dir, create.clone()).unwrap()["state"], "partial");
    let failed = f.call(create);
    assert_eq!(failed["state"], "partial");
    assert!(failed["session_id"].is_null());
    assert!(failed["pid"].is_null());
    assert_eq!(f.call(json!({"op":"list"})), json!([]));
    assert_eq!(f.call(json!({"op":"status"}))["capturing"], 0);
    assert_eq!(f.call(json!({"op":"status"}))["owns_agents"], false);
    assert!(f.events()["events"].as_array().unwrap().is_empty());
    f.halt();
}

#[test]
fn worker_schema_upgrade_preserves_attribution_and_events() {
    let f = Fixture::new();
    let path = f.dir.join("events.sqlite");
    let store = Store::open(&path).unwrap();
    let parent = store.register("fixture", &metadata("parent")).unwrap();
    store
        .0
        .execute_batch(
            "DROP TABLE workers;
        CREATE TABLE workers (
            launch_id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES sessions(id),
            cwd TEXT NOT NULL, prompt TEXT NOT NULL, state TEXT NOT NULL,
            session_id TEXT UNIQUE REFERENCES sessions(id), pid INTEGER);",
        )
        .unwrap();
    store
        .0
        .execute(
            "INSERT INTO workers VALUES ('old',?1,'/synthetic','original task','failed',NULL,NULL)",
            [&parent],
        )
        .unwrap();
    let before = store.events(0).unwrap();
    drop(store);
    let store = Store::open(&path).unwrap();
    let old = store.launch("old").unwrap().unwrap();
    assert_eq!(old["parent_id"], parent);
    assert_eq!(old["prompt"], "original task");
    assert!(old["name"].is_null());
    assert_eq!(store.events(0).unwrap(), before);
    store
        .begin_launch("new", None, "/synthetic", None, Some("Named instance"))
        .unwrap();
    drop(store);
    let reopened = Store::open(&path).unwrap();
    assert_eq!(
        reopened.launch("new").unwrap().unwrap()["name"],
        "Named instance"
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
    store
        .begin_launch(
            "interrupted",
            Some(&parent),
            f.dir.to_str().unwrap(),
            Some("original task"),
            None,
        )
        .unwrap();
    drop(store);
    f.start();
    f.call(json!({"op":"register","thread_id":"live-thread"}));
    assert!(client(&f.dir,json!({"op":"launch","open":false,"parent_id":parent,"request_id":"interrupted","cwd":f.dir,"prompt":"original task"})).is_err());
    assert!(client(&f.dir,json!({"op":"launch","open":false,"parent_id":parent,"request_id":"replacement","cwd":f.dir,"prompt":"another task"})).is_err());
    assert_eq!(f.call(json!({"op":"status"}))["owns_agents"], false);
    f.halt();
}

#[test]
fn owned_worker_survives_clients_and_requires_explicit_stop() {
    let mut f = Fixture::new();
    f.start();
    let parent = f.call(json!({"op":"register","thread_id":"live-thread"}))["session_id"].clone();
    let launch = json!({"op":"launch","open":false,"parent_id":parent,"request_id":"worker-1","cwd":f.dir,"prompt":"read the fixture"});
    let receipt = f.call(launch.clone());
    assert_eq!(receipt["state"], "completed");
    assert_eq!(receipt["runtime"], "running");
    assert_eq!(receipt["initial_request"]["state"], "accepted");
    let session = receipt["session_id"].clone();
    assert_eq!(f.call(launch)["runtime_pid"], receipt["runtime_pid"]);
    assert!(client(&f.dir,json!({"op":"launch","open":false,"parent_id":parent,"request_id":"worker-1","cwd":f.dir,"prompt":"changed"})).is_err());
    let second = f.call(json!({"op":"launch","open":false,"parent_id":parent,"request_id":"worker-2","cwd":f.dir,"prompt":"second"}));
    assert_ne!(second["session_id"], session);
    assert_ne!(second["runtime_pid"], receipt["runtime_pid"]);
    f.call(json!({"op":"stop-instance","session_id":second["session_id"]}));
    assert!(
        f.call(json!({"op":"status"}))["owns_agents"]
            .as_bool()
            .unwrap()
    );
    assert!(client(&f.dir, json!({"op":"stop"})).is_err());
    assert!(client(&f.dir, json!({"op":"stop-instance","session_id":parent})).is_err());
    let info = f.call(json!({"op":"attach-info","session_id":session}));
    assert_eq!(info["pid"], receipt["runtime_pid"]);
    assert_eq!(
        info["args"],
        json!([
            "--remote",
            info["args"][1],
            "resume",
            "worker-thread",
            "--no-alt-screen"
        ])
    );
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
        receipt["runtime_pid"]
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
    f.call(json!({"op":"send","session_id":session,"request_id":"second-turn","message":"still working"}));
    assert_eq!(
        f.call(json!({"op":"stop-instance","session_id":session}))["runtime"],
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
    assert_eq!(f.call(json!({"op":"discover"}))[0]["id"], "live-thread");
    f.halt();
}

#[test]
fn invalid_frames_mark_a_gap_and_filtered_bursts_keep_capture_responsive() {
    for message in ["malformed", "overflow"] {
        let mut f = Fixture::new();
        f.start();
        let registration = f.call(json!({"op":"register","thread_id":"live-thread"}));
        let request = json!({"op":"send","session_id":registration["session_id"],"request_id":"lost","message":message});
        assert!(client(&f.dir, request.clone()).is_err());
        if message == "malformed" {
            wait(|| f.call(json!({"op":"status"}))["codex_connected"] == false);
        } else {
            assert_eq!(f.call(json!({"op":"status"}))["codex_connected"], true);
        }
        assert_eq!(f.call(request)["state"], "uncertain");
        assert_eq!(*f.sends.lock().unwrap(), 1);
        let gap = f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "capture.gap");
        assert_eq!(gap, message == "malformed");
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
            .record(&session, 1, events::normalize(&event).unwrap())
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

fn process_claim(pid: u32) -> Value {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let start = stat
        .rsplit_once(')')
        .unwrap()
        .1
        .split_whitespace()
        .nth(19)
        .unwrap();
    json!({"pid":pid,"start":start})
}

fn dock_request(session: &Value, window: u32, process: Value) -> Value {
    json!({"op":"dock","session_id":session,"generation":uuid::Uuid::new_v4().to_string(),
        "window_id":window,"terminal":process,"frontend":process})
}

fn open_control(f: &Fixture, request: &Value) -> (UnixStream, Value) {
    let mut socket = UnixStream::connect(f.dir.join("service.sock")).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    writeln!(socket, "{request}").unwrap();
    let mut line = String::new();
    BufReader::new(&socket).read_line(&mut line).unwrap();
    let reply: Value = serde_json::from_str(&line).unwrap();
    assert!(reply.get("error").is_none(), "{reply}");
    (socket, reply["result"].clone())
}

#[test]
fn control_switch_stale_release_disconnect_and_capture_are_independent() {
    let mut f = Fixture::new();
    f.start_with_voice("1");
    let session = f.call(json!({"op":"register","thread_id":"live-thread"}))["session_id"].clone();
    let a = dock_request(&session, 1, process_claim(std::process::id()));
    let (old, ack) = open_control(&f, &a);
    assert_eq!(ack["active"], true);
    assert_eq!(ack["voice"]["state"], "unsupported");
    assert_eq!(
        f.call(json!({"op":"status"}))["control"]["generation"],
        a["generation"]
    );
    let (retry, again) = open_control(&f, &a);
    assert_eq!(ack, again);
    drop(old); // Closing the replaced connection cannot clear the retried claim.
    assert_eq!(
        f.call(json!({"op":"status"}))["control"]["generation"],
        a["generation"]
    );
    let mut conflict = a.clone();
    conflict["window_id"] = json!(99);
    assert!(client(&f.dir, conflict).is_err());
    let mut reused_pid = dock_request(&session, 2, process_claim(std::process::id()));
    reused_pid["frontend"]["start"] = json!("0");
    assert!(client(&f.dir, reused_pid).is_err());
    let other = f.call(json!({"op":"register","thread_id":"other-thread"}))["session_id"].clone();
    let b = dock_request(&other, 2, process_claim(std::process::id()));
    let (current, _) = open_control(&f, &b);
    assert_eq!(
        f.call(json!({"op":"undock","generation":a["generation"]}))["released"],
        false
    );
    drop(retry);
    assert_eq!(f.call(json!({"op":"status"}))["control"]["window_id"], 2);
    let stale = json!({"op":"send","session_id":session,"request_id":"stale","message":"hello","control_generation":a["generation"]});
    assert!(client(&f.dir, stale).is_err());
    assert_eq!(*f.sends.lock().unwrap(), 0);
    assert_eq!(f.call(json!({"op":"send","session_id":session,"request_id":"current","message":"hello","control_generation":b["generation"]}))["state"], "accepted");
    drop(current); // Simulate abrupt UI loss; no explicit undock command.
    wait(|| f.call(json!({"op":"status"}))["control"].is_null());
    assert_eq!(f.call(json!({"op":"list"}))[0]["capture"], "connected");
    f.call(
        json!({"op":"send","session_id":session,"request_id":"detached","message":"still working"}),
    );
    wait(|| {
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["native_turn_id"] == "turn-2" && e["type"] == "turn.completed")
    });
    let (_, ended) = open_control(&f, &b);
    assert_eq!(
        ended["active"], false,
        "retry after release must not reacquire control"
    );
    let events = f.events();
    let control: Vec<_> = events["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["type"].as_str().unwrap().starts_with("interface."))
        .collect();
    assert_eq!(control.len(), 4);
    assert_eq!(control[0]["type"], "interface.docked");
    assert_eq!(control[1]["payload"]["reason"], "switched");
    assert_eq!(control[2]["payload"]["attachment"]["window_id"], 2);
    assert_eq!(control[3]["payload"]["reason"], "interface_disconnected");
}

#[test]
fn control_release_is_durable_and_restart_never_restores_authority() {
    let mut f = Fixture::new();
    f.start();
    assert_eq!(f.call(json!({"op":"status"}))["voice"]["state"], "disabled");
    let session = f.call(json!({"op":"register","thread_id":"live-thread"}))["session_id"].clone();
    let a = dock_request(&session, 1, process_claim(std::process::id()));
    let (_socket, _) = open_control(&f, &a);
    assert_eq!(
        f.call(json!({"op":"undock","generation":a["generation"]}))["released"],
        true
    );
    assert_eq!(
        f.call(json!({"op":"undock","generation":a["generation"]}))["released"],
        false
    );
    let b = dock_request(&session, 2, process_claim(std::process::id()));
    let (_socket, _) = open_control(&f, &b);
    let mut service = f.service.take().unwrap();
    service.kill().unwrap();
    service.wait().unwrap();
    f.start();
    assert!(f.call(json!({"op":"status"}))["control"].is_null());
    f.call(json!({"op":"register","thread_id":"live-thread"}));
    let (_, retry) = open_control(&f, &b);
    assert_eq!(retry["active"], false);
    assert!(
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "interface.undocked"
                && e["payload"]["reason"] == "service_restarted")
    );
    let c = dock_request(&session, 3, process_claim(std::process::id()));
    let (_socket, _) = open_control(&f, &c);
    f.halt();
    let stored = Store::open(&f.dir.join("events.sqlite"))
        .unwrap()
        .events(0)
        .unwrap();
    assert!(
        stored["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "interface.undocked"
                && e["payload"]["reason"] == "service_stopped")
    );
}

#[test]
fn closing_terminal_releases_control_without_stopping_external_server() {
    let mut f = Fixture::new();
    f.start();
    let session = f.call(json!({"op":"register","thread_id":"live-thread"}))["session_id"].clone();
    let mut process = Command::new("sleep").arg("30").spawn().unwrap();
    let a = dock_request(&session, 1, process_claim(process.id()));
    let (_socket, _) = open_control(&f, &a);
    process.kill().unwrap();
    process.wait().unwrap();
    wait(|| f.call(json!({"op":"status"}))["control"].is_null());
    assert_eq!(f.call(json!({"op":"status"}))["capturing"], 1);
    assert!(
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["payload"]["reason"] == "terminal_closed")
    );
}

#[test]
fn managed_shell_shares_human_state_and_survives_detach_with_input_exclusion() {
    let mut f = Fixture::new();
    f.start();
    let create = json!({"op":"create","open":false,"kind":"shell","request_id":"shell-1","name":"Workbench","cwd":f.dir});
    let receipt = f.call(create.clone());
    let session = &receipt["session_id"];
    assert_eq!(f.call(create), receipt);
    let info = f.call(json!({"op":"attach-info","session_id":session}));
    let mut terminal = UnixStream::connect(info["socket"].as_str().unwrap()).unwrap();
    let ready = || f.call(json!({"op":"shell-read","session_id":session}))["ready"] == true;
    wait(ready);
    let command = b"export SHARED_PROOF=from_human; mkdir child; cd child\n";
    writeln!(terminal, "{}", json!({"input":command.to_vec()})).unwrap();
    wait(|| {
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "shell.completed")
    });
    f.call(json!({"op":"shell-exec","session_id":session,"request_id":"verify","command":"printf '%s %s\\n' \"$SHARED_PROOF\" \"$PWD\""}));
    wait(ready);
    let output = f.call(json!({"op":"shell-read","session_id":session}));
    assert!(
        output["text"]
            .as_str()
            .unwrap()
            .contains(&format!("from_human {}/child", f.dir.display()))
    );
    writeln!(terminal, "{}", json!({"input":b"echo unfinished".to_vec()})).unwrap();
    wait(|| !ready());
    assert!(client(&f.dir,json!({"op":"shell-exec","session_id":session,"request_id":"must-refuse","command":"touch should-not-exist"})).is_err());
    writeln!(terminal, "{}", json!({"input":vec![3u8]})).unwrap();
    wait(ready);
    let delayed = json!({"op":"shell-exec","session_id":session,"request_id":"delayed","command":"sleep 0.3; printf survived > proof.txt"});
    let accepted = f.call(delayed.clone());
    assert_eq!(f.call(delayed), accepted); // Never replay the same command.
    assert!(client(&f.dir,json!({"op":"shell-exec","session_id":session,"request_id":"busy","command":"echo wrong"})).is_err());
    drop(terminal);
    wait(|| f.dir.join("child/proof.txt").exists());
    wait(ready);
    assert_eq!(
        fs::read_to_string(f.dir.join("child/proof.txt")).unwrap(),
        "survived"
    );
    assert!(!f.dir.join("child/should-not-exist").exists());
    assert_eq!(
        f.call(json!({"op":"attach-info","session_id":session}))["pid"],
        receipt["runtime_pid"]
    );
    let mut again = UnixStream::connect(info["socket"].as_str().unwrap()).unwrap();
    again
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut response = String::new();
    BufReader::new(&mut again).read_line(&mut response).unwrap();
    assert!(serde_json::from_str::<Value>(&response).unwrap()["output"].is_array());
    let events = f.events();
    assert!(
        events["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "shell.command"
                && e["payload"]["actor"] == "human"
                && e["capture_policy"] == "shell-commands-v1")
    );
    assert!(
        events["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "shell.completed"
                && e["payload"]["command_id"] == "verify"
                && e["payload"]["exit_code"] == 0)
    );
    f.call(json!({"op":"shell-exec","session_id":session,"request_id":"typeahead","command":"sleep 0.2"}));
    writeln!(again, "{}", json!({"input":b"echo still editing".to_vec()})).unwrap();
    wait(|| {
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "shell.completed" && e["payload"]["command_id"] == "typeahead")
    });
    assert!(client(&f.dir,json!({"op":"shell-exec","session_id":session,"request_id":"typeahead-refused","command":"echo wrong"})).is_err());
    writeln!(again, "{}", json!({"input":vec![3u8]})).unwrap();
    wait(ready);
    f.call(json!({"op":"shell-exec","session_id":session,"request_id":"stop-live","command":"sleep 0.3; touch should-not-complete"}));
    wait(|| {
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "shell.command" && e["payload"]["command_id"] == "stop-live")
    });
    f.call(json!({"op":"stop-instance","session_id":session}));
    thread::sleep(Duration::from_millis(350));
    assert!(!f.dir.join("child/should-not-complete").exists());
    assert!(client(&f.dir,json!({"op":"shell-exec","session_id":session,"request_id":"ended","command":"echo wrong"})).is_err());
    f.halt();
}

#[test]
fn capture_generation_cutoff_drops_removed_and_old_subscription_payloads() {
    let store = Store::open(Path::new(":memory:")).unwrap();
    let session = store.register("fixture", &metadata("live-thread")).unwrap();
    let observation = |marker: &str| {
        events::normalize(&note("item/completed",json!({"threadId":"live-thread","turnId":"t","item":{"id":marker,"type":"agentMessage","text":marker}}))).unwrap()
    };
    store.record(&session, 1, observation("BEFORE")).unwrap();
    store.0.execute_batch("CREATE TRIGGER reject_remove BEFORE INSERT ON events WHEN NEW.kind='session.removed' BEGIN SELECT RAISE(ABORT,'test write failure'); END;").unwrap();
    assert!(store.remove(&session).is_err());
    assert_eq!(store.generation(&session).unwrap(), Some(1));
    assert!(store.session(&session).unwrap()["removed_ms"].is_null());
    store.0.execute_batch("DROP TRIGGER reject_remove").unwrap();
    store.remove(&session).unwrap();
    store.record(&session, 1, observation("AFTER")).unwrap();
    let generation = store.reactivate(&session).unwrap();
    store
        .record(&session, 1, observation("OLD_QUEUED_FRAME"))
        .unwrap();
    store
        .record(&session, generation, observation("NEW"))
        .unwrap();
    let events = store.events(0).unwrap();
    let text = events["events"].to_string();
    assert!(text.contains("BEFORE") && text.contains("NEW"));
    assert!(!text.contains("AFTER") && !text.contains("OLD_QUEUED_FRAME"));
}

#[test]
fn lifecycle_remove_and_register_preserves_a_real_bash_and_history() {
    let mut f = Fixture::new();
    f.start();
    let created=f.call(json!({"op":"create","kind":"shell","open":false,"request_id":"shell-remove","name":"Workbench","cwd":f.dir}));
    let session = created["session_id"].as_str().unwrap();
    let info = f.call(json!({"op":"attach-info","session_id":session}));
    let mut viewer = UnixStream::connect(info["socket"].as_str().unwrap()).unwrap();
    wait(|| f.call(json!({"op":"shell-read","session_id":session}))["ready"] == true);
    f.call(json!({"op":"shell-exec","session_id":session,"request_id":"before","command":"printf BEFORE"}));
    wait(|| f.call(json!({"op":"shell-read","session_id":session}))["ready"] == true);
    let remove = json!({"op":"remove","session_id":session,"request_id":"remove-shell"});
    let receipt = f.call(remove.clone());
    assert_eq!(receipt["registration"], "removed");
    assert_eq!(receipt["runtime"], "running");
    assert_eq!(f.call(remove), receipt);
    assert!(
        !f.call(json!({"op":"list"}))
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["id"] == session)
    );
    assert!(client(&f.dir, json!({"op":"shell-read","session_id":session})).is_err());
    assert!(client(&f.dir,json!({"op":"shell-exec","session_id":session,"request_id":"forbidden","command":"echo FORBIDDEN"})).is_err());
    writeln!(
        viewer,
        "{}",
        json!({"input":b"printf AFTER > removed-work.txt\n".to_vec()})
    )
    .unwrap();
    wait(|| f.dir.join("removed-work.txt").exists());
    thread::sleep(Duration::from_millis(100));
    let restored = f
        .call(json!({"op":"register-instance","session_id":session,"request_id":"register-shell"}));
    assert_eq!(restored["state"], "completed");
    assert_eq!(
        f.call(json!({"op":"attach-info","session_id":session}))["pid"],
        info["pid"]
    );
    f.call(
        json!({"op":"shell-exec","session_id":session,"request_id":"new","command":"printf NEW"}),
    );
    wait(|| f.call(json!({"op":"shell-read","session_id":session}))["ready"] == true);
    let events = f.events()["events"].to_string();
    assert!(events.contains("BEFORE") && events.contains("NEW"));
    assert!(!events.contains("AFTER"));
    let stop = f.call(
        json!({"op":"remove","session_id":session,"stop":true,"request_id":"stop-remove-shell"}),
    );
    assert_eq!(stop["runtime"], "stopped");
    assert_eq!(stop["registration"], "removed");
    f.halt();
}

#[test]
fn lifecycle_stop_wait_keeps_other_capture_and_status_responsive() {
    let mut f = Fixture::new();
    f.start();
    let make = |id: &str| {
        f.call(json!({"op":"create","kind":"shell","open":false,"request_id":id,"name":id,"cwd":f.dir}))
    };
    let a = make("a");
    let b = make("b");
    for s in [&a, &b] {
        wait(|| f.call(json!({"op":"shell-read","session_id":s["session_id"]}))["ready"] == true);
    }
    f.call(json!({"op":"shell-exec","session_id":a["session_id"],"request_id":"hold","command":"trap '' HUP"}));
    wait(|| f.call(json!({"op":"shell-read","session_id":a["session_id"]}))["ready"] == true);
    let stop = json!({"op":"stop-instance","session_id":a["session_id"],"request_id":"stop-a"});
    assert_eq!(client(&f.dir, stop.clone()).unwrap()["state"], "pending");
    let started = Instant::now();
    f.call(json!({"op":"status"}));
    assert!(started.elapsed() < Duration::from_secs(1));
    f.call(json!({"op":"shell-exec","session_id":b["session_id"],"request_id":"live-b","command":"printf STILL_CAPTURING"}));
    wait(|| f.events()["events"].to_string().contains("STILL_CAPTURING"));
    assert_eq!(
        f.call(json!({"op":"operation","request_id":"stop-a"}))["runtime"],
        "stopped"
    );
    assert_eq!(f.call(stop)["state"], "completed");
    f.call(json!({"op":"stop-instance","session_id":b["session_id"]}));
    f.halt();
}

#[test]
fn migration_version_boundary_preserves_data_after_failure_and_refuses_future_schema() {
    let dir = std::env::temp_dir().join(format!("voyager-migration-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let store = Store::open(&path).unwrap();
    let session = store.register("fixture", &metadata("live-thread")).unwrap();
    store
        .local(&session, "before", json!({"marker":"PRESERVED"}))
        .unwrap();
    store.0.execute_batch("PRAGMA user_version=0; ALTER TABLE sessions DROP COLUMN removed_ms; ALTER TABLE sessions DROP COLUMN capture_generation;").unwrap();
    drop(store);
    assert!(Store::open(&path).is_err());
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM pragma_table_info('sessions') WHERE name='removed_ms'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert!(
        db.query_row("SELECT payload FROM events WHERE kind='before'", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap()
        .contains("PRESERVED")
    );
    db.execute_batch("PRAGMA user_version=999;").unwrap();
    assert!(Store::open(&path).is_err());
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        999
    );
    drop(db);
    fs::remove_dir_all(dir).unwrap();
}
