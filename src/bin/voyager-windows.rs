//! X11/XWayland inventory and placement of the calling Electron avatar only.
//! Titles are display labels, never session identities. Native Wayland windows
//! are intentionally absent; that integration needs a compositor adapter.
use anyhow::{Context, Result, ensure};
use serde_json::json;
use x11rb::{
    connection::Connection,
    protocol::shape::{ConnectionExt as _, SK},
    protocol::xproto::{
        AtomEnum, ClientMessageEvent, ConnectionExt, EventMask, MapState, StackMode,
    },
};

fn main() -> Result<()> {
    let (conn, screen) = x11rb::connect(None)?;
    let root = conn.setup().roots[screen].root;
    let atom = |name: &[u8]| -> Result<u32> { Ok(conn.intern_atom(false, name)?.reply()?.atom) };
    let stacking = atom(b"_NET_CLIENT_LIST_STACKING")?;
    let pid_atom = atom(b"_NET_WM_PID")?;
    let title_atom = atom(b"_NET_WM_NAME")?;
    let utf8 = atom(b"UTF8_STRING")?;
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        ensure!(
            args.len() == 3 && args[0] == "above",
            "usage: voyager-windows [above AVATAR TARGET]"
        );
        let avatar: u32 = args[1].parse()?;
        let target: u32 = args[2].parse()?;
        ensure!(avatar != target, "avatar and terminal must differ");
        let owner = conn
            .get_property(false, avatar, pid_atom, AtomEnum::CARDINAL, 0, 1)?
            .reply()?;
        let pid = owner
            .value32()
            .and_then(|mut v| v.next())
            .context("avatar has no owner")?;
        ensure!(
            pid == nix::unistd::getppid().as_raw() as u32,
            "only the calling app's window may be moved"
        );
        conn.get_window_attributes(target)?.reply()?;
        conn.send_event(
            false,
            root,
            EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
            ClientMessageEvent::new(
                32,
                avatar,
                atom(b"_NET_RESTACK_WINDOW")?,
                [2, target, StackMode::ABOVE.into(), 0, 0],
            ),
        )?
        .check()?;
        conn.flush()?;
        println!(
            "{}",
            json!({"requested":"above","avatar":avatar,"target":target})
        );
        return Ok(());
    }
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
            // Only inspect the caller's input regions. Electron uses a 1x1
            // region at the transparent corner for ignore-mouse-events on Linux.
            let input_region = if pid == Some(nix::unistd::getppid().as_raw() as u32) {
                Some(
                    conn.shape_get_rectangles(id, SK::INPUT)?
                        .reply()?
                        .rectangles
                        .iter()
                        .map(|r| json!({"x":r.x,"y":r.y,"width":r.width,"height":r.height}))
                        .collect::<Vec<_>>(),
                )
            } else {
                None
            };
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
                "input_region": input_region,
            }))
        })();
        if let Ok(window) = window {
            windows.push(window);
        }
    }
    let pointer = conn.query_pointer(root)?.reply()?;
    // Button state prevents a hover from stealing an existing text-selection drag.
    // X11's first eight mask bits are modifiers; the next five are pointer buttons.
    let buttons = u16::from(pointer.mask) & 0x1f00;
    println!(
        "{}",
        json!({"platform":"x11","windows":windows,
            "pointer":{"x":pointer.root_x,"y":pointer.root_y,"buttons":buttons}})
    );
    Ok(())
}
