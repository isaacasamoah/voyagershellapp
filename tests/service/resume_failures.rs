use super::{resume::stopped_saved_agent, *};

#[test]
fn repeated_and_competing_resume_requests_admit_one_runtime() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    fs::write(f.dir.join("hold-resume"), "1").unwrap();
    let request = json!({"op":"resume-instance","session_id":id,"request_id":"single-admission","expected_runtime_generation":1});
    let mut competing = request.clone();
    competing["request_id"] = json!("competing-resume");
    let results = thread::scope(|scope| {
        let left = scope.spawn(|| client(&f.dir, request.clone()));
        let right = scope.spawn(|| client(&f.dir, competing.clone()));
        [left.join().unwrap(), right.join().unwrap()]
    });
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert!(
        results
            .iter()
            .filter_map(|r| r.as_ref().err())
            .all(|e| e.to_string().contains("busy"))
    );
    let [left, right] = results;
    let (request, pending) = match left {
        Ok(receipt) => (request, receipt),
        Err(_) => (competing, right.unwrap()),
    };
    wait(|| f.dir.join("resume-loaded").exists());
    assert_eq!(client(&f.dir, request.clone()).unwrap(), pending);
    let mut changed = request.clone();
    changed["expected_runtime_generation"] = json!(2);
    assert!(
        client(&f.dir, changed)
            .unwrap_err()
            .to_string()
            .contains("request_conflict")
    );
    fs::remove_file(f.dir.join("hold-resume")).unwrap();
    assert_eq!(
        f.call(json!({"op":"operation","request_id":request["request_id"]}))["state"],
        "completed"
    );
    assert_eq!(
        f.call(json!({"op":"list"}))[0]["lifecycle"]["runtime_generation"],
        2
    );
    assert_eq!(
        fs::read_dir(&f.dir)
            .unwrap()
            .filter(|entry| entry
                .as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("w-"))
            .count(),
        2
    );
}

#[test]
fn lost_client_reply_can_be_inspected_without_repeating_resume() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    fs::write(f.dir.join("hold-resume"), "1").unwrap();
    let mut socket = UnixStream::connect(f.dir.join("service.sock")).unwrap();
    writeln!(socket, "{}", json!({"op":"resume-instance","session_id":id,"request_id":"lost-reply","expected_runtime_generation":1})).unwrap();
    wait(|| f.dir.join("resume-loaded").exists());
    drop(socket);
    let output = f.cli(&["operation", "lost-reply"]);
    fs::remove_file(f.dir.join("hold-resume")).unwrap();
    assert!(output.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["state"],
        "pending"
    );
    let completed = f.call(json!({"op":"operation","request_id":"lost-reply"}));
    assert_eq!(completed["state"], "completed");
    assert_eq!(completed["runtime_generation"], 2);
    assert_eq!(f.call(json!({"op":"resume-instance","session_id":id,"request_id":"lost-reply","expected_runtime_generation":1})), completed);
}

#[test]
fn interrupted_service_preserves_uncertainty_and_does_not_restore_ownership() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    fs::write(f.dir.join("hold-resume"), "1").unwrap();
    let pending = client(&f.dir, json!({"op":"resume-instance","session_id":id,"request_id":"interrupted-resume","expected_runtime_generation":1})).unwrap();
    wait(|| f.dir.join("resume-loaded").exists());
    let mut service = f.service.take().unwrap();
    service.kill().unwrap();
    service.wait().unwrap();
    f.start();
    let receipt = f.call(json!({"op":"operation","request_id":"interrupted-resume"}));
    assert_eq!(receipt["state"], "uncertain");
    assert_eq!(receipt["runtime_generation"], pending["runtime_generation"]);
    assert_eq!(receipt["effects"], pending["effects"]);
    let row = f.call(json!({"op":"list"}))[0].clone();
    assert_eq!(row["lifecycle"]["runtime"], "unknown");
    assert_eq!(row["resume"]["state"], "unavailable");
    assert!(client(&f.dir,json!({"op":"resume-instance","session_id":id,"request_id":"uncertainty-bypass","expected_runtime_generation":2})).is_err());
    assert_eq!(f.call(json!({"op":"status"}))["owns_agents"], false);
}

#[test]
fn confirmed_stop_can_resume_after_restart_without_losing_assignments() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    let parent = f.call(json!({"op":"create","open":false,"kind":"codex","request_id":"saved-captain","name":"Captain","cwd":f.dir,"rank":"captain"}))["session_id"].clone();
    f.call(json!({"op":"supervise","session_id":id,"supervisor_id":parent,"request_id":"saved-assignment"}));
    f.call(json!({"op":"stop-instance","session_id":parent}));
    let fleet = uuid::Uuid::new_v4().to_string();
    f.call(json!({"op":"create-fleet","request_id":fleet,"name":"Retained work"}));
    f.call(json!({"op":"move-vessel","session_id":id,"fleet_id":fleet}));
    let before = f
        .call(json!({"op":"list"}))
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == id)
        .unwrap()
        .clone();
    let fleets = f.call(json!({"op":"fleets"}));
    f.halt();
    f.start();
    assert_eq!(
        f.call(json!({"op":"operation","request_id":"saved-agent"}))["state"],
        "completed"
    );
    let resumed = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"after-restart","expected_runtime_generation":1}));
    assert_eq!(resumed["state"], "completed");
    let after = f
        .call(json!({"op":"list"}))
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == id)
        .unwrap()
        .clone();
    for field in [
        "id",
        "name",
        "cwd",
        "rank",
        "supervisor_id",
        "native_thread_id",
    ] {
        assert_eq!(after[field], before[field], "{field}");
    }
    assert_eq!(f.call(json!({"op":"fleets"})), fleets);
}

