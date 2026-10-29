use crate::api::*;
use std::path::PathBuf;

pub struct SessionRequests {
    pub create: RequestId,
    pub instruct: RequestId,
    pub background: RequestId,
    pub open: RequestId,
}

pub fn native_session(
    host: &LocalHost,
    owner: &Principal,
    ids: SessionRequests,
    directory: PathBuf,
) -> Result<(Instance, EvidencePacket)> {
    let created = host.create(
        owner,
        ids.create,
        CreateInstance {
            name: "bounded research".into(),
            directory,
            kind: InstanceKind::Codex,
            viewer: ViewerPreference::Open,
        },
    )?;
    let instance = created.instance.ok_or(Error::InProgress(ids.create))?;
    let submission = instance.instruct(
        owner,
        ids.instruct,
        Instruction::StartWhenIdle {
            text: "Inspect the selected repository and report the entry point.".into(),
        },
    )?;
    let _background = instance.change(owner, ids.background, Lifecycle::Background)?;
    let observed = instance.evidence(owner, EvidenceQuery::Request(submission.request))?;
    let _open = instance.change(owner, ids.open, Lifecycle::Open)?;
    Ok((instance, observed))
}

pub fn ordinary_dock(
    host: &LocalHost,
    owner: &Principal,
    request: RequestId,
    selected: WindowSelection,
) -> Result<DockReceipt> {
    host.adopt_and_dock(owner, request, selected)
}

pub struct ContextRequests {
    pub publish: RequestId,
    pub message: MessageId,
}

pub fn attributable_context(
    producer: &Instance,
    recipient: &Instance,
    owner: &Principal,
    sender: &Principal,
    ids: ContextRequests,
    approved_preview: PreviewId,
) -> Result<(DeliveryReceipt, EvidencePacket)> {
    let publication = producer.publish(owner, ids.publish, approved_preview)?;
    let receipt = recipient.deliver_context(
        sender,
        ids.message,
        ContextDelivery {
            publication,
            in_reply_to: None,
        },
    )?;
    let packet = recipient.investigate(
        sender,
        Investigation {
            question: "Which decision does this handoff depend on?".into(),
            max_sources: 8,
            max_steps: 4,
        },
    )?;
    Ok((receipt, packet))
}
