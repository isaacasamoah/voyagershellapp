use std::{
    fs,
    io::Write,
    os::{
        fd::AsRawFd,
        unix::net::{UnixListener, UnixStream},
    },
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
use voyager_shell::codex::Codex;

fn socket_fixture() -> (PathBuf, UnixListener) {
    let path = std::env::temp_dir().join(format!("vk1-backlog-{}", uuid::Uuid::new_v4()));
    let listener = UnixListener::bind(&path).unwrap();
    (path, listener)
}

fn full_queue() -> (PathBuf, UnixListener, UnixStream) {
    let (path, listener) = socket_fixture();
    assert_eq!(unsafe { nix::libc::listen(listener.as_raw_fd(), 0) }, 0);
    let queued = UnixStream::connect(&path).unwrap();
    (path, listener, queued)
}

#[test]
fn full_backlog_obeys_connection_deadline() {
    let (path, _listener, _queued) = full_queue();
    let (sender, receiver) = mpsc::channel();
    let socket = path.clone();
    thread::spawn(move || {
        let result = Codex::connect_before(&socket, Instant::now() + Duration::from_millis(100));
        let _ = sender.send(result);
    });
    let result = receiver.recv_timeout(Duration::from_millis(600));
    fs::remove_file(path).unwrap();
    assert!(result.is_ok(), "connection exceeded six absolute deadlines");
    assert!(format!("{:#}", result.unwrap().err().unwrap()).contains("timed out"));
}

#[test]
fn cancellation_releases_a_connection_waiting_for_queue_space() {
    let (path, _listener, _queued) = full_queue();
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&cancelled);
    let socket = path.clone();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let _ = sender.send(Codex::connect_cancellable(
            &socket,
            Instant::now() + Duration::from_secs(5),
            flag,
        ));
    });
    thread::sleep(Duration::from_millis(20));
    cancelled.store(true, Ordering::Release);
    let result = receiver.recv_timeout(Duration::from_millis(600)).unwrap();
    fs::remove_file(path).unwrap();
    assert!(format!("{:#}", result.err().unwrap()).contains("cancelled"));
}

#[test]
fn partial_handshake_bytes_cannot_extend_the_absolute_deadline() {
    let (path, listener) = socket_fixture();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        for byte in b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n" {
            if stream.write_all(&[*byte]).is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
    });
    let (sender, receiver) = mpsc::channel();
    let socket = path.clone();
    thread::spawn(move || {
        let _ = sender.send(Codex::connect_before(
            &socket,
            Instant::now() + Duration::from_millis(100),
        ));
    });
    let result = receiver.recv_timeout(Duration::from_millis(600));
    server.join().unwrap();
    fs::remove_file(path).unwrap();
    assert!(
        result.is_ok(),
        "partial handshake extended the connection deadline"
    );
    assert!(format!("{:#}", result.unwrap().err().unwrap()).contains("timed out"));
}
