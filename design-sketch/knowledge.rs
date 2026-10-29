use crate::{ActorAttribution, Digest, EvidenceRef, Fault, RequestId};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClaimRef {
    author_notebook: u128,
    revision: u128,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ParticipantId(u128);

pub struct FindingDraft {
    pub assertion: String,
    pub evidence: Vec<EvidenceRef>,
}

pub enum RelationKind {
    Supports,
    Challenges,
    Supersedes,
    DerivedFrom,
}

pub struct RelationDraft {
    pub from: ClaimRef,
    pub to: ClaimRef,
    pub kind: RelationKind,
    pub evidence: Vec<EvidenceRef>,
}

pub struct SourceExcerpt {
    source: EvidenceRef,
    selected_text: String,
}

impl SourceExcerpt {
    pub fn text(&self) -> &str {
        unimplemented!()
    }

    pub fn source(&self) -> &EvidenceRef {
        unimplemented!()
    }
}

pub struct OwnerReview {
    selection: Digest,
    voyage: u128,
    membership_revision: u128,
    approving_peer: u128,
}

pub struct PublicationSelection {
    pub revision: ClaimRef,
    pub sources: Vec<SourceExcerpt>,
    pub review: OwnerReview,
}

pub struct PublishedClaim {
    voyage: u128,
    public_revision: u128,
}

pub struct DeliveryReceipt {
    pub state: DeliveryState,
    pub observed_response: Option<EvidenceRef>,
    pub resolution: Resolution,
}

pub enum DeliveryState {
    Stored,
    Accepted,
    Presented,
    Read,
    Uncertain,
}

pub enum Resolution {
    Unresolved,
    Resolved {
        actor: ActorAttribution,
        evidence: EvidenceRef,
    },
}

pub struct Query {
    pub question: String,
    pub maximum_sources: usize,
}

pub struct EvidencePacket {
    pub assertions: Vec<(ClaimRef, String, ActorAttribution)>,
    pub relationships: Vec<RelationDraft>,
    pub sources: Vec<SourceExcerpt>,
    pub limitations: Vec<String>,
}

pub struct Notebook {
    author_lane: u128,
    records: NotebookStore,
}

pub struct Voyage {
    audience: u128,
    records: PublicationStore,
    authorization: MembershipState,
}

struct NotebookStore;
struct PublicationStore;
struct MembershipState;

impl Notebook {
    pub fn record(&mut self, _request: RequestId, _draft: FindingDraft) -> Result<ClaimRef, Fault> {
        unimplemented!()
    }

    pub fn relate(
        &mut self,
        _request: RequestId,
        _draft: RelationDraft,
    ) -> Result<ClaimRef, Fault> {
        unimplemented!()
    }

    pub fn context(&self, _query: Query) -> Result<EvidencePacket, Fault> {
        unimplemented!()
    }
}

impl Voyage {
    pub fn publish(
        &mut self,
        _request: RequestId,
        _source: &Notebook,
        _selection: PublicationSelection,
    ) -> Result<PublishedClaim, Fault> {
        unimplemented!()
    }

    pub fn send_context(
        &mut self,
        _request: RequestId,
        _recipient: ParticipantId,
        _claim: PublishedClaim,
    ) -> Result<DeliveryReceipt, Fault> {
        unimplemented!()
    }

    pub fn delivery(&self, _request: &RequestId) -> Result<DeliveryReceipt, Fault> {
        unimplemented!()
    }

    pub fn context(&self, _query: Query) -> Result<EvidencePacket, Fault> {
        unimplemented!()
    }
}
