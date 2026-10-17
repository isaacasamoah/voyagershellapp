use super::{Runtime, string};
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    io::Write,
    os::unix::net::UnixStream,
    time::{Duration, Instant},
};

pub(super) struct NativeCall {
    input: Value,
    stream: Option<UnixStream>,
    deadline: Instant,
    phase: NativePhase,
}

enum NativePhase {
    DiscoverPage {
        request: u64,
        ids: Vec<String>,
    },
    DiscoverItem {
        request: u64,
        ids: Vec<String>,
        index: usize,
        metadata: Vec<Value>,
    },
    RegisterPage {
        request: u64,
        count: usize,
    },
    RegisterMetadata {
        request: u64,
    },
    RegisterSubscribe {
        request: u64,
        metadata: Value,
    },
    SendIdle {
        request: u64,
    },
    SendTurn {
        request: u64,
    },
}

impl NativeCall {
    pub(super) fn targets(&self, session: &str, native: &str) -> bool {
        self.input["session_id"] == session
            || (self.input["op"] == "register" && self.input["thread_id"] == native)
    }
}

impl Runtime {
    pub(super) fn begin_native(
        &mut self,
        input: Value,
        stream: Option<UnixStream>,
    ) -> Result<Option<Value>> {
        self.authorize(&input)?;
        self.check_control(&input)?;
        let phase = match string(&input, "op")? {
            "discover" => NativePhase::DiscoverPage {
                request: self
                    .codex()?
                    .begin_rpc("thread/loaded/list", json!({"limit":100,"cursor":null}))?,
                ids: Vec::new(),
            },
            "register" => {
                let thread = string(&input, "thread_id")?;
                if let Some((id, _)) = self.registered.get(thread) {
                    return Ok(Some(json!({"session_id":id,"already_registered":true})));
                }
                ensure!(
                    !self
                        .native_calls
                        .iter()
                        .any(|p| p.input["op"] == "register" && p.input["thread_id"] == thread),
                    "busy: registration is pending"
                );
                ensure!(
                    !self
                        .store
                        .sessions()?
                        .iter()
                        .any(|s| s["native_thread_id"] == thread
                            && s["server"] == json!(self.server)
                            && !s["removed_ms"].is_null()),
                    "removed: use register-instance explicitly"
                );
                NativePhase::RegisterPage {
                    request: self
                        .codex()?
                        .begin_rpc("thread/loaded/list", json!({"limit":100,"cursor":null}))?,
                    count: 0,
                }
            }
            "send" => {
                let session = string(&input, "session_id")?;
                let id = string(&input, "request_id")?;
                let message = string(&input, "message")?;
                ensure!(
                    id.len() <= 128 && message.len() <= crate::events::TEXT_LIMIT,
                    "invalid_input: request or message too long"
                );
                self.store.require_registered(session)?;
                if let Some(previous) = self.store.request(id)? {
                    ensure!(
                        previous["session_id"] == session
                            && previous["message"] == message
                            && previous["actor_kind"] == input["actor"]["kind"]
                            && previous["actor_session_id"] == input["actor"]["session_id"]
                            && previous["purpose"]
                                == input
                                    .get("purpose")
                                    .cloned()
                                    .unwrap_or(json!("instruction"))
                            && previous["control_generation"] == input["control_generation"]
                            && previous["about_request_id"] == input["about_request_id"],
                        "request_conflict: instruction ID has different inputs"
                    );
                    return Ok(Some(previous));
                }
                ensure!(
                    self.store.operation(id)?.is_none(),
                    "request_conflict: ID already names an operation"
                );
                ensure!(
                    !self.operations.values().any(|p| p.session == session)
                        && !self
                            .native_calls
                            .iter()
                            .any(|p| p.input["session_id"] == session),
                    "busy: an action on this instance is pending"
                );
                let native = self.store.session(session)?["native_thread_id"]
                    .as_str()
                    .context("native identity missing")?
                    .to_owned();
                let request = self.connection(session)?.begin_rpc(
                    "thread/read",
                    json!({"threadId":native,"includeTurns":true}),
                )?;
                self.store.begin_request(id, session, message)?;
                let authority = if crate::authority::is_owner(&input["actor"]) {
                    "owner"
                } else if self.control.session() == input["actor"]["session_id"].as_str() {
                    "docked"
                } else if input["purpose"] == "escalation" {
                    "reporter"
                } else {
                    "supervisor"
                };
                self.store.0.execute("UPDATE requests SET actor_kind=?2,actor_session_id=?3,authority=?4,control_generation=?5,purpose=?6,about_request_id=?7 WHERE id=?1",rusqlite::params![id,input["actor"]["kind"].as_str(),input["actor"]["session_id"].as_str(),authority,input["control_generation"].as_str(),input["purpose"].as_str().unwrap_or("instruction"),input["about_request_id"].as_str()])?;
                NativePhase::SendIdle { request }
            }
            _ => bail!("unsupported native action"),
        };
        self.native_calls.push(NativeCall {
            input,
            stream,
            deadline: Instant::now() + Duration::from_secs(8),
            phase,
        });
        Ok(None)
    }

