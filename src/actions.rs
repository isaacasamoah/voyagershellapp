use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq)]
pub enum Action {
    Open(crate::viewer::Kind),
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
            Some("open") => Self::Open(crate::viewer::Kind::parse(&request["terminal"])?),
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
            Self::Open(_) => "open",
            Self::Background => "background",
            Self::Stop { .. } => "stop-instance",
            Self::Remove { .. } => "remove",
            Self::Register => "register-instance",
        }
    }

    pub fn inputs(self, session: &str, generation: Option<&Value>) -> Value {
        let mut inputs = json!({"op":self.name(),"session_id":session,"close_window":matches!(self,Self::Stop{close:true}),"stop":matches!(self,Self::Remove{stop:true}),"control_generation":generation});
        if let Self::Open(kind) = self {
            if kind != crate::viewer::Kind::Ghostty {
                inputs["terminal"] = json!(kind.as_str());
            }
        }
        inputs
    }
}

pub enum Phase {
    Start,
    WaitStop {
        force_at: Instant,
        forced: bool,
    },
    Close,
    WaitClose {
        window: u32,
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

pub fn name(value: &str) -> Result<&str> {
    let name = value.trim();
    ensure!(
        !name.is_empty() && name.len() <= 100 && !name.chars().any(char::is_control),
        "invalid_input: use a name of 1–100 bytes without control characters"
    );
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewer_choice_is_part_of_the_open_request_identity() {
        let ghostty = Action::parse(&json!({"op":"open","terminal":"ghostty"}))
            .unwrap()
            .unwrap();
        let xterm = Action::parse(&json!({"op":"open","terminal":"xterm"}))
            .unwrap()
            .unwrap();
        assert_ne!(
            ghostty.inputs("session", None),
            xterm.inputs("session", None)
        );
        assert!(Action::parse(&json!({"op":"open","terminal":"arbitrary-command"})).is_err());
    }
}
