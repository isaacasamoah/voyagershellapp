use anyhow::{Result, bail};
use serde_json::json;
use std::{
    io::{self, Write},
    os::unix::process::CommandExt,
    path::PathBuf,
    process::Command,
    time::Duration,
};
use voyager_shell::service;

fn main() -> Result<()> {
    let mut args: Vec<_> = std::env::args().skip(1).collect();
    let state = if args.first().map(String::as_str) == Some("--state") && args.len() >= 2 {
        let state = PathBuf::from(&args[1]);
        args.drain(..2);
        state
    } else {
        PathBuf::from(
            std::env::var_os("HOME").ok_or_else(|| anyhow::anyhow!("provide --state DIR"))?,
        )
        .join(".local/share/voyagershell")
    };
    let request = match args.as_slice() {
        [op, socket] if op == "serve" => return service::serve(&state, &PathBuf::from(socket)),
        [op] if ["status", "discover", "list", "stop"].contains(&op.as_str()) => json!({"op":op}),
        [op, thread] if op == "register" => json!({"op":op,"thread_id":thread}),
        [op, session, id, message] if op == "send" => {
            json!({"op":op,"session_id":session,"request_id":id,"message":message})
        }
        [op, parent, id, cwd, prompt] if op == "launch" => {
            json!({"op":op,"parent_id":parent,"request_id":id,"cwd":cwd,"prompt":prompt})
        }
        [op, session] if op == "stop-worker" || op == "attach-info" => {
            json!({"op":op,"session_id":session})
        }
        [op, session] if op == "attach" => {
            let info = service::client(&state, json!({"op":"attach-info","session_id":session}))?;
            let executable = info["executable"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("missing native executable"))?;
            let args = info["args"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("missing native arguments"))?
                .iter()
                .map(|v| {
                    v.as_str()
                        .ok_or_else(|| anyhow::anyhow!("invalid native argument"))
                })
                .collect::<Result<Vec<_>>>()?;
            return Err(Command::new(executable).args(args).exec().into());
        }
        [op] if op == "events" => json!({"op":op,"after":0}),
        [op, cursor] if op == "events" => json!({"op":op,"after":cursor.parse::<i64>()?}),
        [op] if op == "watch" => return watch(&state, 0, false),
        [op, flag] if op == "watch" && flag == "--pretty" => return watch(&state, 0, true),
        [op, flag, cursor] if op == "watch" && flag == "--pretty" => {
            return watch(&state, cursor.parse::<i64>()?, true);
        }
        [op, cursor] if op == "watch" => return watch(&state, cursor.parse::<i64>()?, false),
        _ => bail!(
            "usage: voyager [--state PRIVATE_DIR] COMMAND\n\
            serve CODEX_SOCKET | status | discover | register THREAD_ID | list\n\
            send SESSION_ID REQUEST_ID MESSAGE | events [CURSOR] | watch [--pretty] [CURSOR] | stop\n\
            launch PARENT_SESSION REQUEST_ID CWD PROMPT | attach SESSION_ID | attach-info SESSION_ID | stop-worker SESSION_ID"
        ),
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&service::client(&state, request)?)?
    );
    Ok(())
}

fn watch(state: &std::path::Path, mut cursor: i64, pretty: bool) -> Result<()> {
    loop {
        let page = service::client(state, json!({"op":"events","after":cursor}))?;
        for event in page["events"].as_array().unwrap_or(&Vec::new()) {
            if pretty {
                let p = &event["payload"];
                let body = if event["type"] == "message" {
                    format!(
                        "{}: {}",
                        if p["role"] == "user" { "You" } else { "Agent" },
                        p["text"].as_str().unwrap_or("")
                    )
                } else {
                    format!("{} {}", event["type"].as_str().unwrap_or("event"), p)
                };
                // Never interpret terminal controls embedded in model/user text.
                let safe: String = body
                    .chars()
                    .flat_map(|c| {
                        if c.is_control() && c != '\n' && c != '\t' {
                            c.escape_default().collect::<Vec<_>>()
                        } else {
                            vec![c]
                        }
                    })
                    .collect();
                println!(
                    "#{} [{}] {}",
                    event["sequence"],
                    event["session_id"]
                        .as_str()
                        .unwrap_or("?")
                        .chars()
                        .take(8)
                        .collect::<String>(),
                    safe
                );
            } else {
                println!("{}", serde_json::to_string(event)?);
            }
        }
        io::stdout().flush()?;
        let next = page["cursor"]
            .as_i64()
            .ok_or_else(|| anyhow::anyhow!("missing cursor"))?;
        let caught_up = page["events"].as_array().is_none_or(|v| v.len() < 100);
        cursor = next;
        if caught_up {
            std::thread::sleep(Duration::from_millis(250));
        }
    }
}
