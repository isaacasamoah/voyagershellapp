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
        while UnixStream::connect(service.dir.join("service.sock")).is_err() {
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
        if self.child.try_wait().ok().flatten().is_some() {
            let _ = fs::remove_dir_all(&self.dir);
            return;
        }
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

fn development_candidate(s: &Service) -> PathBuf {
    let root = s.dir.join("candidate");
    for dir in [
        "target/debug",
        "desktop/src",
        "desktop/node_modules/electron/dist",
    ] {
        fs::create_dir_all(root.join(dir)).unwrap();
    }
    fs::copy(
        env!("CARGO_BIN_EXE_voyager"),
        root.join("target/debug/voyager"),
    )
    .unwrap();
    fs::copy(
        env!("CARGO_BIN_EXE_voyager-windows"),
        root.join("target/debug/voyager-windows"),
    )
    .unwrap();
    for file in ["Cargo.toml", "desktop/package.json", "desktop/src/main.cjs"] {
        fs::write(root.join(file), "{}").unwrap();
    }
    let app = root.join("desktop/node_modules/electron/dist/electron");
    fs::write(&app, r##"#!/usr/bin/env python3
import json, os, pathlib, socket, sys, time
state = pathlib.Path(os.environ['VOYAGER_STATE'])
def rpc(request):
    with socket.socket(socket.AF_UNIX) as conn:
        conn.connect(str(state / 'service.sock'))
        conn.sendall((json.dumps(request) + '\n').encode())
        reply = json.loads(conn.makefile().readline())
        if 'error' in reply:
            raise RuntimeError(reply)
        return reply['result']
receipt = rpc({'op':'create','kind':'shell','name':'test shell','cwd':str(state),'request_id':'test-shell','open':False})
while receipt['state'] == 'pending':
    time.sleep(.02)
    receipt = rpc({'op':'operation','request_id':'test-shell'})
assert receipt['state'] == 'completed', receipt
(state / 'app-ready.json').write_text(json.dumps({'pid':os.getpid(),'service':rpc({'op':'status'})['instance'],'session':receipt['session_id']}))
print('TEST_SURFACE_READY', flush=True)
if '--proof-polish' in sys.argv:
    selection = pathlib.Path(sys.argv[1]) / 'fixture-verdict'
    verdict = selection.read_text() if selection.exists() else 'pass'
    (state / 'polish-proof.json').write_text(json.dumps({'verdict':verdict,'observations':['fixture surface only']}))
while True:
    time.sleep(.1)
"##).unwrap();
    fs::set_permissions(app, fs::Permissions::from_mode(0o700)).unwrap();
    root
}

fn development_finished(s: &Service, credential: &Value, request: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let result = s.agent(credential, json!({"op":"operation","request_id":request}));
        if matches!(result["run_state"].as_str(), Some("finished" | "uncertain")) {
            return result;
        }
        assert!(Instant::now() < deadline, "{result}");
        thread::sleep(Duration::from_millis(40));
    }
}

#[test]
fn development_grants_scope_runs_and_revocation_cleans_only_the_candidate() {
    let s = Service::start();
    let instance = s.create("tester", "codex", None);
    let peer = s.create("test-peer", "codex", Some("admiral"));
    let agent = s.context("tester");
    let other = s.context("test-peer");
    let checkout = development_candidate(&s);
    let grant =
        json!({"op":"test-grant","session_id":instance,"request_id":"grant","checkout":checkout});
    let start = json!({"op":"test-start","request_id":"manual-run","mode":"manual"});
    assert_eq!(s.raw(Some(&agent), start.clone())["code"], "forbidden");
    assert_eq!(s.raw(Some(&agent), grant.clone())["code"], "forbidden");
    s.owner(grant.clone());
    assert_eq!(s.owner(grant)["checkout"], json!(checkout));
    assert_eq!(
        s.agent(&agent, json!({"op":"capabilities"}))["development_checkout"],
        json!(checkout)
    );
    assert_eq!(s.raw(Some(&other), start.clone())["code"], "forbidden");
    let mut override_state = start.clone();
    override_state["state_dir"] = json!(s.dir);
    assert_eq!(s.raw(Some(&agent), override_state)["code"], "invalid_input");
    let receipt = s.agent(&agent, start.clone());
    let run = receipt["run_id"].as_str().unwrap();
    let state = PathBuf::from(receipt["state_dir"].as_str().unwrap());
    assert_eq!(s.agent(&agent, start.clone())["run_id"], run);
    let mut changed = start;
    changed["mode"] = json!("polish");
    assert_eq!(s.raw(Some(&agent), changed)["code"], "request_conflict");
    assert!(
        s.raw(
            Some(&agent),
            json!({"op":"test-start","request_id":"second","mode":"manual"})
        )
        .get("error")
        .is_some()
    );
    for op in ["test-read", "test-stop"] {
        assert_eq!(
            s.raw(
                Some(&other),
                json!({"op":op,"run_id":run,"request_id":"peer-stop"})
            )["code"],
            "forbidden"
        );
    }
    assert_eq!(s.agent(&other, json!({"op":"test-runs"})), json!([]));
    let deadline = Instant::now() + Duration::from_secs(12);
    while !state.join("app-ready.json").exists() {
        assert!(
            Instant::now() < deadline,
            "{:?}",
            fs::read_to_string(state.join("test.log"))
        );
        thread::sleep(Duration::from_millis(30));
    }
    let ready: Value =
        serde_json::from_slice(&fs::read(state.join("app-ready.json")).unwrap()).unwrap();
    assert_ne!(
        ready["service"],
        s.owner(json!({"op":"status"}))["instance"]
    );
    assert!(
        s.agent(&agent, json!({"op":"test-read","run_id":run}))["text"]
            .as_str()
            .unwrap()
            .contains("TEST_SURFACE_READY")
    );
    s.owner(json!({"op":"test-revoke","session_id":instance,"request_id":"revoke"}));
    assert_eq!(
        s.raw(
            Some(&agent),
            json!({"op":"test-start","request_id":"revoked","mode":"manual"})
        )["code"],
        "forbidden"
    );
    let done = development_finished(&s, &agent, "manual-run");
    assert_eq!(done["run_state"], "finished", "{done}");
    assert_eq!(done["result"]["cleanup"], "completed", "{done}");
    assert!(!state.join("service.sock").exists());
    let rows = s.owner(json!({"op":"list"}));
    assert!(
        rows.as_array()
            .unwrap()
            .iter()
            .any(|r| r["id"] == peer && r["worker_state"] == "running")
    );
    assert_eq!(
        s.agent(&agent, json!({"op":"test-runs"}))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        s.agent(
            &agent,
            json!({"op":"test-stop","run_id":run,"request_id":"already-stopped"})
        )["effect"],
        "stop_requested"
    );
    fs::remove_dir_all(state).unwrap();
}

#[test]
fn development_proof_distinguishes_pass_rework_and_failed_launch() {
    let s = Service::start();
    let instance = s.create("proof-tester", "codex", None);
    let agent = s.context("proof-tester");
    let checkout = development_candidate(&s);
    s.owner(
        json!({"op":"test-grant","session_id":instance,"request_id":"grant","checkout":checkout}),
    );
    for verdict in ["pass", "rework"] {
        fs::write(checkout.join("desktop/fixture-verdict"), verdict).unwrap();
        let request = format!("proof-{verdict}");
        s.agent(
            &agent,
            json!({"op":"test-start","request_id":request,"mode":"polish"}),
        );
        let done = development_finished(&s, &agent, &request);
        assert_eq!(done["run_state"], "finished", "{done}");
        assert_eq!(
            done["result"]["outcome"]["proof"]["verdict"], verdict,
            "{done}"
        );
        assert_eq!(done["result"]["cleanup"], "completed");
        fs::remove_dir_all(done["state_dir"].as_str().unwrap()).unwrap();
    }
    fs::write(
        checkout.join("desktop/node_modules/electron/dist/electron"),
        "#!/bin/sh\nexit 7\n",
    )
    .unwrap();
    s.agent(
        &agent,
        json!({"op":"test-start","request_id":"broken-app","mode":"manual"}),
    );
    let done = development_finished(&s, &agent, "broken-app");
    assert_eq!(done["run_state"], "finished", "{done}");
    assert!(
        done["result"]["error"]
            .as_str()
            .unwrap()
            .contains("desktop exited")
    );
    assert_eq!(done["result"]["cleanup"], "completed");
    fs::remove_dir_all(done["state_dir"].as_str().unwrap()).unwrap();
}

#[test]
fn development_parent_loss_requests_cleanup_without_restoring_authority() {
    let mut s = Service::start();
    let instance = s.create("lease-tester", "codex", None);
    let agent = s.context("lease-tester");
    let checkout = development_candidate(&s);
    s.owner(
        json!({"op":"test-grant","session_id":instance,"request_id":"grant","checkout":checkout}),
    );
    let started = s.agent(
        &agent,
        json!({"op":"test-start","request_id":"leased-run","mode":"manual"}),
    );
    let state = PathBuf::from(started["state_dir"].as_str().unwrap());
    let deadline = Instant::now() + Duration::from_secs(12);
    while !state.join("app-ready.json").exists() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(30));
    }
    s.finish(s.owner(json!({"op":"stop-instance","session_id":instance,"request_id":"stop-parent-worker","close_window":false})));
    s.child.kill().unwrap();
    s.child.wait().unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Ok(result) = voyager_shell::development::read_json(&state.join("test-result.json")) {
            assert_eq!(result["cleanup"], "completed", "{result}");
            assert_eq!(result["outcome"]["reason"], "stop_requested");
            break;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(40));
    }
    let mut restarted = Service::start_at(s.dir.clone());
    let runs = restarted.owner(json!({"op":"test-runs"}));
    assert_eq!(runs[0]["run_state"], "uncertain", "{runs}");
    assert_eq!(
        restarted.raw(
            Some(&agent),
            json!({"op":"test-start","request_id":"stale","mode":"manual"})
        )["code"],
        "forbidden"
    );
    let replacement = restarted.create("new-tester", "codex", None);
    let context = restarted.context("new-tester");
    assert!(
        restarted.agent(&context, json!({"op":"capabilities"}))["development_checkout"].is_null()
    );
    restarted.finish(restarted.owner(json!({"op":"stop-instance","session_id":replacement,"request_id":"stop-new-worker","close_window":false})));
    restarted.owner(json!({"op":"stop"}));
    restarted.child.wait().unwrap();
    fs::remove_dir_all(state).unwrap();
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
    for actor in [&a, &ca, &cr, &terminal] {
        assert_eq!(
            s.raw(Some(actor), json!({"op":"conversation"}))["code"],
            "forbidden"
        );
        assert_eq!(
            s.raw(
                Some(actor),
                json!({"op":"conversation-send","request_id":"private","text":"hello"})
            )["code"],
            "forbidden"
        );
    }
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
    let fleet = uuid::Uuid::new_v4().to_string();
    s.owner(json!({"op":"create-fleet","request_id":fleet,"name":"Visual organization"}));
    assert!(
        s.agent(&credential, json!({"op":"fleets"}))["fleets"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["id"] == fleet)
    );
    let moved = s.agent(
        &credential,
        json!({"op":"move-vessel","session_id":target,"fleet_id":fleet}),
    );
    assert_eq!(moved["assignments"][&target], fleet);
    let target_row = s
        .owner(json!({"op":"list"}))
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == target)
        .unwrap()
        .clone();
    assert_eq!(target_row["rank"], "crew");
    assert!(target_row["supervisor_id"].is_null());
    let receipt=s.agent(&credential,json!({"op":"send","session_id":target,"request_id":"docked-send","message":"accepted before undock"}));
    assert_eq!(receipt["state"], "accepted");
    assert_eq!(receipt["authority"], "docked");
    assert_eq!(receipt["control_generation"], generation);
    let create = json!({"op":"create","kind":"codex","name":"Independent Crew","cwd":s.dir,"request_id":"docked-create","open":false});
    let child = s.finish(s.agent(&credential, create));
    assert_eq!(child["rank"], "crew");
    assert!(child["supervisor_id"].is_null());
    s.owner(json!({"op":"undock","generation":generation}));
    assert_eq!(
        s.raw(
            Some(&credential),
            json!({"op":"move-vessel","session_id":target,"fleet_id":null})
        )["code"],
        "forbidden"
    );
    assert_eq!(
        s.raw(Some(&credential), json!({"op":"fleets"}))["code"],
        "forbidden"
    );
    assert_eq!(s.raw(None,json!({"op":"move-vessel","session_id":target,"fleet_id":null,"control_generation":generation}))["code"],"stale_control");
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
    for operation in [
        vec!["start"],
        vec!["serve"],
        vec!["test-host", "/tmp", "manual"],
    ] {
        let denied = Command::new(env!("CARGO_BIN_EXE_voyager"))
            .arg("--state")
            .arg(&s.dir)
            .args(operation)
            .env("VOYAGER_CALLER", "instance")
            .env("VOYAGER_SESSION_CONTEXT", s.dir.join("contexts/crew.json"))
            .output()
            .unwrap();
        assert!(!denied.status.success());
        assert!(String::from_utf8_lossy(&denied.stderr).contains("forbidden"));
    }
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

