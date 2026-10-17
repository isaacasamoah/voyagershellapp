use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq)]
pub enum Action {
    Open,
    Background,
    Stop { close: bool },
    Remove { stop: bool },
    Register,
}

impl Action {
    pub fn parse(request: &Value) -> Result<Option<Self>> {
        let boolean = |field: &str, default| -> Result<bool> {
            request.get(field).map_or(Ok(default), |v| {
                v.as_bool().context("invalid_input: expected boolean")
            })
        };
        Ok(Some(match request["op"].as_str() {
            Some("open") => {
                ensure!(
                    request["terminal"] == "ghostty",
                    "unsupported: choose ghostty"
                );
                Self::Open
            }
            Some("background") => Self::Background,
            Some("stop-instance") => Self::Stop {
                close: boolean("close_window", true)?,
            },
            Some("remove") => Self::Remove {
                stop: boolean("stop", false)?,
            },
            Some("register-instance") => Self::Register,
            _ => return Ok(None),
        }))
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Background => "background",
            Self::Stop { .. } => "stop-instance",
            Self::Remove { .. } => "remove",
            Self::Register => "register-instance",
        }
    }

    pub fn inputs(self, session: &str, generation: Option<&Value>) -> Value {
        json!({"op":self.name(),"session_id":session,"close_window":matches!(self,Self::Stop{close:true}),"stop":matches!(self,Self::Remove{stop:true}),"control_generation":generation})
    }
}

pub enum Phase {
    Start,
    AdoptedArchive {
        request: u64,
    },
    WaitStop {
        force_at: Instant,
        forced: bool,
    },
    Close,
    WaitClose {
        window: u32,
        confirmation: Option<std::process::Child>,
    },
    WaitOpen,
    Remove,
    LaunchIdle {
        request: u64,
    },
    LaunchTurn {
        request: u64,
    },
    RegisterConnect {
        connection: std::thread::JoinHandle<Result<crate::codex::Codex>>,
    },
    RegisterResume {
        connection: Box<crate::codex::Codex>,
        request: u64,
    },
}

pub struct PendingOperation {
    pub id: String,
    pub session: String,
    pub action: Action,
    pub phase: Phase,
    pub deadline: Instant,
    pub receipt: Value,
}

impl PendingOperation {
    pub fn new(id: &str, session: &str, action: Action) -> Self {
        Self {
            id: id.into(),
            session: session.into(),
            action,
            phase: Phase::Start,
            deadline: Instant::now() + Duration::from_secs(10),
            receipt: json!({"request_id":id,"session_id":session,"action":action.name(),"state":"pending","runtime":"unknown","window":"unknown","registration":"active","effects":[],"event_seq":null}),
        }
    }

    pub fn effect(&mut self, phase: &str, state: &str) {
        let effects = self.receipt["effects"]
            .as_array_mut()
            .expect("operation effects array");
        if let Some(effect) = effects.iter_mut().find(|e| e["phase"] == phase) {
            effect["state"] = json!(state);
        } else {
            effects.push(json!({"phase":phase,"state":state}));
        }
    }
}

pub fn request_id(request: &Value) -> Result<&str> {
    match request["request_id"].as_str() {
        Some(id) if !id.is_empty() && id.len() <= 128 => Ok(id),
        _ => bail!("invalid_input: request_id must contain 1–128 bytes"),
    }
}
