use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    os::unix::{fs::OpenOptionsExt, io::AsRawFd},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const PAGE: usize = 32768;
const SEARCH_BYTES: usize = 8 * 1024 * 1024;

fn permitted(state: &Path, path: &Path) -> Result<()> {
    ensure!(
        !path.starts_with(state)
            && !["/proc", "/sys", "/dev", "/run"]
                .iter()
                .any(|root| path.starts_with(root))
            && !path.components().any(|part| {
                let name = part.as_os_str().to_string_lossy();
                matches!(name.as_ref(), ".ssh" | ".gnupg" | ".aws" | "contexts")
                    || name == "auth.json"
                    || name == ".env"
                    || name.starts_with(".env.")
                    || name.ends_with(".pem")
                    || name.ends_with(".key")
            })
            && !path
                .ancestors()
                .any(|parent| parent.join("instances.sock").exists()),
        "forbidden: protected location"
    );
    Ok(())
}

fn resolve(state: &Path, path: &Value) -> Result<PathBuf> {
    let path = Path::new(path.as_str().context("invalid_input: path must be text")?);
    ensure!(path.is_absolute(), "invalid_input: expected absolute path");
    permitted(state, path)?;
    let path = path.canonicalize().context("resolve local path")?;
    permitted(state, &path)?;
    Ok(path)
}

fn open(state: &Path, path: &Path) -> Result<File> {
    permitted(state, path)?;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NONBLOCK | nix::libc::O_NOFOLLOW)
        .open(path)
        .context("open local file")?;
    let actual = fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))?;
    permitted(state, &actual)?;
    ensure!(
        file.metadata()?.is_file(),
        "invalid_input: expected regular file"
    );
    Ok(file)
}

fn text_page(file: &mut File, limit: usize) -> Result<(String, bool, usize)> {
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    let truncated = bytes.len() > limit;
    bytes.truncate(limit);
    ensure!(!bytes.contains(&0), "unsupported: binary file");
    if let Err(error) = std::str::from_utf8(&bytes) {
        ensure!(
            truncated && error.error_len().is_none(),
            "unsupported: expected UTF-8 text and aligned offset"
        );
        bytes.truncate(error.valid_up_to());
    }
    let count = bytes.len();
    Ok((String::from_utf8(bytes)?, truncated, count))
}

pub(super) fn read(state: &Path, args: &Value) -> Result<Value> {
    let state = state.canonicalize()?;
    let path = resolve(&state, &args["path"])?;
    let offset = args["offset"]
        .as_u64()
        .context("invalid_input: offset must be a nonnegative integer")?;
    let mut file = open(&state, &path)?;
    let size = file.metadata()?.len();
    ensure!(offset <= size, "invalid_input: offset exceeds file size");
    file.seek(SeekFrom::Start(offset))?;
    let (text, truncated, count) = text_page(&mut file, PAGE)?;
    Ok(
        json!({"path":path,"offset":offset,"next_offset":offset+count as u64,"size":size,"text":text,"truncated":truncated}),
    )
}

