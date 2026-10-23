use super::{Runtime, string};
use crate::{
    actions, authority,
    development::{self, Candidate, Mode},
};
use anyhow::{Context, Result, ensure};
use rusqlite::OptionalExtension;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
};

#[derive(Default)]
pub(super) struct Tests {
    pub grants: HashMap<String, PathBuf>,
    pub runs: HashMap<String, Run>,
}

pub(super) struct Run {
    child: Child,
    lease: Option<ChildStdin>,
    pub receipt: Value,
}

impl Tests {
    pub fn active(&self) -> bool {
        self.runs.values().any(|run| {
            run.receipt["run_state"] == "running" || run.receipt["run_state"] == "stopping"
        })
    }
}

impl Runtime {
    pub(super) fn test_saved(&self, id: &str) -> Result<Value> {
        let raw: Option<String> = self.store.0.query_row(
            "SELECT receipt FROM operations WHERE json_extract(receipt,'$.action')='test-start' AND json_extract(receipt,'$.run_id')=?1",
            [id], |row| row.get(0),
        ).optional()?;
        Ok(serde_json::from_str(
            &raw.context("not_found: development run")?,
        )?)
    }

    pub(super) fn test_authorize(&self, request: &Value) -> Result<()> {
        let actor = &request["actor"];
        if !authority::is_owner(actor) {
            self.store.require_registered(authority::actor_id(actor)?)?;
        }
        let own = request["run_id"]
            .as_str()
            .and_then(|id| self.test_saved(id).ok())
            .is_some_and(|run| run["actor"] == *actor);
        let granted = actor["session_id"]
            .as_str()
            .is_some_and(|id| self.tests.grants.contains_key(id));
        authority::development(actor, string(request, "op")?, granted, own)
    }

