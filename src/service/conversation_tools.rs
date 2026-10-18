use super::exchange;
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::path::Path;

pub(super) fn definitions() -> Result<Value> {
    Ok(serde_json::from_str(include_str!(
        "conversation-tools.json"
    ))?)
}

pub(super) fn invoke(
    state: &Path,
    name: &str,
    args: &Value,
    id: &str,
    human: Option<(&str, &str)>,
) -> Result<Value> {
    let definitions = definitions()?;
    let spec = definitions
        .as_array()
        .context("tool catalog")?
        .iter()
        .find(|spec| spec["name"] == name)
        .context("unsupported Voyager tool")?;
    let props = spec["inputSchema"]["properties"]
        .as_object()
        .context("tool fields")?;
    let input = args
        .as_object()
        .context("invalid_input: tool arguments must be an object")?;
    ensure!(
        input.len() == props.len() && input.keys().all(|key| props.contains_key(key)),
        "invalid_input: tool fields do not match the named action"
    );
    let mut request = args.clone();
    request["request_id"] = json!(id);
    let op = match name {
        "voyager_status" => "status",
        "voyager_vessels" => "list",
        "voyager_create" => "create",
        "voyager_send" => "send",
        "voyager_operation" => {
            request["request_id"] = args["request_id"].clone();
            "operation"
        }
        "voyager_events" => "events",
        "voyager_open" => {
            request["terminal"] = json!("ghostty");
            "open"
        }
        "voyager_background" => "background",
        "voyager_stop" => "stop-instance",
        "voyager_remove" => "remove",
        "voyager_rank" => "rank",
        "voyager_supervise" => "supervise",
        "voyager_shell" => "shell-exec",
        "voyager_fleets" => "fleets",
        "voyager_create_fleet" => {
            request["name"] = args["goal"].clone();
            "create-fleet"
        }
        "voyager_move_to_fleet" => "move-vessel",
        "voyager_remove_fleet" => "remove-fleet",
        "voyager_escalations" => "escalations",
        "voyager_answer" => {
            let (turn, words) =
                human.context("invalid_input: no human input is bound to this native turn")?;
            ensure!(!words.trim().is_empty(), "invalid_input: empty human reply");
            let questions = exchange(state, json!({"op":"escalations"}), false)?;
            let question = questions
                .as_array()
                .context("escalation list")?
                .iter()
                .find(|q| q["request_id"] == args["escalation_id"])
                .context("not_found: escalation")?;
            ensure!(
                question["answered"] == false,
                "invalid_input: escalation already answered"
            );
            request = json!({"session_id":question["session_id"],"request_id":id,"reply_to":question["request_id"],"message":words,"human_turn_id":turn,"decision":"resolve"});
            "adjudicate"
        }
        _ => bail!("unsupported Voyager tool"),
    };
    request["op"] = json!(op);
    request
        .as_object_mut()
        .context("tool request")?
        .retain(|_, value| !value.is_null());
    if op == "supervise" {
        request["supervisor_id"] = args["supervisor_id"].clone();
    }
    if op == "move-vessel" {
        request["fleet_id"] = args["fleet_id"].clone();
    }
    exchange(state, request, false)
}

pub(super) fn reply(result: Result<Value>) -> Value {
    let success = result.is_ok();
    let text = match result { Ok(value) => value.to_string(), Err(error) => json!({"error":error.to_string(),"retry":"Inspect the outcome; no action was automatically replayed."}).to_string() };
    json!({"contentItems":[{"type":"inputText","text":text}],"success":success})
}
