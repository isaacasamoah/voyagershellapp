use crate::store::Store;
use anyhow::{Context, Result, ensure};
use nix::{
    sys::socket::{MsgFlags, recv},
    unistd::Uid,
};
use rusqlite::OptionalExtension;
use serde_json::{Value, json};
use std::{
    fs,
    os::{
        fd::AsRawFd,
        unix::{fs::MetadataExt, net::UnixStream},
    },
};

#[derive(Clone, PartialEq)]
struct Process {
    pid: u32,
    start: String,
}

impl Process {
    fn read(pid: u32) -> Result<Self> {
        let path = format!("/proc/{pid}");
        ensure!(
            fs::metadata(&path)?.uid() == Uid::effective().as_raw(),
            "different-user process"
        );
        let stat = fs::read_to_string(format!("{path}/stat"))?;
        let fields: Vec<_> = stat
            .rsplit_once(')')
            .context("invalid process stat")?
            .1
            .split_whitespace()
            .collect();
        ensure!(fields.first() != Some(&"Z"), "process has exited");
        Ok(Self {
            pid,
            start: fields.get(19).context("missing process start")?.to_string(),
        })
    }

    fn parse(value: &Value) -> Result<Self> {
        let pid = value["pid"]
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .filter(|n| *n > 0)
            .context("invalid process PID")?;
        let start = value["start"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() < 32 && s.bytes().all(|c| c.is_ascii_digit()))
            .context("invalid process start")?
            .to_owned();
        Ok(Self { pid, start })
    }

    fn live(&self) -> bool {
        Self::read(self.pid).is_ok_and(|p| p == *self)
    }
    fn value(&self) -> Value {
        json!({"pid":self.pid,"start":self.start})
    }
}

#[derive(Clone, PartialEq)]
struct Attachment {
    generation: String,
    session: String,
    window: u32,
    terminal: Process,
    frontend: Process,
    desktop: Process,
}

impl Attachment {
    fn parse(v: &Value, peer: u32) -> Result<Self> {
        let generation = v["generation"]
            .as_str()
            .context("missing control generation")?;
        uuid::Uuid::parse_str(generation).context("control generation must be a UUID")?;
        let session = v["session_id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .context("missing session_id")?
            .to_owned();
        let window = v["window_id"]
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .filter(|n| *n > 0)
            .context("invalid window ID")?;
        Ok(Self {
            generation: generation.to_owned(),
            session,
            window,
            terminal: Process::parse(&v["terminal"])?,
            frontend: Process::parse(&v["frontend"])?,
            desktop: Process::read(peer)?,
        })
    }

    fn value(&self) -> Value {
        json!({"generation":self.generation,"session_id":self.session,"window_id":self.window,
            "terminal":self.terminal.value(),"frontend":self.frontend.value(),"desktop":self.desktop.value()})
    }
}

struct Active {
    attachment: Attachment,
    socket: UnixStream,
}

pub struct Control {
    active: Option<Active>,
    voice_follows_dock: bool,
}

impl Control {
    pub fn new(store: &Store) -> Result<Self> {
        let voice_follows_dock = match std::env::var("VOYAGER_VOICE_FOLLOWS_DOCK").as_deref() {
            Ok("1") | Err(std::env::VarError::NotPresent) => true,
            Ok("0") => false,
            _ => anyhow::bail!("VOYAGER_VOICE_FOLLOWS_DOCK must be 0 or 1"),
        };
        store.0.execute_batch("CREATE TABLE IF NOT EXISTS control (singleton INTEGER PRIMARY KEY CHECK(singleton=1), attachment TEXT NOT NULL);")?;
        let previous: Option<String> = store
            .0
            .query_row(
                "SELECT attachment FROM control WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(raw) = previous {
            let previous: Value = serde_json::from_str(&raw)?;
            let tx = store.0.unchecked_transaction()?;
            Self::release_event(store, &previous, "service_restarted")?;
            tx.execute("DELETE FROM control", [])?;
            tx.commit()?;
        }
        Ok(Self {
            active: None,
            voice_follows_dock,
        })
    }

