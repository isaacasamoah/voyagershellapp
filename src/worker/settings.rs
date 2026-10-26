use crate::codex::Codex;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};

#[derive(Debug)]
pub struct Settings {
    parameters: Value,
}
impl Settings {
    pub(super) fn current(connection: &mut Codex, cwd: &str) -> Result<Self> {
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
        let mut cursor = Value::Null;
        let mut seen = std::collections::HashSet::new();
        while model.is_none() || effort.is_none() {
            let catalog = connection.rpc(
                "model/list",
                json!({"includeHidden":true,"limit":100,"cursor":cursor}),
            )?;
            let models = catalog["data"]
                .as_array()
                .context("provider_failed: Codex did not return model defaults")?;
            if let Some(selected) = models.iter().find(|entry| match &model {
                Some(name) => entry["model"] == *name || entry["id"] == *name,
                None => entry["isDefault"] == true,
            }) {
                if model.is_none() {
                    model = selected["model"].as_str().map(str::to_owned);
                }
                if effort.is_none() {
                    effort = selected["defaultReasoningEffort"]
                        .as_str()
                        .map(str::to_owned);
                }
                break;
            }
            let next = catalog["nextCursor"]
                .as_str()
                .context("provider_failed: current model defaults are unavailable")?;
            ensure!(
                seen.insert(next.to_owned()),
                "provider_failed: Codex repeated its model cursor"
            );
            cursor = json!(next);
        }
        let mut parameters = json!({"cwd":cwd,"model":model.context("provider_failed: current model is unavailable")?,"config":{"model_reasoning_effort":effort.context("provider_failed: current reasoning effort is unavailable")?},"approvalPolicy":"never","permissions":":danger-full-access"});
        if let Some(provider) = config
            .get("model_provider")
            .filter(|value| !value.is_null())
        {
            parameters["modelProvider"] = provider.clone();
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
        ensure!(
            reply["activePermissionProfile"]["id"] == ":danger-full-access"
                && reply["sandbox"]["type"] == "dangerFullAccess",
            "provider_failed: Codex did not apply YOLO permissions"
        );
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
