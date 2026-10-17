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
    stream: UnixStream,
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
        stream: UnixStream,
    ) -> Result<Option<Value>> {
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
                        previous["session_id"] == session && previous["message"] == message,
                        "request_conflict: instruction ID has different inputs"
                    );
                    return Ok(Some(previous));
                }
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
                    json!({"threadId":native,"includeTurns":false}),
                )?;
                self.store.begin_request(id, session, message)?;
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
                    let _ = writeln!(call.stream, "{}", json!({"result":result}));
                }
                Err(error) => {
                    let _ = writeln!(
                        call.stream,
                        "{}",
                        json!({"error":error.to_string(),"code":"provider_failed"})
                    );
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
                ensure!(
                    reply["thread"]["status"]["type"] == "idle",
                    "busy: leave the current native work alone"
                );
                self.check_control(&call.input)?;
                self.store.require_registered(session)?;
                self.verify_adopted(session)?;
                let native = self.store.session(session)?["native_thread_id"]
                    .as_str()
                    .context("native identity missing")?
                    .to_owned();
                let request=self.connection(session)?.begin_rpc("turn/start",json!({"threadId":native,"clientUserMessageId":call.input["request_id"],"input":[{"type":"text","text":call.input["message"]}]}))?;
                call.phase = NativePhase::SendTurn { request };
            }
            NativePhase::SendTurn { request } => {
                let session = string(&call.input, "session_id")?;
                let Some(reply) = self.connection(session)?.poll_rpc(*request)? else {
                    return Ok(None);
                };
                let turn = reply["turn"]["id"]
                    .as_str()
                    .context("outcome_unknown: no native turn identity")?;
                let id = string(&call.input, "request_id")?;
                self.store.accepted(id, turn)?;
                return self.store.request(id);
            }
        }
        Ok(None)
    }
}
