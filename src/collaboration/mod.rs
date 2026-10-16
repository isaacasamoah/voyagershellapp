mod db;
mod model;
mod pipeline;
mod resolution;
pub mod types;
mod web;
mod worker;

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::{Arc, Mutex, mpsc},
    thread,
};
use types::Config;

pub struct Handle {
    sender: mpsc::SyncSender<Value>,
    status: Arc<Mutex<Value>>,
    url: String,
}

impl Handle {
    pub fn start(state: &Path) -> Result<Self> {
        let db = db::Db::open(&state.join("collaboration.sqlite"))?;
        let mut graph = db.graph()?;
        for n in &mut graph.notifications {
            if n.state == "dispatching" {
                n.state = "uncertain".into();
                n.error = Some(
                    "Service stopped during delivery; inspect native transcript before retrying"
                        .into(),
                );
            }
        }
        db.save(&graph, None)?;
        let status = Arc::new(Mutex::new(
            json!({"state":"paused","config":Config::default()}),
        ));
        let url = web::start(state.join("collaboration.sqlite"), status.clone())?;
        let (sender, receiver) = mpsc::sync_channel(16);
        let path = state.to_path_buf();
        let progress = status.clone();
        thread::Builder::new()
            .name("collaboration".into())
            .spawn(move || worker::run(db, path, receiver, progress))?;
        Ok(Self {
            sender,
            status,
            url,
        })
    }

    pub fn command(&self, request: Value) -> Result<Value> {
        let action = request["action"]
            .as_str()
            .context("missing collaboration action")?;
        if action == "status" {
            return Ok(json!({"url":self.url,"worker":*self.status.lock().unwrap()}));
        }
        ensure!(
            ["assign", "import", "run", "pause", "resolve"].contains(&action),
            "unknown collaboration action"
        );
        let id = uuid::Uuid::new_v4().to_string();
        let mut request = request;
        request["job_id"] = json!(id);
        self.sender
            .try_send(request)
            .context("collaboration queue full or stopped")?;
        Ok(json!({"state":"queued","job_id":id,"url":self.url}))
    }
}

#[cfg(test)]
mod tests;
