use super::Runtime;
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

pub(crate) fn definitions() -> Value {
    json!([
        {"type":"function","name":"voyager_identity","description":"Read this Vessel's actual Voyager identity and capabilities directly through the native tool connection.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
        {"type":"function","name":"voyager_owner_probe","description":"Run the authorized experiment's harmless negative check: attempt an owner-only operation against a nonexistent target. A forbidden result is expected.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}
    ])
}

impl Runtime {
    pub(super) fn tool_probe(&mut self, session: &str, call: Value) -> Result<()> {
        let result = (|| -> Result<Value> {
            let worker = self.workers.get(session).context("missing tool worker")?;
            ensure!(
                call["params"]["threadId"] == worker.native
                    && self.store.generation(session)? == Some(worker.generation),
                "forbidden: tool identity differs from the active Vessel"
            );
            ensure!(
                call["params"]["arguments"]
                    .as_object()
                    .is_some_and(|args| args.is_empty()),
                "invalid_input: this probe accepts no arguments"
            );
            let mut request = match call["params"]["tool"].as_str() {
                Some("voyager_identity") => json!({"op":"capabilities"}),
                Some("voyager_owner_probe") => {
                    json!({"op":"rank","session_id":"00000000-0000-0000-0000-000000000000","rank":"crew","request_id":uuid::Uuid::new_v4().to_string()})
                }
                _ => bail!("unsupported: experiment tool"),
            };
            request["actor"] = json!({"kind":"instance","session_id":session});
            self.dispatch(request).map(|(value, _)| value)
        })();
        let reply = super::conversation_tools::reply(result);
        self.store.local(session, "experiment.direct_tool", json!({"tool":call["params"]["tool"],"call_id":call["params"]["callId"],"native_turn_id":call["params"]["turnId"],"reply":reply}))?;
        self.workers
            .get_mut(session)
            .context("tool worker disappeared")?
            .client()?
            .tool_reply(call["id"].clone(), reply)
    }
}
