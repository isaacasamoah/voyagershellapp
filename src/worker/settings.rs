use crate::codex::Codex;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{fs, os::unix::fs::MetadataExt, path::Path};

pub struct Settings {
    pub snapshot: Value,
}
fn files(sources: &Value) -> Result<Vec<Value>> {
    sources.as_array().context("settings_unavailable: instruction sources are missing")?.iter().map(|source| {
        let path = source.as_str().context("settings_unavailable: invalid instruction source")?;
        ensure!(Path::new(path).is_absolute(), "settings_unavailable: instruction source is not absolute");
        let m = fs::metadata(path).context("settings_unavailable: instruction source is unavailable")?;
        Ok(json!({"path":path,"device":m.dev(),"inode":m.ino(),"size":m.len(),"modified":m.mtime(),"modified_ns":m.mtime_nsec(),"changed":m.ctime(),"changed_ns":m.ctime_nsec()}))
    }).collect()
}
fn workflow(connection: &mut Codex, effective: &Value) -> Result<Value> {
    let response = connection.rpc(
        "config/read",
        json!({"cwd":effective["cwd"],"includeLayers":true}),
    )?;
    let mut layers = Vec::new();
    for layer in response["layers"]
        .as_array()
        .context("settings_unavailable: configuration provenance is missing")?
    {
        if layer["name"]["type"] == "sessionFlags" {
            continue;
        }
        ensure!(
            layer["name"].is_object() && layer["version"].is_string(),
            "settings_unavailable: invalid configuration provenance"
        );
        layers.push(json!({"name":layer["name"],"version":layer["version"],"disabledReason":layer["disabledReason"]}));
    }
    Ok(json!({"layers":layers,"instruction_files":files(&effective["instructionSources"])?}))
}
impl Settings {
    pub fn capture(connection: &mut Codex, reply: &Value, executable: &str) -> Result<Value> {
        let mut effective = serde_json::Map::new();
        for key in [
            "model",
            "modelProvider",
            "cwd",
            "approvalPolicy",
            "approvalsReviewer",
            "sandbox",
            "activePermissionProfile",
            "runtimeWorkspaceRoots",
            "instructionSources",
            "reasoningEffort",
        ] {
            effective.insert(
                key.into(),
                reply
                    .get(key)
                    .context("settings_unavailable: missing effective setting")?
                    .clone(),
            );
        }
        let effective = Value::Object(effective);
        let snapshot = json!({"version":1,"provider_executable":executable,"provider_version":connection.user_agent,"effective":effective,"workflow":workflow(connection,&effective)?});
        Self::parse(&snapshot, executable)?;
        Ok(snapshot)
    }
    pub fn parse(snapshot: &Value, executable: &str) -> Result<Self> {
        ensure!(
            snapshot["version"] == 1
                && snapshot["provider_executable"] == executable
                && snapshot["provider_version"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty()),
            "settings_unavailable: provider settings cannot be verified"
        );
        let effective = &snapshot["effective"];
        let string = |key: &str| {
            effective[key]
                .as_str()
                .filter(|v| !v.is_empty())
                .context("settings_unavailable: a saved setting is missing")
        };
        let cwd = string("cwd")?.to_owned();
        ensure!(
            Path::new(&cwd).is_absolute() && Path::new(&cwd).is_dir(),
            "directory_unavailable: saved working folder is unavailable"
        );
        string("model")?;
        ensure!(
            string("modelProvider")? == "openai",
            "settings_unavailable: this provider is not supported for recovery yet"
        );
        let approval = string("approvalPolicy")?.to_owned();
        ensure!(
            ["never", "on-request", "untrusted"].contains(&approval.as_str())
                && string("approvalsReviewer")? == "user",
            "settings_unavailable: unsupported approval settings"
        );
        ensure!(
            effective
                .get("activePermissionProfile")
                .is_some_and(Value::is_null),
            "settings_unavailable: named permission profiles are not supported for recovery yet"
        );
        ensure!(
            effective["sandbox"] == json!({"type":"dangerFullAccess"})
                || effective["sandbox"] == json!({"type":"readOnly","networkAccess":false}),
            "settings_unavailable: this sandbox policy cannot be reproduced safely yet"
        );
        ensure!(
            effective["runtimeWorkspaceRoots"]
                .as_array()
                .is_some_and(|a| a
                    .iter()
                    .all(|v| v.as_str().is_some_and(|p| Path::new(p).is_absolute()))),
            "settings_unavailable: workspace roots are missing"
        );
        ensure!(
            snapshot["workflow"]["layers"].is_array()
                && snapshot["workflow"]["instruction_files"]
                    == json!(files(&effective["instructionSources"])?),
            "settings_unavailable: instruction sources changed or cannot be verified"
        );
        let effort = effective
            .get("reasoningEffort")
            .context("settings_unavailable: reasoning settings are missing")?;
        ensure!(
            effort.is_null()
                || effort.as_str().is_some_and(|s| [
                    "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"
                ]
                .contains(&s)),
            "settings_unavailable: unsupported reasoning settings"
        );
        Ok(Self {
            snapshot: snapshot.clone(),
        })
    }
    pub fn refresh(snapshot: &Value, current: &Value, executable: &str) -> Result<Value> {
        ensure!(
            snapshot["effective"]["cwd"] == current["cwd"],
            "settings_unavailable: working folder changed without a verified workflow snapshot"
        );
        let mut updated = snapshot.clone();
        for (target, source) in [
            ("model", "model"),
            ("modelProvider", "modelProvider"),
            ("cwd", "cwd"),
            ("approvalPolicy", "approvalPolicy"),
            ("approvalsReviewer", "approvalsReviewer"),
            ("sandbox", "sandboxPolicy"),
            ("activePermissionProfile", "activePermissionProfile"),
            ("reasoningEffort", "effort"),
        ] {
            updated["effective"][target] = current
                .get(source)
                .context("settings_unavailable: incomplete settings update")?
                .clone();
        }
        Self::parse(&updated, executable)?;
        Ok(updated)
    }

    pub fn verify_before_load(&self, connection: &mut Codex) -> Result<()> {
        ensure!(
            json!(connection.user_agent) == self.snapshot["provider_version"],
            "settings_unavailable: the provider version changed"
        );
        ensure!(
            workflow(connection, &self.snapshot["effective"])? == self.snapshot["workflow"],
            "settings_unavailable: workflow configuration changed"
        );
        Ok(())
    }
    pub fn verify_after_load(
        &self,
        connection: &mut Codex,
        reply: &Value,
        executable: &str,
    ) -> Result<()> {
        ensure!(
            Self::capture(connection, reply, executable)? == self.snapshot,
            "settings_unavailable: resumed settings differ from saved settings"
        );
        Ok(())
    }
}
