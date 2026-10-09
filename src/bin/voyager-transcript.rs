//! Opt-in transcript experiment. Never opens the running service's event store.
use anyhow::{Result, bail};
use std::path::Path;
use voyager_shell::transcript;

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let output = match args.as_slice() {
        [op, state, file, thread] if op == "register" => {
            transcript::register(Path::new(state), Path::new(file), thread)?
        }
        [op, state] if op == "poll" => transcript::poll(Path::new(state))?,
        [op, state] if op == "events" => transcript::open(Path::new(state))?.events(0)?,
        [op, state, cursor] if op == "events" => {
            transcript::open(Path::new(state))?.events(cursor.parse()?)?
        }
        _ => bail!(
            "usage: voyager-transcript register NEW_PRIVATE_DIR TRANSCRIPT THREAD_ID\n\
            voyager-transcript poll PRIVATE_DIR\n\
            voyager-transcript events PRIVATE_DIR [EVENT_CURSOR]\n\
            Codex 0.162.0 experiment. Register starts at EOF; no historical import."
        ),
    };
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
