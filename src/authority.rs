use crate::store::Store;
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rank {
    Admiral,
    Commodore,
    Captain,
    Crew,
}

impl Rank {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "admiral" => Ok(Self::Admiral),
            "commodore" => Ok(Self::Commodore),
            "captain" => Ok(Self::Captain),
            "crew" => Ok(Self::Crew),
            _ => bail!("invalid_input: unknown rank"),
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Admiral => "admiral",
            Self::Commodore => "commodore",
            Self::Captain => "captain",
            Self::Crew => "crew",
        }
    }
    pub fn supervises(self, other: Self) -> bool {
        matches!(
            (self, other),
            (Self::Admiral, Self::Commodore)
                | (Self::Commodore, Self::Captain)
                | (Self::Captain, Self::Crew)
        )
    }
}

pub struct Credentials {
    tokens: HashMap<String, String>,
    paths: HashMap<String, PathBuf>,
}
impl Default for Credentials {
    fn default() -> Self {
        Self::new()
    }
}
impl Credentials {
    pub fn locator(state: &Path, launch: &str) -> PathBuf {
        let filename: String = launch
            .bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() || b"-_.".contains(&b) {
                    (b as char).to_string()
                } else {
                    format!("%{b:02x}")
                }
            })
            .collect();
        state.join("contexts").join(format!("{filename}.json"))
    }
    pub fn clear_stale(state: &Path) -> Result<()> {
        let dir = state.join("contexts");
        if !dir.exists() {
            return Ok(());
        }
        crate::service::private_dir(&dir)?;
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            let meta = fs::symlink_metadata(&path)?;
            ensure!(
                meta.is_file() && !meta.file_type().is_symlink(),
                "invalid context file"
            );
            fs::remove_file(path)?;
        }
        Ok(())
    }
    pub fn new() -> Self {
        Self {
            tokens: HashMap::new(),
            paths: HashMap::new(),
        }
    }
    pub fn issue(
        &mut self,
        state: &Path,
        service: &str,
        session: &str,
        launch: &str,
    ) -> Result<PathBuf> {
        self.revoke(session)?;
        let dir = state.join("contexts");
        crate::service::private_dir(&dir)?;
        let path = Self::locator(state, launch);
        let mut random = [0u8; 32];
        fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut token = String::new();
        let mut accumulator = 0u32;
        let mut bits = 0;
        for byte in random {
            accumulator = (accumulator << 8) | u32::from(byte);
            bits += 8;
            while bits >= 6 {
                bits -= 6;
                token.push(alphabet[((accumulator >> bits) & 63) as usize] as char);
            }
        }
        if bits > 0 {
            token.push(alphabet[((accumulator << (6 - bits)) & 63) as usize] as char);
        }
        let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(nix::libc::O_NOFOLLOW)
            .open(&temporary)?;
        writeln!(
            file,
            "{}",
            json!({"session_id":session,"service_instance":service,"token":token})
        )?;
        file.sync_all()?;
        fs::rename(&temporary, &path)?;
        self.tokens.insert(token, session.to_owned());
        self.paths.insert(session.to_owned(), path.clone());
        Ok(path)
    }
    pub fn actor(&self, store: &Store, credential: &Value, service: &str) -> Result<Value> {
        ensure!(
            credential["service_instance"] == service,
            "forbidden: stale instance context"
        );
        let session = self
            .tokens
            .get(
                credential["token"]
                    .as_str()
                    .context("forbidden: missing instance credential")?,
            )
            .context("forbidden: invalid or revoked instance credential")?;
        let record = store
            .session(session)
            .context("forbidden: instance not registered")?;
        store.require_registered(session)?;
        Ok(
            json!({"kind":if record["kind"] == "shell" {"terminal"} else {"instance"},"session_id":session}),
        )
    }
    pub fn revoke(&mut self, session: &str) -> Result<()> {
        self.tokens.retain(|_, s| s != session);
        if let Some(path) = self.paths.remove(session) {
            match fs::remove_file(path) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }
    pub fn path(&self, session: &str) -> Option<&Path> {
        self.paths.get(session).map(PathBuf::as_path)
    }
}

