use candidate_a::*;

pub enum NativeVisit {
    Start(StartTask),
    Return {
        start_request: RequestId,
        open_request: RequestId,
    },
}

pub enum TaskCard {
    Starting(Operation),
    Returned {
        operation: Operation,
        evidence: TaskEvidence,
        viewer: Option<Operation>,
    },
}

pub async fn start_and_return(work: &mut Work, visit: NativeVisit) -> Result<TaskCard, Fault> {
    match visit {
        NativeVisit::Start(request) => Ok(TaskCard::Starting(work.start(request).await?)),
        NativeVisit::Return {
            start_request,
            open_request,
        } => {
            let operation = work.operation(start_request).await?;
            let task = operation.effects.task.ok_or(Fault::NotFound)?;
            let evidence = work.task(task).await?;
            let viewer = match operation.effects.session {
                Some(session) => Some(
                    work.lifecycle(open_request, Lifecycle::Open(session))
                        .await?,
                ),
                None => None,
            };
            Ok(TaskCard::Returned {
                operation,
                evidence,
                viewer,
            })
        }
    }
}

pub enum DockFeedback {
    Pending(Operation),
    Refused(Fault),
    Acknowledged {
        attachment: Attachment,
        instruction: Operation,
    },
}

pub async fn dock_and_steer(
    work: &mut Work,
    dropped_window: DockRequest,
    instruction: RequestId,
    observed_turn: TurnId,
    text: BoundedText,
) -> Result<DockFeedback, Fault> {
    let operation = match work.dock(dropped_window).await {
        Ok(operation) => operation,
        Err(fault) => return Ok(DockFeedback::Refused(fault)),
    };
    let Some(attachment) = operation.effects.attachment else {
        return Ok(DockFeedback::Pending(operation));
    };
    let sent = work
        .instruct(
            instruction,
            Instruction::Steer {
                attachment,
                expected_turn: observed_turn,
                text,
            },
        )
        .await?;
    Ok(DockFeedback::Acknowledged {
        attachment,
        instruction: sent,
    })
}

pub struct ShareChoice {
    pub consent: PublicationConsent,
    pub publish_request: RequestId,
    pub deliver_request: RequestId,
    pub recipient: ParticipantId,
}

pub enum Finding {
    Private(EvidencePacket),
    Shared {
        publication: Publication,
        delivery: Delivery,
    },
}

pub async fn find_and_share(
    notebook: &mut Notebook,
    task: TaskId,
    question: BoundedText,
    choice: Option<ShareChoice>,
) -> Result<Finding, Fault> {
    match choice {
        None => Ok(Finding::Private(
            notebook
                .find(Query {
                    about: Some(task),
                    question,
                    audience: Audience::Private,
                })
                .await?,
        )),
        Some(choice) => {
            let publication = notebook
                .publish(Publish {
                    request: choice.publish_request,
                    consent: choice.consent,
                })
                .await?;
            let delivery = notebook
                .deliver(Deliver {
                    request: choice.deliver_request,
                    publication: publication.id,
                    recipient: choice.recipient,
                    purpose: MessagePurpose::Context { about: task },
                })
                .await?;
            Ok(Finding::Shared {
                publication,
                delivery,
            })
        }
    }
}
