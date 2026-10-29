use crate::api::*;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Child;

struct Service {
    host: HostBook,
    cells: BTreeMap<InstanceId, Cell>,
}

struct HostBook {
    epoch: u128,
    directory: BTreeMap<NativeIdentity, InstanceId>,
    creation_routes: BTreeMap<RequestId, InstanceId>,
    current_dock: Option<DockClaim>,
    voice: VoiceHandoff,
    policy: StandingPolicy,
}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct NativeIdentity {
    native_server_incarnation: u128,
    native_session: String,
}

struct Cell {
    identity: InstanceId,
    runtime: RuntimeAuthority,
    viewer: ViewerAuthority,
    registration: RegistrationObservation,
    capture: CaptureOwner,
    native: ProviderTransport,
    journal: CellJournal,
    pending: BTreeMap<RequestId, PendingNativeCall>,
    human_priority: Option<RequestId>,
}

enum RuntimeAuthority {
    Owned { child: Child },
    Adopted { control: VerifiedLifecycleControl },
    ObservationOnly,
    Exited,
    UnknownAfterRestart,
}

enum ViewerAuthority {
    Owned { child: Child, exact_window: u64 },
    VerifiedExternal { binding: VerifiedBinding },
    Closed,
    Unknown,
}

struct VerifiedLifecycleControl {
    native_identity: NativeIdentity,
    mechanism: NativeControl,
}

enum NativeControl {
    Conversation {
        live: LiveNativeControl,
        evidence: SourceRef,
    },
    PtyHandoff {
        live: LivePtyHandoff,
        evidence: SourceRef,
    },
}

struct LiveNativeControl;
struct LivePtyHandoff;

struct VerifiedBinding {
    native_identity: NativeIdentity,
    window: u64,
    terminal_process_start: u128,
    frontend_process_start: u128,
    binding_revision: u128,
}

struct CellJournal {
    private_path: PathBuf,
}

struct CaptureOwner {
    state: CaptureObservation,
    generation: u64,
    connection_incarnation: u128,
}

struct PendingNativeCall {
    request: RequestId,
    phase: NativePhase,
}

enum NativePhase {
    Ready,
    Writing { bytes_written: usize },
    AwaitingAcknowledgement,
}

struct DockClaim {
    instance: InstanceId,
    generation: Generation,
    binding: VerifiedBinding,
    live_socket: LiveAttachment,
}

struct LiveAttachment;
struct StandingPolicy;
struct ProviderTransport;

struct VoiceHandoff {
    desired_generation: Option<Generation>,
    observed: BTreeMap<InstanceId, VoiceObservation>,
}

struct DispatchPermit<'a> {
    host: &'a HostBook,
    target: InstanceId,
    request: RequestId,
}

impl HostBook {
    fn authorize<'a>(
        &'a self,
        _actor: &Principal,
        _target: InstanceId,
        _request: RequestId,
        _instruction: &Instruction,
    ) -> Result<DispatchPermit<'a>> {
        Err(Error::NotImplemented)
    }
}

impl Cell {
    fn dispatch(
        &mut self,
        _permit: DispatchPermit<'_>,
        _instruction: Instruction,
    ) -> Result<Submission> {
        Err(Error::NotImplemented)
    }

    fn lifecycle(
        &mut self,
        _actor: &Principal,
        _host: &mut HostBook,
        _request: RequestId,
        _action: Lifecycle,
    ) -> Result<LifecycleReceipt> {
        Err(Error::NotImplemented)
    }
}
