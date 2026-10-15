use anyhow::{Context, Result, bail};
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    os::unix::{fs::OpenOptionsExt, net::UnixStream},
    path::Path,
    time::Duration,
};

pub fn read(state: &Path, output: &Path) -> Result<()> {
    let socket = UnixStream::connect(state.join("whiteboard.sock"))
        .context("open the whiteboard desktop with --whiteboard-read first")?;
    socket.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut bytes = Vec::new();
    socket.take(16 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 16 * 1024 * 1024 {
        bail!("whiteboard snapshot exceeds 16 MiB");
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        bail!("{}", String::from_utf8_lossy(&bytes));
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(output)
        .context("choose a new PNG output path")?;
    file.write_all(&bytes)?;
    println!(
        "{}",
        serde_json::json!({"image": output.canonicalize()?, "bytes": bytes.len(), "scope": "whiteboard-only"})
    );
    Ok(())
}
