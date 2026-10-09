//! A fixture-only collector that preserves source records, not a Pi adapter.
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    fs::OpenOptions,
    io::{self, BufRead, Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_RECORD: usize = 64 * 1024;

pub fn run(path: &Path, source: &str) -> Result<()> {
    ensure!(
        !source.is_empty() && source.len() <= 128,
        "invalid source ID"
    );
    // Never truncate previous evidence or follow an existing file/symlink.
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    let mut input = io::stdin().lock();
    let mut line = Vec::new();
    let mut sequence = 0_u64;
    loop {
        line.clear();
        // Bound allocation even when an untrusted producer never emits LF.
        let count = input
            .by_ref()
            .take((MAX_RECORD + 1) as u64)
            .read_until(b'\n', &mut line)?;
        if count == 0 {
            eprintln!("capture_closed records={sequence} task_outcome=unknown");
            return Ok(());
        }
        let parsed = parse(&line);
        match parsed {
            Ok(event) => {
                sequence += 1;
                append(
                    &mut output,
                    json!({
                        "schema_version": 1, "sequence": sequence,
                        "source": source, "source_record": sequence,
                        "recorded_unix_ms": SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis(),
                        "kind": "source_event", "session_id": null, "task_id": null,
                        "event": event
                    }),
                )?;
            }
            Err(_) => {
                // A generic gap records the failure without logging rejected
                // bytes or pretending subsequent capture is complete.
                append(
                    &mut output,
                    json!({
                        "schema_version": 1, "sequence": sequence + 1,
                        "source": source, "kind": "capture_gap",
                        "reason": "invalid_or_oversized_record", "task_id": null
                    }),
                )?;
                anyhow::bail!("capture stopped: invalid or oversized fixture record");
            }
        }
    }
}

fn parse(bytes: &[u8]) -> Result<Value> {
    ensure!(
        bytes.len() <= MAX_RECORD && bytes.ends_with(b"\n"),
        "invalid frame"
    );
    let value: Value = serde_json::from_slice(bytes).context("invalid JSON")?;
    let kind = value
        .get("type")
        .and_then(Value::as_str)
        .context("missing type")?;
    ensure!(!kind.is_empty() && value.is_object(), "invalid event");
    Ok(value)
}

fn append(output: &mut std::fs::File, value: Value) -> Result<()> {
    serde_json::to_writer(&mut *output, &value)?;
    output.write_all(b"\n")?;
    output.sync_data()?;
    Ok(())
}
