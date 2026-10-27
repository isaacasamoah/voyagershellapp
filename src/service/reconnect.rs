use super::{Credentials, Runtime, Worker, string};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, TryRecvError, channel},
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Default)]
pub(super) struct Recoveries(HashMap<String, Recovery>);

struct Recovery {
    runtime: Value,
    capture: i64,
    attempts: u8,
    phase: Phase,
    requests: Vec<String>,
}

enum Checked {
    Runtime(Box<Worker>, Option<crate::viewer::Recovery>),
    Viewer(crate::viewer::Recovery),
}

enum Phase {
    Checking {
        ready: Receiver<Result<Checked>>,
        deadline: Instant,
        cancelled: Arc<AtomicBool>,
    },
    Waiting {
        at: Instant,
        reason: String,
    },
    Disconnected(String),
}

impl Runtime {
    pub(super) fn reconnect_instance(&mut self, request: &Value) -> Result<Value> {
        ensure!(
            crate::authority::is_owner(&request["actor"]),
            "forbidden: only the app owner can retry a connection"
        );
        let id = crate::actions::request_id(request)?;
        if let Some((inputs, receipt)) = self.store.operation(id)? {
            ensure!(
                inputs == *request,
                "request_conflict: this request ID has different inputs"
            );
            return Ok(receipt);
        }
        ensure!(
            self.store.request(id)?.is_none(),
            "request_conflict: this ID already names a task"
        );
        let session = string(request, "session_id")?;
        let row = self.store.session(session)?;
        let runtime = self
            .store
            .resume_record(session)?
            .context("unavailable: this Vessel has no saved runtime")?;
        ensure!(
            row["kind"] == "codex" && row["ownership"] == "managed" && row["removed_ms"].is_null(),
            "unavailable: only a registered managed Codex Vessel can reconnect"
        );
        ensure!(
            runtime["state"] == "running" || runtime["state"] == "unknown",
            "stopped: use Resume for this Vessel"
        );
        let generation = request["expected_runtime_generation"]
            .as_i64()
            .filter(|v| *v >= 0)
            .context("invalid_input: choose the observed runtime generation")?;
        ensure!(
            runtime["generation"] == generation,
            "stale_runtime: refresh this Vessel before retrying"
        );
        ensure!(
            !self.operations.values().any(|p| p.session == session),
            "busy: another lifecycle action is pending"
        );
        let mut receipt = json!({"action":"reconnect-instance","request_id":id,"session_id":session,"runtime_generation":generation,"state":"pending","effects":[]});
        if self.recovery_status(session)["state"] == "connected" {
            receipt["state"] = json!("completed");
        }
        let capture = row["capture_generation"]
            .as_i64()
            .context("capture identity missing")?;
        self.store.begin_operation(id, request, &receipt)?;
        if receipt["state"] == "pending" {
            let recovery = self
                .recoveries
                .0
                .entry(session.into())
                .or_insert_with(|| Recovery {
                    runtime,
                    capture,
                    attempts: 0,
                    phase: Phase::Waiting {
                        at: Instant::now(),
                        reason: String::new(),
                    },
                    requests: Vec::new(),
                });
            if matches!(recovery.phase, Phase::Disconnected(_)) {
                recovery.runtime = self
                    .store
                    .resume_record(session)?
                    .context("runtime disappeared")?;
                recovery.capture = self
                    .store
                    .generation(session)?
                    .context("capture disappeared")?;
                recovery.attempts = 0;
                recovery.phase = Phase::Waiting {
                    at: Instant::now(),
                    reason: String::new(),
                };
            }
            recovery.requests.push(id.into());
        }
        Ok(receipt)
    }

    fn finish_retries(&self, recovery: &mut Recovery, error: Option<&str>) -> Result<()> {
        for id in &recovery.requests {
            let (_, mut receipt) = self
                .store
                .operation(id)?
                .context("connection receipt disappeared")?;
            receipt["state"] = json!(if error.is_some() {
                "partial"
            } else {
                "completed"
            });
            if let Some(reason) = error {
                receipt["error"] = json!(reason);
            }
            self.store.save_operation(id, &receipt)?;
        }
        recovery.requests.clear();
        Ok(())
    }

