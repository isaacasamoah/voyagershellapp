use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum Protocol {
    #[serde(rename = "1")]
    V1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "operation",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ContentRequest {
    #[serde(rename = "content.describe")]
    Describe {
        version: Protocol,
        request_id: String,
        content_id: String,
    },
    #[serde(rename = "content.inspect")]
    Inspect {
        version: Protocol,
        request_id: String,
        content_id: String,
    },
    #[serde(rename = "content.update")]
    Update {
        version: Protocol,
        request_id: String,
        content_id: String,
        expected_revision: String,
        data: Value,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentSnapshot {
    pub content_id: String,
    pub type_id: String,
    pub revision: String,
    pub data: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentDescriptor {
    pub content_id: String,
    pub type_id: String,
    pub schema_declared: bool,
    pub state_schema: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum RejectionCode {
    Forbidden,
    Unavailable,
    InvalidData,
    StaleRevision,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "status", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum ContentResponse {
    #[serde(rename = "invalid-request")]
    InvalidRequest { version: Protocol, message: String },
    #[serde(rename = "described")]
    Described {
        version: Protocol,
        request_id: String,
        content_id: String,
        descriptor: ContentDescriptor,
    },
    #[serde(rename = "snapshot")]
    Snapshot {
        version: Protocol,
        request_id: String,
        content_id: String,
        snapshot: ContentSnapshot,
    },
    #[serde(rename = "applied")]
    Applied {
        version: Protocol,
        request_id: String,
        content_id: String,
        snapshot: ContentSnapshot,
    },
    #[serde(rename = "rejected")]
    Rejected {
        version: Protocol,
        request_id: String,
        content_id: String,
        code: RejectionCode,
        message: String,
    },
    #[serde(rename = "uncertain")]
    Uncertain {
        version: Protocol,
        request_id: String,
        content_id: String,
        expected_revision: String,
        message: String,
    },
}
