use serde_json::json;
use voyager_content_contract::{ContentRequest, ContentResponse};

#[test]
fn protocol_refuses_missing_write_revision_and_caller_supplied_authority() {
    let inspect =
        json!({"version":"1","requestId":"r","contentId":"c","operation":"content.inspect"});
    let request: ContentRequest =
        serde_json::from_value(inspect.clone()).expect("valid read request");
    assert_eq!(
        serde_json::to_value(request).expect("read serializes"),
        inspect
    );
    for invalid in [
        json!({"version":"2","requestId":"r","contentId":"c","operation":"content.inspect"}),
        json!({"version":"1","requestId":"r","contentId":"c","operation":"content.inspect","authority":"owner"}),
        json!({"version":"1","requestId":"r","contentId":"c","operation":"content.update","data":{}}),
    ] {
        assert!(
            serde_json::from_value::<ContentRequest>(invalid.clone()).is_err(),
            "accepted {invalid}"
        );
    }
}

#[test]
fn uncertain_response_retains_operation_target_and_revision() {
    let value = json!({"version":"1","requestId":"r","contentId":"c","status":"uncertain","expectedRevision":"old","message":"readback lost"});
    let response: ContentResponse =
        serde_json::from_value(value.clone()).expect("valid uncertain response");
    assert_eq!(
        serde_json::to_value(response).expect("response serializes"),
        value
    );
}
