use anyhow::{Context, Result, ensure};
use nix::unistd::Uid;
use serde_json::{Value, json};
use std::{
    fs,
    os::unix::fs::MetadataExt,
    thread,
    time::{Duration, Instant},
};
use x11rb::{
    connection::Connection,
    protocol::xproto::{AtomEnum, ClientMessageEvent, ConnectionExt, EventMask, MapState},
};

fn number(v: &Value, key: &str) -> Result<u32> {
    v[key]
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .filter(|n| *n > 0)
        .context(format!("invalid {key}"))
}
fn process(v: &Value) -> Result<()> {
    let pid = number(v, "pid")?;
    let base = format!("/proc/{pid}");
    ensure!(
        fs::metadata(&base)?.uid() == Uid::effective().as_raw(),
        "different-user terminal"
    );
    ensure!(
        crate::viewer::Kind::from_executable(&fs::read_link(format!("{base}/exe"))?).is_some(),
        "unsupported terminal"
    );
    let stat = fs::read_to_string(format!("{base}/stat"))?;
    let fields: Vec<_> = stat
        .rsplit_once(')')
        .context("invalid process stat")?
        .1
        .split_whitespace()
        .collect();
    ensure!(
        fields.get(19).copied() == v["start"].as_str() && fields.first() != Some(&"Z"),
        "terminal process changed"
    );
    Ok(())
}
fn rectangle(v: &Value) -> Result<[u32; 4]> {
    let coordinate = |key| -> Result<u32> {
        Ok(i32::try_from(v[key].as_i64().context("invalid coordinate")?)? as u32)
    };
    let width = number(v, "width")?;
    let height = number(v, "height")?;
    ensure!(
        (100..=65535).contains(&width) && (80..=65535).contains(&height),
        "layout is too small or too large"
    );
    Ok([coordinate("x")?, coordinate("y")?, width, height])
}
fn extents(conn: &impl Connection, id: u32, name: &[u8]) -> Result<[i64; 4]> {
    let atom = conn.intern_atom(false, name)?.reply()?.atom;
    let values: Vec<_> = conn
        .get_property(false, id, atom, AtomEnum::CARDINAL, 0, 4)?
        .reply()?
        .value32()
        .into_iter()
        .flatten()
        .map(i64::from)
        .collect();
    Ok(if values.len() == 4 {
        [values[0], values[1], values[2], values[3]]
    } else {
        [0; 4]
    })
}
pub fn apply(plan: &Value) -> Result<Value> {
    let entries = plan["windows"].as_array().context("missing windows")?;
    ensure!(
        !entries.is_empty() && entries.len() <= 128,
        "expected 1–128 windows"
    );
    let (conn, screen) = x11rb::connect(None).context("connect to X11 desktop")?;
    let root = conn.setup().roots[screen].root;
    let atom = |name: &[u8]| -> Result<u32> { Ok(conn.intern_atom(false, name)?.reply()?.atom) };
    let clients: Vec<_> = conn
        .get_property(
            false,
            root,
            atom(b"_NET_CLIENT_LIST")?,
            AtomEnum::WINDOW,
            0,
            4096,
        )?
        .reply()?
        .value32()
        .into_iter()
        .flatten()
        .collect();
    let pid_atom = atom(b"_NET_WM_PID")?;
    let state_atom = atom(b"_NET_WM_STATE")?;
    let hidden_atom = atom(b"_NET_WM_STATE_HIDDEN")?;
    let mut seen = std::collections::HashSet::new();
    for entry in entries {
        process(entry)?;
        let id = number(entry, "id")?;
        let pid = number(entry, "pid")?;
        ensure!(seen.insert(id), "duplicate window");
        ensure!(clients.contains(&id), "terminal window closed");
        let actual = conn
            .get_property(false, id, pid_atom, AtomEnum::CARDINAL, 0, 1)?
            .reply()?
            .value32()
            .and_then(|mut values| values.next());
        ensure!(actual == Some(pid), "terminal window owner changed");
        if entry["minimise"] != true {
            rectangle(entry)?;
        }
    }
    let focus = number(plan, "focus")?;
    ensure!(
        entries
            .iter()
            .any(|e| e["id"] == focus && e["minimise"] != true),
        "invalid focused window"
    );
    let send = |id, name: &[u8], data| -> Result<()> {
        conn.send_event(
            false,
            root,
            EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
            ClientMessageEvent::new(32, id, atom(name)?, data),
        )?
        .check()?;
        Ok(())
    };
    let desktop = conn
        .get_property(
            false,
            root,
            atom(b"_NET_CURRENT_DESKTOP")?,
            AtomEnum::CARDINAL,
            0,
            1,
        )?
        .reply()?
        .value32()
        .and_then(|mut values| values.next())
        .context("desktop is unavailable")?;
    for entry in entries {
        process(entry)?;
        let id = number(entry, "id")?;
        if entry["minimise"] == true {
            send(id, b"WM_CHANGE_STATE", [3, 0, 0, 0, 0])?;
        } else {
            let [x, y, width, height] = rectangle(entry)?;
            send(id, b"_NET_WM_DESKTOP", [desktop, 2, 0, 0, 0])?;
            send(
                id,
                b"_NET_WM_STATE",
                [
                    0,
                    atom(b"_NET_WM_STATE_MAXIMIZED_VERT")?,
                    atom(b"_NET_WM_STATE_MAXIMIZED_HORZ")?,
                    2,
                    0,
                ],
            )?;
            conn.map_window(id)?.check()?;
            let gtk = extents(&conn, id, b"_GTK_FRAME_EXTENTS")?;
            let frame = extents(&conn, id, b"_NET_FRAME_EXTENTS")?;
            let client_x = i64::from(x as i32) + frame[0] - gtk[0];
            let client_y = i64::from(y as i32) + frame[2] - gtk[2];
            let client_width = i64::from(width) - frame[0] - frame[1] + gtk[0] + gtk[1];
            let client_height = i64::from(height) - frame[2] - frame[3] + gtk[2] + gtk[3];
            send(
                id,
                b"_NET_MOVERESIZE_WINDOW",
                [
                    0x2f0a,
                    client_x as u32,
                    client_y as u32,
                    u32::try_from(client_width)?,
                    u32::try_from(client_height)?,
                ],
            )?;
            send(id, b"_NET_ACTIVE_WINDOW", [2, 0, 0, 0, 0])?;
        }
    }
    send(focus, b"_NET_ACTIVE_WINDOW", [2, 0, 0, 0, 0])?;
    conn.flush()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let mut exact = true;
        let mut observed = Vec::new();
        for entry in entries {
            let id = number(entry, "id")?;
            let attr = conn.get_window_attributes(id)?.reply()?;
            let geometry = conn.get_geometry(id)?.reply()?;
            let position = conn.translate_coordinates(id, root, 0, 0)?.reply()?;
            let hidden = conn
                .get_property(false, id, state_atom, AtomEnum::ATOM, 0, 64)?
                .reply()?
                .value32()
                .is_some_and(|mut values| values.any(|a| a == hidden_atom));
            let visible = attr.map_state == MapState::VIEWABLE && !hidden;
            let gtk = extents(&conn, id, b"_GTK_FRAME_EXTENTS")?;
            let frame = extents(&conn, id, b"_NET_FRAME_EXTENTS")?;
            let actual = json!({"id":id,"visible":visible,"x":i64::from(position.dst_x)-frame[0]+gtk[0],"y":i64::from(position.dst_y)-frame[2]+gtk[2],"width":i64::from(geometry.width)+frame[0]+frame[1]-gtk[0]-gtk[1],"height":i64::from(geometry.height)+frame[2]+frame[3]-gtk[2]-gtk[3]});
            exact &= if entry["minimise"] == true {
                !visible
            } else {
                visible
                    && ["x", "y", "width", "height"].iter().all(|key| {
                        (actual[*key].as_i64().unwrap_or(i64::MAX)
                            - entry[*key].as_i64().unwrap_or(0))
                        .abs()
                            <= 1
                    })
            };
            observed.push(actual);
        }
        if exact || Instant::now() >= deadline {
            return Ok(
                json!({"state":if exact {"confirmed"} else {"adjusted"},"windows":observed}),
            );
        }
        thread::sleep(Duration::from_millis(25));
    }
}