    pub(super) fn advance_native(&mut self) -> Result<()> {
        let calls = std::mem::take(&mut self.native_calls);
        for mut call in calls {
            let result = self.advance_native_call(&mut call);
            match result {
                Ok(None) => self.native_calls.push(call),
                Ok(Some(result)) => {
                    self.coordination_delivery(&call.input, "accepted", Some(result.clone()))?;
                    if let Some(stream) = &mut call.stream {
                        let _ = writeln!(stream, "{}", json!({"result":result}));
                    }
                }
                Err(error) => {
                    let message = error.to_string();
                    let explicit = message.starts_with("provider_failed:")
                        || message.starts_with("forbidden:")
                        || message.starts_with("removed:")
                        || message.starts_with("busy:")
                        || message.starts_with("stale_control:")
                        || message.starts_with("unsupported:");
                    let dispatched = matches!(call.phase, NativePhase::SendTurn { .. })
                        || (call.input["op"] == "send"
                            && self
                                .store
                                .request(string(&call.input, "request_id")?)?
                                .is_some_and(|r| !r["dispatch_mode"].is_null()));
                    let state = if !dispatched || explicit {
                        "failed"
                    } else {
                        "uncertain"
                    };
                    if call.input["op"] == "send" {
                        let id = string(&call.input, "request_id")?;
                        self.store.0.execute(
                            "UPDATE requests SET state=?2,error_code=?3 WHERE id=?1",
                            rusqlite::params![
                                id,
                                state,
                                if explicit {
                                    message.split(':').next().unwrap_or("provider_failed")
                                } else if dispatched {
                                    "outcome_unknown"
                                } else {
                                    "provider_failed"
                                }
                            ],
                        )?;
                        self.coordination_delivery(&call.input, state, self.store.request(id)?)?;
                    }
                    if let Some(stream) = &mut call.stream {
                        let _ = writeln!(
                            stream,
                            "{}",
                            json!({"error":message,"code":if explicit {message.split(':').next().unwrap_or("provider_failed")} else {"outcome_unknown"}})
                        );
                    }
                }
            }
        }
        Ok(())
    }

