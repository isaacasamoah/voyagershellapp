use voyager_design::knowledge::{
    DeliveryReceipt, EvidencePacket, FindingDraft, Notebook, OwnerReview, ParticipantId,
    PublicationSelection, Query, Voyage,
};
use voyager_design::sessions::AssessmentVerdict;
use voyager_design::sessions::{
    ControlInput, ControlReply, LaunchReceipt, LaunchSpec, Lifecycle, Local, OperationId,
    SessionId, ViewerIntent, WorkId, WorkView,
};
use voyager_design::{EvidenceRef, Fault, RequestId};

pub enum TaskVisit {
    Assess {
        request: RequestId,
        work: WorkId,
        verdict: AssessmentVerdict,
        evidence: Vec<EvidenceRef>,
    },
    Start {
        request: RequestId,
        parent: SessionId,
        folder: std::path::PathBuf,
    },
    Return {
        work: WorkId,
        open_request: RequestId,
    },
}

pub enum TaskCard {
    Assessed(WorkView),
    Starting(LaunchReceipt),
    Returned {
        evidence: WorkView,
        viewer: Result<OperationId, Fault>,
    },
}

pub fn task_card(local: &mut Local, visit: TaskVisit) -> Result<TaskCard, Fault> {
    match visit {
        TaskVisit::Assess {
            request,
            work,
            verdict,
            evidence,
        } => Ok(TaskCard::Assessed(
            local.assess(request, work, verdict, evidence)?,
        )),
        TaskVisit::Start {
            request,
            parent,
            folder,
        } => {
            let launch = local.launch(
                request,
                LaunchSpec {
                    parent,
                    folder,
                    name: "native-api-research".into(),
                    instruction:
                        "Investigate the selected API and preserve primary-source references."
                            .into(),
                    viewer: ViewerIntent::Open,
                },
            )?;
            Ok(TaskCard::Starting(launch))
        }
        TaskVisit::Return { work, open_request } => {
            let evidence = local.work(work)?;
            let viewer = local
                .managed(evidence.session)
                .and_then(|managed| local.lifecycle(open_request, &managed, Lifecycle::Open));
            Ok(TaskCard::Returned { evidence, viewer })
        }
    }
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
    selected_sources: Vec<voyager_design::knowledge::SourceExcerpt>,
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
