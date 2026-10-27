use anyhow::{Result, ensure};
use nix::{
    errno::Errno,
    poll::{PollFd, PollFlags, poll},
    sys::socket::{
        AddressFamily, SockFlag, SockType, UnixAddr, connect, getsockopt, socket, sockopt,
    },
};
use std::{
    os::fd::{AsFd, AsRawFd},
    os::unix::net::UnixStream,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

pub(super) struct Check {
    pub(super) deadline: Instant,
    pub(super) cancelled: Arc<AtomicBool>,
}

impl Check {
    pub(super) fn remaining(&self) -> Result<Duration> {
        ensure!(
            !self.cancelled.load(Ordering::Acquire),
            "native connection check cancelled"
        );
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        ensure!(!remaining.is_zero(), "native connection check timed out");
        Ok(remaining)
    }

    pub(super) fn handshake(
        &self,
        stream: UnixStream,
    ) -> Result<tungstenite::WebSocket<UnixStream>> {
        stream.set_nonblocking(true)?;
        let mut progress = tungstenite::client("ws://localhost/", stream);
        loop {
            self.remaining()?;
            match progress {
                Ok((socket, _)) => {
                    socket.get_ref().set_nonblocking(false)?;
                    return Ok(socket);
                }
                Err(tungstenite::HandshakeError::Interrupted(handshake)) => {
                    thread::sleep(self.remaining()?.min(Duration::from_millis(2)));
                    progress = handshake.handshake();
                }
                Err(tungstenite::HandshakeError::Failure(error)) => return Err(error.into()),
            }
        }
    }

    pub(super) fn connect(&self, path: &Path) -> Result<UnixStream> {
        let address = UnixAddr::new(path)?;
        loop {
            self.remaining()?;
            let handle = socket(
                AddressFamily::Unix,
                SockType::Stream,
                SockFlag::SOCK_NONBLOCK | SockFlag::SOCK_CLOEXEC,
                None,
            )?;
            match connect(handle.as_raw_fd(), &address) {
                Ok(()) => (),
                Err(Errno::EAGAIN | Errno::EINTR) => {
                    thread::sleep(self.remaining()?.min(Duration::from_millis(20)));
                    continue;
                }
                Err(Errno::EINPROGRESS) => {
                    let mut fds = [PollFd::new(handle.as_fd(), PollFlags::POLLOUT)];
                    loop {
                        let timeout = u16::try_from(self.remaining()?.as_millis().clamp(1, 20))?;
                        match poll(&mut fds, timeout) {
                            Ok(0) | Err(Errno::EINTR) => continue,
                            result => {
                                result?;
                            }
                        }
                        let error = getsockopt(&handle, sockopt::SocketError)?;
                        ensure!(
                            error == 0,
                            "native socket connection failed: {}",
                            Errno::from_raw(error)
                        );
                        break;
                    }
                }
                Err(error) => return Err(error.into()),
            }
            self.remaining()?;
            let stream = UnixStream::from(handle);
            stream.set_nonblocking(false)?;
            return Ok(stream);
        }
    }
}
