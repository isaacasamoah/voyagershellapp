//! A client of an already-running Codex app server. Never launches/resumes a
//! replacement process, changes permissions, or answers approval requests.
use anyhow::{Context, Result, bail, ensure};
use nix::{
    sys::socket::{getsockopt, sockopt},
    unistd::Uid,
};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    io,
    os::unix::net::UnixStream,
    path::Path,
    time::{Duration, Instant},
};
use tungstenite::{Message, WebSocket};

pub struct Codex {
    socket: WebSocket<UnixStream>,
    next_id: u64,
    failed: bool,
    pub pending: VecDeque<Value>,
}

impl Codex {
    pub fn connect(path: &Path) -> Result<Self> {
        let stream = UnixStream::connect(path).context("connect to existing Codex socket")?;
        ensure!(
            getsockopt(&stream, sockopt::PeerCredentials)?.uid() == Uid::effective().as_raw(),
            "different-user Codex server"
        );
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        let (mut socket, _) = tungstenite::client("ws://localhost/", stream)?;
        socket.set_config(|c| {
            c.max_message_size = Some(4 * 1024 * 1024);
            c.max_frame_size = Some(4 * 1024 * 1024);
        });
        socket
            .get_mut()
            .set_read_timeout(Some(Duration::from_millis(50)))?;
        let mut this = Self {
            socket,
            next_id: 1,
            failed: false,
            pending: VecDeque::new(),
        };
        this.rpc("initialize", json!({"clientInfo":{"name":"voyager_shell","title":"Voyager Shell","version":"0.2.0"},"capabilities":{"experimentalApi":true}}))?;
        this.socket.send(Message::Text(
            json!({"method":"initialized"}).to_string().into(),
        ))?;
        Ok(this)
    }

    pub fn rpc(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        self.socket.send(Message::Text(
            json!({"id":id,"method":method,"params":params})
                .to_string()
                .into(),
        ))?;
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if let Some(value) = self.read()? {
                if value.get("id").and_then(Value::as_u64) == Some(id) {
                    // Do not echo upstream errors: they can contain private input.
                    ensure!(value.get("error").is_none(), "Codex rejected {method}");
                    return value.get("result").cloned().context("missing RPC result");
                }
                if self.pending.len() >= 512 {
                    self.failed = true;
                    bail!("Codex notification backlog exceeded");
                }
                self.pending.push_back(value);
            }
        }
        bail!("Codex {method} timed out; delivery may be uncertain")
    }

    pub fn read(&mut self) -> Result<Option<Value>> {
        ensure!(!self.failed, "Codex capture connection failed");
        match self.socket.read() {
            Ok(Message::Text(text)) => match serde_json::from_str(&text) {
                Ok(value) => Ok(Some(value)),
                Err(error) => {
                    self.failed = true;
                    Err(error.into())
                }
            },
            Ok(Message::Close(_)) => {
                self.failed = true;
                bail!("Codex connection closed")
            }
            Ok(Message::Ping(_)) => {
                self.socket.flush()?;
                Ok(None)
            }
            Ok(_) => Ok(None),
            Err(tungstenite::Error::Io(e))
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                Ok(None)
            }
            Err(e) => {
                self.failed = true;
                Err(e.into())
            }
        }
    }

    pub fn loaded(&mut self) -> Result<Vec<String>> {
        let mut ids = Vec::new();
        let mut cursor = Value::Null;
        loop {
            let page = self.rpc("thread/loaded/list", json!({"limit":100,"cursor":cursor}))?;
            for id in page["data"].as_array().context("missing loaded threads")? {
                ids.push(id.as_str().context("invalid thread id")?.to_owned());
            }
            cursor = page["nextCursor"].clone();
            if cursor.is_null() {
                return Ok(ids);
            }
            ensure!(
                ids.len() < 1000,
                "too many loaded threads for this prototype"
            );
        }
    }

    pub fn metadata(&mut self, id: &str) -> Result<Value> {
        let reply = self.rpc("thread/read", json!({"threadId":id,"includeTurns":false}))?;
        let t = reply.get("thread").context("missing thread")?;
        Ok(
            json!({"id":t["id"],"sessionId":t["sessionId"],"cwd":t["cwd"],"status":t["status"],"source":t["source"]}),
        )
    }
}
