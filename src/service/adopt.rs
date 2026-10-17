use super::{Runtime, Terminal, TerminalProcess, string};
use crate::{
    actions,
    adoption::{Candidate, Process, children, window_owner},
    codex::Codex,
    native_instance::{AgentFrontend, NativeInstance},
};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{fs, path::Path};

fn process_value(process: &Process) -> Result<Value> {
    let argv: Vec<_> = fs::read(format!("/proc/{}/cmdline", process.pid))?
        .split(|b| *b == 0)
        .filter(|b| !b.is_empty())
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .collect();
    Ok(
        json!({"pid":process.pid,"start":process.start.to_string(),"executable":process.executable,"argv":argv}),
    )
}

impl Runtime {
    pub(super) fn inspect_window(&self, window: u32) -> Result<Value> {
        let owner = window_owner(window)?;
        if let Some(terminal) = self
            .terminals
            .iter()
            .find(|t| t.window == Some(window) && t.process.id() == owner)
        {
            ensure!(terminal.process.alive()?, "terminal ended");
            let session = self.store.session(&terminal.session)?;
            let frontend = if let Some(native) = self
                .adopted
                .get(&terminal.session)
                .filter(|n| n.candidate.terminal.pid == owner)
            {
                if let Some(agent) = &native.agent {
                    agent.frontend.verify()?;
                }
                Process::open(
                    native
                        .agent
                        .as_ref()
                        .map_or(native.candidate.shell.pid, |a| a.frontend.process.pid),
                )?
            } else {
                let list = children(owner)?;
                ensure!(list.len() == 1, "ambiguous native viewer");
                Process::open(*list.first().context("missing frontend")?)?
            };
            let mut record = process_value(&Process::open(owner)?)?;
            record["frontend"] = process_value(&frontend)?;
            record["nativeId"] = session["native_thread_id"].clone();
            record["server"] = session["server"].clone();
            record["session_id"] = session["id"].clone();
            record["external"] = json!(false);
            record["adoptable"] = json!(false);
            return Ok(record);
        }
        let candidate = Candidate::inspect(window)?;
        let agent = AgentFrontend::inspect(&candidate)?;
        let mut record = process_value(&candidate.terminal)?;
        record["frontend"] =
            process_value(agent.as_ref().map_or(&candidate.shell, |a| &a.process))?;
        record["adoptable"] = json!(true);
        record["kind"] = json!(if agent.is_some() { "codex" } else { "shell" });
        Ok(record)
    }

    pub(super) fn adopt(&mut self, request: &Value) -> Result<Value> {
        let id = actions::request_id(request)?;
        ensure!(id.len() <= 100, "invalid_input: adoption ID is too long");
        if let Some((inputs, receipt)) = self.store.operation(id)? {
            ensure!(
                inputs == *request,
                "request_conflict: adoption inputs changed"
            );
            return Ok(receipt);
        }
        let window = u32::try_from(request["window_id"].as_u64().context("missing window_id")?)?;
        let record = self.inspect_window(window)?;
        if let Some(session) = record["session_id"].as_str() {
            self.ensure_connected(session)?;
            let receipt = json!({"request_id":id,"session_id":session,"state":"completed","action":"adopt","already_adopted":true});
            self.store.begin_operation(id, request, &receipt)?;
            return Ok(receipt);
        }
        let candidate = Candidate::inspect(window)?;
        let frontend = AgentFrontend::inspect(&candidate)?;
        let cwd = fs::read_link(format!("/proc/{}/cwd", candidate.shell.pid))?;
        let cwd = cwd.to_str().context("native directory is not UTF-8")?;
        let pid = candidate.shell.pid;
        let terminal_process = Process::open(candidate.terminal.pid)?;
        let mut native = NativeInstance::acquire(candidate, frontend, &self.state, id)?;
        let (connection, server, metadata) = if let Some(agent) = &native.agent {
            let mut connection = Codex::connect(&agent.frontend.server)?;
            let metadata = connection
                .metadata(&agent.thread)
                .context("read existing Codex thread")?;
            ensure!(
                metadata["id"] == agent.thread,
                "native metadata identity mismatch"
            );
            let reply = connection
                .rpc(
                    "thread/resume",
                    json!({"threadId":agent.thread,"excludeTurns":true}),
                )
                .context("subscribe to existing Codex thread")?;
            ensure!(
                reply["thread"]["id"] == agent.thread,
                "native capture identity mismatch"
            );
            agent.frontend.verify()?;
            connection.pending.clear();
            (
                Some(connection),
                agent
                    .frontend
                    .server
                    .to_str()
                    .context("invalid server")?
                    .to_owned(),
                metadata,
            )
        } else {
            (
                None,
                format!(
                    "native-pty:{}:{}",
                    native.candidate.shell.pid, native.candidate.shell.start
                ),
                json!({"id":format!("{}:{}",native.candidate.shell.pid,native.candidate.shell.start),"kind":"shell","cwd":cwd}),
            )
        };
        ensure!(
            !self
                .store
                .sessions()?
                .iter()
                .any(|s| s["server"] == server && s["native_thread_id"] == metadata["id"]),
            "already registered through another owner; adopt that owner explicitly"
        );
        self.store.begin_launch(
            id,
            None,
            cwd,
            None,
            Some(if native.agent.is_some() {
                "Codex"
            } else {
                "Terminal"
            }),
        )?;
        let session = match self.store.register_worker(id, &server, &metadata, pid) {
            Ok(session) => session,
            Err(error) => {
                self.store.worker_state(id, "failed")?;
                return Err(error);
            }
        };
        native.session = session.clone();
        self.adopted.insert(session.clone(), native);
        self.terminals.push(Terminal {
            session: session.clone(),
            process: TerminalProcess::Adopted(terminal_process),
            window: Some(window),
        });
        if let Some(connection) = connection {
            self.captures.insert(session.clone(), (connection, 1));
        }
        self.store.local(&session,"instance.adopted",json!({"window_id":window,"shell_pid":pid,"runtime_restarted":false,"history_imported":false,"mechanism":"linux-ptrace-pty"}))?;
        let receipt = json!({"request_id":id,"action":"adopt","session_id":session,"state":"completed","runtime":"running","window":"open","registration":"active","window_id":window,"runtime_pid":pid});
        self.store.begin_operation(id, request, &receipt)?;
        Ok(receipt)
    }

    pub(super) fn verify_adopted(&mut self, session: &str) -> Result<()> {
        if let Some(native) = self.adopted.get_mut(session) {
            ensure!(
                native.alive && native.capture,
                "adopted runtime is unavailable"
            );
            native.verify(&self.store)?;
        }
        Ok(())
    }

    pub(super) fn adopted_stop_connection(&mut self, id: &str) -> Result<()> {
        if !self.captures.contains_key(id) {
            let session = self.store.session(id)?;
            let connection = Codex::connect(Path::new(string(&session, "server")?))?;
            self.captures.insert(
                id.into(),
                (
                    connection,
                    session["capture_generation"]
                        .as_i64()
                        .context("capture generation missing")?,
                ),
            );
        }
        Ok(())
    }
}