    pub fn current(&self) -> Value {
        self.active
            .as_ref()
            .map(|a| a.attachment.value())
            .unwrap_or(Value::Null)
    }

    pub fn voice(&self) -> Value {
        json!({"follows_dock":self.voice_follows_dock})
    }

    pub fn session(&self) -> Option<&str> {
        self.active.as_ref().map(|a| a.attachment.session.as_str())
    }

    pub fn require(&self, generation: &str) -> Result<&str> {
        let active = self
            .active
            .as_ref()
            .filter(|a| a.attachment.generation == generation)
            .context("stale_control: control attachment is no longer current")?;
        Ok(&active.attachment.session)
    }

    pub fn dock(
        &mut self,
        store: &Store,
        request: &Value,
        peer: u32,
        socket: UnixStream,
    ) -> Result<Value> {
        let attachment = Attachment::parse(request, peer)?;
        ensure!(
            attachment.terminal.live() && attachment.frontend.live(),
            "terminal client has changed or exited"
        );
        let key = format!("interface.docked:{}", attachment.generation);
        let previous: Option<String> = store
            .0
            .query_row(
                "SELECT payload FROM events WHERE source_key=?1",
                [&key],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(raw) = previous {
            let previous: Value = serde_json::from_str(&raw)?;
            ensure!(
                previous["attachment"] == attachment.value(),
                "control generation conflicts with previous attachment"
            );
            let active = self
                .active
                .as_ref()
                .is_some_and(|a| a.attachment == attachment);
            if active {
                self.active = Some(Active {
                    attachment: attachment.clone(),
                    socket,
                });
            }
            return Ok(
                json!({"attachment":attachment.value(),"active":active,"voice":self.voice()}),
            );
        }
        let tx = store.0.unchecked_transaction()?;
        if let Some(old) = &self.active {
            Self::release_event(store, &old.attachment.value(), "switched")?;
        }
        store.0.execute("INSERT INTO control VALUES (1,?1) ON CONFLICT(singleton) DO UPDATE SET attachment=excluded.attachment", [attachment.value().to_string()])?;
        store.insert(
            &attachment.session,
            "interface.docked",
            None,
            Some(&key),
            None,
            json!({"attachment":attachment.value(),"voice":self.voice()}),
        )?;
        tx.commit()?;
        let value = attachment.value();
        self.active = Some(Active { attachment, socket });
        Ok(json!({"attachment":value,"active":true,"voice":self.voice()}))
    }

    fn release_event(store: &Store, attachment: &Value, reason: &str) -> Result<()> {
        store.local(
            attachment["session_id"]
                .as_str()
                .context("missing control session")?,
            "interface.undocked",
            json!({"attachment":attachment,"reason":reason}),
        )
    }

    pub fn release(
        &mut self,
        store: &Store,
        generation: Option<&str>,
        reason: &str,
    ) -> Result<bool> {
        let Some(active) = &self.active else {
            return Ok(false);
        };
        if generation.is_some_and(|g| g != active.attachment.generation) {
            return Ok(false);
        }
        let tx = store.0.unchecked_transaction()?;
        Self::release_event(store, &active.attachment.value(), reason)?;
        tx.execute("DELETE FROM control", [])?;
        tx.commit()?;
        self.active = None;
        Ok(true)
    }

    pub fn observe(&mut self, store: &Store) -> Result<()> {
        let Some(active) = &self.active else {
            return Ok(());
        };
        let mut byte = [0];
        let reason = match recv(
            active.socket.as_raw_fd(),
            &mut byte,
            MsgFlags::MSG_PEEK | MsgFlags::MSG_DONTWAIT,
        ) {
            Ok(0) => Some("interface_disconnected"),
            Ok(_) => Some("unexpected_interface_data"),
            Err(nix::errno::Errno::EAGAIN) => {
                if !active.attachment.terminal.live() || !active.attachment.frontend.live() {
                    Some("terminal_closed")
                } else {
                    None
                }
            }
            Err(_) => Some("interface_disconnected"),
        };
        if let Some(reason) = reason {
            self.release(store, None, reason)?;
        }
        Ok(())
    }
}
