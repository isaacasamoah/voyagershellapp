use super::{pipeline, types::Graph};
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resolution {
    pub notification_id: String,
    pub conflict_id: String,
    pub expected_revision: u64,
    pub decision_ids: Vec<String>,
    pub outcome: String,
    pub rationale: String,
}

pub fn apply(
    graph: &mut Graph,
    resolution: Resolution,
    session: &str,
    human: bool,
    evidence: &str,
) -> Result<()> {
    ensure!(
        resolution.expected_revision == graph.revision,
        "stale resolution: inspect the current graph revision"
    );
    ensure!(
        !resolution.rationale.trim().is_empty() && resolution.rationale.len() <= 4000,
        "resolution requires a bounded rationale"
    );
    ensure!(
        [
            "adopt_new",
            "retain_existing",
            "different_conditions",
            "needs_input"
        ]
        .contains(&resolution.outcome.as_str()),
        "invalid resolution outcome"
    );
    let notification = graph
        .notifications
        .iter()
        .find(|n| n.id == resolution.notification_id)
        .context("unknown notification")?;
    ensure!(
        notification.recipient == session
            && notification.relation_ids.contains(&resolution.conflict_id),
        "resolution recipient or conflict mismatch"
    );
    let relation = graph
        .relations
        .iter_mut()
        .find(|r| r.id == resolution.conflict_id)
        .context("unknown conflict")?;
    ensure!(
        relation.kind == "contradicts" && relation.resolution.is_none(),
        "not an open decision conflict"
    );
    ensure!(
        relation.resolver.as_deref() == Some(session),
        "only the named resolver may respond"
    );
    ensure!(
        resolution.decision_ids.len() == 2
            && resolution.decision_ids.contains(&relation.from)
            && resolution.decision_ids.contains(&relation.to),
        "decision IDs mismatch"
    );
    ensure!(
        human || !relation.requires_user || resolution.outcome == "needs_input",
        "this conflict requires a user decision"
    );
    if resolution.outcome == "needs_input" {
        return Ok(());
    }
    let ids = vec![relation.from.clone(), relation.to.clone()];
    let retired = match resolution.outcome.as_str() {
        "adopt_new" => Some(relation.to.clone()),
        "retain_existing" => Some(relation.from.clone()),
        _ => None,
    };
    relation.resolution = Some(
        json!({"outcome":resolution.outcome,"rationale":resolution.rationale,"actor":if human {"user"} else {"agent"},"session_id":session,"evidence_event_id":evidence}),
    );
    if let Some(id) = retired {
        graph
            .records
            .iter_mut()
            .find(|r| r.id == id)
            .context("missing decision")?
            .status = "superseded".into();
    }
    graph.revision += 1;
    pipeline::notify(
        graph,
        &format!("resolution:{}", resolution.conflict_id),
        &ids,
    )
}

pub fn extract(text: &str) -> Option<Value> {
    for (offset, c) in text.char_indices() {
        if c != '{' {
            continue;
        }
        let mut stream = serde_json::Deserializer::from_str(&text[offset..]).into_iter::<Value>();
        if let Some(Ok(value)) = stream.next() {
            if value.get("voyager_resolution").is_some() {
                return Some(value["voyager_resolution"].clone());
            }
        }
    }
    None
}
