use anyhow::{Context, Result, ensure};
use nix::{
    libc,
    sys::socket::{ControlMessageOwned, MsgFlags, getsockopt, recvmsg, sockopt},
    unistd::Uid,
};
use std::{
    fs::{self, File},
    io::{self, IoSliceMut, Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd, RawFd},
        unix::{fs::MetadataExt, net::UnixListener},
    },
    path::Path,
    time::Duration,
};

nix::ioctl_read_bad!(pty_number, libc::TIOCGPTN, libc::c_uint);

struct SocketPath<'a>(&'a Path);

impl Drop for SocketPath<'_> {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.0);
    }
}

pub fn receive(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .context("socket needs a private parent directory")?;
    let metadata = fs::symlink_metadata(parent)?;
    ensure!(
        metadata.is_dir()
            && metadata.uid() == Uid::effective().as_raw()
            && metadata.mode() & 0o077 == 0,
        "socket directory must be owned by this user with no group/other permissions"
    );
    // Never remove an existing socket to make bind succeed.
    let listener = UnixListener::bind(path)?;
    let _socket_path = SocketPath(path);
    eprintln!("receiver_ready");
    let (mut connection, _) = listener.accept()?;
    drop(listener); // Exactly one handoff for this experiment.
    connection.set_read_timeout(Some(Duration::from_secs(5)))?;
    connection.set_write_timeout(Some(Duration::from_secs(5)))?;
    let peer = getsockopt(&connection, sockopt::PeerCredentials)?;
    ensure!(
        peer.uid() == Uid::effective().as_raw(),
        "different-user peer"
    );

    let mut byte = [0];
    let mut iov = [IoSliceMut::new(&mut byte)];
    // Linux limits SCM_RIGHTS to 253 descriptors. Own every received descriptor
    // before rejecting an invalid packet so errors also close them.
    let mut ancillary = nix::cmsg_space!([RawFd; 253]);
    let message = recvmsg::<()>(
        connection.as_raw_fd(),
        &mut iov,
        Some(&mut ancillary),
        MsgFlags::MSG_CMSG_CLOEXEC,
    )?;
    let mut descriptors = Vec::new();
    for control in message.cmsgs()? {
        if let ControlMessageOwned::ScmRights(fds) = control {
            for fd in fds {
                // SAFETY: recvmsg installed each SCM_RIGHTS descriptor in this
                // process. This is its sole conversion to Rust ownership.
                descriptors.push(unsafe { OwnedFd::from_raw_fd(fd) });
            }
        }
    }
    ensure!(
        !message
            .flags
            .intersects(MsgFlags::MSG_CTRUNC | MsgFlags::MSG_TRUNC),
        "truncated handoff"
    );
    ensure!(
        message.bytes == 1 && byte == *b"H",
        "invalid handoff marker"
    );
    ensure!(
        descriptors.len() == 1,
        "handoff requires exactly one descriptor"
    );
    let master = descriptors.pop().unwrap();
    let mut number = 0;
    // SAFETY: the ioctl writes one c_uint to this valid mutable address.
    unsafe { pty_number(master.as_raw_fd(), &mut number) }.context("not a PTY master")?;
    connection.write_all(b"+")?;
    // The original owner must pause I/O before sending and close its master
    // after our ACK. D confirms relinquishment; an ACK alone is not a transfer.
    connection.read_exact(&mut byte)?;
    ensure!(byte == *b"D", "owner did not confirm relinquishment");
    drop(connection);
    eprintln!("handoff_received pty={number}");

    let mut master = File::from(master);
    let mut output = io::stdout().lock();
    let mut buffer = [0; 4096];
    loop {
        match master.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                output.write_all(&buffer[..n])?;
                output.flush()?;
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            // Linux PTY masters return EIO when no slave remains open.
            Err(error) if error.raw_os_error() == Some(libc::EIO) => break,
            Err(error) => return Err(error.into()),
        }
    }
    // We are not the parent and cannot infer the child's exit status here.
    eprintln!("pty_closed outcome=unknown");
    Ok(())
}