pub fn owner() -> Value {
    json!({"kind":"owner","session_id":null})
}
pub fn is_owner(actor: &Value) -> bool {
    actor["kind"] == "owner"
}
pub fn actor_id(actor: &Value) -> Result<&str> {
    actor["session_id"]
        .as_str()
        .context("forbidden: no bound instance")
}
pub fn rank(record: &Value) -> Result<Option<Rank>> {
    record["rank"].as_str().map(Rank::parse).transpose()
}
pub fn direct(store: &Store, supervisor: &str, target: &str) -> Result<bool> {
    if supervisor == target {
        return Ok(false);
    }
    let parent = store.session(supervisor)?;
    let child = store.session(target)?;
    if !parent["removed_ms"].is_null()
        || !child["removed_ms"].is_null()
        || child["supervisor_id"] != supervisor
    {
        return Ok(false);
    }
    Ok(match (rank(&parent)?, rank(&child)?) {
        (Some(p), Some(c)) => p.supervises(c),
        (Some(p), None) => child["kind"] == "shell" && p != Rank::Crew,
        _ => false,
    })
}
pub fn assignment(store: &Store, target: &Value, supervisor: &str) -> Result<()> {
    store.require_registered(supervisor)?;
    ensure!(
        target["id"] != supervisor,
        "invalid_input: self supervision"
    );
    let parent = store.session(supervisor)?;
    let p = rank(&parent)?.context("invalid_input: a terminal cannot supervise")?;
    let valid = match rank(target)? {
        Some(c) => p.supervises(c),
        None => target["kind"] == "shell" && p != Rank::Crew,
    };
    ensure!(
        valid,
        "invalid_input: assignments require adjacent agent ranks or a non-Crew shell controller"
    );
    Ok(())
}
pub fn authorize(store: &Store, actor: &Value, dock: Option<&str>, request: &Value) -> Result<()> {
    if is_owner(actor) {
        return Ok(());
    }
    let id = actor_id(actor)?;
    store.require_registered(id)?;
    let op = request["op"]
        .as_str()
        .context("invalid_input: missing op")?;
    if [
        "status",
        "list",
        "capabilities",
        "operation",
        "events",
        "report",
        "escalate",
    ]
    .contains(&op)
    {
        return Ok(());
    }
    ensure!(
        actor["kind"] == "instance",
        "forbidden: terminal callers cannot mutate instances"
    );
    if ["create", "launch"].contains(&op) {
        return Ok(());
    }
    if ["fleets", "move-vessel"].contains(&op) {
        ensure!(
            dock == Some(id),
            "forbidden: fleet organization requires the current dock"
        );
        return Ok(());
    }
    let target = request["session_id"]
        .as_str()
        .context("forbidden: owner-only operation")?;
    ensure!(
        [
            "send",
            "adjudicate",
            "shell-exec",
            "shell-read",
            "open",
            "background",
            "stop-instance"
        ]
        .contains(&op),
        "forbidden: owner-only operation"
    );
    store.require_registered(target)?;
    let permitted = dock == Some(id)
        || direct(store, id, target)?
        || (target == id && ["open", "shell-read"].contains(&op));
    ensure!(
        permitted,
        "forbidden: requires current dock or a direct assigned report"
    );
    Ok(())
}
pub fn creation(
    store: &Store,
    actor: &Value,
    dock: Option<&str>,
    request: &Value,
) -> Result<(Option<Rank>, Option<String>)> {
    let kind = request["kind"].as_str().unwrap_or("codex");
    let selected = if kind == "shell" {
        ensure!(
            !request.get("rank").is_some_and(|v| !v.is_null()),
            "invalid_input: Bash has no rank"
        );
        None
    } else {
        Some(Rank::parse(
            request.get("rank").map_or(Ok("crew"), |v| {
                v.as_str().context("invalid_input: rank must be a string")
            })?,
        )?)
    };
    let requested = request
        .get("supervisor_id")
        .map(|v| {
            v.as_str()
                .filter(|s| !s.is_empty())
                .context("invalid_input: supervisor_id must be a UUID")
        })
        .transpose()?;
    let supervisor = if is_owner(actor) {
        requested.map(str::to_owned)
    } else {
        ensure!(
            actor["kind"] == "instance",
            "forbidden: terminal cannot create instances"
        );
        let id = actor_id(actor)?;
        let parent = store.session(id)?;
        if dock == Some(id) && selected == Some(Rank::Crew) && requested.is_none() {
            None
        } else {
            ensure!(
                requested.is_none_or(|s| s == id),
                "forbidden: new reports must be assigned to caller"
            );
            let p = rank(&parent)?.context("forbidden: no rank")?;
            ensure!(
                selected.is_some_and(|c| p.supervises(c)),
                "forbidden: explicitly choose the next lower rank"
            );
            Some(id.to_owned())
        }
    };
    if let Some(s) = &supervisor {
        assignment(
            store,
            &json!({"id":null,"kind":kind,"rank":selected.map(Rank::as_str)}),
            s,
        )?;
    }
    Ok((selected, supervisor))
}

pub fn development(actor: &Value, op: &str, granted: bool, owns_run: bool) -> Result<()> {
    ensure!(
        [
            "test-grant",
            "test-revoke",
            "test-start",
            "test-stop",
            "test-runs",
            "test-read"
        ]
        .contains(&op),
        "invalid_input: unknown development operation"
    );
    if is_owner(actor) {
        return Ok(());
    }
    ensure!(
        actor["kind"] == "instance",
        "forbidden: development testing requires an instance"
    );
    ensure!(
        match op {
            "test-start" => granted,
            "test-read" | "test-stop" => owns_run,
            "test-runs" => true,
            _ => false,
        },
        "forbidden: development operation outside caller grant or run ownership"
    );
    Ok(())
}

#[cfg(test)]
mod development_tests {
    use super::*;

    #[test]
    fn development_rights_require_an_explicit_grant_and_do_not_follow_rank() {
        let agent = json!({"kind":"instance","session_id":"a","rank":"admiral"});
        let shell = json!({"kind":"terminal","session_id":"a"});
        assert!(development(&owner(), "test-grant", false, false).is_ok());
        assert!(development(&agent, "test-grant", true, true).is_err());
        assert!(development(&agent, "test-start", false, true).is_err());
        assert!(development(&agent, "test-start", true, false).is_ok());
        assert!(development(&shell, "test-start", true, true).is_err());
        assert!(development(&agent, "test-stop", false, true).is_ok());
        assert!(development(&agent, "test-read", true, false).is_err());
        assert!(development(&agent, "test-read", false, true).is_ok());
        assert!(development(&agent, "test-runs", false, false).is_ok());
        assert!(development(&agent, "test-unknown", true, true).is_err());
    }
}