    pub(super) fn recovery_status(&self, session: &str) -> Value {
        if self
            .workers
            .get(session)
            .is_some_and(|w| w.alive && w.connection.is_some())
            && !self.viewer_errors.contains_key(session)
        {
            return json!({"state":"connected","reason":null,"retry_available":false});
        }
        match self.recoveries.0.get(session).map(|r| &r.phase) {
            Some(Phase::Waiting { reason, .. }) => {
                json!({"state":"checking","reason":reason,"retry_available":false})
            }
            Some(Phase::Checking { deadline, .. }) => {
                json!({"state":"checking","reason":if Instant::now() >= *deadline {Some("Closing the timed-out connection check.")} else {None},"retry_available":false})
            }
            Some(Phase::Disconnected(reason)) => {
                json!({"state":"disconnected","reason":reason,"retry_available":true})
            }
            None => Value::Null,
        }
    }

    pub(super) fn advance_recoveries(&mut self) -> Result<()> {
        for row in self.store.sessions()? {
            if row["kind"] != "codex" || row["ownership"] != "managed" {
                continue;
            }
            let id = string(&row, "id")?;
            let current = self.store.resume_record(id)?;
            let eligible = row["removed_ms"].is_null()
                && current
                    .as_ref()
                    .is_some_and(|r| r["state"] == "unknown" || r["state"] == "running");
            let connected = self
                .workers
                .get(id)
                .is_some_and(|w| w.alive && w.connection.is_some());
            let needs_check = !connected || self.viewer_errors.contains_key(id);
            let capture = row["capture_generation"]
                .as_i64()
                .context("capture identity missing")?;
            let mut recovery = match self.recoveries.0.remove(id) {
                Some(recovery) => recovery,
                None if eligible && needs_check => Recovery {
                    runtime: current.clone().context("runtime disappeared")?,
                    capture,
                    attempts: 0,
                    requests: Vec::new(),
                    phase: Phase::Waiting {
                        at: Instant::now(),
                        reason: String::new(),
                    },
                },
                None => continue,
            };
            let stale = current.as_ref() != Some(&recovery.runtime) || capture != recovery.capture;
            if !eligible || !needs_check || stale {
                if let Phase::Checking { cancelled, .. } = &recovery.phase {
                    cancelled.store(true, Ordering::Release);
                }
            }
            let result = match &mut recovery.phase {
                Phase::Checking { ready, .. } => match ready.try_recv() {
                    Ok(result) => Some(result),
                    Err(TryRecvError::Disconnected) => {
                        Some(Err(anyhow::anyhow!("Native connection check ended.")))
                    }
                    Err(TryRecvError::Empty) => None,
                },
                _ => None,
            };
            if let Some(result) = result {
                if !eligible || !needs_check {
                    self.finish_retries(
                        &mut recovery,
                        (!eligible || stale).then_some(
                            "The Vessel changed or is no longer available to reconnect.",
                        ),
                    )?;
                    continue;
                }
                match result.and_then(|checked| {
                    ensure!(
                        !stale,
                        "The Vessel changed during the connection check. Refresh before retrying."
                    );
                    match checked {
                        Checked::Runtime(worker, viewer) => {
                            ensure!(!connected, "The runtime connection changed during recovery");
                            self.admit_recovery(
                                &row,
                                &recovery.runtime,
                                recovery.capture,
                                *worker,
                            )?;
                            if let Some(viewer) = viewer {
                                self.admit_viewer(id, viewer);
                            }
                        }
                        Checked::Viewer(viewer) => {
                            ensure!(
                                connected,
                                "The runtime disconnected while checking its terminal"
                            );
                            self.admit_viewer(id, viewer);
                        }
                    }
                    ensure!(
                        !self.viewer_errors.contains_key(id),
                        "{}",
                        self.viewer_errors
                            .get(id)
                            .map(String::as_str)
                            .unwrap_or("Terminal could not be verified")
                    );
                    Ok(())
                }) {
                    Ok(()) => {
                        self.finish_retries(&mut recovery, None)?;
                        continue;
                    }
                    Err(error) => {
                        let reason = format!("Could not reconnect this Vessel: {error}");
                        if !stale {
                            recovery.runtime = self
                                .store
                                .resume_record(id)?
                                .context("runtime disappeared")?;
                            recovery.capture =
                                self.store.generation(id)?.context("capture disappeared")?;
                        }
                        recovery.phase = if recovery.attempts < 3 && !stale {
                            Phase::Waiting {
                                at: Instant::now() + Duration::from_secs(1),
                                reason,
                            }
                        } else {
                            Phase::Disconnected(reason)
                        };
                    }
                }
            }
            if matches!(recovery.phase, Phase::Checking { .. }) {
                self.recoveries.0.insert(id.into(), recovery);
                continue;
            }
            if !eligible || !needs_check {
                self.finish_retries(
                    &mut recovery,
                    (!eligible || stale)
                        .then_some("The Vessel changed or is no longer available to reconnect."),
                )?;
                continue;
            }
            if stale {
                recovery.phase = Phase::Disconnected("The Vessel changed during the connection check. Retry using its current state.".into());
            }
            if matches!(recovery.phase, Phase::Waiting { at, .. } if Instant::now() >= at) {
                let operation = string(&recovery.runtime, "request_id")?.to_owned();
                let receipt = self
                    .store
                    .operation(&operation)?
                    .map(|(_, receipt)| receipt);
                match receipt {
                    Some(receipt) if receipt["state"] == "completed" => {
                        let (sender, ready) = channel();
                        let context = Credentials::locator(&self.state, &operation);
                        let record = row.clone();
                        let check_viewer = !self.terminals.iter().any(|t| t.session == id);
                        let saved_viewer = self.store.viewer_receipt(id)?;
                        let attachment = if connected { Some(self.workers.get(id).context("runtime disappeared")?.attach()?) } else { None };
                        let deadline = Instant::now() + Duration::from_secs(10);
                        let cancelled = Arc::new(AtomicBool::new(false));
                        let cancellation = Arc::clone(&cancelled);
                        thread::spawn(move || {
                            let result = if let Some(attachment) = attachment {
                                crate::viewer::recover(saved_viewer.as_ref(), &attachment).map(Checked::Viewer)
                            } else { Worker::recover(&record, &receipt, &operation, &context, deadline, &cancellation).map(|worker| {
                                let viewer = check_viewer.then(|| {
                                    let result = worker.attach().and_then(|attachment| {
                                        crate::viewer::recover(saved_viewer.as_ref(), &attachment)
                                    });
                                    result.unwrap_or_else(|error| crate::viewer::Recovery::Unknown(error.to_string()))
                                });
                                Checked::Runtime(Box::new(worker), viewer)
                            }) };
                            let _ = sender.send(result);
                        });
                        recovery.attempts += 1;
                        recovery.phase = Phase::Checking { ready, deadline, cancelled };
                    }
                    _ => recovery.phase = Phase::Disconnected("The saved runtime has no confirmed launch receipt. No replacement was started.".into()),
                }
            }
            if let Phase::Disconnected(reason) = &recovery.phase {
                let reason = reason.clone();
                self.finish_retries(&mut recovery, Some(&reason))?;
            }
            self.recoveries.0.insert(id.into(), recovery);
        }
        Ok(())
    }

