use crate::{ActorAttribution, EvidenceRef, Fault, RequestId};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct SessionId(u128);

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct WorkId(u128);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OperationId(u128);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ControlGeneration(u128);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CaptureGeneration(u128);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TurnRef {
    pub session: SessionId,
    native_turn: String,
}

pub struct LaunchSpec {
    pub parent: SessionId,
    pub folder: PathBuf,
    pub name: String,
    pub instruction: String,
    pub viewer: ViewerIntent,
}

pub enum ViewerIntent {
    Open,
    Background,
}

pub struct LaunchReceipt {
    pub operation: OperationId,
    pub session: SessionId,
    pub work: WorkId,
    pub progress: OperationProgress,
}

pub enum OperationProgress {
    Pending,
    Finished,
    Partial { reason: String },
    Uncertain { reason: String },
}

pub struct OperationView {
    pub progress: OperationProgress,
    pub observed: Vec<SessionView>,
}

pub struct SessionView {
    pub session: SessionId,
    pub runtime: RuntimeObservation,
    pub viewer: ViewerObservation,
    pub registration: Registration,
    pub capabilities: Vec<CapabilityStatus>,
}

pub enum RuntimeObservation {
    Running,
    Exited,
    Unknown,
}

pub enum ViewerObservation {
    Open,
    Closed,
    Unknown,
}

pub enum Registration {
    Active {
        generation: CaptureGeneration,
        capture: CaptureState,
    },
    Removed {
        cutoff: EvidenceRef,
    },
}

pub enum CaptureState {
    Connected,
    Gapped { latest_gap: EvidenceRef },
    Disconnected,
}

pub enum Capability {
    Observe,
    NativeInput,
    SurviveViewerClosure,
    SameInstanceReopen,
    IsolatedStop,
    ExpectedTurnSteering,
    NativeVoice,
}

pub enum CapabilityStatus {
    Verified {
        capability: Capability,
        evidence: EvidenceRef,
    },
    Unsupported {
        capability: Capability,
        reason: String,
    },
}

pub struct ManagedSession {
    session: SessionId,
    service_epoch: u128,
    live_control_generation: u128,
}

pub enum Lifecycle {
    Open,
    Background,
    Stop,
    StopAndRemove,
}

pub enum Instruction {
    ShellCommand {
        command: String,
    },
    Begin {
        text: String,
    },
    Steer {
        work: WorkId,
        expected_turn: TurnRef,
        text: String,
    },
    HumanReplacement {
        work: WorkId,
        expected_turn: TurnRef,
        control: ControlGeneration,
        text: String,
    },
}

pub enum SubmissionOutcome {
    NotSent { reason: String },
    Accepted { turn: TurnRef },
    Uncertain,
}

pub struct Submission {
    pub request: RequestId,
    pub work: WorkId,
    pub outcome: SubmissionOutcome,
}

pub enum NativeTurnOutcome {
    Completed,
    Failed,
    Interrupted,
}

pub struct EndedTurn {
    pub turn: TurnRef,
    pub outcome: NativeTurnOutcome,
    pub evidence: EvidenceRef,
}

pub enum OutcomeAssessment {
    Unassessed,
    Recorded {
        assessor: ActorAttribution,
        judgment: String,
        evidence: Vec<EvidenceRef>,
    },
}

pub struct WorkView {
    pub work: WorkId,
    pub session: SessionId,
    pub requests: Vec<Submission>,
    pub ended_turns: Vec<EndedTurn>,
    pub assessment: OutcomeAssessment,
    pub gaps: Vec<EvidenceRef>,
}

pub struct DropEvidence {
    peer_connection: u128,
    window_identity: u128,
    native_binding_revision: u128,
}

pub enum ControlInput {
    Drop {
        request: RequestId,
        evidence: DropEvidence,
    },
    Pull {
        generation: ControlGeneration,
    },
}

pub enum ControlReply {
    Docked {
        session: SessionId,
        generation: ControlGeneration,
        binding_revision: u128,
        voice: VoiceView,
    },
    Released {
        generation: ControlGeneration,
    },
    Pending {
        operation: OperationId,
    },
    Refused {
        reason: String,
    },
    Uncertain {
        operation: OperationId,
    },
}

pub struct VoiceView {
    pub desired: AudioState,
    pub observed: Option<AudioState>,
    pub phase: VoicePhase,
}

pub enum AudioState {
    Off,
    On,
}

pub enum VoicePhase {
    Disabled,
    Unsupported,
    Stopping,
    Starting,
    Active,
    Failed,
    Unknown,
}

pub struct Local {
    kernel: Kernel,
}

struct Kernel {
    live: std::collections::BTreeMap<SessionId, LiveControl>,
    provider: ProviderConnections,
    store: EvidenceStore,
}

enum LiveControl {
    Owned(std::process::Child),
    Adopted(VerifiedAdoption),
}

struct VerifiedAdoption {
    binding: NativeBinding,
    proof: AdoptionProof,
}

struct NativeBinding;
struct AdoptionProof;
struct ProviderConnections;
struct EvidenceStore;

impl Local {
    pub fn launch(
        &mut self,
        _request: RequestId,
        _spec: LaunchSpec,
    ) -> Result<LaunchReceipt, Fault> {
        unimplemented!()
    }

    pub fn work(&self, _work: WorkId) -> Result<WorkView, Fault> {
        unimplemented!()
    }

    pub fn session(&self, _session: SessionId) -> Result<SessionView, Fault> {
        unimplemented!()
    }

    pub fn operation(&self, _operation: OperationId) -> Result<OperationView, Fault> {
        unimplemented!()
    }

    pub fn managed(&self, _session: SessionId) -> Result<ManagedSession, Fault> {
        unimplemented!()
    }

    pub fn lifecycle(
        &mut self,
        _request: RequestId,
        _session: &ManagedSession,
        _action: Lifecycle,
    ) -> Result<OperationId, Fault> {
        unimplemented!()
    }

    pub fn remove(
        &mut self,
        _request: RequestId,
        _session: SessionId,
    ) -> Result<OperationId, Fault> {
        unimplemented!()
    }

    pub fn register_again(
        &mut self,
        _request: RequestId,
        _session: SessionId,
    ) -> Result<OperationId, Fault> {
        unimplemented!()
    }

    pub fn instruct(
        &mut self,
        _request: RequestId,
        _session: SessionId,
        _instruction: Instruction,
    ) -> Result<Submission, Fault> {
        unimplemented!()
    }

    pub fn dock(
        &mut self,
        _request: RequestId,
        _evidence: DropEvidence,
    ) -> Result<ControlReply, Fault> {
        unimplemented!()
    }

    pub fn release(&mut self, _generation: ControlGeneration) -> Result<ControlReply, Fault> {
        unimplemented!()
    }

    pub fn release_priority(
        &mut self,
        _request: RequestId,
        _session: SessionId,
        _protected_work: WorkId,
    ) -> Result<OperationId, Fault> {
        unimplemented!()
    }
}
