use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SourceEvent {
    pub event_id: String,
    pub session_id: String,
    pub role: String,
    pub text: String,
    #[serde(default)]
    pub gap: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Assignment {
    pub session_id: String,
    pub brief: String,
    pub ticket: Option<String>,
    pub supervisor: Option<String>,
    #[serde(default)]
    pub delivery: bool,
    #[serde(default)]
    pub delivery_mode: DeliveryMode,
    #[serde(default)]
    pub topics: Vec<String>,
    #[serde(default)]
    pub topic_assessments: std::collections::BTreeMap<String, f64>,
    #[serde(default)]
    pub direction: Vec<SourceEvent>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryMode {
    #[default]
    Idle,
    Steer,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Topic {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Evidence {
    pub event_id: String,
    pub quote: String,
    pub stance: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Composition {
    pub assessment: String,
    pub statement: Option<String>,
    pub decision_maker: Option<String>,
    pub evidence: Vec<Evidence>,
    pub explanation: String,
    pub existing_topic_ids: Vec<String>,
    pub proposed_topic: Option<Subject>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Subject {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Knowledge {
    pub id: String,
    pub kind: String,
    pub session_id: String,
    pub trigger: String,
    pub ticket: Option<String>,
    pub topics: Vec<String>,
    pub composition: Composition,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Relation {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
    pub probability: f64,
    pub resolver: Option<String>,
    pub resolution: Option<Value>,
    #[serde(default)]
    pub requires_user: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub batch: String,
    pub recipient: String,
    pub reasons: Vec<String>,
    pub record_ids: Vec<String>,
    pub relation_ids: Vec<String>,
    pub message: String,
    pub state: String,
    pub native_turn: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Graph {
    pub revision: u64,
    pub topics: Vec<Topic>,
    pub records: Vec<Knowledge>,
    pub relations: Vec<Relation>,
    pub assignments: Vec<Assignment>,
    pub notifications: Vec<Notification>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    pub window_chars: usize,
    pub max_events: usize,
    pub follow: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            window_chars: 16000,
            max_events: 20,
            follow: false,
        }
    }
}
