use anyhow::Result;
use std::{process::Command, thread, time::Duration};
use voyager_shell::adoption::Process;

#[test]
fn retained_handle_observes_exit_without_reaping_the_child() -> Result<()> {
    let mut child = Command::new("sleep").arg("30").spawn()?;
    let process = Process::open(child.id())?;
    assert!(process.alive()?);
    child.kill()?;
    child.wait()?;
    assert!(!process.alive()?);
    Ok(())
}

#[test]
fn signal_targets_only_the_retained_process() -> Result<()> {
    let mut target = Command::new("sleep").arg("30").spawn()?;
    let mut other = Command::new("sleep").arg("30").spawn()?;
    let process = Process::open(target.id())?;
    process.signal(nix::libc::SIGTERM)?;
    for _ in 0..100 {
        if !process.alive()? {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    let target_stopped = !process.alive()?;
    let other_running = other.try_wait()?.is_none();
    let _ = target.kill();
    target.wait()?;
    other.kill()?;
    other.wait()?;
    assert!(target_stopped);
    assert!(other_running);
    Ok(())
}

#[test]
#[ignore = "Temporarily traces the explicitly supplied disposable native window"]
fn dropping_handoff_releases_the_original_terminal() -> Result<()> {
    let window: u32 = std::env::var("VOYAGER_ADOPTION_WINDOW")?.parse()?;
    let target = voyager_shell::adoption::Candidate::inspect(window)?;
    let handoff = target.handoff()?;
    drop(handoff);
    let mut released = false;
    for _ in 0..100 {
        released = std::fs::read_to_string(format!("/proc/{}/status", target.terminal.pid))?
            .lines()
            .any(|line| {
                line.starts_with("TracerPid:") && line.split_whitespace().nth(1) == Some("0")
            });
        if released {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(released);
    assert!(target.terminal.alive()? && target.shell.alive()?);
    Ok(())
}
