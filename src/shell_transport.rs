//! Byte transport between the native terminal client and the owned shell.
use anyhow::{Context, Result, bail, ensure};
use nix::{
    pty::Winsize,
    sys::{
        socket::{getsockopt, sockopt},
        termios,
    },
    unistd::Uid,
};
use serde_json::{Value, json};
use std::{
    io::{self, Read, Write},
    os::unix::net::UnixStream,
    path::Path,
    time::Duration,
};
const FRAME_LIMIT: usize = 32 * 1024;
fn transient(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}
pub(crate) struct Viewer {
    pub socket: UnixStream,
    pub input: Vec<u8>,
}
impl Viewer {
    pub fn send(&mut self, value: Value) -> Result<()> {
        let mut bytes = serde_json::to_vec(&value)?;
        bytes.push(b'\n');
        self.socket.write_all(&bytes)?;
        Ok(())
    }
    pub fn output(&mut self, bytes: &[u8]) -> Result<()> {
        for chunk in bytes.chunks(4096) {
            self.send(json!({"output":chunk}))?;
        }
        Ok(())
    }

    pub fn read(&mut self) -> Result<Vec<Value>> {
        let mut bytes = [0; 4096];
        match self.socket.read(&mut bytes) {
            Ok(0) => bail!("terminal detached"),
            Ok(n) => self.input.extend_from_slice(&bytes[..n]),
            Err(e) if transient(&e) => (),
            Err(e) => return Err(e.into()),
        }
        ensure!(self.input.len() <= FRAME_LIMIT, "terminal frame too large");
        let mut frames = Vec::new();
        while let Some(end) = self.input.iter().position(|b| *b == b'\n') {
            frames.push(serde_json::from_slice(&self.input[..end])?);
            self.input.drain(..=end);
        }
        Ok(frames)
    }
}

/// Raw terminal transport, with no parser or emulator. Closing this process only
/// disconnects the client; the service still holds the shell's master PTY.
pub fn attach(socket: &Path) -> Result<()> {
    let stream = UnixStream::connect(socket)?;
    ensure!(
        getsockopt(&stream, sockopt::PeerCredentials)?.uid() == Uid::effective().as_raw(),
        "different-user shell service"
    );
    stream.set_read_timeout(Some(Duration::from_millis(1)))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    let stdin = io::stdin();
    let original = termios::tcgetattr(&stdin).context("attach requires a terminal")?;
    struct Restore(termios::Termios);
    impl Drop for Restore {
        fn drop(&mut self) {
            let _ = termios::tcsetattr(io::stdin(), termios::SetArg::TCSANOW, &self.0);
        }
    }
    let _restore = Restore(original.clone());
    let mut raw = original;
    termios::cfmakeraw(&mut raw);
    termios::tcsetattr(&stdin, termios::SetArg::TCSANOW, &raw)?;
    let mut peer = Viewer {
        socket: stream,
        input: Vec::new(),
    };
    let mut size = (0, 0);
    loop {
        let mut current = Winsize {
            ws_row: 0,
            ws_col: 0,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        // SAFETY: stdin remains a terminal; current has the platform winsize layout.
        if unsafe { nix::libc::ioctl(0, nix::libc::TIOCGWINSZ, &mut current) } == 0
            && (current.ws_row, current.ws_col) != size
            && current.ws_row > 0
            && current.ws_col > 0
        {
            size = (current.ws_row, current.ws_col);
            peer.send(json!({"resize":[size.0,size.1]}))?;
        }
        let mut poll = nix::libc::pollfd {
            fd: 0,
            events: nix::libc::POLLIN,
            revents: 0,
        };
        // SAFETY: one valid pollfd, bounded wait, no retained pointer.
        if unsafe { nix::libc::poll(&mut poll, 1, 10) } > 0 && poll.revents & nix::libc::POLLIN != 0
        {
            let mut input = [0; 4096];
            let n = stdin.lock().read(&mut input)?;
            if n == 0 {
                break;
            }
            peer.send(json!({"input":&input[..n]}))?;
        }
        for frame in peer.read()? {
            if let Some(error) = frame["error"].as_str() {
                bail!("{error}");
            }
            if let Some(output) = frame.get("output") {
                let bytes: Vec<u8> = serde_json::from_value(output.clone())?;
                io::stdout().write_all(&bytes)?;
                io::stdout().flush()?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_redraw_burst_keeps_transport_frames_bounded() -> Result<()> {
        let (writer, reader) = UnixStream::pair()?;
        let bytes = vec![255; 128 * 1024];
        let expected = bytes.clone();
        let send = std::thread::spawn(move || {
            Viewer {
                socket: writer,
                input: Vec::new(),
            }
            .output(&bytes)
        });
        let mut peer = Viewer {
            socket: reader,
            input: Vec::new(),
        };
        let mut received = Vec::new();
        while received.len() < expected.len() {
            for value in peer.read()? {
                received.extend(serde_json::from_value::<Vec<u8>>(value["output"].clone())?);
            }
        }
        send.join().expect("writer thread")?;
        assert_eq!(received, expected);
        Ok(())
    }
}