    pub(super) fn test_operation(&mut self, request: &Value) -> Result<Value> {
        let op = string(request, "op")?;
        let actor = &request["actor"];
        let allowed: &[&str] = match op {
            "test-grant" => &["session_id", "checkout", "request_id"],
            "test-revoke" => &["session_id", "request_id"],
            "test-start" => &["mode", "request_id"],
            "test-stop" => &["run_id", "request_id"],
            "test-read" => &["run_id", "offset"],
            _ => &[],
        };
        ensure!(
            request
                .as_object()
                .context("invalid_input: request")?
                .keys()
                .all(|key| ["op", "actor"].contains(&key.as_str())
                    || allowed.contains(&key.as_str())),
            "invalid_input: unsupported development argument"
        );
        if op == "test-runs" {
            let mut query = self.store.0.prepare("SELECT json_remove(receipt,'$.result') FROM operations WHERE json_extract(receipt,'$.action')='test-start' AND (?1 OR actor_session_id=?2) ORDER BY rowid DESC LIMIT 64")?;
            let rows = query.query_map(
                rusqlite::params![authority::is_owner(actor), actor["session_id"].as_str()],
                |row| row.get::<_, String>(0),
            )?;
            return Ok(json!(
                rows.map(|row| Ok(serde_json::from_str::<Value>(&row?)?))
                    .collect::<Result<Vec<_>>>()?
            ));
        }
        if op == "test-read" {
            let run = self.test_saved(string(request, "run_id")?)?;
            let offset = request.get("offset").map_or(Ok(0), |v| {
                v.as_u64().context("invalid_input: offset must be unsigned")
            })?;
            let (bytes, next) = development::read_page(
                &Path::new(string(&run, "state_dir")?).join("test.log"),
                offset,
                32 * 1024,
            )?;
            return Ok(
                json!({"run_id":run["run_id"],"offset":offset,"next":next,"text":String::from_utf8_lossy(&bytes)}),
            );
        }
        let id = actions::request_id(request)?;
        ensure!(id.len() <= 100, "invalid_input: request ID too long");
        if let Some((inputs, receipt)) = self.store.operation(id)? {
            ensure!(
                inputs == *request,
                "request_conflict: development ID has different inputs"
            );
            return Ok(receipt);
        }
        ensure!(
            self.store.request(id)?.is_none(),
            "request_conflict: ID already names a task"
        );
        let mut receipt = json!({"request_id":id,"action":op,"actor":actor,"state":"completed"});
        match op {
            "test-grant" | "test-revoke" => {
                let target = string(request, "session_id")?;
                self.store.require_registered(target)?;
                ensure!(
                    self.store.session(target)?["kind"] == "codex",
                    "invalid_input: grant requires an agent"
                );
                let checkout = if op == "test-grant" {
                    let path = Path::new(string(request, "checkout")?);
                    ensure!(
                        path.is_absolute(),
                        "invalid_input: checkout must be absolute"
                    );
                    let path = fs::canonicalize(path)?;
                    ensure!(
                        path.join("Cargo.toml").is_file()
                            && path.join("desktop/package.json").is_file(),
                        "invalid_input: expected Voyager source checkout"
                    );
                    Some(path)
                } else {
                    None
                };
                receipt["grantee"] = json!(target);
                receipt["checkout"] = json!(checkout);
                self.store.begin_operation(id, request, &receipt)?;
                if let Some(checkout) = checkout {
                    self.tests.grants.insert(target.to_owned(), checkout);
                } else {
                    self.tests.grants.remove(target);
                    for run in self
                        .tests
                        .runs
                        .values_mut()
                        .filter(|r| r.receipt["actor"]["session_id"] == target)
                    {
                        run.lease.take();
                        if run.receipt["run_state"] == "running" {
                            run.receipt["run_state"] = json!("stopping");
                            self.store.save_operation(
                                string(&run.receipt, "request_id")?,
                                &run.receipt,
                            )?;
                        }
                    }
                }
                Ok(receipt)
            }
            "test-start" => {
                let grantee = authority::actor_id(actor)?;
                let checkout = self
                    .tests
                    .grants
                    .get(grantee)
                    .context("forbidden: no development grant")?
                    .clone();
                ensure!(
                    !self
                        .tests
                        .runs
                        .values()
                        .any(|r| r.receipt["actor"] == *actor
                            && matches!(
                                r.receipt["run_state"].as_str(),
                                Some("running" | "stopping" | "uncertain")
                            )),
                    "conflict: inspect or stop the existing development run first"
                );
                ensure!(
                    self.tests.runs.len() < 64,
                    "conflict: development run limit reached for this service lifetime"
                );
                let mode = Mode::parse(string(request, "mode")?)?;
                let candidate = Candidate::inspect(&checkout)?;
                ensure!(
                    candidate.checkout == checkout,
                    "forbidden: granted checkout was redirected"
                );
                let root = std::env::temp_dir()
                    .join(format!("voyager-tests-{}", nix::unistd::Uid::effective()));
                super::private_dir(&root)?;
                let run_id = uuid::Uuid::new_v4().to_string();
                let state = root.join(&run_id);
                ensure!(!state.exists(), "conflict: test state already exists");
                super::private_dir(&state)?;
                let log = development::private_file(&state.join("test.log"))?;
                receipt["state"] = json!("pending");
                receipt["run_id"] = json!(run_id);
                receipt["mode"] = json!(mode.as_str());
                receipt["checkout"] = json!(checkout);
                receipt["state_dir"] = json!(state);
                receipt["run_state"] = json!("starting");
                self.store.begin_operation(id, request, &receipt)?;
                match Command::new(&self.binary)
                    .arg("--state")
                    .arg(&state)
                    .arg("test-host")
                    .arg(&checkout)
                    .arg(mode.as_str())
                    .stdin(Stdio::piped())
                    .stdout(log.try_clone()?)
                    .stderr(log)
                    .spawn()
                {
                    Ok(mut child) => {
                        receipt["state"] = json!("completed");
                        receipt["effect"] = json!("runner_spawned");
                        receipt["run_state"] = json!("running");
                        receipt["runner_pid"] = json!(child.id());
                        self.tests.runs.insert(
                            run_id,
                            Run {
                                lease: child.stdin.take(),
                                child,
                                receipt: receipt.clone(),
                            },
                        );
                    }
                    Err(error) => {
                        receipt["state"] = json!("failed");
                        receipt["run_state"] = json!("finished");
                        receipt["error"] = json!(error.to_string());
                    }
                }
                self.store.save_operation(id, &receipt)?;
                Ok(receipt)
            }
            "test-stop" => {
                let run_id = string(request, "run_id")?;
                let run =
                    self.tests.runs.get_mut(run_id).context(
                        "outcome_unknown: test runner ownership unavailable after restart",
                    )?;
                ensure!(
                    run.receipt["run_state"] != "uncertain",
                    "outcome_unknown: inspect uncertain cleanup before another action"
                );
                receipt["run_id"] = json!(run_id);
                receipt["effect"] = json!("stop_requested");
                self.store.begin_operation(id, request, &receipt)?;
                run.lease.take();
                if run.receipt["run_state"] == "running" {
                    run.receipt["run_state"] = json!("stopping");
                    self.store
                        .save_operation(string(&run.receipt, "request_id")?, &run.receipt)?;
                }
                Ok(receipt)
            }
            _ => unreachable!(),
        }
    }

    pub(super) fn observe_tests(&mut self) -> Result<()> {
        self.tests
            .grants
            .retain(|id, _| self.store.require_registered(id).is_ok());
        for run in self.tests.runs.values_mut() {
            if !matches!(
                run.receipt["run_state"].as_str(),
                Some("running" | "stopping")
            ) {
                continue;
            }
            if run.receipt["actor"]["session_id"]
                .as_str()
                .is_some_and(|id| self.store.require_registered(id).is_err())
            {
                run.lease.take();
            }
            let outcome = match run.child.try_wait() {
                Ok(None) => continue,
                Ok(Some(exit)) if exit.success() => development::read_json(
                    &Path::new(string(&run.receipt, "state_dir")?).join("test-result.json"),
                ),
                Ok(Some(exit)) => Err(anyhow::anyhow!(
                    "test runner exited without confirmed cleanup: {exit}"
                )),
                Err(error) => Err(error.into()),
            };
            run.lease.take();
            match outcome {
                Ok(result) => {
                    run.receipt["cleanup"] = result["cleanup"].clone();
                    run.receipt["proof_verdict"] = result["outcome"]["proof"]["verdict"].clone();
                    run.receipt["run_state"] = json!(if result["cleanup"] == "completed" {
                        "finished"
                    } else {
                        "uncertain"
                    });
                    run.receipt["result"] = result;
                }
                Err(error) => {
                    run.receipt["run_state"] = json!("uncertain");
                    run.receipt["error"] = json!(format!("{error:#}"));
                }
            }
            self.store
                .save_operation(string(&run.receipt, "request_id")?, &run.receipt)?;
        }
        Ok(())
    }
}
