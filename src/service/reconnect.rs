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
}

enum Phase {
    Checking {
        ready: Receiver<Result<Worker>>,
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
    pub(super) fn recovery_status(&self, session: &str) -> Value {
        if self
            .workers
            .get(session)
            .is_some_and(|w| w.alive && w.connection.is_some())
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
                && current.as_ref().is_some_and(|r| r["state"] == "unknown");
            let connected = self
                .workers
                .get(id)
                .is_some_and(|w| w.alive && w.connection.is_some());
            let capture = row["capture_generation"]
                .as_i64()
                .context("capture identity missing")?;
            let mut recovery = match self.recoveries.0.remove(id) {
                Some(recovery) => recovery,
                None if eligible && !connected => Recovery {
                    runtime: current.clone().context("runtime disappeared")?,
                    capture,
                    attempts: 0,
                    phase: Phase::Waiting {
                        at: Instant::now(),
                        reason: String::new(),
                    },
                },
                None => continue,
            };
            let stale = current.as_ref() != Some(&recovery.runtime) || capture != recovery.capture;
            if !eligible || connected || stale {
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
                if !eligible || connected {
                    continue;
                }
                match result.and_then(|worker| {
                    self.admit_recovery(&row, &recovery.runtime, recovery.capture, worker)
                }) {
                    Ok(()) => continue,
                    Err(error) => {
                        let reason = format!("Could not reconnect this Vessel: {error}");
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
            if !eligible || connected {
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
                        let deadline = Instant::now() + Duration::from_secs(10);
                        let cancelled = Arc::new(AtomicBool::new(false));
                        let cancellation = Arc::clone(&cancelled);
                        thread::spawn(move || {
                            let _ = sender.send(Worker::recover(&record, &receipt, &operation, &context, deadline, &cancellation));
                        });
                        recovery.attempts += 1;
                        recovery.phase = Phase::Checking { ready, deadline, cancelled };
                    }
                    _ => recovery.phase = Phase::Disconnected("The saved runtime has no confirmed launch receipt. No replacement was started.".into()),
                }
            }
            self.recoveries.0.insert(id.into(), recovery);
        }
        Ok(())
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
