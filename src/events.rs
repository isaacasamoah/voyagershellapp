//! Only explicit, supported fields cross the capture boundary.
use serde_json::{Value, json};

pub const TEXT_LIMIT: usize = 16 * 1024;

pub fn text(value: &Value) -> (String, bool) {
    let s = value.as_str().unwrap_or("");
    let mut end = s.len().min(TEXT_LIMIT);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    (s[..end].to_owned(), end != s.len())
}

pub struct Observation {
    pub thread: String,
    pub turn: Option<String>,
    pub key: String,
    pub kind: &'static str,
    pub occurred_ms: Option<i64>,
    pub payload: Value,
}

pub fn normalize(notification: &Value) -> Option<Observation> {
    // Server requests (including approvals) are not observations we can answer.
    if notification.get("id").is_some() {
        return None;
    }
    let method = notification["method"].as_str()?;
    let p = &notification["params"];
    let thread = p["threadId"].as_str()?.to_owned();
    let (kind, turn, key, occurred_ms, payload) = match method {
        "turn/started" | "turn/completed" => {
            let t = &p["turn"];
            let id = t["id"].as_str()?;
            let kind = if method == "turn/started" {
                "turn.started"
            } else {
                "turn.completed"
            };
            (
                kind,
                Some(id.to_owned()),
                format!("{method}:{id}"),
                None,
                json!({"status":t["status"].as_str(),"has_error":!t["error"].is_null()}),
            )
        }
        "item/started" | "item/completed" => {
            let item = &p["item"];
            let id = item["id"].as_str()?;
            let turn = p["turnId"].as_str()?.to_owned();
            let ty = item["type"].as_str()?;
            let payload = match ty {
                "userMessage" if method == "item/completed" => {
                    let mut output = String::new();
                    let mut omitted = 0;
                    for part in item["content"].as_array()? {
                        if part["type"] == "text" {
                            if output.len() <= TEXT_LIMIT {
                                output.push_str(part["text"].as_str().unwrap_or(""));
                            }
                        } else {
                            omitted += 1;
                        }
                    }
                    let (body, truncated) = text(&Value::String(output));
                    json!({"role":"user","text":body,"truncated":truncated,"omitted_parts":omitted,"item_id":id})
                }
                "agentMessage" if method == "item/completed" => {
                    let (body, truncated) = text(&item["text"]);
                    json!({"role":"assistant","text":body,"truncated":truncated,"item_id":id,"phase":item["phase"].as_str()})
                }
                "commandExecution" | "mcpToolCall" | "dynamicToolCall" | "fileChange"
                | "webSearch" => {
                    // Names and output are deliberately excluded in this first
                    // policy; even tool arguments/paths can contain secrets.
                    json!({"item_id":id,"tool_kind":ty,"status":item["status"].as_str(),"payload_omitted":true})
                }
                _ => return None, // Includes reasoning and streaming text deltas.
            };
            let kind = if ty == "userMessage" || ty == "agentMessage" {
                "message"
            } else if method == "item/started" {
                "tool.started"
            } else {
                "tool.completed"
            };
            (
                kind,
                Some(turn.clone()),
                format!("{method}:{turn}:{id}"),
                p["completedAtMs"].as_i64(),
                payload,
            )
        }
        _ => return None,
    };
    Some(Observation {
        thread,
        turn,
        key,
        kind,
        occurred_ms,
        payload,
    })
}
