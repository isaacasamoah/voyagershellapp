use std::path::PathBuf;

macro_rules! identities {
    ($($name:ident),+ $(,)?) => {
        $(#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
        pub struct $name(u128);)+
    };
}

identities!(
    HostId,
    ActorId,
    SessionId,
    TaskId,
    RequestId,
    TurnId,
    SourceId,
    ClaimId,
    RevisionId,
    WindowId,
    GestureId,
    Attachment,
    CaptureGeneration,
    PacketId,
    PublicationId,
    PublicationConsent,
    VoyageId,
    ParticipantId,
    DeliveryId,
    SubscriptionId,
    BoardId,
    SnapshotId,
    AttemptId,
    ReviewId,
);

pub struct BoundedText {
    _value: String,
}

pub enum Fault {
    NotImplemented,
    InvalidInput,
    NotFound,
    Forbidden,
    RequestConflict,
    AmbiguousTarget,
    StaleBinding,
    StaleAttachment,
    StaleTurn,
    StaleRevision,
    Busy,
    Unsupported(Capability),
    StorageUnavailable,
}

pub enum Capability {
    OrdinaryAdoption,
    SameInstanceOpen,
    IsolatedStop,
    ActiveTurnSteering,
    NativeVoice,
    RemoteAccess,
}

pub struct Work {
    _private: (),
}

pub enum NativeKind {
    Codex,
    Bash,
}

pub struct StartTask {
    pub request: RequestId,
    pub task: TaskId,
    pub parent: Option<SessionId>,
    pub name: BoundedText,
    pub directory: PathBuf,
    pub native: NativeKind,
    pub initial_input: BoundedText,
    pub viewer: InitialViewer,
}

pub enum InitialViewer {
    Open,
    Background,
}

pub struct DockRequest {
    pub request: RequestId,
    pub window: WindowId,
    pub gesture: GestureId,
}

pub enum Lifecycle {
    Open(SessionId),
    Background(SessionId),
    Stop(SessionId),
    Remove(SessionId),
    StopAndRemove(SessionId),
    RegisterAgain(SessionId),
    Detach(Attachment),
}

pub enum Instruction {
    Start {
        session: SessionId,
        task: TaskId,
        text: BoundedText,
    },
    Steer {
        attachment: Attachment,
        expected_turn: TurnId,
        text: BoundedText,
    },
    InterruptForHuman {
        attachment: Attachment,
        expected_turn: TurnId,
    },
}

pub struct Operation {
    pub request: RequestId,
    pub state: OperationState,
    pub effects: Effects,
}

pub enum OperationState {
    Pending,
    Applied,
    Partial(Fault),
    Refused(Fault),
    Uncertain,
}

pub struct Effects {
    pub session: Option<SessionId>,
    pub task: Option<TaskId>,
    pub attachment: Option<Attachment>,
    pub runtime: RuntimeState,
    pub viewer: ViewerState,
    pub registration: Registration,
    pub submission: Submission,
}

pub enum Submission {
    NotRequested,
    Pending,
    Accepted { turn: TurnId },
    Refused,
    Uncertain,
}

pub enum RuntimeState {
    NotCreated,
    Live(RuntimeAuthority),
    Exited,
    UnknownAfterRestart,
}

pub enum RuntimeAuthority {
    OwnedProcess,
    VerifiedHandoff,
    ObservationOnly,
}

pub enum ViewerState {
    Closed,
    Open(WindowId),
    Opening,
    Uncertain,
}

pub enum Registration {
    NeverRegistered,
    Active(CaptureGeneration),
    Removed { cutoff: SourceId },
}

pub enum CaptureState {
    Connected,
    Disconnected {
        last_durable: Option<SourceId>,
        reason: Gap,
    },
    Stopped,
}

pub struct SessionView {
    pub session: SessionId,
    pub runtime: RuntimeState,
    pub registration: Registration,
    pub capture: CaptureState,
    pub viewer: ViewerState,
    pub attachment: Option<Attachment>,
}

pub struct TaskEvidence {
    pub task: TaskId,
    pub submissions: Vec<(RequestId, Submission)>,
    pub turns: Vec<TurnEvidence>,
    pub assessments: Vec<Assessment>,
    pub coverage: Coverage,
}

pub struct TurnEvidence {
    pub turn: TurnId,
    pub state: TurnState,
    pub sources: Vec<SourceId>,
}

pub enum TurnState {
    Running,
    Completed,
    Failed,
    Interrupted,
    Unknown,
}

pub struct Assessment {
    pub author: ActorId,
    pub verdict: Verdict,
    pub sources: Vec<SourceId>,
}

pub enum Verdict {
    Met,
    NotMet,
    Inconclusive,
}

pub struct AssessTask {
    pub request: RequestId,
    pub task: TaskId,
    pub verdict: Verdict,
    pub evidence: Vec<SourceId>,
}

pub struct Coverage {
    pub through: Option<SourceId>,
    pub gaps: Vec<Gap>,
    pub truncated: bool,
}

pub enum Gap {
    Disconnected,
    Restarted,
    CaptureRemoved,
    StorageFailure,
    SourceUnavailable,
}

impl Work {
    pub async fn start(&mut self, _request: StartTask) -> Result<Operation, Fault> {
        Err(Fault::NotImplemented)
    }

    pub async fn lifecycle(
        &mut self,
        _request: RequestId,
        _action: Lifecycle,
    ) -> Result<Operation, Fault> {
        Err(Fault::NotImplemented)
    }

    pub async fn dock(&mut self, _request: DockRequest) -> Result<Operation, Fault> {
        Err(Fault::NotImplemented)
    }

