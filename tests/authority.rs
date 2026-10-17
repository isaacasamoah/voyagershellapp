use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::unix::{fs::PermissionsExt, net::UnixStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

struct Service {
    dir: PathBuf,
    child: Child,
}
impl Service {
    fn start() -> Self {
        let dir = std::env::temp_dir().join(format!("va-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        Self::start_at(dir)
    }
    fn start_at(dir: PathBuf) -> Self {
        let child = Command::new(env!("CARGO_BIN_EXE_voyager"))
            .env(
                "VOYAGER_CODEX_BIN",
                concat!(env!("CARGO_MANIFEST_DIR"), "/tests/worker_server.py"),
            )
            .args(["--state", dir.to_str().unwrap(), "serve"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let service = Self { dir, child };
        let deadline = Instant::now() + Duration::from_secs(5);
        while !service.dir.join("service.sock").exists() {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(10));
        }
        service
    }
    fn raw(&self, instance: Option<&Value>, mut request: Value) -> Value {
        if let Some(credential) = instance {
            request["credential"] = credential.clone();
        }
        let mut stream = UnixStream::connect(self.dir.join(if instance.is_some() {
            "instances.sock"
        } else {
            "service.sock"
        }))
        .unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(12)))
            .unwrap();
        writeln!(stream, "{request}").unwrap();
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    }
    fn owner(&self, request: Value) -> Value {
        let reply = self.raw(None, request);
        assert!(reply.get("error").is_none(), "{reply}");
        reply["result"].clone()
    }
    fn agent(&self, credential: &Value, request: Value) -> Value {
        let reply = self.raw(Some(credential), request);
        assert!(reply.get("error").is_none(), "{reply}");
        reply["result"].clone()
    }
    fn finish(&self, mut receipt: Value) -> Value {
        let deadline = Instant::now() + Duration::from_secs(12);
        while receipt["state"] == "pending" {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(20));
            receipt = self.owner(json!({"op":"operation","request_id":receipt["request_id"]}));
        }
        assert_eq!(receipt["state"], "completed", "{receipt}");
        receipt
    }
    fn create(&self, id: &str, kind: &str, rank: Option<&str>) -> String {
        let mut request = json!({"op":"create","kind":kind,"name":id,"cwd":self.dir,"request_id":id,"open":false});
        if let Some(rank) = rank {
            request["rank"] = json!(rank);
        }
        self.finish(self.owner(request))["session_id"]
            .as_str()
            .unwrap()
            .to_owned()
    }
    fn context(&self, id: &str) -> Value {
        let path = self.dir.join("contexts").join(format!("{id}.json"));
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
    }
    fn supervise(&self, id: &str, parent: Option<&str>) {
        self.owner(json!({"op":"supervise","session_id":id,"supervisor_id":parent,"request_id":uuid::Uuid::new_v4().to_string()}));
    }
}
impl Drop for Service {
    fn drop(&mut self) {
        if let Ok(mut stream) = UnixStream::connect(self.dir.join("service.sock")) {
            let _ = writeln!(stream, "{}", json!({"op":"list","include_removed":true}));
            let mut line = String::new();
            if BufReader::new(stream).read_line(&mut line).is_ok() {
                if let Ok(reply) = serde_json::from_str::<Value>(&line) {
                    if let Some(rows) = reply["result"].as_array() {
                        for row in rows {
                            let _=self.raw(None,json!({"op":"stop-instance","session_id":row["id"],"close_window":false,"request_id":uuid::Uuid::new_v4().to_string()}));
                        }
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(150));
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn hierarchy_identity_reads_and_lifecycle_share_the_service_policy() {
    let s = Service::start();
    let admiral = s.create("admiral", "codex", Some("admiral"));
    let commodore = s.create("commodore", "codex", Some("commodore"));
    let captain = s.create("captain", "codex", Some("captain"));
    let crew = s.create("crew", "codex", None);
    let peer = s.create("peer", "codex", None);
    s.supervise(&commodore, Some(&admiral));
    s.supervise(&captain, Some(&commodore));
    s.supervise(&crew, Some(&captain));
    let a = s.context("admiral");
    let co = s.context("commodore");
    let ca = s.context("captain");
    let cr = s.context("crew");
    for (credential, target) in [(&a, &commodore), (&co, &captain), (&ca, &crew)] {
        let receipt=s.agent(credential,json!({"op":"send","session_id":target,"request_id":uuid::Uuid::new_v4().to_string(),"message":"bounded instruction"}));
        assert_eq!(receipt["state"], "accepted");
        assert_eq!(receipt["actor_session_id"], credential["session_id"]);
        assert_eq!(receipt["authority"], "supervisor");
    }
    for (credential, target) in [(&a, &crew), (&co, &admiral), (&ca, &peer), (&cr, &peer)] {
        let reply=s.raw(Some(credential),json!({"op":"send","session_id":target,"request_id":uuid::Uuid::new_v4().to_string(),"message":"must refuse"}));
        assert_eq!(reply["code"], "forbidden", "{reply}");
    }
    let mut forged = cr.clone();
    forged["session_id"] = json!(captain);
    let cap = s.agent(&forged, json!({"op":"capabilities"}));
    assert_eq!(cap["actor"]["session_id"], crew);
    assert_eq!(cap["rank"], "crew");
    let bad = s.raw(
        Some(&json!({"service_instance":cr["service_instance"],"token":"forged"})),
        json!({"op":"status"}),
    );
    assert_eq!(bad["code"], "forbidden");
    s.owner(json!({"op":"send","session_id":peer,"request_id":"private-peer","message":"ONLY_PEER_CONTENT"}));
    let page = s.agent(&cr, json!({"op":"events","after":0}));
    assert!(!page.to_string().contains("ONLY_PEER_CONTENT"));
    assert!(
        page["events"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["session_id"] == crew)
    );
    let forbidden = s.raw(
        Some(&ca),
        json!({"op":"remove","session_id":crew,"request_id":"agent-remove"}),
    );
    assert_eq!(forbidden["code"], "forbidden");
    let demote = s.raw(
        None,
        json!({"op":"rank","session_id":captain,"rank":"crew","request_id":"invalid-demotion"}),
    );
    assert_eq!(demote["code"], "invalid_input");
    assert!(demote["error"].as_str().unwrap().contains(&crew));
    let bad_assignment = s.raw(
        None,
        json!({"op":"supervise","session_id":crew,"supervisor_id":admiral,"request_id":"skip"}),
    );
    assert_eq!(bad_assignment["code"], "invalid_input");
    let removed = s
        .finish(s.owner(json!({"op":"remove","session_id":captain,"request_id":"remove-captain"})));
    assert_eq!(removed["runtime"], "running");
    let list = s.owner(json!({"op":"list"}));
    let report = list
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == crew)
        .unwrap();
    assert!(report["supervisor_id"].is_null());
    assert_eq!(report["worker_state"], "running");
    assert!(!s.dir.join("contexts/captain.json").exists());
    assert_eq!(
        s.raw(Some(&ca), json!({"op":"status"}))["code"],
        "forbidden"
    );
}

#[test]
fn creation_defaults_owner_coordination_and_terminal_refusal_are_real_boundary_checks() {
    let s = Service::start();
    let admiral = s.create("admiral", "codex", Some("admiral"));
    let captain = s.create("captain", "codex", Some("captain"));
    let crew = s.create("crew", "codex", None);
    let shell = s.create("shell", "shell", None);
    let a = s.context("admiral");
    let ca = s.context("captain");
    let cr = s.context("crew");
    let terminal = s.context("shell");
    let request = json!({"op":"create","kind":"codex","request_id":"omitted-rank","cwd":s.dir,"name":"default report","open":false});
    assert_eq!(s.raw(Some(&a), request.clone())["code"], "forbidden");
    assert!(!s.dir.join("contexts/omitted-rank.json").exists());
    let child = s.finish(s.agent(&ca, request));
    assert_eq!(child["rank"], "crew");
    assert_eq!(child["supervisor_id"], captain);
    let mut explicit = json!({"op":"create","kind":"codex","request_id":"explicit-rank","cwd":s.dir,"name":"explicit report","open":false,"rank":"commodore"});
    let child = s.finish(s.agent(&a, explicit.clone()));
    assert_eq!(child["rank"], "commodore");
    assert_eq!(child["supervisor_id"], admiral);
    explicit["rank"] = json!("captain");
    assert_eq!(s.raw(Some(&a), explicit)["code"], "forbidden");
    let escalation = s.agent(
        &cr,
        json!({"op":"escalate","request_id":"question","message":"Need owner decision"}),
    );
    assert_eq!(escalation["delivery"], "recorded");
    assert!(escalation["destination"].is_null());
    assert_eq!(
        s.agent(
            &cr,
            json!({"op":"escalate","request_id":"question","message":"Need owner decision"})
        ),
        escalation
    );
    assert_eq!(
        s.raw(
            Some(&cr),
            json!({"op":"escalate","request_id":"question","message":"Changed question"})
        )["code"],
        "request_conflict"
    );
    let answer=s.owner(json!({"op":"adjudicate","session_id":crew,"request_id":"answer","decision":"resolve","message":"Proceed","reply_to":"question"}));
    assert_eq!(answer["delivery"], "recorded");
    thread::sleep(Duration::from_millis(100));
    let questions = s.owner(json!({"op":"escalations"}));
    assert_eq!(questions[0]["answered"], true);
    assert_eq!(questions[0]["answer"]["request_id"], "answer");
    let report = s.agent(
        &cr,
        json!({"op":"report","request_id":"report","message":"Still working"}),
    );
    assert_eq!(report["delivery"], "recorded");
    let denied=s.raw(Some(&terminal),json!({"op":"send","session_id":crew,"request_id":"terminal-send","message":"no elevation"}));
    assert_eq!(denied["code"], "forbidden");
    s.supervise(&shell, Some(&captain));
    assert_eq!(s.agent(&ca,json!({"op":"shell-exec","session_id":shell,"request_id":"controlled-shell","command":"printf controlled"}))["state"],"accepted");
    assert_eq!(s.raw(None,json!({"op":"supervise","session_id":shell,"supervisor_id":crew,"request_id":"crew-shell"}))["code"],"invalid_input");
    let nested=s.owner(json!({"op":"shell-exec","session_id":shell,"request_id":"nested","command":"\"$VOYAGER_BIN\" --state \"$VOYAGER_STATE\" create codex forbidden nested /tmp --background"}));
    assert_eq!(nested["state"], "accepted");
    thread::sleep(Duration::from_millis(150));
    let output = s.owner(json!({"op":"shell-read","session_id":shell}));
    assert!(output.to_string().contains("forbidden"));
    assert!(
        s.owner(json!({"op":"list"}))
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["name"] != "nested")
    );
    s.supervise(&crew, Some(&captain));
    s.finish(s.owner(json!({"op":"stop-instance","session_id":captain,"request_id":"stop-supervisor","close_window":false})));
    let failed=s.agent(&cr,json!({"op":"escalate","request_id":"unavailable-supervisor","message":"Supervisor unavailable"}));
    assert_eq!(failed["destination"], captain);
    assert_eq!(failed["delivery"], "failed");
    let questions = s.owner(json!({"op":"escalations"}));
    assert!(
        questions
            .as_array()
            .unwrap()
            .iter()
            .any(|q| q["request_id"] == "unavailable-supervisor" && q["destination"] == captain)
    );
}

#[test]
fn dock_grants_only_temporary_bound_agent_authority_without_promotion() {
    let s = Service::start();
    let crew = s.create("crew", "codex", None);
    let target = s.create("target", "codex", None);
    let credential = s.context("crew");
    let pid = std::process::id();
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let start = stat
        .rsplit_once(')')
        .unwrap()
        .1
        .split_whitespace()
        .nth(19)
        .unwrap();
    let process = json!({"pid":pid,"start":start});
    let generation = uuid::Uuid::new_v4().to_string();
    let mut socket = UnixStream::connect(s.dir.join("service.sock")).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    writeln!(socket,"{}",json!({"op":"dock","session_id":crew,"generation":generation,"window_id":1,"terminal":process,"frontend":process})).unwrap();
    let mut line = String::new();
    BufReader::new(&socket).read_line(&mut line).unwrap();
    let dock: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(dock["result"]["active"], true);
    let caps = s.agent(&credential, json!({"op":"capabilities"}));
    assert_eq!(caps["rank"], "crew");
    assert_eq!(caps["dock_generation"], generation);
    let receipt=s.agent(&credential,json!({"op":"send","session_id":target,"request_id":"docked-send","message":"accepted before undock"}));
    assert_eq!(receipt["state"], "accepted");
    assert_eq!(receipt["authority"], "docked");
    assert_eq!(receipt["control_generation"], generation);
    let create = json!({"op":"create","kind":"codex","name":"Independent Crew","cwd":s.dir,"request_id":"docked-create","open":false});
    let child = s.finish(s.agent(&credential, create));
    assert_eq!(child["rank"], "crew");
    assert!(child["supervisor_id"].is_null());
    s.owner(json!({"op":"undock","generation":generation}));
    assert_eq!(s.raw(Some(&credential),json!({"op":"send","session_id":target,"request_id":"after-undock","message":"new rights withdrawn"}))["code"],"forbidden");
    assert_eq!(s.raw(None,json!({"op":"send","session_id":target,"request_id":"stale-owner","message":"stale","control_generation":generation}))["code"],"stale_control");
    thread::sleep(Duration::from_millis(1200));
    let events = s.owner(json!({"op":"events","after":0}));
    assert!(
        events["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["session_id"] == target && e["type"] == "turn.completed")
    );
    let saved = s.agent(
        &credential,
        json!({"op":"operation","request_id":"docked-send"}),
    );
    assert_eq!(saved["state"], "accepted");
    assert!(saved.get("message").is_none());
}

#[test]
fn schema_two_migrates_rank_without_inferring_supervision_and_rolls_back_unknown_kinds() {
    let dir = std::env::temp_dir().join(format!("va-migrate-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir(&dir).unwrap();
    for (name, kind, valid) in [("valid", "codex", true), ("invalid", "unknown", false)] {
        let path = dir.join(name);
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE sessions(id TEXT PRIMARY KEY,server TEXT NOT NULL,native_id TEXT NOT NULL,native_session_id TEXT,cwd TEXT NOT NULL,registered_ms INTEGER NOT NULL,kind TEXT NOT NULL,removed_ms INTEGER,capture_generation INTEGER NOT NULL DEFAULT 1,UNIQUE(server,native_id)); CREATE TABLE workers(launch_id TEXT PRIMARY KEY,parent_id TEXT REFERENCES sessions(id),cwd TEXT NOT NULL,prompt TEXT,state TEXT NOT NULL,session_id TEXT UNIQUE REFERENCES sessions(id),pid INTEGER,name TEXT,kind TEXT NOT NULL); CREATE TABLE requests(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),message TEXT NOT NULL,state TEXT NOT NULL,native_turn_id TEXT,created_ms INTEGER NOT NULL); CREATE TABLE operations(id TEXT PRIMARY KEY,inputs TEXT NOT NULL,receipt TEXT NOT NULL,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL); PRAGMA user_version=1;").unwrap();
        db.execute(
            "INSERT INTO sessions VALUES('legacy','server','thread',NULL,'/tmp',1,?1,2,1)",
            [kind],
        )
        .unwrap();
        db.execute(
            "INSERT INTO requests VALUES('historical','legacy','retained','accepted','turn',1)",
            [],
        )
        .unwrap();
        drop(db);
        let result = voyager_shell::store::Store::open(&path);
        assert_eq!(result.is_ok(), valid);
        if let Ok(store) = result {
            let legacy = store.session("legacy").unwrap();
            assert_eq!(legacy["rank"], "crew");
            assert!(legacy["supervisor_id"].is_null());
            assert_eq!(legacy["removed_ms"], 2);
            let task = store.request("historical").unwrap().unwrap();
            assert!(task["actor_kind"].is_null());
            assert!(task["purpose"].is_null());
            assert_eq!(task["native_turn_id"], "turn");
        } else {
            let db = rusqlite::Connection::open(&path).unwrap();
            assert_eq!(
                db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                1
            );
            assert_eq!(
                db.query_row(
                    "SELECT count(*) FROM pragma_table_info('sessions') WHERE name='rank'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                0
            );
        }
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn owner_dock_cli_holds_one_connection_and_bound_callers_cannot_claim_it() {
    let s = Service::start();
    let session = s.create("crew", "codex", None);
    let pid = std::process::id().to_string();
    let args = [
        "--state",
        s.dir.to_str().unwrap(),
        "dock",
        session.as_str(),
        "--window-id",
        "1",
        "--terminal-pid",
        pid.as_str(),
        "--client-pid",
        pid.as_str(),
    ];
    let mut client = Command::new(env!("CARGO_BIN_EXE_voyager"))
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(client.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let result: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(result["active"], true);
    assert!(client.try_wait().unwrap().is_none());
    assert_eq!(
        s.owner(json!({"op":"status"}))["control"]["session_id"],
        session
    );
    s.owner(json!({"op":"undock","generation":result["attachment"]["generation"]}));
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if let Some(status) = client.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(10));
    }
    let denied = Command::new(env!("CARGO_BIN_EXE_voyager"))
        .args(args)
        .env("VOYAGER_CALLER", "instance")
        .env("VOYAGER_SESSION_CONTEXT", s.dir.join("contexts/crew.json"))
        .output()
        .unwrap();
    assert!(!denied.status.success());
    assert!(String::from_utf8_lossy(&denied.stderr).contains("forbidden"));
    assert!(s.owner(json!({"op":"status"}))["control"].is_null());
}

#[test]
fn restart_reconciles_coordination_without_replay_or_downgrading_saved_acknowledgements() {
    let dir = std::env::temp_dir().join(format!("va-recover-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir(&dir).unwrap();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    let path = dir.join("events.sqlite");
    let store = voyager_shell::store::Store::open(&path).unwrap();
    let sender = store
        .register("fixture", &json!({"id":"sender","cwd":"/fixture"}))
        .unwrap();
    let supervisor = store
        .register("fixture", &json!({"id":"supervisor","cwd":"/fixture"}))
        .unwrap();
    store
        .0
        .execute(
            "UPDATE sessions SET rank='captain' WHERE id=?1",
            [&supervisor],
        )
        .unwrap();
    store
        .0
        .execute(
            "UPDATE sessions SET supervisor_id=?2 WHERE id=?1",
            rusqlite::params![sender, supervisor],
        )
        .unwrap();
    for (id, op, delivery, state, turn, expected) in [
        ("missing", "escalate", "recorded", None, None, "failed"),
        (
            "pending",
            "escalate",
            "recorded",
            Some("pending"),
            None,
            "failed",
        ),
        (
            "requested",
            "escalate",
            "recorded",
            Some("uncertain"),
            None,
            "uncertain",
        ),
        (
            "acknowledged",
            "escalate",
            "recorded",
            Some("accepted"),
            Some("exact-turn"),
            "accepted",
        ),
        (
            "rejected",
            "escalate",
            "recorded",
            Some("failed"),
            None,
            "failed",
        ),
        (
            "decision",
            "adjudicate",
            "recorded",
            Some("uncertain"),
            None,
            "uncertain",
        ),
        (
            "final-accepted",
            "escalate",
            "accepted",
            None,
            None,
            "accepted",
        ),
        (
            "final-failed",
            "escalate",
            "failed",
            Some("accepted"),
            Some("exact-turn"),
            "failed",
        ),
    ] {
        let task = format!("task:{id}");
        if let Some(state) = state {
            store
                .begin_request(&task, &supervisor, "Selected evidence")
                .unwrap();
            store.0.execute("UPDATE requests SET state=?2,native_turn_id=?3,dispatch_mode=CASE WHEN ?2='pending' THEN NULL ELSE 'steer' END,expected_turn_id='exact-turn',error_code=CASE WHEN ?2='failed' THEN 'provider_failed' ELSE NULL END WHERE id=?1",rusqlite::params![task,state,turn]).unwrap();
        }
        let receipt = json!({"request_id":id,"session_id":sender,"destination":supervisor,"state":"completed","delivery":delivery,"task_request_id":task,"message":"Selected evidence","expected_delivery":expected});
        store
            .begin_operation(
                id,
                &json!({"op":op,"actor":{"kind":"instance","session_id":sender}}),
                &receipt,
            )
            .unwrap();
    }
    store.begin_operation("owner-question",&json!({"op":"escalate","actor":{"kind":"instance","session_id":sender}}),&json!({"request_id":"owner-question","session_id":sender,"destination":null,"state":"completed","delivery":"recorded","message":"Owner question"})).unwrap();
    drop(store);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let mut service = Service::start_at(dir);
    for id in [
        "missing",
        "pending",
        "requested",
        "acknowledged",
        "rejected",
        "decision",
        "final-accepted",
        "final-failed",
    ] {
        let receipt = service.owner(json!({"op":"operation","request_id":id}));
        assert_eq!(
            receipt["delivery"], receipt["expected_delivery"],
            "{id}: {receipt}"
        );
        assert_eq!(receipt["state"], "completed");
        if ["missing", "pending", "requested", "rejected", "decision"].contains(&id) {
            assert!(
                receipt["error"]
                    .as_str()
                    .unwrap()
                    .contains("no automatic replay")
            );
        }
    }
    let accepted = service.owner(json!({"op":"operation","request_id":"acknowledged"}));
    assert_eq!(accepted["native_request"]["native_turn_id"], "exact-turn");
    assert!(accepted.get("error").is_none());
    assert_eq!(
        service.owner(json!({"op":"operation","request_id":"owner-question"}))["delivery"],
        "recorded"
    );
    let questions = service.owner(json!({"op":"escalations"}));
    for id in ["missing", "pending", "requested", "rejected"] {
        assert!(
            questions
                .as_array()
                .unwrap()
                .iter()
                .any(|q| q["request_id"] == id && q["destination"] == supervisor)
        );
    }
    assert!(
        !questions
            .as_array()
            .unwrap()
            .iter()
            .any(|q| q["request_id"] == "acknowledged")
    );
    service.owner(json!({"op":"stop"}));
    service.child.wait().unwrap();
    let store = voyager_shell::store::Store::open(&path).unwrap();
    let events_before: i64 = store
        .0
        .query_row(
            "SELECT count(*) FROM events WHERE kind='coordination.delivery'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(events_before, 6);
    store.reconcile_coordination().unwrap();
    assert_eq!(
        store
            .0
            .query_row(
                "SELECT count(*) FROM events WHERE kind='coordination.delivery'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        events_before
    );
    assert_eq!(
        store
            .0
            .query_row("SELECT count(*) FROM requests", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        6
    );
}
