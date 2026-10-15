use std::{fs, io::Write, os::unix::net::UnixListener};
use voyager_shell::whiteboard;

#[test]
fn whiteboard_read_saves_private_png_and_preserves_existing_files() {
    let dir = std::env::temp_dir().join(format!("wb-cli-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&dir).unwrap();
    let listener = UnixListener::bind(dir.join("whiteboard.sock")).unwrap();
    let server = std::thread::spawn(move || {
        for reply in [
            b"\x89PNG\r\n\x1a\nfixture".as_slice(),
            b"\x89PNG\r\n\x1a\nnew",
            b"Finish the current edit",
        ] {
            listener.accept().unwrap().0.write_all(reply).unwrap();
        }
    });
    let output = dir.join("drawing.png");
    whiteboard::read(&dir, &output).unwrap();
    let original = fs::read(&output).unwrap();
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(
        fs::metadata(&output).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(whiteboard::read(&dir, &output).is_err());
    assert_eq!(fs::read(&output).unwrap(), original);
    let failed = dir.join("failed.png");
    assert!(
        whiteboard::read(&dir, &failed)
            .unwrap_err()
            .to_string()
            .contains("Finish the current edit")
    );
    assert!(!failed.exists());
    server.join().unwrap();
    fs::remove_dir_all(dir).unwrap();
}
