use crate::codex::Codex;
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug)]
pub(super) enum LaunchMode {
    Yolo,
    Config,
}
impl LaunchMode {
    pub fn read() -> Result<Self> {
        match std::env::var("VOYAGER_CODEX_LAUNCH_MODE") {
            Err(std::env::VarError::NotPresent) => Ok(Self::Yolo),
            Ok(value) if value == "yolo" => Ok(Self::Yolo),
            Ok(value) if value == "config" => Ok(Self::Config),
            _ => bail!("invalid_config: VOYAGER_CODEX_LAUNCH_MODE must be yolo or config"),
        }
    }
    pub fn arguments(self) -> &'static [&'static str] {
        match self {
            Self::Yolo => &[
                "-c",
                "sandbox_mode=\"danger-full-access\"",
                "-c",
                "approval_policy=\"never\"",
            ],
            Self::Config => &[],
        }
    }
}

#[derive(Debug)]
pub struct Settings {
    parameters: Value,
}
impl Settings {
    pub(super) fn current(connection: &mut Codex, cwd: &str, mode: LaunchMode) -> Result<Self> {
        let response = connection.rpc("config/read", json!({"cwd":cwd,"includeLayers":false}))?;
        let config = response["config"]
            .as_object()
            .context("provider_failed: Codex did not return current configuration")?;
        let mut model = config
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let mut effort = config
            .get("model_reasoning_effort")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if model.is_none() || effort.is_none() {
            let catalog =
                connection.rpc("model/list", json!({"includeHidden":true,"limit":100}))?;
            let models = catalog["data"]
                .as_array()
                .context("provider_failed: Codex did not return model defaults")?;
            let selected = models
                .iter()
                .find(|entry| match &model {
                    Some(name) => entry["model"] == *name || entry["id"] == *name,
                    None => entry["isDefault"] == true,
                })
                .context("provider_failed: current model defaults are unavailable")?;
            if model.is_none() {
                model = selected["model"].as_str().map(str::to_owned);
            }
            if effort.is_none() {
                effort = selected["defaultReasoningEffort"]
                    .as_str()
                    .map(str::to_owned);
            }
        }
        let mut parameters = json!({"cwd":cwd,"model":model.context("provider_failed: current model is unavailable")?,"config":{"model_reasoning_effort":effort.context("provider_failed: current reasoning effort is unavailable")?}});
        for (source, target) in [
            ("model_provider", "modelProvider"),
            ("approval_policy", "approvalPolicy"),
            ("approvals_reviewer", "approvalsReviewer"),
            ("sandbox_mode", "sandbox"),
            ("default_permissions", "permissions"),
        ] {
            if let Some(value) = config.get(source).filter(|value| !value.is_null()) {
                parameters[target] = value.clone();
            }
        }
        if matches!(mode, LaunchMode::Yolo) {
            parameters["approvalPolicy"] = json!("never");
            parameters["sandbox"] = json!("danger-full-access");
            parameters
                .as_object_mut()
                .context("invalid startup parameters")?
                .remove("permissions");
        }
        Ok(Self { parameters })
    }
    pub(super) fn parameters(&self) -> Value {
        self.parameters.clone()
    }
    pub(super) fn verify(&self, reply: &Value) -> Result<()> {
        for key in [
            "model",
            "modelProvider",
            "cwd",
            "approvalPolicy",
            "approvalsReviewer",
        ] {
            if let Some(expected) = self.parameters.get(key) {
                ensure!(
                    reply.get(key) == Some(expected),
                    "provider_failed: Codex did not apply current {key}"
                );
            }
        }
        ensure!(
            reply["reasoningEffort"] == self.parameters["config"]["model_reasoning_effort"],
            "provider_failed: Codex did not apply current reasoning effort"
        );
        if let Some(sandbox) = self.parameters["sandbox"].as_str() {
            let kind = match sandbox {
                "danger-full-access" => "dangerFullAccess",
                "read-only" => "readOnly",
                "workspace-write" => "workspaceWrite",
                _ => bail!("provider_failed: unsupported current sandbox {sandbox}"),
            };
            ensure!(
                reply["sandbox"]["type"] == kind,
                "provider_failed: Codex did not apply current sandbox"
            );
        }
        if let Some(permissions) = self.parameters.get("permissions") {
            ensure!(
                reply.get("activePermissionProfile") == Some(permissions),
                "provider_failed: Codex did not apply current permissions profile"
            );
        }
        Ok(())
    }
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
                    .context("settings_unavailable: effective setting is missing")?
                    .clone(),
            );
        }
        Ok(
            json!({"version":2,"provider_executable":executable,"provider_version":connection.user_agent,"effective":effective}),
        )
    }
    pub fn refresh(snapshot: &Value, current: &Value, _executable: &str) -> Result<Value> {
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
        Ok(updated)
    }
}
