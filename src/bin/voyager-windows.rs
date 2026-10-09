//! Read-only X11/XWayland window inventory for the bounded desktop experiment.
//! Titles are display labels, never session identities. Native Wayland windows
//! are intentionally absent; that integration needs a compositor adapter.
use anyhow::Result;
use serde_json::json;
use x11rb::{
    connection::Connection,
    protocol::xproto::{AtomEnum, ConnectionExt, MapState},
};

fn main() -> Result<()> {
    let (conn, screen) = x11rb::connect(None)?;
    let root = conn.setup().roots[screen].root;
    let atom = |name: &[u8]| -> Result<u32> { Ok(conn.intern_atom(false, name)?.reply()?.atom) };
    let stacking = atom(b"_NET_CLIENT_LIST_STACKING")?;
    let pid_atom = atom(b"_NET_WM_PID")?;
    let title_atom = atom(b"_NET_WM_NAME")?;
    let utf8 = atom(b"UTF8_STRING")?;
    let ids = conn
        .get_property(false, root, stacking, AtomEnum::WINDOW, 0, 4096)?
        .reply()?;
    let mut windows = Vec::new();
    for id in ids.value32().into_iter().flatten() {
        // A window can close between any two queries. Omit that stale candidate.
        let window = (|| -> Result<_> {
            let attr = conn.get_window_attributes(id)?.reply()?;
            let geometry = conn.get_geometry(id)?.reply()?;
            let position = conn.translate_coordinates(id, root, 0, 0)?.reply()?;
            let pid = conn
                .get_property(false, id, pid_atom, AtomEnum::CARDINAL, 0, 1)?
                .reply()?
                .value32()
                .and_then(|mut values| values.next());
            let title = conn
                .get_property(false, id, title_atom, utf8, 0, 256)?
                .reply()?;
            let class = conn
                .get_property(false, id, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 256)?
                .reply()?;
            Ok(json!({
                "id": id,
                "pid": pid,
                "visible": attr.map_state == MapState::VIEWABLE,
                "x": position.dst_x,
                "y": position.dst_y,
                "width": geometry.width,
                "height": geometry.height,
                "title": String::from_utf8_lossy(&title.value),
                "class": String::from_utf8_lossy(&class.value).replace('\0', " "),
            }))
        })();
        if let Ok(window) = window {
            windows.push(window);
        }
    }
    println!("{}", json!({"platform":"x11","windows":windows}));
    Ok(())
}
