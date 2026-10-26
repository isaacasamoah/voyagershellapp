use super::{Runtime, Worker, actions, authority, string};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};

impl Runtime {
    pub(in crate::service) fn resume_availability(&self, record: &Value) -> Result<Value> {
        let session = string(record, "id")?;
        let runtime = record["lifecycle"]["runtime"].as_str().unwrap_or("unknown");
        let current = self.store.resume_record(session)?;
        let reason = if record["kind"] != "codex" {
            Some((
                "unsupported_kind",
                "Only saved Codex conversations can be resumed.".into(),
            ))
        } else if record["ownership"] != "managed" {
            Some((
                "external_owner",
                "Voyager did not start this conversation's runtime.".into(),
            ))
        } else if !record["removed_ms"].is_null() {
            Some((
                "registration_removed",
                "This registration has been removed.".into(),
            ))
        } else if runtime == "running" {
            Some((
                "already_running",
                "This agent is running. Use Open to attach a terminal.".into(),
            ))
        } else if current.as_ref().is_some_and(|v| v["state"] == "starting") {
            return Ok(
                json!({"state":"pending","request_id":current.unwrap()["request_id"],"reason_code":null,"reason":null}),
            );
        } else if runtime != "stopped" {
            Some((
                "outcome_unknown",
                "The earlier runtime's exit is not confirmed. Inspect its saved details.".into(),
            ))
        } else {
            let settings = current
                .as_ref()
                .map(|v| &v["settings"])
                .unwrap_or(&Value::Null);
            crate::worker::Settings::parse(settings, &self.executable)
                .err()
                .map(|e| {
                    let message = e.to_string();
                    (
                        if message.starts_with("directory_unavailable:") {
                            "directory_unavailable"
                        } else {
                            "settings_unavailable"
                        },
                        message,
                    )
                })
        };
        Ok(match reason {
            Some((code, reason)) => {
                json!({"state":"unavailable","request_id":null,"reason_code":code,"reason":reason})
            }
            None => json!({"state":"eligible","request_id":null,"reason_code":null,"reason":null}),
        })
    }

    pub(in crate::service) fn resume_instance(&mut self, request: &Value) -> Result<Value> {
        ensure!(
            authority::is_owner(&request["actor"]),
            "forbidden: only the app owner can resume a conversation"
        );
        let id = actions::request_id(request)?;
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
        let expected = request["expected_runtime_generation"]
            .as_i64()
            .filter(|v| *v >= 0)
            .context("invalid_input: choose the observed runtime generation")?;
        ensure!(
            !self.operations.values().any(|p| p.session == session),
            "busy: another lifecycle action is pending"
        );
        let mut record = self.store.session(session)?;
        record["lifecycle"] = self.store.runtime_observation(
            session,
            self.workers.get(session).is_some_and(|w| w.alive),
            record["ownership"] == "external",
        )?;
        let availability = self.resume_availability(&record)?;
        ensure!(
            availability["state"] != "pending",
            "busy: resume is already pending as {}",
            availability["request_id"]
        );
        ensure!(
            availability["state"] == "eligible",
            "{}: {}",
            availability["reason_code"]
                .as_str()
                .unwrap_or("outcome_unknown"),
            availability["reason"]
                .as_str()
                .unwrap_or("Resume is unavailable.")
        );
        let current = self
            .store
            .resume_record(session)?
            .context("outcome_unknown: runtime generation is unverified")?;
        let settings = crate::worker::Settings::parse(&current["settings"], &self.executable)?;
        let receipt = self
            .store
            .claim_resume(request, expected, &settings.snapshot)?;
        self.tests.grants.remove(session);
        let context = match self
            .credentials
            .issue(&self.state, &self.instance, session, id)
        {
            Ok(context) => context,
            Err(error) => {
                self.fail_resume(id, error.to_string(), true)?;
                return Ok(self
                    .store
                    .operation(id)?
                    .context("missing resume receipt")?
                    .1);
            }
        };
        let mode = crate::worker::ThreadStart::Resume(crate::worker::Resume {
            session: session.into(),
            native: string(&record, "native_thread_id")?.into(),
            generation: receipt["runtime_generation"]
                .as_i64()
                .context("missing generation")?,
            settings,
        });
        let cwd = string(&current["settings"]["effective"], "cwd")?;
        match Worker::begin(
            &self.state,
            &self.binary,
            &self.executable,
            id,
            cwd,
            mode,
            &context,
        ) {
            Ok(startup) => {
                self.creations.insert(id.into(), (request.clone(), startup));
            }
            Err(error) => self.fail_resume(id, error.to_string(), true)?,
        }
        Ok(self
            .store
            .operation(id)?
            .context("missing resume receipt")?
            .1)
    }

    pub(super) fn fail_resume(&mut self, id: &str, error: String, no_effect: bool) -> Result<()> {
        let (_, mut receipt) = self
            .store
            .operation(id)?
            .context("missing resume receipt")?;
        self.credentials.revoke(string(&receipt, "session_id")?)?;
        let transaction = self.store.0.unchecked_transaction()?;
        self.store
            .worker_state(id, if no_effect { "stopped" } else { "uncertain" })?;
        receipt["state"] = json!(if no_effect { "partial" } else { "uncertain" });
        receipt["runtime"] = json!(if no_effect { "stopped" } else { "unknown" });
        receipt["effects"][0]["state"] = json!(if no_effect { "failed" } else { "unknown" });
        receipt["error"] = json!(error);
        self.store.save_operation(id, &receipt)?;
        transaction.commit()?;
        Ok(())
    }

    pub(super) fn finish_resume(&mut self, request: &Value, session: &str) -> Result<()> {
        let id = actions::request_id(request)?;
        let (_, mut receipt) = self
            .store
            .operation(id)?
            .context("missing resume receipt")?;
        let row = self.store.session(session)?;
        receipt["state"] = json!("completed");
        receipt["runtime"] = json!("running");
        receipt["native_thread_id"] = row["native_thread_id"].clone();
        receipt["capture_generation"] = row["capture_generation"].clone();
        receipt["runtime_pid"] = self
            .workers
            .get(session)
            .context("resumed worker missing")?
            .attach()?["pid"]
            .clone();
        receipt["effects"][0]["state"] = json!("confirmed");
        self.store.local(session,"conversation.resumed",json!({"request_id":id,"runtime_generation":receipt["runtime_generation"],"task_submitted":false}))?;
        receipt["event_seq"] = json!(self.store.0.last_insert_rowid());
        self.store.save_operation(id, &receipt)
    }
}
