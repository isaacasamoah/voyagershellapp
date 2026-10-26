use anyhow::{Context, Result, bail, ensure};
use nix::{
    sys::socket::{getsockopt, sockopt},
    unistd::Uid,
};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    io,
    os::unix::net::UnixStream,
    path::Path,
    time::{Duration, Instant},
};
use tungstenite::{Message, WebSocket};

pub struct Codex {
    pub peer_pid: u32,
    pub user_agent: Option<String>,
    socket: WebSocket<UnixStream>,
    next_id: u64,
    failed: bool,
    pub pending: VecDeque<Value>,
    replies: HashMap<u64, Value>,
}

impl Codex {
    pub fn connect(path: &Path) -> Result<Self> {
        let stream = UnixStream::connect(path).context("connect to existing Codex socket")?;
        let peer = getsockopt(&stream, sockopt::PeerCredentials)?;
        ensure!(
            peer.uid() == Uid::effective().as_raw(),
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
            .set_read_timeout(Some(Duration::from_millis(2)))?;
        let mut this = Self {
            peer_pid: u32::try_from(peer.pid()).context("invalid native server PID")?,
            socket,
            user_agent: None,
            next_id: 1,
            failed: false,
            pending: VecDeque::new(),
            replies: HashMap::new(),
        };
        let initialized = this.rpc("initialize", json!({"clientInfo":{"name":"voyager_shell","title":"Voyager Shell","version":"0.2.0"},"capabilities":{"experimentalApi":true}}))?;
        this.user_agent = initialized["userAgent"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        this.socket.send(Message::Text(
            json!({"method":"initialized"}).to_string().into(),
        ))?;
        Ok(this)
    }

    pub fn rpc(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.begin_rpc(method, params)?;
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if let Some(value) = self.poll_rpc(id)? {
                return Ok(value);
            }
        }
        bail!("Codex {method} timed out; delivery may be uncertain")
    }

    pub fn begin_rpc(&mut self, method: &str, params: Value) -> Result<u64> {
        let id = self.next_id;
        self.next_id += 1;
        self.socket.send(Message::Text(
            json!({"id":id,"method":method,"params":params})
                .to_string()
                .into(),
        ))?;
        Ok(id)
    }

    pub fn poll_rpc(&mut self, id: u64) -> Result<Option<Value>> {
        if let Some(value) = self.read()? {
            if self.pending.len() >= 512 {
                self.failed = true;
                bail!("Codex notification backlog exceeded");
            }
            self.pending.push_back(value);
        }
        self.replies
            .remove(&id)
            .map(|value| {
                ensure!(
                    value.get("error").is_none(),
                    "provider_failed: Codex rejected the request"
                );
                value.get("result").cloned().context("missing RPC result")
            })
            .transpose()
    }

    pub fn read(&mut self) -> Result<Option<Value>> {
        ensure!(!self.failed, "Codex capture connection failed");
        match self.socket.read() {
            Ok(Message::Text(text)) => match serde_json::from_str(&text) {
                Ok(value) => {
                    let value: Value = value;
                    if value.get("method").is_none() {
                        if let Some(id) = value["id"].as_u64() {
                            ensure!(self.replies.len() < 128, "Codex reply backlog exceeded");
                            self.replies.insert(id, value);
                            return Ok(None);
                        }
                    }
                    Ok(Some(value))
                }
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
