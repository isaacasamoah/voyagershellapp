use voyager_candidate_b::knowledge::{
    DeliveryReceipt, EvidencePacket, FindingDraft, Notebook, OwnerReview, ParticipantId,
    PublicationSelection, Query, Voyage,
};
use voyager_candidate_b::sessions::{
    ControlInput, ControlReply, LaunchReceipt, LaunchSpec, Local, SessionId, ViewerIntent, WorkView,
};
use voyager_candidate_b::{Fault, RequestId};

pub fn native_research(
    local: &mut Local,
    request: RequestId,
    parent: SessionId,
    folder: std::path::PathBuf,
) -> Result<(LaunchReceipt, WorkView), Fault> {
    let launch = local.launch(
        request,
        LaunchSpec {
            parent,
            folder,
            name: "native-api-research".into(),
            instruction: "Investigate the selected API and preserve primary-source references."
                .into(),
            viewer: ViewerIntent::Open,
        },
    )?;
    let work = local.work(launch.work)?;
    Ok((launch, work))
}

pub fn human_control(local: &mut Local, input: ControlInput) -> Result<ControlReply, Fault> {
    match input {
        ControlInput::Drop { request, evidence } => local.dock(request, evidence),
        ControlInput::Pull { generation } => local.release(generation),
    }
}

pub struct ShareRequests {
    pub record: RequestId,
    pub publish: RequestId,
    pub message: RequestId,
}

pub fn share_finding(
    notebook: &mut Notebook,
    voyage: &mut Voyage,
    requests: ShareRequests,
    finding: FindingDraft,
    selected_sources: Vec<voyager_candidate_b::knowledge::SourceExcerpt>,
    review: OwnerReview,
    recipient: ParticipantId,
) -> Result<(EvidencePacket, DeliveryReceipt), Fault> {
    let revision = notebook.record(requests.record, finding)?;
    let context = notebook.context(Query {
        question: "Which native API finding has inspectable source evidence?".into(),
        maximum_sources: 4,
    })?;
    let published = voyage.publish(
        requests.publish,
        notebook,
        PublicationSelection {
            revision,
            sources: selected_sources,
            review,
        },
    )?;
    let delivery = voyage.send_context(requests.message, recipient, published)?;
    Ok((context, delivery))
}
