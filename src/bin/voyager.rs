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
    let control = if args.first().map(String::as_str) == Some("--control") && args.len() >= 2 {
        let generation = args[1].clone();
        args.drain(..2);
        Some(generation)
    } else {
        None
    };
    if control.is_some()
        && !args.first().is_some_and(|op| {
            ["send", "launch", "stop-instance", "shell-exec"].contains(&op.as_str())
        })
    {
        bail!("--control is only supported by send, launch, shell-exec and stop-instance");
    }
    let arity = match args.first().map(String::as_str) {
        Some("create" | "launch") => 5,
        Some("open") => 3,
        Some("background" | "stop-instance" | "remove" | "register-instance") => 2,
        Some("list") => 1,
        _ => args.len(),
    };
    let options = if args.len() > arity {
        args.split_off(arity)
    } else {
        Vec::new()
    };
    let op = args.first().map(String::as_str).unwrap_or("");
    let mut background = false;
    let mut runtime_only = false;
    let mut stop_removed = false;
    let mut include_removed = false;
    let mut request_id = None;
    let mut terminal = None;
    let mut options = options.into_iter();
    while let Some(option) = options.next() {
        match option.as_str() {
            "--background" if ["create", "launch"].contains(&op) => background = true,
            "--runtime-only" if op == "stop-instance" => runtime_only = true,
            "--stop" if op == "remove" => stop_removed = true,
            "--include-removed" if op == "list" => include_removed = true,
            "--terminal" if op == "create" => {
                terminal = Some(
                    options
                        .next()
                        .ok_or_else(|| anyhow::anyhow!("provide a terminal after --terminal"))?,
                )
            }
            "--request-id"
                if [
                    "open",
                    "background",
                    "stop-instance",
                    "remove",
                    "register-instance",
                ]
                .contains(&op) =>
            {
                request_id = Some(
                    options
                        .next()
                        .ok_or_else(|| anyhow::anyhow!("provide an ID after --request-id"))?,
                )
            }
            _ => bail!("invalid option for {op}: {option}"),
        }
    }
    let mut request = match args.as_slice() {
        [op, output] if op == "whiteboard-read" => {
            return voyager_shell::whiteboard::read(&state, std::path::Path::new(output));
        }
        [op] if op == "serve" => return service::serve(&state, None),
        [op] if op == "start" => {
            println!("{}", service::start(&state)?);
            return Ok(());
        }
        [op, socket] if op == "serve" => {
            return service::serve(&state, Some(&PathBuf::from(socket)));
        }
        [op] if ["status", "discover", "connection-info", "list", "stop"]
            .contains(&op.as_str()) =>
        {
            json!({"op":op,"include_removed":include_removed})
        }
        [op, thread] if op == "register" => json!({"op":op,"thread_id":thread}),
        [op, generation] if op == "undock" => json!({"op":op,"generation":generation}),
        [op, session, id, message] if op == "send" => {
            json!({"op":op,"session_id":session,"request_id":id,"message":message})
        }
        [op, parent, id, cwd, prompt] if op == "launch" => {
            json!({"op":op,"parent_id":parent,"request_id":id,"cwd":cwd,"prompt":prompt,"open":!background})
        }
        [op, kind, id, name, cwd] if op == "create" => {
            json!({"op":op,"kind":kind,"request_id":id,"name":name,"cwd":cwd,"open":!background})
        }
        [op, session, id, command] if op == "shell-exec" => {
            json!({"op":op,"session_id":session,"request_id":id,"command":command})
        }
        [op, session] if op == "shell-read" => json!({"op":op,"session_id":session,"after":0}),
        [op, session, after] if op == "shell-read" => {
            json!({"op":op,"session_id":session,"after":after.parse::<u64>()?})
        }
        [op, session] if op == "shell-attach" => {
            let info = service::client(&state, json!({"op":"attach-info","session_id":session}))?;
            let socket = info["socket"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("not a shell"))?;
            return voyager_shell::shell_transport::attach(std::path::Path::new(socket));
        }
        [op, session, terminal] if op == "open" => {
            json!({"op":op,"session_id":session,"terminal":terminal})
        }
        [op, session]
            if ["background", "stop-instance", "remove", "register-instance"]
                .contains(&op.as_str()) =>
        {
            json!({"op":op,"session_id":session,"close_window":!runtime_only,"stop":stop_removed})
        }
        [op, session] if op == "attach-info" => json!({"op":op,"session_id":session}),
        [op, id] if op == "operation" => json!({"op":op,"request_id":id}),
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
            "usage: voyager [--state PRIVATE_DIR] [--control GENERATION] COMMAND\n\
            whiteboard-read NEW_PNG | start | serve [CODEX_SOCKET] | status | discover | connection-info | register THREAD_ID | list\n\
            create codex|shell REQUEST_ID NAME CWD [--background] [--terminal ghostty] | open SESSION_ID ghostty [--request-id ID]\n\
            shell-exec SESSION_ID REQUEST_ID COMMAND | shell-read SESSION_ID [CURSOR] | shell-attach SESSION_ID\n\
            send SESSION_ID REQUEST_ID MESSAGE | events [CURSOR] | watch [--pretty] [CURSOR] | stop\n\
            launch PARENT_SESSION REQUEST_ID CWD PROMPT [--background] | attach SESSION_ID | attach-info SESSION_ID | stop-instance SESSION_ID [--runtime-only] [--request-id ID]\n\
            background SESSION_ID | remove SESSION_ID [--stop] | register-instance SESSION_ID | operation REQUEST_ID | list [--include-removed]\n\
            undock GENERATION (--control is supported by send, launch, shell-exec and stop-instance)"
        ),
    };
    if let Some(terminal) = terminal {
        request["terminal"] = json!(terminal);
    }
    if [
        "open",
        "background",
        "stop-instance",
        "remove",
        "register-instance",
    ]
    .contains(&request["op"].as_str().unwrap_or(""))
    {
        request["request_id"] =
            json!(request_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()));
    } else if request_id.is_some() {
        bail!("--request-id is only for lifecycle actions; create/launch/send use a positional ID");
    }
    if let Some(generation) = control {
        request["control_generation"] = json!(generation);
    }
    let mut receipt = service::client(&state, request)?;
    while receipt["state"] == "pending" {
        let id = receipt["request_id"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("pending receipt has no request ID"))?
            .to_owned();
        std::thread::sleep(Duration::from_millis(250));
        receipt = service::client(&state, json!({"op":"operation","request_id":id}))?;
    }
    println!("{}", serde_json::to_string_pretty(&receipt)?);
    if ["partial", "uncertain", "cancelled"]
        .iter()
        .any(|s| receipt["state"] == *s)
    {
        bail!(
            "{} (operation {})",
            receipt["error"]
                .as_str()
                .unwrap_or("action incomplete; inspect the saved receipt"),
            receipt["request_id"].as_str().unwrap_or("unknown")
        );
    }
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