#[test]
fn delayed_old_capture_events_do_not_become_new_completions() {
    let mut f = Fixture::new();
    let id = stopped_saved_agent(&mut f);
    f.call(json!({"op":"resume-instance","session_id":id,"request_id":"event-boundary","expected_runtime_generation":1}));
    let store = Store::open(&f.dir.join("events.sqlite")).unwrap();
    let event = json!({"method":"turn/completed","params":{"threadId":"worker-thread","turn":{"id":"delayed-turn","status":"completed"}}});
    store
        .record(id.as_str().unwrap(), 1, events::normalize(&event).unwrap())
        .unwrap();
    assert!(
        !f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["native_turn_id"] == "delayed-turn")
    );
    store
        .record(id.as_str().unwrap(), 2, events::normalize(&event).unwrap())
        .unwrap();
    store
        .record(id.as_str().unwrap(), 2, events::normalize(&event).unwrap())
        .unwrap();
    assert_eq!(
        f.events()["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["native_turn_id"] == "delayed-turn")
            .count(),
        1
    );
}

#[test]
fn missing_working_folder_keeps_resume_unavailable() {
    let mut f = Fixture::new();
    stopped_saved_agent(&mut f);
    let store = Store::open(&f.dir.join("events.sqlite")).unwrap();
    store
        .0
        .execute(
            "UPDATE runtime_generations SET settings=json_set(settings,'$.effective.cwd',?1)",
            [f.dir.join("missing").to_str().unwrap()],
        )
        .unwrap();
    let row = f.call(json!({"op":"list"}))[0].clone();
    assert_eq!(row["resume"]["reason_code"], "directory_unavailable");
    assert_eq!(row["lifecycle"]["runtime_generation"], 1);
}

#[test]
fn unavailable_or_unexpected_provider_threads_never_create_a_replacement() {
    for (flag, state, message) in [
        (
            "missing-thread",
            "partial",
            "could not inspect the saved conversation",
        ),
        (
            "resume-wrong-thread",
            "uncertain",
            "provider returned another conversation",
        ),
    ] {
        let mut f = Fixture::new();
        let id = stopped_saved_agent(&mut f);
        fs::write(f.dir.join(flag), "1").unwrap();
        let receipt = f.call(json!({"op":"resume-instance","session_id":id,"request_id":"provider-refusal","expected_runtime_generation":1}));
        assert_eq!(receipt["state"], state);
        assert!(
            receipt["error"].as_str().unwrap().contains(message),
            "{flag}: {receipt}"
        );
        let rows = f.call(json!({"op":"list"}));
        assert_eq!(rows.as_array().unwrap().len(), 1);
        assert_eq!(rows[0]["id"], id);
        assert_eq!(rows[0]["native_thread_id"], "worker-thread");
    }
}

#[test]
fn unsupported_registrations_refuse_resume_without_stopping_running_work() {
    let mut f = Fixture::new();
    let stopped = stopped_saved_agent(&mut f);
    f.call(json!({"op":"remove","session_id":stopped}));
    let external = f.call(json!({"op":"register","thread_id":"live-thread"}))["session_id"].clone();
    let shell = f.call(json!({"op":"create","open":false,"kind":"shell","request_id":"stopped-shell","name":"Shell","cwd":f.dir}))["session_id"].clone();
    f.call(json!({"op":"stop-instance","session_id":shell}));
    let running = f.call(json!({"op":"create","open":false,"kind":"codex","request_id":"still-running","name":"Running","cwd":f.dir}))["session_id"].clone();
    let pid = f.call(json!({"op":"attach-info","session_id":running}))["pid"].clone();
    for (id, reason) in [
        (stopped, "registration_removed"),
        (external, "external_owner"),
        (shell, "unsupported_kind"),
        (running.clone(), "already_running"),
    ] {
        assert!(client(&f.dir,json!({"op":"resume-instance","session_id":id,"request_id":format!("refuse-{id}"),"expected_runtime_generation":1})).unwrap_err().to_string().contains(reason));
    }
    assert_eq!(
        f.call(json!({"op":"attach-info","session_id":running}))["pid"],
        pid
    );
    assert_eq!(
        f.call(json!({"op":"operation","request_id":"still-running"}))["state"],
        "completed"
    );
    assert_eq!(
        Codex::connect(&f.socket).unwrap().loaded().unwrap(),
        vec!["live-thread", "other-thread"]
    );
}
