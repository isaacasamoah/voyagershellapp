use anyhow::{Result, bail};
use serde_json::json;
use std::{
    io::{self, Write},
    path::PathBuf,
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
        [op] if op == "events" => json!({"op":op,"after":0}),
        [op, cursor] if op == "events" => json!({"op":op,"after":cursor.parse::<i64>()?}),
        [op] if op == "watch" => return watch(&state, 0),
        [op, cursor] if op == "watch" => return watch(&state, cursor.parse::<i64>()?),
        _ => bail!(
            "usage: voyager [--state PRIVATE_DIR] COMMAND\n\
            serve CODEX_SOCKET | status | discover | register THREAD_ID | list\n\
            send SESSION_ID REQUEST_ID MESSAGE | events [CURSOR] | watch [CURSOR] | stop"
        ),
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&service::client(&state, request)?)?
    );
    Ok(())
}

fn watch(state: &std::path::Path, mut cursor: i64) -> Result<()> {
    loop {
        let page = service::client(state, json!({"op":"events","after":cursor}))?;
        for event in page["events"].as_array().unwrap_or(&Vec::new()) {
            println!("{}", serde_json::to_string(event)?);
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
