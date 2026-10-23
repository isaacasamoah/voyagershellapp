use serde_json::json;
use std::{
    fs,
    path::PathBuf,
    process::{Child, Command},
    thread,
    time::{Duration, Instant},
};
use voyager_shell::{terminal, viewer, window_layout};
use x11rb::protocol::xproto::{ConnectionExt, ImageFormat};

struct Owned(Child);
impl Drop for Owned {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn wait(mut check: impl FnMut() -> bool) {
    let end = Instant::now() + Duration::from_secs(10);
    while !check() {
        assert!(Instant::now() < end, "native viewer check timed out");
        thread::sleep(Duration::from_millis(50));
    }
}

fn identity(pid: u32) -> serde_json::Value {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let start = stat
        .rsplit_once(')')
        .unwrap()
        .1
        .split_whitespace()
        .nth(19)
        .unwrap();
    json!({"pid":pid,"start":start})
}

#[test]
#[ignore = "Opens disposable xterm on the real desktop; requires VOYAGER_VIEWER_PROOF_DIR, cc and xdotool"]
fn xterm_maps_resizes_receives_verified_input_and_closes() {
    let dir = PathBuf::from(std::env::var_os("VOYAGER_VIEWER_PROOF_DIR").unwrap());
    fs::create_dir(&dir).unwrap();
    let source = dir.join("input.c");
    let executable = dir.join("input");
    fs::write(
        &source,
        r#"
#include <stdio.h>
#include <unistd.h>
#include <termios.h>
#include <poll.h>
int main(void) {
    struct termios t;
    if (tcgetattr(0, &t)) return 1;
    cfmakeraw(&t);
    if (tcsetattr(0, TCSANOW, &t)) return 2;
    FILE *f = fopen("frontend", "w");
    fprintf(f, "%d", getpid());
    fclose(f);
    f = fopen("input.bin", "ab");
    unsigned n = 0;
    for (;;) {
        printf("\033[H\033[2JViewer fixture %08u\r\n", n++);
        fflush(stdout);
        struct pollfd p = {0, POLLIN, 0};
        if (poll(&p, 1, 100) > 0) {
            unsigned char b[64];
            int count = read(0, b, sizeof b);
            if (count <= 0) break;
            fwrite(b, 1, count, f);
            fflush(f);
        }
    }
    fclose(f);
    return 0;
}
"#,
    )
    .unwrap();
    assert!(
        Command::new("cc")
            .arg(&source)
            .arg("-o")
            .arg(&executable)
            .status()
            .unwrap()
            .success()
    );
    let info = json!({"executable":executable,"args":["--remote","unix:///fixture-only","resume","fixture-thread"]});
    let session = json!({"cwd":dir,"name":"Voyager disposable viewer check"});
    let mut child = Owned(viewer::open_instance(viewer::Kind::Xterm, &info, &session).unwrap());
    wait(|| terminal::window(child.0.id()).unwrap().is_some() && dir.join("frontend").exists());
    let window = terminal::window(child.0.id()).unwrap().unwrap();
    let frontend: u32 = fs::read_to_string(dir.join("frontend"))
        .unwrap()
        .parse()
        .unwrap();
    let attachment = json!({"terminal":identity(child.0.id()),"frontend":identity(frontend),"window_id":window,"executable":executable,"server":"/fixture-only","native_thread_id":"fixture-thread"});
    let mut wrong = attachment.clone();
    wrong["frontend"]["start"] = json!("0");
    assert!(terminal::voice_toggle(&wrong).is_err());
    assert!(fs::read(dir.join("input.bin")).unwrap().is_empty());
    terminal::voice_toggle(&attachment).unwrap();
    wait(|| fs::read(dir.join("input.bin")).unwrap() == b"\x1b[19~");
    let (conn, _) = x11rb::connect(None).unwrap();
    let pixels = || {
        conn.get_image(ImageFormat::Z_PIXMAP, window, 0, 0, 700, 100, u32::MAX)
            .unwrap()
            .reply()
            .unwrap()
            .data
    };
    let mut observations = Vec::new();
    for cycle in 0..12 {
        assert!(
            Command::new("xdotool")
                .args(["windowminimize", &window.to_string()])
                .status()
                .unwrap()
                .success()
        );
        thread::sleep(Duration::from_millis(100));
        let mut entry = identity(child.0.id());
        entry["id"] = json!(window);
        entry["x"] = json!(100);
        entry["y"] = json!(100);
        entry["width"] = json!(803 + cycle % 2 * 10);
        entry["height"] = json!(507);
        let result = window_layout::apply(&json!({"focus":window,"windows":[entry]})).unwrap();
        assert_eq!(result["state"], "confirmed", "{result}");
        let before = pixels();
        thread::sleep(Duration::from_millis(250));
        assert!(
            before != pixels(),
            "viewer stopped drawing at cycle {cycle}"
        );
        assert_eq!(identity(frontend), attachment["frontend"]);
        observations.push(result);
    }
    terminal::close(child.0.id()).unwrap();
    wait(|| child.0.try_wait().unwrap().is_some());
    assert!(!terminal::exists(window).unwrap());
    fs::write(dir.join("proof.json"), serde_json::to_vec_pretty(&json!({"verdict":"pass","viewer_pid":child.0.id(),"window":window,"attachment":attachment,"cycles":observations,"input_hex":"1b5b31397e","limits":"Disposable native input fixture, not a Codex agent or service. Verifies shortcut delivery, not microphone or voice transport. No app docking or sound measurement."})).unwrap()).unwrap();
}
