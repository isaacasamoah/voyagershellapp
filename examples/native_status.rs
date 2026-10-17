use anyhow::{Context, Result};
use voyager_shell::{adoption::Candidate, native_instance::AgentFrontend, native_status};
fn main() -> Result<()> {
    let window = std::env::args()
        .nth(1)
        .context("native_status WINDOW_ID")?
        .parse()?;
    let candidate = Candidate::inspect(window)?;
    let handoff = candidate.handoff()?;
    let frontend = AgentFrontend::inspect(&candidate)?.context("no native Codex frontend")?;
    let status = native_status::read(&candidate, Some(&handoff), &frontend.process)?;
    if let Some(path) = std::env::args().nth(2) {
        std::fs::write(path, &status.output)?;
    }
    let thread = status.thread?;
    println!(
        "{}",
        serde_json::json!({"thread":thread,"relayed_bytes":status.output.len()})
    );
    Ok(())
}
