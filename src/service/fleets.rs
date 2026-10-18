use super::{Runtime, string};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{collections::HashSet, fs};

impl Runtime {
    pub(super) fn fleet_operation(&self, request: &Value) -> Result<Value> {
        let file = self.state.join("fleets.json");
        let mut data: Value = match fs::read(&file) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).context("invalid fleet settings; file preserved")?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                json!({"fleets":[],"assignments":{}})
            }
            Err(error) => return Err(error.into()),
        };
        let fleets = data["fleets"].as_array().context("invalid fleet list")?;
        let assignments = data["assignments"]
            .as_object()
            .context("invalid fleet assignments")?;
        let mut ids = HashSet::new();
        for fleet in fleets {
            let id = string(fleet, "id")?;
            uuid::Uuid::parse_str(id)?;
            let name = string(fleet, "name")?;
            ensure!(
                name.len() <= 100 && ids.insert(id.to_owned()),
                "invalid fleet settings"
            );
        }
        for (vessel, fleet) in assignments {
            uuid::Uuid::parse_str(vessel)?;
            ensure!(
                fleet.is_null() || fleet.as_str().is_some_and(|id| ids.contains(id)),
                "invalid fleet assignment"
            );
        }
        match string(request, "op")? {
            "fleets" => return Ok(data),
            "create-fleet" => {
                let id = string(request, "request_id")?;
                uuid::Uuid::parse_str(id)?;
                let name = string(request, "name")?.trim();
                ensure!(
                    !name.is_empty() && name.len() <= 100 && !name.chars().any(char::is_control),
                    "invalid_input: use a short fleet goal"
                );
                if let Some(existing) = data["fleets"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|f| f["id"] == id)
                {
                    ensure!(
                        existing["name"] == name,
                        "request_conflict: fleet ID has another goal"
                    );
                    return Ok(data);
                }
                ensure!(
                    !data["fleets"].as_array().unwrap().iter().any(|f| f["name"]
                        .as_str()
                        .is_some_and(|n| n.eq_ignore_ascii_case(name))),
                    "invalid_input: fleet goal already exists"
                );
                data["fleets"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!({"id":id,"name":name}));
            }
            "move-vessel" => {
                let vessel = string(request, "session_id")?;
                self.store.require_registered(vessel)?;
                let fleet = &request["fleet_id"];
                ensure!(
                    fleet.is_null() || fleet.as_str().is_some_and(|id| ids.contains(id)),
                    "not_found: fleet"
                );
                let sessions = self.store.sessions()?;
                let mut branch = HashSet::from([vessel.to_owned()]);
                loop {
                    let before = branch.len();
                    for session in &sessions {
                        if session["removed_ms"].is_null()
                            && session["supervisor_id"]
                                .as_str()
                                .is_some_and(|id| branch.contains(id))
                        {
                            branch.insert(string(session, "id")?.into());
                        }
                    }
                    if before == branch.len() {
                        break;
                    }
                }
                let assignments = data["assignments"].as_object_mut().unwrap();
                assignments.retain(|id, _| !branch.contains(id));
                assignments.insert(vessel.into(), fleet.clone());
            }
            "remove-fleet" => {
                let id = string(request, "fleet_id")?;
                data["fleets"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|f| f["id"] != id);
                data["assignments"]
                    .as_object_mut()
                    .unwrap()
                    .retain(|_, fleet| fleet != id);
            }
            _ => anyhow::bail!("unsupported fleet action"),
        }
        let temporary = self
            .state
            .join(format!("fleets-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> Result<()> {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temporary)?;
            serde_json::to_writer(&mut output, &data)?;
            output.flush()?;
            fs::rename(&temporary, file)?;
            Ok(())
        })();
        let _ = fs::remove_file(temporary);
        result?;
        Ok(data)
    }
}