#[test]
fn fleet_service_owns_membership_and_preserves_existing_files_and_authority() {
    let s = Service::start();
    let captain = s.create("fleet-captain", "codex", Some("captain"));
    let crew = s.create("fleet-crew", "codex", None);
    s.supervise(&crew, Some(&captain));
    let a = uuid::Uuid::new_v4().to_string();
    let b = uuid::Uuid::new_v4().to_string();
    s.owner(json!({"op":"create-fleet","request_id":a,"name":"Compiler"}));
    s.owner(json!({"op":"create-fleet","request_id":b,"name":"Docs"}));
    s.owner(json!({"op":"create-fleet","request_id":a,"name":"Compiler"}));
    assert_eq!(
        s.owner(json!({"op":"fleets"}))["fleets"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let credential = s.context("fleet-crew");
    assert_eq!(s.raw(Some(&credential),json!({"op":"create-fleet","request_id":uuid::Uuid::new_v4().to_string(),"name":"Unpermitted"}))["code"],"forbidden");
    s.owner(json!({"op":"move-vessel","session_id":crew,"fleet_id":b}));
    let moved = s.owner(json!({"op":"move-vessel","session_id":captain,"fleet_id":a}));
    assert_eq!(moved["assignments"][&captain], a);
    assert!(moved["assignments"].get(&crew).is_none());
    let rows = s.owner(json!({"op":"list"}));
    assert_eq!(
        rows.as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == crew)
            .unwrap()["supervisor_id"],
        captain
    );
    let data = s.owner(json!({"op":"remove-fleet","fleet_id":a}));
    assert!(data["assignments"].get(&captain).is_none());
    assert_eq!(
        fs::metadata(s.dir.join("fleets.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    let renamed = s.owner(json!({"op":"rename-fleet","fleet_id":b,"name":"Manual"}));
    assert!(
        renamed["fleets"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["id"] == b && f["name"] == "Manual")
    );
    assert_eq!(
        s.raw(
            Some(&credential),
            json!({"op":"rename-fleet","fleet_id":b,"name":"Forbidden"})
        )["code"],
        "forbidden"
    );
    assert_eq!(s.raw(Some(&credential),json!({"op":"rename","session_id":crew,"name":"Forbidden","request_id":"forbidden-rename"}))["code"],"forbidden");
    assert!(
        s.raw(
            None,
            json!({"op":"rename-fleet","fleet_id":b,"name":"Compiler"})
        )
        .get("error")
        .is_none()
    );
    let saved = fs::read(s.dir.join("fleets.json")).unwrap();
    assert!(
        s.raw(
            None,
            json!({"op":"move-vessel","session_id":"unknown","fleet_id":b})
        )
        .get("error")
        .is_some()
    );
    assert_eq!(fs::read(s.dir.join("fleets.json")).unwrap(), saved);
    fs::write(s.dir.join("fleets.json"), "{broken").unwrap();
    assert!(s.raw(None,json!({"op":"create-fleet","request_id":uuid::Uuid::new_v4().to_string(),"name":"Preserved"})).get("error").is_some());
    assert_eq!(
        fs::read_to_string(s.dir.join("fleets.json")).unwrap(),
        "{broken"
    );
}

#[test]
fn ordinary_instance_cannot_resume_a_saved_conversation() {
    let s = Service::start();
    let id = s.create("resume-rights", "codex", Some("crew"));
    let credential = s.context("resume-rights");
    let response = s.raw(Some(&credential), json!({"op":"resume-instance","session_id":id,"request_id":"resume-without-owner","expected_runtime_generation":1}));
    assert_eq!(response["code"], "forbidden");
    assert_eq!(
        s.raw(
            None,
            json!({"op":"operation","request_id":"resume-without-owner"})
        )["code"],
        "not_found"
    );
}

#[test]
fn resuming_a_runtime_drops_its_old_control_and_temporary_grant() {
    let s = Service::start();
    fs::write(s.dir.join("verified-settings"), "1").unwrap();
    let id = s.create("prior-runtime", "codex", Some("crew"));
    let old = s.context("prior-runtime");
    s.owner(json!({"op":"test-grant","session_id":id,"request_id":"prior-grant","checkout":env!("CARGO_MANIFEST_DIR")}));
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
    let mut lease = UnixStream::connect(s.dir.join("service.sock")).unwrap();
    writeln!(lease,"{}",json!({"op":"dock","session_id":id,"generation":uuid::Uuid::new_v4().to_string(),"window_id":1,"terminal":process,"frontend":process})).unwrap();
    let mut line = String::new();
    BufReader::new(&lease).read_line(&mut line).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap()["result"]["active"],
        true
    );
    s.finish(s.owner(json!({"op":"stop-instance","session_id":id,"request_id":"stop-prior-runtime","close_window":false})));
    assert!(s.owner(json!({"op":"status"}))["control"].is_null());
    s.finish(s.owner(json!({"op":"resume-instance","session_id":id,"request_id":"fresh-runtime","expected_runtime_generation":1})));
    assert!(s.owner(json!({"op":"status"}))["control"].is_null());
    assert_eq!(
        s.raw(Some(&old), json!({"op":"capabilities"}))["code"],
        "forbidden"
    );
    let fresh = s.context("fresh-runtime");
    assert_eq!(
        s.agent(&fresh, json!({"op":"capabilities"}))["rank"],
        "crew"
    );
    assert_eq!(
        s.raw(
            Some(&fresh),
            json!({"op":"test-start","request_id":"no-prior-grant","mode":"invalid-mode"})
        )["code"],
        "forbidden"
    );
}
