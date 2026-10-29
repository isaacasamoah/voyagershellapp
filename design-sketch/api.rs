use std::path::PathBuf;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct InstanceId(pub u128);
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct RequestId(pub u128);
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ActorId(pub u128);
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct MessageId(pub u128);
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ClaimId(pub u128);
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct PreviewId(pub [u8; 32]);
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Generation(pub u128);
#[derive(Clone, Copy)]
pub struct TaskId(pub u128);
pub struct TurnId(pub String);

pub enum Error {
    NotImplemented,
    InProgress(RequestId),
    ConflictingRequest,
    Forbidden,
    StaleBinding,
    StaleControl,
    Busy,
    HumanPriority,
    CaptureUnavailable,
    Unsupported(Capability),
    StorageUnavailable,
}

pub enum Capability {
    OrdinaryAdoption,
    IsolatedStop,
    ActiveTurnSteering,
    HumanOverride,
    NativeVoice,
}

pub struct Principal {
    actor: ActorId,
    service_epoch: u128,
}

pub struct LocalHost {
    local_binding: (),
}

pub struct Instance {
    identity: InstanceId,
    local_binding: (),
}

pub struct CreateInstance {
    pub name: String,
    pub directory: PathBuf,
    pub kind: InstanceKind,
    pub viewer: ViewerPreference,
}

pub enum InstanceKind {
    Codex,
    Bash,
}

pub enum ViewerPreference {
    Open,
    Background,
}

pub struct CreationReceipt {
    pub request: RequestId,
    pub instance: Option<Instance>,
    pub state: OperationState,
    pub viewer: ViewerObservation,
}

pub enum Lifecycle {
    Open,
    Background,
    Stop,
    Remove,
    StopAndRemove,
    RegisterAgain,
}

pub enum OperationState {
    Pending,
    Completed,
    Partial,
    Uncertain,
}

pub enum RuntimeObservation {
    Running,
    Exited,
    ObservationOnly,
    Unknown,
}

pub enum ViewerObservation {
    Open,
    Closed,
    FocusRequested,
    Unknown,
}

pub enum RegistrationObservation {
    Active { generation: u64 },
    Removed { cutoff: u64 },
}

pub enum CaptureObservation {
    Connected,
    Disconnected,
    Faulted,
}

pub struct LifecycleReceipt {
    pub request: RequestId,
    pub state: OperationState,
    pub runtime: RuntimeObservation,
    pub viewer: ViewerObservation,
    pub registration: RegistrationObservation,
    pub capture: CaptureObservation,
}

pub enum Instruction {
    ShellCommand { line: String },
    StartWhenIdle { text: String },
    Steer { expected_turn: TurnId, text: String },
    ReplaceKnownSupervisorTurn { expected_turn: TurnId, text: String },
}

pub struct Submission {
    pub request: RequestId,
    pub task: TaskId,
    pub state: SubmissionState,
}

pub enum SubmissionState {
    Prepared,
    Dispatching,
    Accepted { turn: TurnId },
    Rejected,
    Uncertain { known_turn: Option<TurnId> },
}

pub struct WindowSelection {
    pub window: u64,
    pub desktop_observation: u128,
}

pub struct DockReceipt {
    pub instance: Instance,
    pub generation: Generation,
    pub lifecycle: LifecycleEvidence,
    pub voice: VoiceObservation,
}

pub enum LifecycleEvidence {
    AlreadyOwned,
    VerifiedAdoption { proof: SourceRef },
}

pub enum VoiceObservation {
    Disabled,
    Unsupported,
    Off,
    Stopping,
    Starting,
    On { generation: Generation },
    Unknown,
}

pub struct SourceRef {
    pub machine: u128,
    pub instance: InstanceId,
    pub service_epoch: u128,
    pub sequence: u64,
    pub digest: [u8; 32],
}

pub struct Fact {
    pub source: SourceRef,
    pub request: Option<RequestId>,
    pub turn: Option<TurnId>,
    pub provenance: Provenance,
    pub occurred_micros: Option<u64>,
    pub recorded_micros: u64,
    pub kind: FactKind,
}

