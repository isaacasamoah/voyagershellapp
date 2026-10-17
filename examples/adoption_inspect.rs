use anyhow::{Result, ensure};
use serde_json::json;
use std::io::{self, BufRead, Write};
use voyager_shell::adoption::{Candidate, Process, children};

fn identity(process: &Process) -> serde_json::Value {
    json!({"pid":process.pid,"start":process.start,"session":process.session,"executable":process.executable})
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    ensure!(
        args.len() == 1 || (args.len() == 2 && args[1] == "--retain"),
        "usage: adoption_inspect WINDOW_ID [--retain]"
    );
    let candidate = Candidate::inspect(args[0].parse()?)?;
    println!(
        "{}",
        json!({"state":"not_adopted","window":candidate.window,"terminal":identity(&candidate.terminal),"shell":identity(&candidate.shell),"tty":candidate.tty,"master_retained":true,"shell_children":children(candidate.shell.pid)?,"reason":"Inspection retains handles without installing the lifecycle handoff."})
    );
    io::stdout().flush()?;
    if args.len() == 2 {
        for line in io::stdin().lock().lines() {
            ensure!(line? == "status", "only status is supported");
            println!(
                "{}",
                json!({"terminal_alive":candidate.terminal.alive()?,"shell_alive":candidate.shell.alive()?})
            );
            io::stdout().flush()?;
        }
    }
    Ok(())
}
