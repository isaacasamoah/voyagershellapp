//! Mechanism probes, not an installed daemon or a production capture adapter.
#[cfg(not(target_os = "linux"))]
compile_error!("These experiments currently require Linux; macOS support is unproved.");

mod capture;
mod handoff;

use anyhow::{Result, bail};
use std::{env, path::Path};

fn main() -> Result<()> {
    let args: Vec<_> = env::args().skip(1).collect();
    match args.as_slice() {
        [command, socket] if command == "receive" => handoff::receive(Path::new(socket)),
        [command, output, source] if command == "capture-fixture" => {
            capture::run(Path::new(output), source)
        }
        _ => bail!(
            "usage: voyager-probe receive PRIVATE_DIR/socket\n\
             or: voyager-probe capture-fixture NEW_FILE SOURCE_ID < synthetic.jsonl\n\
             Linux experiments only. Do not supply real conversations."
        ),
    }
}
