# Content protocol

This small Rust crate owns the version-one request and response shapes for Voyager content. It has no process supervisor, transport or storage implementation. Serde serializes the same types that Schemars uses to emit JSON Schema Draft 7. The application integration is a separate increment.

The named operations are content.describe, content.inspect and content.update. Updates carry the inspected revision. Caller authority and frame binding are supplied by the application, never by request fields. Unsupported versions and unknown fields are rejected by the wire types.

Responses distinguish a snapshot or applied update, a known rejection, an uncertain write and a malformed request. An uncertain write retains the request ID, content ID and expected revision. Request IDs correlate an operation; this crate does not implement durable receipts or promise safe retries. A process address is not a content ID.

Rejections have an optional expected revision. The application must include the attempted revision for every rejected update. Describe and inspect requests have no revision to echo. Schema validation establishes the response shape; the application establishes its relationship to the original request.

Content data and its declared schema are JSON values because packages define their own data. The application must validate a declared package schema separately. A schema-less package must remain identifiable as such. These types do not establish application authority or make a declaration a sandbox.

Run from experiments/core-workspace:

    cargo run --locked --manifest-path contract/Cargo.toml --bin export
    cargo fmt --check --manifest-path contract/Cargo.toml
    cargo test --locked --manifest-path contract/Cargo.toml
    cargo clippy --locked --manifest-path contract/Cargo.toml --all-targets -- -D warnings

Cargo.lock fixes the tested dependencies, including Schemars 1.2.3. The generator explicitly selects Draft 7 rather than a changeable default. Source stays comment-free under the project convention; this document owns the mechanism and limitations.

The [Serde container attributes](https://serde.rs/container-attrs.html) define tagged variants and unknown-field rejection. The [Schemars schema settings](https://docs.rs/schemars/latest/schemars/generate/struct.SchemaSettings.html) describe explicit draft selection. Library unit checks establish serialization behavior, not a working desktop feature or native renderer parity.