pub(super) fn search(state: &Path, args: &Value) -> Result<Value> {
    let state = state.canonicalize()?;
    let root = resolve(&state, &args["path"])?;
    let query = args["query"]
        .as_str()
        .context("invalid_input: query must be text")?;
    let content = args["content"]
        .as_bool()
        .context("invalid_input: content must be boolean")?;
    ensure!(
        query.len() <= 1024 && (!content || !query.is_empty()),
        "invalid_input: query must be bounded and content query nonempty"
    );
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut pending = vec![(root.clone(), 0)];
    let mut matches = Vec::new();
    let mut visited = 0;
    let mut bytes = 0;
    let mut skipped = 0;
    let mut partial = false;
    while let Some((path, depth)) = pending.pop() {
        if visited >= 4096
            || matches.len() >= 100
            || bytes >= SEARCH_BYTES
            || Instant::now() >= deadline
        {
            partial = true;
            break;
        }
        visited += 1;
        if permitted(&state, &path).is_err() {
            skipped += 1;
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(&path) else {
            skipped += 1;
            continue;
        };
        if meta.is_symlink() {
            skipped += 1;
            continue;
        }
        if !content
            && path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().contains(query))
        {
            matches.push(json!({"path":path,"kind":if meta.is_dir(){"directory"}else{"file"}}));
        }
        if meta.is_dir() {
            if depth >= 16 {
                partial = true;
                continue;
            }
            let Ok(entries) = fs::read_dir(&path) else {
                skipped += 1;
                continue;
            };
            for entry in entries {
                if pending.len() + visited >= 4096 || Instant::now() >= deadline {
                    partial = true;
                    break;
                }
                if let Ok(entry) = entry {
                    pending.push((entry.path(), depth + 1));
                } else {
                    skipped += 1;
                }
            }
        } else if content && meta.is_file() {
            let limit = (256 * 1024).min(SEARCH_BYTES - bytes);
            bytes += usize::try_from(meta.len()).unwrap_or(usize::MAX).min(limit);
            match open(&state, &path).and_then(|mut file| text_page(&mut file, limit)) {
                Ok((text, truncated, _)) => {
                    partial |= truncated;
                    if let Some(position) = text.find(query) {
                        let line = text[..position].bytes().filter(|b| *b == b'\n').count() + 1;
                        let snippet: String = text[position..].chars().take(200).collect();
                        matches.push(
                            json!({"path":path,"line":line,"offset":position,"snippet":snippet}),
                        );
                    }
                }
                Err(_) => skipped += 1,
            }
        }
    }
    Ok(
        json!({"path":root,"matches":matches,"visited":visited,"bytes_scanned":bytes,"skipped":skipped,"partial":partial || skipped>0,"limits":{"entries":4096,"matches":100,"file_bytes":262144,"total_bytes":SEARCH_BYTES,"depth":16,"seconds":2}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn reads_paginate_unicode_and_refuse_protected_or_nonregular_targets() {
        let root = std::env::temp_dir().join(format!("vread-{}", uuid::Uuid::new_v4()));
        let state = root.join("state");
        fs::create_dir_all(&state).unwrap();
        let source = format!("{}€end", "x".repeat(PAGE - 1));
        fs::write(root.join("text"), &source).unwrap();
        let first = read(&state, &json!({"path":root.join("text"),"offset":0})).unwrap();
        assert_eq!(first["text"].as_str().unwrap().len(), PAGE - 1);
        assert_eq!(first["truncated"], true);
        let rest = read(
            &state,
            &json!({"path":root.join("text"),"offset":first["next_offset"]}),
        )
        .unwrap();
        assert_eq!(rest["text"], "€end");
        assert_eq!(rest["truncated"], false);
        assert!(read(&state, &json!({"path":root.join("text"),"offset":PAGE})).is_err());
        fs::write(state.join("private"), "PRIVATE_FIXTURE").unwrap();
        symlink(state.join("private"), root.join("alias")).unwrap();
        assert!(
            read(&state, &json!({"path":root.join("alias"),"offset":0}))
                .unwrap_err()
                .to_string()
                .contains("protected")
        );
        let fifo = root.join("fifo");
        nix::unistd::mkfifo(&fifo, nix::sys::stat::Mode::S_IRUSR).unwrap();
        assert!(read(&state, &json!({"path":fifo,"offset":0})).is_err());
        assert!(read(&state, &json!({"path":"relative","offset":0})).is_err());
        assert!(read(&state, &json!({"path":"/proc/self/environ","offset":0})).is_err());
        fs::write(root.join("binary"), [1, 0, 2]).unwrap();
        assert!(read(&state, &json!({"path":root.join("binary"),"offset":0})).is_err());
        assert_eq!(fs::read_to_string(root.join("text")).unwrap(), source);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn literal_search_reports_source_and_incomplete_coverage() {
        let root = std::env::temp_dir().join(format!("vsearch-{}", uuid::Uuid::new_v4()));
        let state = root.join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(root.join("transcript.jsonl"), "first\n[needle].* literal\n").unwrap();
        fs::write(state.join("protected"), "[needle].* hidden").unwrap();
        symlink(&root, root.join("loop")).unwrap();
        let result = search(
            &state,
            &json!({"path":root,"query":"[needle].*","content":true}),
        )
        .unwrap();
        assert_eq!(result["matches"].as_array().unwrap().len(), 1);
        assert_eq!(result["matches"][0]["line"], 2);
        assert_eq!(result["partial"], true);
        let names = search(
            &state,
            &json!({"path":root,"query":"transcript","content":false}),
        )
        .unwrap();
        assert_eq!(names["matches"].as_array().unwrap().len(), 1);
        assert!(search(&state, &json!({"path":root,"query":"","content":true})).is_err());
        fs::write(root.join("large"), "z".repeat(300_000)).unwrap();
        let bounded = search(
            &state,
            &json!({"path":root.join("large"),"query":"absent","content":true}),
        )
        .unwrap();
        assert_eq!(bounded["partial"], true);
        assert_eq!(bounded["bytes_scanned"], 262144);
        fs::remove_dir_all(root).unwrap();
    }
}
