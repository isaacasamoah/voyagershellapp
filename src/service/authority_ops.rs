use super::{Runtime, string};
use crate::{
    actions,
    authority::{self, Rank},
};
use anyhow::{Context, Result, ensure};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};

impl Runtime {
    pub(super) fn authorize(&self, request: &Value) -> Result<()> {
        let actor = &request["actor"];
        if request["purpose"] == "escalation" && !authority::is_owner(actor) {
            let id = authority::actor_id(actor)?;
            self.store.require_registered(id)?;
            ensure!(
                self.store.session(id)?["supervisor_id"] == request["session_id"],
                "forbidden: escalation destination changed before dispatch"
            );
            return Ok(());
        }
        authority::authorize(&self.store, actor, self.control.session(), request)
    }
    pub(super) fn can_read(&self, actor: &Value, target: &str) -> Result<bool> {
        if authority::is_owner(actor) {
            return Ok(true);
        }
        let id = authority::actor_id(actor)?;
        self.store.require_registered(id)?;
        Ok(self.store.generation(target)?.is_some()
            && (id == target
                || (actor["kind"] == "instance" && self.control.session() == Some(id))
                || authority::direct(&self.store, id, target)?))
    }
    pub(super) fn capabilities(&self, request: &Value) -> Result<Value> {
        let actor = &request["actor"];
        let target = request["session_id"]
            .as_str()
            .or(actor["session_id"].as_str());
        let mut result = json!({"actor":actor,"rank":null,"supervisor_id":null,"direct_report_ids":[],"permitted_actions":["list","status","capabilities","events","operation"],"dock_generation":null});
        if let Some(id) = target {
            let s = self.store.session(id)?;
            self.store.require_registered(id)?;
            result["rank"] = s["rank"].clone();
            result["supervisor_id"] = s["supervisor_id"].clone();
            result["session_id"] = json!(id);
            result["direct_report_ids"] = json!(
                self.store
                    .sessions()?
                    .into_iter()
                    .filter(|s| s["supervisor_id"] == id && s["removed_ms"].is_null())
                    .map(|s| s["id"].clone())
                    .collect::<Vec<_>>()
            );
        }
        let owner = authority::is_owner(actor);
        let dock = actor["session_id"]
            .as_str()
            .is_some_and(|id| self.control.session() == Some(id))
            && actor["kind"] == "instance";
        if owner || dock {
            result["permitted_actions"] = json!([
                "list",
                "status",
                "capabilities",
                "events",
                "operation",
                "send",
                "adjudicate",
                "escalate",
                "report",
                "create",
                "launch",
                "open",
                "background",
                "stop-instance",
                "shell-exec",
                "shell-read"
            ]);
        } else if actor["kind"] == "instance" {
            result["permitted_actions"] = json!([
                "list",
                "status",
                "capabilities",
                "events",
                "operation",
                "report",
                "escalate",
                "send_direct_report",
                "adjudicate_direct_report",
                "create_next_rank",
                "open_self_or_report",
                "background_direct_report",
                "stop_direct_report"
            ]);
        }
        if owner {
            result["owner_actions"] = json!([
                "rank",
                "supervise",
                "rename",
                "rename-fleet",
                "remove",
                "register-instance",
                "dock",
                "undock",
                "stop",
                "escalations"
            ]);
        }
        if dock {
            result["dock_generation"] = self.control.current()["generation"].clone();
        }
        Ok(result)
    }
    pub(super) fn authority_operation(&mut self, request: &Value) -> Result<Value> {
        let id = actions::request_id(request)?;
        if let Some((inputs, receipt)) = self.store.operation(id)? {
            ensure!(
                inputs == *request,
                "request_conflict: coordination ID has different inputs"
            );
            return Ok(receipt);
        }
        ensure!(
            self.store.request(id)?.is_none(),
            "request_conflict: ID already names a task"
        );
        let op = string(request, "op")?;
        let actor = &request["actor"];
        let owner = authority::is_owner(actor);
        let mut receipt =
            json!({"request_id":id,"state":"completed","actor":actor,"action":op,"event_seq":null});
        let target = match op {
            "rank" | "supervise" | "adjudicate" => string(request, "session_id")?.to_owned(),
            _ => authority::actor_id(actor)?.to_owned(),
        };
        self.store.require_registered(&target)?;
        receipt["session_id"] = json!(target);
        match op {
            "rank" => {
                ensure!(owner, "forbidden: only owner changes rank");
                let rank = Rank::parse(string(request, "rank")?)?;
                let mut record = self.store.session(&target)?;
                ensure!(record["kind"] == "codex", "invalid_input: Bash has no rank");
                receipt["previous_rank"] = record["rank"].clone();
                record["rank"] = json!(rank.as_str());
                let mut affected = Vec::new();
                if let Some(parent) = record["supervisor_id"].as_str() {
                    if authority::assignment(&self.store, &record, parent).is_err() {
                        affected.push(json!(target));
                    }
                }
                for report in self
                    .store
                    .sessions()?
                    .iter()
                    .filter(|s| s["supervisor_id"] == target && s["removed_ms"].is_null())
                {
                    let valid = match authority::rank(report)? {
                        Some(r) => rank.supervises(r),
                        None => rank != Rank::Crew,
                    };
                    if !valid {
                        affected.push(report["id"].clone());
                    }
                }
                ensure!(
                    affected.is_empty(),
                    "invalid_input: rank would invalidate assignments: {}",
                    json!(affected)
                );
                let transaction = self.store.0.unchecked_transaction()?;
                self.store.0.execute(
                    "UPDATE sessions SET rank=?2 WHERE id=?1",
                    params![target, rank.as_str()],
                )?;
                receipt["rank"] = json!(rank.as_str());
                self.store
                    .local(&target, "authority.rank", receipt.clone())?;
                self.store.begin_operation(id, request, &receipt)?;
                transaction.commit()?;
                Ok(receipt)
            }
            "supervise" => {
                ensure!(owner, "forbidden: only owner changes assignments");
                let supervisor = request
                    .get("supervisor_id")
                    .context("invalid_input: missing supervisor_id")?;
                if !supervisor.is_null() {
                    authority::assignment(
                        &self.store,
                        &self.store.session(&target)?,
                        supervisor
                            .as_str()
                            .context("invalid_input: supervisor_id must be a UUID or null")?,
                    )?;
                }
                let previous = self.store.session(&target)?["supervisor_id"].clone();
                let transaction = self.store.0.unchecked_transaction()?;
                self.store.0.execute(
                    "UPDATE sessions SET supervisor_id=?2 WHERE id=?1",
                    params![target, supervisor.as_str()],
                )?;
                receipt["supervisor_id"] = supervisor.clone();
                receipt["previous_supervisor_id"] = previous;
                self.store
                    .local(&target, "authority.supervise", receipt.clone())?;
                self.store.begin_operation(id, request, &receipt)?;
                transaction.commit()?;
                Ok(receipt)
            }
            "report" | "escalate" | "adjudicate" => {
                ensure!(
                    actor["kind"] != "terminal",
                    "forbidden: terminal cannot report or coordinate"
                );
                let message = string(request, "message")?;
                ensure!(
                    message.len() <= crate::events::TEXT_LIMIT,
                    "invalid_input: message too long"
                );
                let decision = if op == "adjudicate" {
                    let d = string(request, "decision")?;
                    ensure!(
                        ["accept", "revise", "resolve"].contains(&d),
                        "invalid_input: unknown decision"
                    );
                    Some(d)
                } else {
                    None
                };
                if let Some(about) = request.get("about_request_id") {
                    let task = self
                        .store
                        .request(
                            about
                                .as_str()
                                .context("invalid_input: about_request_id must be a string")?,
                        )?
                        .context("not_found: referenced task")?;
                    let task_session = string(&task, "session_id")?;
                    ensure!(
                        self.can_read(actor, task_session)?
                            && (task_session == target
                                || task["actor_session_id"] == actor["session_id"]),
                        "forbidden: task reference outside coordination scope"
                    );
                }
                if let Some(reply) = request.get("reply_to") {
                    ensure!(
                        op == "adjudicate" && owner,
                        "forbidden: only owner answers owner escalation"
                    );
                    let (inputs, original) = self
                        .store
                        .operation(
                            reply
                                .as_str()
                                .context("invalid_input: reply_to must be a string")?,
                        )?
                        .context("not_found: escalation")?;
                    ensure!(
                        inputs["op"] == "escalate"
                            && (original["destination"].is_null()
                                || ["failed", "uncertain"]
                                    .iter()
                                    .any(|state| original["delivery"] == *state))
                            && original["session_id"] == target,
                        "invalid_input: reply target does not match escalation"
                    );
                    receipt["reply_to"] = reply.clone();
                    if let Some(turn) = request.get("human_turn_id") {
                        ensure!(
                            turn.as_str()
                                .is_some_and(|id| !id.is_empty() && id.len() <= 128),
                            "invalid_input: human turn identity"
                        );
                        receipt["human_turn_id"] = turn.clone();
                    }
                }
                let destination = if op == "report" {
                    None
                } else if op == "adjudicate" {
                    Some(target.clone())
                } else {
                    self.store.session(&target)?["supervisor_id"]
                        .as_str()
                        .map(str::to_owned)
                };
                receipt["destination"] = json!(destination);
                receipt["message"] = json!(message);
                receipt["decision"] = json!(decision);
                receipt["about_request_id"] = request["about_request_id"].clone();
                receipt["delivery"] = json!("recorded");
                if destination.is_some() {
                    receipt["task_request_id"] = json!(format!("coord:{}", uuid::Uuid::new_v4()));
                }
                let transaction = self.store.0.unchecked_transaction()?;
                self.store.begin_operation(id, request, &receipt)?;
                self.store
                    .local(&target, &format!("coordination.{op}"), receipt.clone())?;
                transaction.commit()?;
                if let Some(destination) = destination {
                    let purpose = if op == "adjudicate" {
                        "adjudication"
                    } else {
                        "escalation"
                    };
                    let delivery = json!({"op":"send","session_id":destination,"request_id":receipt["task_request_id"],"message":format!("[Voyager {purpose}; actor {}; decision {}] {message}",actor["session_id"].as_str().unwrap_or("owner"),decision.unwrap_or("none")),"actor":actor,"purpose":purpose,"about_request_id":request["about_request_id"],"coordination_id":id,"control_generation":request.get("control_generation").cloned().unwrap_or(Value::Null)});
                    let mut delivery = delivery;
                    if delivery["control_generation"].is_null() {
                        delivery
                            .as_object_mut()
                            .context("delivery")?
                            .remove("control_generation");
                    }
                    if let Err(error) = self.begin_native(delivery, None) {
                        receipt["delivery"] = json!("failed");
                        receipt["error"] = json!(error.to_string());
                        self.store.save_operation(id, &receipt)?;
                    }
                }
                Ok(receipt)
            }
            _ => unreachable!(),
        }
    }
    pub(super) fn escalations(&self) -> Result<Value> {
        let mut query=self.store.0.prepare("SELECT receipt FROM operations WHERE json_extract(inputs,'$.op')='escalate' AND (json_extract(receipt,'$.destination') IS NULL OR json_extract(receipt,'$.delivery') IN ('failed','uncertain')) ORDER BY created_ms")?;
        let rows = query
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut output = Vec::new();
        for row in rows {
            let mut receipt: Value = serde_json::from_str(&row)?;
            let id = string(&receipt, "request_id")?;
            let answered:bool=self.store.0.query_row("SELECT EXISTS(SELECT 1 FROM operations WHERE json_extract(inputs,'$.op')='adjudicate' AND json_extract(inputs,'$.reply_to')=?1)",[id],|r|r.get(0))?;
            let answer: Option<String> = self.store.0.query_row("SELECT receipt FROM operations WHERE json_extract(inputs,'$.op')='adjudicate' AND json_extract(inputs,'$.reply_to')=?1 ORDER BY created_ms DESC LIMIT 1", [id], |r| r.get(0)).optional()?;
            receipt["answer"] = answer
                .map(|raw| serde_json::from_str::<Value>(&raw))
                .transpose()?
                .unwrap_or(Value::Null);
            receipt["answered"] = json!(answered);
            let session = self.store.session(string(&receipt, "session_id")?)?;
            receipt["registered"] = json!(session["removed_ms"].is_null());
            receipt["source_name"] = session["name"].clone();
            output.push(receipt);
        }
        Ok(json!(output))
    }
    pub(super) fn coordination_delivery(
        &self,
        input: &Value,
        delivery: &str,
        task: Option<Value>,
    ) -> Result<()> {
        if let Some(id) = input["coordination_id"].as_str() {
            let mut receipt = self
                .store
                .operation(id)?
                .context("coordination operation missing")?
                .1;
            receipt["delivery"] = json!(delivery);
            receipt["native_request"] = json!(task);
            if ["failed", "uncertain"].contains(&delivery) {
                receipt["error"] = json!(format!(
                    "Native delivery {delivery}: {}",
                    receipt["native_request"]["error_code"]
                        .as_str()
                        .unwrap_or("provider_failed")
                ));
            }
            self.store.save_operation(id, &receipt)?;
            self.store.local(string(&receipt,"session_id")?,"coordination.delivery",json!({"request_id":id,"destination":receipt["destination"],"delivery":delivery,"actor":input["actor"]}))?;
        }
        Ok(())
    }
}