pub enum Provenance {
    Native { speaker: NativeSpeaker },
    BoundCaller { actor: ActorId },
    ServiceObservation,
}

pub enum NativeSpeaker {
    UserRole,
    AssistantRole,
    ToolRole,
}

pub enum FactKind {
    ConversationText(String),
    TurnStarted,
    TurnEnded { reported_outcome: String },
    CaptureGap,
    ContextReceived(MessageId),
}

pub struct Claim {
    pub id: ClaimId,
    pub interpreter: ActorId,
    pub interpretation: String,
    pub sources: Vec<SourceRef>,
    pub supersedes: Vec<ClaimId>,
    pub conflicts: Vec<ClaimId>,
}

pub struct EvidencePacket {
    pub facts: Vec<Fact>,
    pub claims: Vec<Claim>,
    pub coverage_gaps: Vec<String>,
}

pub enum EvidenceQuery {
    Request(RequestId),
    Turn(TurnId),
}

pub struct Investigation {
    pub question: String,
    pub max_sources: u16,
    pub max_steps: u16,
}

pub enum Audience {
    Private(ActorId),
    Voyage(u128),
    Room(u128),
}

pub struct Publication {
    identity: u128,
    source_instance: InstanceId,
    approved_digest: [u8; 32],
}

pub struct ContextDelivery {
    pub publication: Publication,
    pub in_reply_to: Option<MessageId>,
}

pub struct DeliveryReceipt {
    pub message: MessageId,
    pub sender: ActorId,
    pub observations: Vec<DeliveryObservation>,
}

pub enum DeliveryObservation {
    Stored,
    Presented { by: ActorId },
    Read { by: ActorId },
    Responded { request: RequestId },
    Resolved { by: ActorId },
}

impl LocalHost {
    pub fn create(
        &self,
        _actor: &Principal,
        _request: RequestId,
        _new: CreateInstance,
    ) -> Result<CreationReceipt> {
        Err(Error::NotImplemented)
    }

    pub fn creation(&self, _actor: &Principal, _request: RequestId) -> Result<CreationReceipt> {
        Err(Error::NotImplemented)
    }

    pub fn adopt_and_dock(
        &self,
        _actor: &Principal,
        _request: RequestId,
        _selection: WindowSelection,
    ) -> Result<DockReceipt> {
        Err(Error::NotImplemented)
    }

    pub fn undock(&self, _actor: &Principal, _generation: Generation) -> Result<()> {
        Err(Error::NotImplemented)
    }
}

impl Instance {
    pub fn instruct(
        &self,
        _actor: &Principal,
        _request: RequestId,
        _instruction: Instruction,
    ) -> Result<Submission> {
        Err(Error::NotImplemented)
    }

    pub fn submission(&self, _actor: &Principal, _request: RequestId) -> Result<Submission> {
        Err(Error::NotImplemented)
    }

    pub fn change(
        &self,
        _actor: &Principal,
        _request: RequestId,
        _action: Lifecycle,
    ) -> Result<LifecycleReceipt> {
        Err(Error::NotImplemented)
    }

    pub fn evidence(&self, _actor: &Principal, _query: EvidenceQuery) -> Result<EvidencePacket> {
        Err(Error::NotImplemented)
    }

    pub fn investigate(&self, _actor: &Principal, _query: Investigation) -> Result<EvidencePacket> {
        Err(Error::NotImplemented)
    }

    pub fn preview_publication(
        &self,
        _actor: &Principal,
        _claims: Vec<ClaimId>,
        _audience: Audience,
    ) -> Result<PreviewId> {
        Err(Error::NotImplemented)
    }

    pub fn publish(
        &self,
        _actor: &Principal,
        _request: RequestId,
        _approved_preview: PreviewId,
    ) -> Result<Publication> {
        Err(Error::NotImplemented)
    }

    pub fn deliver_context(
        &self,
        _actor: &Principal,
        _message: MessageId,
        _context: ContextDelivery,
    ) -> Result<DeliveryReceipt> {
        Err(Error::NotImplemented)
    }
}
