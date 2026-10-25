use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use voyager_shell::codex::Codex;

pub struct Provider {
    child: Child,
    receipt: PathBuf,
}
impl Provider {
    pub fn stop(mut self) -> Result<()> {
        if self.child.try_wait()?.is_none() {
            self.child.kill()?;
        }
        let exit = self.child.wait()?;
        save(
            &self.receipt,
            &json!({"pid":self.child.id(),"exit_observed":true,"exit_code":exit.code()}),
        )
    }
}
impl Drop for Provider {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
pub fn connect(root: &Path, name: &str) -> Result<(Provider, Codex)> {
    let socket = root.join(format!("{name}.sock"));
    let child = Command::new(std::env::var("VOYAGER_CODEX_BIN").unwrap_or("codex".into()))
        .args([
            "app-server",
            "--listen",
            &format!("unix://{}", socket.display()),
        ])
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(fs::File::create(root.join(format!("{name}.log")))?)
        .spawn()?;
    let provider = Provider {
        child,
        receipt: root.join(format!("{name}-cleanup.json")),
    };
    let deadline = Instant::now() + Duration::from_secs(10);
    while !socket.exists() {
        ensure!(Instant::now() < deadline, "provider socket did not appear");
        std::thread::sleep(Duration::from_millis(20));
    }
    Ok((provider, Codex::connect(&socket)?))
}
pub fn save(path: &Path, value: &Value) -> Result<()> {
    fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}
pub fn observe(connection: &mut Codex, seconds: u64) -> Result<Vec<Value>> {
    let mut events: Vec<_> = connection.pending.drain(..).collect();
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < deadline {
        if let Some(value) = connection.read()? {
            events.push(value);
        }
    }
    Ok(events)
}
pub fn idle(events: &[Value]) -> bool {
    !events.iter().any(|v| {
        matches!(v["method"].as_str(), Some("turn/started" | "item/started"))
            || (v["method"] == "thread/status/changed" && v["params"]["status"]["type"] == "active")
    })
}
pub fn after_preflight(reply: &Value, load: impl FnOnce() -> Result<Value>) -> Result<Value> {
    ensure!(
        reply.get("goal").is_some_and(Value::is_null),
        "goal state is not verified absent; refusing to load"
    );
    load()
}
pub fn settings(reply: &Value) -> Result<Value> {
    for key in [
        "model",
        "modelProvider",
        "cwd",
        "approvalPolicy",
        "approvalsReviewer",
    ] {
        ensure!(
            reply
                .get(key)
                .and_then(Value::as_str)
                .is_some_and(|s| !s.is_empty()),
            "missing setting: {key}"
        );
    }
    ensure!(
        reply.get("sandbox").is_some_and(Value::is_object)
            && reply.get("activePermissionProfile").is_some(),
        "missing permissions"
    );
    Ok(
        json!({"model":reply["model"],"modelProvider":reply["modelProvider"],"cwd":reply["cwd"],"approvalPolicy":reply["approvalPolicy"],"approvalsReviewer":reply["approvalsReviewer"],"sandbox":reply["sandbox"],"activePermissionProfile":reply["activePermissionProfile"]}),
    )
}
pub fn plain_resume(connection: &mut Codex, params: Value) -> Result<Value> {
    let reply = connection.rpc("thread/goal/get", json!({"threadId":params["threadId"]}))?;
    after_preflight(&reply, || connection.rpc("thread/resume", params))
}
pub fn require_idle(reply: &Value) -> Result<()> {
    ensure!(
        reply["thread"]["status"]["type"] == "idle",
        "provider did not report idle"
    );
    Ok(())
}
pub fn thread_id(reply: &Value) -> Result<&str> {
    reply["thread"]["id"]
        .as_str()
        .context("missing thread identity")
}
