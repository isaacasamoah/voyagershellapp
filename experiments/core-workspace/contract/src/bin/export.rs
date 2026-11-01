use schemars::generate::SchemaSettings;
use serde_json::json;
use std::io::{self, Write};
use voyager_content_contract::{ContentRequest, ContentResponse};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let schemas = json!({
        "request": SchemaSettings::draft07().into_generator().into_root_schema_for::<ContentRequest>(),
        "response": SchemaSettings::draft07().into_generator().into_root_schema_for::<ContentResponse>(),
    });
    let mut output = io::stdout().lock();
    serde_json::to_writer_pretty(&mut output, &schemas)?;
    writeln!(output)?;
    Ok(())
}
