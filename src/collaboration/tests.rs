use super::{db::Db, pipeline, resolution, types::*};
use serde_json::json;

fn event(id: &str, text: &str) -> SourceEvent {
    SourceEvent {
        event_id: id.into(),
        session_id: "crew".into(),
        role: "user".into(),
        text: text.into(),
        gap: false,
    }
}
fn assignment(id: &str) -> Assignment {
    serde_json::from_value(json!({"session_id":id,"brief":"Build exports","ticket":"T-1","supervisor":null,"topics":["exports"]})).unwrap()
}
fn knowledge(id: &str, session: &str) -> Knowledge {
    serde_json::from_value(json!({"id":id,"kind":"decision","session_id":session,"trigger":"e1","ticket":"T-1","topics":["exports"],"status":"current","composition":{"assessment":"supported","statement":"Use jobs","decision_maker":"agent","evidence":[{"event_id":"e1","quote":"Use jobs","stance":"supports"}],"explanation":"Commitment","existing_topic_ids":["exports"],"proposed_topic":null}})).unwrap()
}
fn graph() -> Graph {
    Graph {
        assignments: vec![
            assignment("captain"),
            assignment("crew"),
            assignment("reader"),
        ],
        records: vec![knowledge("old", "captain"), knowledge("new", "crew")],
        relations: vec![Relation {
            id: "conflict".into(),
            from: "new".into(),
            to: "old".into(),
            kind: "contradicts".into(),
            probability: 0.9,
            resolver: Some("captain".into()),
            resolution: None,
            requires_user: true,
        }],
        ..Graph::default()
    }
}
#[test]
fn replay_window_is_causal_isolated_and_stops_at_capture_gap() {
    let db = Db::open(std::path::Path::new(":memory:")).unwrap();
    db.insert(&event("one", "before")).unwrap();
    let mut other = event("other", "other session");
    other.session_id = "other".into();
    db.insert(&other).unwrap();
    db.insert(&event("two", "after")).unwrap();
    assert_eq!(db.window(1, "crew", 1024).unwrap().len(), 1);
    assert_eq!(db.window(3, "crew", 5).unwrap()[0].event_id, "two");
    let mut gap = event("gap", "");
    gap.gap = true;
    gap.role = "gap".into();
    db.insert(&gap).unwrap();
    db.insert(&event("three", "new")).unwrap();
    let window = db.window(5, "crew", 1024).unwrap();
    assert_eq!(
        window
            .iter()
            .map(|e| e.event_id.as_str())
            .collect::<Vec<_>>(),
        vec!["gap", "three"]
    );
    assert!(!db.insert(&event("one", "before")).unwrap());
    assert!(db.insert(&event("one", "changed")).is_err());
}
#[test]
fn extracted_evidence_and_decision_maker_must_match_source() {
    let mut c = knowledge("one", "crew").composition;
    c.existing_topic_ids.clear();
    c.decision_maker = Some("user".into());
    let window = vec![event("e1", "Use jobs")];
    assert!(pipeline::validate_composition(&c, &window, "decision", &[]).is_ok());
    c.evidence[0].quote = "Not actually said".into();
    assert!(pipeline::validate_composition(&c, &window, "decision", &[]).is_err());
    c.evidence[0].quote = "Use jobs".into();
    c.decision_maker = Some("agent".into());
    assert!(pipeline::validate_composition(&c, &window, "decision", &[]).is_err());
}
#[test]
fn topic_and_author_and_conflict_delivery_coalesce_once_per_recipient() {
    let mut g = graph();
    pipeline::notify(&mut g, "source-event", &["new".into()]).unwrap();
    assert_eq!(g.notifications.len(), 3);
    let captain = g
        .notifications
        .iter()
        .find(|n| n.recipient == "captain")
        .unwrap();
    assert!(captain.reasons.len() >= 2);
    assert_eq!(captain.record_ids.len(), 2);
    assert!(captain.message.contains("Use jobs"));
    assert!(captain.id.len() <= 128);
    pipeline::notify(&mut g, "source-event", &["new".into()]).unwrap();
    assert_eq!(g.notifications.len(), 3);
}
#[test]
fn resolution_requires_responsibility_revision_and_user_when_flagged() {
    let mut g = graph();
    pipeline::notify(&mut g, "source", &["new".into()]).unwrap();
    let n = g
        .notifications
        .iter()
        .find(|n| n.recipient == "captain")
        .unwrap()
        .id
        .clone();
    let payload = json!({"notification_id":n,"conflict_id":"conflict","expected_revision":0,"decision_ids":["new","old"],"outcome":"adopt_new","rationale":"Reviewed evidence"});
    assert!(
        resolution::apply(
            &mut g,
            serde_json::from_value(payload.clone()).unwrap(),
            "reader",
            true,
            "e2"
        )
        .is_err()
    );
    assert!(
        resolution::apply(
            &mut g,
            serde_json::from_value(payload.clone()).unwrap(),
            "captain",
            false,
            "e2"
        )
        .is_err()
    );
    resolution::apply(
        &mut g,
        serde_json::from_value(payload.clone()).unwrap(),
        "captain",
        true,
        "e2",
    )
    .unwrap();
    assert_eq!(g.records[0].status, "superseded");
    assert_eq!(g.records[1].status, "current");
    assert_eq!(g.notifications.len(), 6);
    assert!(
        resolution::apply(
            &mut g,
            serde_json::from_value(payload).unwrap(),
            "captain",
            true,
            "e2"
        )
        .is_err()
    );
}
#[test]
fn parser_accepts_resolution_inside_fenced_prose() {
    assert_eq!(
        resolution::extract(
            "Here is my choice.\n```json\n{\"voyager_resolution\":{\"outcome\":\"needs_input\"}}\n```"
        ),
        Some(json!({"outcome":"needs_input"}))
    );
    assert!(resolution::extract("{not json} no resolution").is_none());
}

#[test]
fn rejected_composition_is_audited_without_blocking_next_candidate() {
    let db = Db::open(std::path::Path::new(":memory:")).unwrap();
    let mut c = knowledge("one", "crew").composition;
    c.existing_topic_ids.clear();
    c.decision_maker = None;
    let window = vec![event("e1", "Use jobs")];
    assert!(!pipeline::accept_composition(&db, "e1", &c, &window, "decision", &[]).unwrap());
    let response: String =
        db.0.query_row(
            "SELECT response FROM attempts WHERE stage='validation'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&response).unwrap()["error"],
        "missing decision maker"
    );
    assert!(db.graph().unwrap().records.is_empty());
    c.decision_maker = Some("user".into());
    assert!(pipeline::accept_composition(&db, "e2", &c, &window, "decision", &[]).unwrap());
}
