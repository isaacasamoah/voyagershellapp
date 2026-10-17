use crate::knowledge::{Notebook, OwnerReview, Voyage};
use crate::sessions::{DropEvidence, Local};
use crate::{Digest, Fault};

struct AcceptedPeer {
    observed_connection: u128,
    service_epoch: u128,
}

struct SelectedWindowObservation {
    window: u128,
    gesture_generation: u128,
    terminal_process_start: u128,
    frontend_process_start: u128,
    binding_revision: u128,
}

struct ReviewedSelection {
    content_digest: Digest,
    audience: u128,
    membership_revision: u128,
}

struct OwnerApproval {
    approving_peer: AcceptedPeer,
    selection: ReviewedSelection,
}

impl AcceptedPeer {
    fn local(&self) -> Result<Local, Fault> {
        Err(Fault::NotImplemented)
    }

    fn notebook(&self) -> Result<Notebook, Fault> {
        Err(Fault::NotImplemented)
    }

    fn voyage(&self, _audience: u128) -> Result<Voyage, Fault> {
        Err(Fault::NotImplemented)
    }

    fn drop_evidence(
        &self,
        _observation: SelectedWindowObservation,
    ) -> Result<DropEvidence, Fault> {
        Err(Fault::NotImplemented)
    }
}

impl OwnerApproval {
    fn issue(&self) -> Result<OwnerReview, Fault> {
        Err(Fault::NotImplemented)
    }
}
