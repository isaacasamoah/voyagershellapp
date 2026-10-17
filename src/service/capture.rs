use crate::{codex::Codex, events, store::Store, transcript::Transcript};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::path::Path;

pub(super) struct Capture {
    pub connection: Codex,
    source: Source,
    generation: i64,
}

enum Source {
    Notifications,
    EmptyTranscript(Transcript),
}

impl Capture {
    pub fn notifications(connection: Codex, generation: i64) -> Self {
        Self {
            connection,
            generation,
            source: Source::Notifications,
        }
    }

    pub fn adopt(mut connection: Codex, metadata: &Value, generation: i64) -> Result<Self> {
        let thread = metadata["id"].as_str().context("missing native identity")?;
        if let Some(path) = metadata["path"].as_str() {
            if let Some(source) = Transcript::empty(Path::new(path), thread)? {
                return Ok(Self {
                    connection,
                    generation,
                    source: Source::EmptyTranscript(source),
                });
            }
        }
        let reply = connection
            .rpc(
                "thread/resume",
                json!({"threadId":thread,"excludeTurns":true}),
            )
            .context("subscribe to existing Codex thread")?;
        ensure!(
            reply["thread"]["id"] == thread,
            "native capture identity mismatch"
        );
        connection.pending.clear();
        Ok(Self::notifications(connection, generation))
    }

    pub fn source(&self) -> &'static str {
        match self.source {
            Source::Notifications => "codex_app_server",
            Source::EmptyTranscript(_) => "codex_transcript",
        }
    }

    pub fn observe(&mut self, store: &Store, session: &str) -> Result<()> {
        let native = store.session(session)?["native_thread_id"]
            .as_str()
            .context("native identity missing")?
            .to_owned();
        let mut notes: Vec<_> = self.connection.pending.drain(..).collect();
        if let Some(note) = self.connection.read()? {
            notes.push(note);
        }
        match &mut self.source {
            Source::Notifications => {
                for note in notes {
                    if let Some(event) = events::normalize(&note) {
                        if event.thread == native {
                            store.record(session, self.generation, event)?;
                        }
                    }
                }
                Ok(())
            }
            Source::EmptyTranscript(source) => source.poll(store, session, self.generation),
        }
    }
}