    fn admit_viewer(&mut self, session: &str, viewer: crate::viewer::Recovery) {
        use crate::viewer::Recovery;
        match viewer {
            Recovery::Open {
                kind,
                process,
                window,
            } => {
                self.viewer_errors.remove(session);
                self.viewer_choices.insert(session.to_owned(), kind);
                self.terminals.push(super::Terminal {
                    kind,
                    session: session.to_owned(),
                    process,
                    window: Some(window),
                });
            }
            Recovery::Closed => {
                self.viewer_errors.remove(session);
            }
            Recovery::Unknown(reason) => {
                self.viewer_errors.insert(session.to_owned(), reason);
            }
        }
    }

    fn admit_recovery(
        &mut self,
        row: &Value,
        runtime: &Value,
        capture: i64,
        mut worker: Worker,
    ) -> Result<()> {
        let id = string(row, "id")?;
        ensure!(
            self.store.resume_record(id)?.as_ref() == Some(runtime)
                && self.store.generation(id)? == Some(capture),
            "Vessel registration or runtime changed during recovery"
        );
        if let Some(existing) = self.workers.get(id) {
            ensure!(
                existing.alive && existing.identity()? == worker.identity()?,
                "managed runtime changed during recovery"
            );
        } else {
            self.credentials
                .issue(&self.state, &self.instance, id, &worker.launch)?;
        }
        let transaction = self.store.0.unchecked_transaction()?;
        let generation = self.store.reactivate(id)?;
        self.store.worker_state(&worker.launch, "running")?;
        self.store.local(id, "capture.gap", json!({"reason":"runtime_reconnected","replay_available":false,"runtime_generation":runtime["generation"]}))?;
        transaction.commit()?;
        worker.generation = generation;
        if let Some(existing) = self.workers.get_mut(id) {
            existing.connection = worker.connection.take();
            existing.generation = generation;
        } else {
            self.workers.insert(id.into(), worker);
        }
        Ok(())
    }
}
