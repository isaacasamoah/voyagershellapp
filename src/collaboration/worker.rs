use super::{db::Db, model::Models, pipeline, resolution, types::*};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};

pub fn run(db: Db, state: PathBuf, receiver: mpsc::Receiver<Value>, status: Arc<Mutex<Value>>) {
    let mut config = Config::default();
    let mut remaining = 0usize;
    let mut models = None;
    let mut last_job = Value::Null;
    let mut jobs = std::collections::VecDeque::new();
    loop {
        match receiver.recv_timeout(if remaining > 0 {
            Duration::from_millis(10)
        } else {
            Duration::from_millis(500)
        }) {
            Ok(request) => {
                status.lock().unwrap()["working_job"] =
                    json!({"id":request["job_id"],"action":request["action"]});
                let result = command(&db, &request, &mut config, &mut remaining, &mut models);
                last_job = json!({"id":request["job_id"],"action":request["action"],"result":match result {Ok(v)=>v,Err(e)=>json!({"error":format!("{e:#}")})}});
                jobs.push_back(last_job.clone());
                if jobs.len() > 16 {
                    jobs.pop_front();
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        *status.lock().unwrap() = json!({"state":if remaining>0 {"running"} else {"paused"},"remaining":remaining,"config":config,"last_job":last_job,"recent_jobs":jobs});
        if remaining == 0 {
            continue;
        }
        let step = (|| -> Result<bool> {
            if config.follow {
                capture(&db, &state)?;
            }
            deliver(&db, &state)?;
            let Some((seq, event)) = db.next()? else {
                return Ok(false);
            };
            status.lock().unwrap()["processing"] =
                json!({"sequence":seq,"event_id":event.event_id});
            let result = pipeline::process(
                &db,
                models.as_ref().context("models unavailable")?,
                seq,
                &event,
                &config,
            );
            if let Err(error) = result {
                db.fail(seq, &format!("{error:#}"))?;
                return Err(error);
            }
            deliver(&db, &state)?;
            Ok(true)
        })();
        match step {
            Ok(true) => remaining -= 1,
            Ok(false) if !config.follow => remaining = 0,
            Ok(false) => std::thread::sleep(Duration::from_millis(500)),
            Err(e) => {
                remaining = 0;
                last_job["pipeline_error"] = json!(format!("{e:#}"));
            }
        }
    }
}

fn command(
    db: &Db,
    request: &Value,
    config: &mut Config,
    remaining: &mut usize,
    models: &mut Option<Models>,
) -> Result<Value> {
    match request["action"].as_str().unwrap_or("") {
        "pause" => {
            *remaining = 0;
            Ok(json!({"paused":true}))
        }
        "run" => {
            let next: Config = if request["data"].is_null() {
                Config::default()
            } else {
                serde_json::from_value(request["data"].clone())?
            };
            ensure!(
                (1024..=64000).contains(&next.window_chars) && (1..=500).contains(&next.max_events),
                "window_chars must be 1024..64000 and max_events 1..500"
            );
            if models.is_none() {
                *models = Some(Models::from_env()?);
            }
            *remaining = next.max_events;
            *config = next;
            Ok(json!({"started":true}))
        }
        "assign" => {
            let mut assignment: Assignment = serde_json::from_value(request["data"].clone())?;
            ensure!(
                !assignment.session_id.is_empty()
                    && assignment.session_id.len() <= 200
                    && !assignment.brief.trim().is_empty()
                    && assignment.brief.len() <= 8000,
                "invalid assignment"
            );
            assignment.topics.clear();
            assignment.direction.clear();
            let mut graph = db.graph()?;
            graph
                .assignments
                .retain(|a| a.session_id != assignment.session_id);
            ensure!(
                graph.assignments.len() < 10,
                "trial supports at most ten assignments"
            );
            let session = assignment.session_id.clone();
            graph.assignments.push(assignment);
            if !graph.topics.is_empty() {
                if models.is_none() {
                    *models = Some(Models::from_env()?);
                }
                pipeline::subscribe(db, models.as_ref().unwrap(), &mut graph, "assignment")?;
            }
            graph.revision += 1;
            let topics = &graph
                .assignments
                .iter()
                .find(|a| a.session_id == session)
                .unwrap()
                .topics;
            let ids: Vec<_> = graph
                .records
                .iter()
                .filter(|r| r.status == "current" && r.topics.iter().any(|t| topics.contains(t)))
                .map(|r| r.id.clone())
                .collect();
            pipeline::notify_to(
                &mut graph,
                &format!("assignment:{}", request["job_id"]),
                &ids,
                Some(&session),
            )?;
            db.save(&graph, None)?;
            Ok(json!({"assigned":session}))
        }
        "import" => {
            let events: Vec<SourceEvent> = serde_json::from_value(request["data"].clone())?;
            ensure!(events.len() <= 100, "import at most 100 events per request");
            let tx = db.0.unchecked_transaction()?;
            let mut inserted = 0;
            for event in &events {
                if db.insert(event)? {
                    inserted += 1;
                }
            }
            tx.commit()?;
            Ok(json!({"inserted":inserted}))
        }
        "resolve" => {
            let mut graph = db.graph()?;
            let session = request["data"]["session_id"]
                .as_str()
                .context("missing resolver session")?;
            let resolution = serde_json::from_value(request["data"]["resolution"].clone())?;
            resolution::apply(
                &mut graph,
                resolution,
                session,
                true,
                "explicit CLI resolution",
            )?;
            db.save(&graph, None)?;
            Ok(json!({"revision":graph.revision}))
        }
        _ => anyhow::bail!("unsupported action"),
    }
}

fn capture(db: &Db, state: &Path) -> Result<()> {
    let page = crate::service::client(state, json!({"op":"events","after":db.cursor()?}))?;
    let mut graph = db.graph()?;
    for event in page["events"].as_array().context("invalid event page")? {
        let session = event["session_id"]
            .as_str()
            .context("event missing session")?;
        if !graph.assignments.iter().any(|a| a.session_id == session) {
            continue;
        }
        let ty = event["type"].as_str().unwrap_or("");
        if ty != "message" && ty != "capture.gap" {
            continue;
        }
        let payload = &event["payload"];
        let text = payload["text"].as_str().unwrap_or("");
        let turn = event["native_turn_id"].as_str();
        let delivered = graph.notifications.iter().any(|n| {
            n.recipient == session
                && n.native_turn.as_deref() == turn
                && turn.is_some()
                && n.message == text
        });
        if delivered {
            continue;
        }
        let ambiguous_echo = graph.notifications.iter().any(|n| {
            n.recipient == session
                && n.native_turn.is_none()
                && n.state == "uncertain"
                && n.message == text
        });
        if ambiguous_echo {
            db.insert(&SourceEvent {
                event_id: event["event_id"]
                    .as_str()
                    .context("missing event ID")?
                    .into(),
                session_id: session.into(),
                role: "gap".into(),
                text: "Possible notification echo with uncertain receipt: held for inspection"
                    .into(),
                gap: true,
            })?;
            continue;
        }
        if payload["role"] == "assistant" {
            if let Some(value) = resolution::extract(text) {
                let outcome = (|| -> Result<()> {
                    let resolution = serde_json::from_value(value.clone())?;
                    resolution::apply(
                        &mut graph,
                        resolution,
                        session,
                        false,
                        event["event_id"].as_str().unwrap_or(""),
                    )
                })();
                db.attempt(
                    event["event_id"].as_str().unwrap_or(""),
                    "resolution",
                    &value,
                    &match outcome {
                        Ok(()) => json!({"accepted":true,"revision":graph.revision}),
                        Err(e) => json!({"error":e.to_string()}),
                    },
                    0,
                )?;
                continue;
            }
        }
        let gap = ty == "capture.gap" || payload["truncated"] == true;
        db.insert(&SourceEvent {
            event_id: event["event_id"]
                .as_str()
                .context("event missing ID")?
                .into(),
            session_id: session.into(),
            role: if gap {
                "gap"
            } else {
                payload["role"].as_str().context("event missing role")?
            }
            .into(),
            text: if gap {
                "Capture gap: omitted or truncated content".into()
            } else {
                text.into()
            },
            gap,
        })?;
    }
    db.save(&graph, None)?;
    db.set_cursor(page["cursor"].as_i64().context("missing cursor")?)
}

fn deliver(db: &Db, state: &Path) -> Result<()> {
    let mut graph = db.graph()?;
    for index in 0..graph.notifications.len() {
        if graph.notifications[index].state != "queued" {
            continue;
        }
        let n = graph.notifications[index].clone();
        let assignment = graph
            .assignments
            .iter()
            .find(|a| a.session_id == n.recipient)
            .context("missing delivery assignment")?;
        if !assignment.delivery {
            continue;
        }
        let mode = assignment.delivery_mode.clone();
        graph.notifications[index].state = "dispatching".into();
        db.save(&graph, None)?;
        let reply = crate::service::client(
            state,
            json!({"op":"send","session_id":n.recipient,"request_id":n.id,"message":n.message,"delivery_mode":mode}),
        );
        let item = &mut graph.notifications[index];
        match reply {
            Ok(value) => {
                item.state = value["state"].as_str().unwrap_or("uncertain").into();
                item.native_turn = value["native_turn_id"].as_str().map(str::to_owned);
                item.error = None;
            }
            Err(error) => {
                let text = error.to_string();
                if text.starts_with("busy:") {
                    item.state = "queued".into();
                } else {
                    item.state = "uncertain".into();
                }
                item.error = Some(text);
            }
        }
        db.save(&graph, None)?;
    }
    Ok(())
}