    pub async fn instruct(
        &mut self,
        _request: RequestId,
        _instruction: Instruction,
    ) -> Result<Operation, Fault> {
        Err(Fault::NotImplemented)
    }

    pub async fn operation(&self, _request: RequestId) -> Result<Operation, Fault> {
        Err(Fault::NotImplemented)
    }

    pub async fn session(&self, _session: SessionId) -> Result<SessionView, Fault> {
        Err(Fault::NotImplemented)
    }

    pub async fn task(&self, _task: TaskId) -> Result<TaskEvidence, Fault> {
        Err(Fault::NotImplemented)
    }

    pub async fn assess(&mut self, _request: AssessTask) -> Result<TaskEvidence, Fault> {
        Err(Fault::NotImplemented)
    }
}

pub struct Notebook {
    _private: (),
}

pub enum Audience {
    Private,
    Voyage(VoyageId),
}

pub enum Authorship {
    Observed(ActorId),
    Reported { reporter: ActorId, claimed: ActorId },
    Unknown,
}

pub struct Source {
    pub id: SourceId,
    pub host: HostId,
    pub session: SessionId,
    pub task: Option<TaskId>,
    pub request: Option<RequestId>,
    pub turn: Option<TurnId>,
    pub author: Authorship,
    pub observed_sequence: u64,
    pub occurred_at: Option<u64>,
    pub recorded_at: u64,
    pub content: SourceContent,
}

pub enum SourceContent {
    Excerpt(BoundedText),
    TurnOutcome(TurnState),
    Gap(Gap),
    Artifact { digest: [u8; 32], available: bool },
}

pub struct ClaimRevision {
    pub claim: ClaimId,
    pub revision: RevisionId,
    pub author: ActorId,
    pub text: BoundedText,
    pub evidence: Vec<SourceId>,
    pub replaces: Option<RevisionId>,
    pub challenges: Vec<RevisionId>,
    pub judgment: Judgment,
}

pub struct ProposeClaim {
    pub request: RequestId,
    pub claim: Option<ClaimId>,
    pub expected: Option<RevisionId>,
    pub text: BoundedText,
    pub evidence: Vec<SourceId>,
    pub challenges: Vec<RevisionId>,
}

pub enum Judgment {
    Unassessed,
    BoundedModel {
        attempt: AttemptId,
        confidence: u8,
        evidence: Vec<SourceId>,
    },
    HumanReviewed {
        reviewer: ActorId,
        evidence: Vec<SourceId>,
    },
}

pub struct Query {
    pub about: Option<TaskId>,
    pub question: BoundedText,
    pub audience: Audience,
}

pub struct EvidencePacket {
    pub id: PacketId,
    pub claims: Vec<ClaimRevision>,
    pub sources: Vec<Source>,
    pub coverage: Coverage,
}

pub struct Publish {
    pub request: RequestId,
    pub consent: PublicationConsent,
}

pub struct Publication {
    pub id: PublicationId,
    pub packet: PacketId,
    pub audience: VoyageId,
}

pub enum MessagePurpose {
    Context { about: TaskId },
    Request { about: TaskId },
    Response { to: DeliveryId },
}

pub struct Deliver {
    pub request: RequestId,
    pub publication: PublicationId,
    pub recipient: ParticipantId,
    pub purpose: MessagePurpose,
}

pub struct Delivery {
    pub id: DeliveryId,
    pub sender: ActorId,
    pub purpose: MessagePurpose,
    pub transport: DeliveryTransport,
    pub presentation: Presentation,
    pub response: Option<DeliveryId>,
    pub resolution: Resolution,
}

pub enum DeliveryTransport {
    Queued,
    Accepted,
    Refused,
    Uncertain,
}

pub enum Presentation {
    Unknown,
    Presented(SourceId),
    ReadAcknowledged(SourceId),
}

pub enum Resolution {
    Open,
    Resolved { actor: ActorId, evidence: SourceId },
}

pub struct Subscription {
    pub id: SubscriptionId,
    pub recipient: ParticipantId,
    pub about: TaskId,
    pub audience: Audience,
    pub after: Option<SourceId>,
}

impl Notebook {
    pub async fn find(&self, _query: Query) -> Result<EvidencePacket, Fault> {
        Err(Fault::NotImplemented)
    }

    pub async fn read(&self, _packet: PacketId) -> Result<EvidencePacket, Fault> {
        Err(Fault::NotImplemented)
    }

    pub async fn revise(&mut self, _request: ProposeClaim) -> Result<ClaimRevision, Fault> {
        Err(Fault::NotImplemented)
    }

    pub async fn publish(&mut self, _request: Publish) -> Result<Publication, Fault> {
        Err(Fault::NotImplemented)
    }

    pub async fn deliver(&mut self, _request: Deliver) -> Result<Delivery, Fault> {
        Err(Fault::NotImplemented)
    }
}

pub struct BoardEdit {
    pub request: RequestId,
    pub board: BoardId,
    pub expected: RevisionId,
    pub bounded_changes: BoundedText,
}

pub struct ReviewSnapshot {
    pub review: ReviewId,
    pub session: SessionId,
    pub snapshot: SnapshotId,
    pub base_revision: String,
    pub sources: Vec<SourceId>,
}

pub struct ReviewAttempt {
    pub request: RequestId,
    pub snapshot: SnapshotId,
    pub attempt: AttemptId,
    pub result: GenerationResult,
}

pub enum GenerationResult {
    Pending,
    Ready { artifact: SourceId },
    Failed,
    Uncertain,
}