    fn advance_native_call(&mut self, call: &mut NativeCall) -> Result<Option<Value>> {
        ensure!(
            Instant::now() < call.deadline,
            "outcome_unknown: native request timed out; no automatic replay"
        );
        match &mut call.phase {
            NativePhase::DiscoverPage { request, ids } => {
                let Some(page) = self.codex()?.poll_rpc(*request)? else {
                    return Ok(None);
                };
                for id in page["data"]
                    .as_array()
                    .context("invalid loaded-thread page")?
                {
                    ids.push(id.as_str().context("invalid native identity")?.into());
                }
                ensure!(
                    ids.len() <= 1000,
                    "too many loaded threads for this prototype"
                );
                if !page["nextCursor"].is_null() {
                    *request = self.codex()?.begin_rpc(
                        "thread/loaded/list",
                        json!({"limit":100,"cursor":page["nextCursor"]}),
                    )?;
                } else if ids.is_empty() {
                    return Ok(Some(json!([])));
                } else {
                    let request = self.codex()?.begin_rpc(
                        "thread/read",
                        json!({"threadId":ids[0],"includeTurns":false}),
                    )?;
                    call.phase = NativePhase::DiscoverItem {
                        request,
                        ids: std::mem::take(ids),
                        index: 0,
                        metadata: Vec::new(),
                    };
                }
            }
            NativePhase::DiscoverItem {
                request,
                ids,
                index,
                metadata,
            } => {
                let Some(reply) = self.codex()?.poll_rpc(*request)? else {
                    return Ok(None);
                };
                let t = reply.get("thread").context("native metadata missing")?;
                metadata.push(json!({"id":t["id"],"sessionId":t["sessionId"],"cwd":t["cwd"],"status":t["status"],"source":t["source"]}));
                *index += 1;
                if *index == ids.len() {
                    return Ok(Some(json!(metadata)));
                }
                *request = self.codex()?.begin_rpc(
                    "thread/read",
                    json!({"threadId":ids[*index],"includeTurns":false}),
                )?;
            }
            NativePhase::RegisterPage { request, count } => {
                let Some(page) = self.codex()?.poll_rpc(*request)? else {
                    return Ok(None);
                };
                let thread = string(&call.input, "thread_id")?;
                let ids = page["data"]
                    .as_array()
                    .context("invalid loaded-thread page")?;
                *count += ids.len();
                ensure!(*count <= 1000, "too many loaded threads for this prototype");
                if ids.iter().any(|id| id == thread) {
                    call.phase = NativePhase::RegisterMetadata {
                        request: self.codex()?.begin_rpc(
                            "thread/read",
                            json!({"threadId":thread,"includeTurns":false}),
                        )?,
                    };
                } else if !page["nextCursor"].is_null() {
                    *request = self.codex()?.begin_rpc(
                        "thread/loaded/list",
                        json!({"limit":100,"cursor":page["nextCursor"]}),
                    )?;
                } else {
                    bail!("not_found: thread is not loaded; no replacement is created");
                }
            }
            NativePhase::RegisterMetadata { request } => {
                let Some(reply) = self.codex()?.poll_rpc(*request)? else {
                    return Ok(None);
                };
                let metadata = reply["thread"].clone();
                let thread = string(&call.input, "thread_id")?;
                ensure!(metadata["id"] == thread, "native identity mismatch");
                let request = self.codex()?.begin_rpc(
                    "thread/resume",
                    json!({"threadId":thread,"excludeTurns":true}),
                )?;
                call.phase = NativePhase::RegisterSubscribe { request, metadata };
            }
            NativePhase::RegisterSubscribe { request, metadata } => {
                let Some(reply) = self.codex()?.poll_rpc(*request)? else {
                    return Ok(None);
                };
                let thread = string(&call.input, "thread_id")?;
                ensure!(
                    reply["thread"]["id"] == thread,
                    "native subscription identity mismatch"
                );
                let notes: Vec<_> = self.codex()?.pending.drain(..).collect();
                for note in notes {
                    self.persist(note)?;
                }
                let server = self.server.as_deref().context("native server missing")?;
                let id = self.store.register(server, metadata)?;
                let generation = self
                    .store
                    .generation(&id)?
                    .context("registration missing")?;
                self.registered
                    .insert(thread.into(), (id.clone(), generation));
                self.store.local(&id,"capture.started",json!({"source":"codex_app_server","history_imported":false,"replay_available":false}))?;
                return Ok(Some(
                    json!({"session_id":id,"native_thread_id":thread,"ownership":"external","capture":"connected"}),
                ));
            }
            NativePhase::SendIdle { request } => {
                let session = string(&call.input, "session_id")?;
                let Some(reply) = self.connection(session)?.poll_rpc(*request)? else {
                    return Ok(None);
                };
                self.authorize(&call.input)?;
                self.check_control(&call.input)?;
                self.store.require_registered(session)?;
                let native = self.store.session(session)?["native_thread_id"]
                    .as_str()
                    .context("native identity missing")?
                    .to_owned();
                let idle = reply["thread"]["status"]["type"] == "idle";
                let expected = if idle {
                    None
                } else {
                    let turns = reply["thread"]["turns"]
                        .as_array()
                        .context("unsupported: active native turn identity unavailable")?;
                    let active: Vec<_> = turns
                        .iter()
                        .filter(|t| {
                            ["inProgress", "in_progress"]
                                .iter()
                                .any(|s| t["status"] == *s)
                        })
                        .collect();
                    ensure!(
                        active.len() == 1,
                        "unsupported: active native turn identity ambiguous"
                    );
                    Some(string(active[0], "id")?.to_owned())
                };
                let mode = if idle { "start" } else { "steer" };
                let id = string(&call.input, "request_id")?;
                self.store.0.execute("UPDATE requests SET state='uncertain',dispatch_mode=?2,expected_turn_id=?3 WHERE id=?1",rusqlite::params![id,mode,expected])?;
                let text = if call.input["actor"]["kind"] == "instance"
                    && call.input["purpose"].as_str().unwrap_or("instruction") == "instruction"
                {
                    format!(
                        "[Voyager instruction; actor {}] {}",
                        string(&call.input["actor"], "session_id")?,
                        string(&call.input, "message")?
                    )
                } else {
                    string(&call.input, "message")?.to_owned()
                };
                let mut params = json!({"threadId":native,"clientUserMessageId":id,"input":[{"type":"text","text":text}]});
                if let Some(expected) = expected {
                    params["expectedTurnId"] = json!(expected);
                }
                let request = self
                    .connection(session)?
                    .begin_rpc(if idle { "turn/start" } else { "turn/steer" }, params)?;
                call.phase = NativePhase::SendTurn { request };
            }
            NativePhase::SendTurn { request } => {
                let session = string(&call.input, "session_id")?;
                let Some(reply) = self.connection(session)?.poll_rpc(*request)? else {
                    return Ok(None);
                };
                let turn = reply["turn"]["id"]
                    .as_str()
                    .or(reply["turnId"].as_str())
                    .context("outcome_unknown: no native turn identity")?;
                let id = string(&call.input, "request_id")?;
                let task = self.store.request(id)?.context("task missing")?;
                if let Some(expected) = task["expected_turn_id"].as_str() {
                    ensure!(
                        turn == expected,
                        "outcome_unknown: steering acknowledgement changed turn identity"
                    );
                }
                self.store.accepted(id, turn)?;
                self.store.local(session,"instruction.accepted",json!({"request_id":id,"actor":call.input["actor"],"purpose":task["purpose"],"authority":task["authority"],"control_generation":task["control_generation"],"dispatch_mode":task["dispatch_mode"],"expected_turn_id":task["expected_turn_id"],"native_turn_id":turn}))?;
                return self.store.request(id);
            }
        }
        Ok(None)
    }
}
