#![allow(dead_code)]

mod boundary;

pub mod knowledge;
pub mod sessions;

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct RequestId(String);

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct EvidenceId(u128);

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct ActorId(u128);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Digest([u8; 32]);

#[derive(Clone, Debug)]
pub enum ActorAttribution {
    LocalPeer { actor: ActorId },
    AuthenticatedParticipant { actor: ActorId },
    NativeSourceOnly,
    Unknown,
}

#[derive(Clone, Debug)]
pub struct EvidenceRef {
    pub event: EvidenceId,
    pub digest: Digest,
}

#[derive(Debug)]
pub enum Fault {
    NotImplemented,
    InvalidInput,
    RequestConflict,
    StaleAuthority,
    AccessDenied,
    Unavailable,
    StorageUnavailable,
}

pub(crate) struct ActorContext {
    actor: ActorId,
    service_epoch: u128,
    peer_connection: u128,
}
