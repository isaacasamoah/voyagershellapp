const $ = (selector) => document.querySelector(selector);
const stages = [
  {
    title: 'Conversation',
    tag: '01 · SOURCE',
    subtitle: 'Newest event + rolling context',
    x: 35,
    y: 72,
    input:
      'Earlier: “Use synchronous exports.” New: “Large exports exceed the timeout; use a background job.”',
    output: 'A frozen window with source event IDs, speaker, session and origin ticket.',
    detail:
      'Keep the preceding context. The newest event may supply the missing evidence or commitment.',
  },
  {
    title: 'Jev · detect',
    tag: '02 · TYPED JUDGMENT',
    subtitle: 'Decision? Discovery? Direction?',
    x: 475,
    y: 72,
    input:
      'The frozen window, current assignment and established direction evidence. Three independent questions.',
    output:
      'Decision / discovery candidates; a changed-direction flag schedules subscription reassessment. Uncertainty stays visible.',
    detail:
      'Ask what became newly supported. A direction-only trigger rechecks topic relevance; it does not create knowledge or change subscriptions by itself.',
  },
  {
    title: 'Jev · match topics',
    tag: '03 · MEMBERSHIP',
    subtitle: 'Existing topics · several or none',
    x: 915,
    y: 72,
    input:
      'The candidate in context + a versioned catalogue of existing topic IDs, names and scopes.',
    output: 'Matching topic IDs, no suitable match, or uncertainty.',
    detail:
      'Jev selects from existing topics. It does not invent a topic name. Shared topics can span tickets.',
  },
  {
    title: 'Sol · compose',
    tag: '04 · EVIDENCE',
    subtitle: 'GPT-6.1 Sol · medium',
    x: 915,
    y: 287,
    input:
      'One flagged kind, evidence, ticket and provisional matches. On no-match, include the existing catalogue too.',
    output:
      'A supported statement or disagreement. On no-match: suggest existing IDs for recheck, or propose a topic name and scope.',
    detail:
      'Jev’s no-match is provisional. Sol sees existing subjects before proposing another. Resolve topic changes before comparing records; expand the topic rule below.',
  },
  {
    title: 'Jev · compare',
    tag: '05 · RELATIONSHIPS',
    subtitle: 'Contradicts? Supports? Challenges?',
    x: 475,
    y: 287,
    input:
      'The supported statement, related existing statements, conditions and source evidence under settled topic IDs.',
    output: 'Decision: possible contradiction. Discovery: supports / challenges. No link is valid.',
    detail:
      'Jev judges the knowledge relationships that drive targeted notifications. Shared topics only find candidates; contradictions need overlapping conditions. Uncertain links stay provisional.',
  },
  {
    title: 'Record + route',
    tag: '06 · HARNESS',
    subtitle: 'Graph update → recipient packets',
    x: 35,
    y: 287,
    input:
      'Validated knowledge, evidence, settled topics, Jev’s relationship judgments and recipient identities.',
    output:
      'Topic updates plus relationship-specific reasons: your finding was challenged, or your decision needs reconciliation. One packet per recipient.',
    detail:
      'The harness routes Jev’s judged links to affected authors and one responsible resolver. It does not infer meaning from IDs. Only explicit resolutions create supersession.',
  },
];
const scenarios = {
  decision: {
    caption: 'Decision B may contradict decision A',
    source: '“Use a background job for large exports.”',
    flag: 'decision candidate',
    result: 'possible contradiction',
    end: 'Review the two decisions → record the resolution',
  },
  discovery: {
    caption: 'New evidence challenges an earlier finding',
    source: '“This export timed out on the large fixture.”',
    flag: 'discovery candidate',
    result: 'challenges',
    end: 'Notify subscribers + original author; preserve both findings',
  },
  quiet: {
    caption: 'No newly supported knowledge',
    source: '“Okay, thanks.”',
    flag: 'no change',
    result: 'no record',
    end: 'Stop here. No composition call and no notification.',
  },
};
const workers = [
  {
    id: 'W1',
    name: 'Research',
    reasons: ['Subscribed: exports', 'Your finding is cited'],
    note: 'Your timing experiment is cited as evidence. Review the claim if the interpretation is wrong.',
  },
  {
    id: 'W2',
    name: 'API',
    reasons: ['Subscribed: exports', 'Your decision is challenged'],
    note: 'Your synchronous-export decision may conflict with the proposed background-job decision. The captain is asked to resolve it.',
  },
  {
    id: 'W3',
    name: 'Jobs',
    reasons: ['Subscribed: exports', 'You proposed the new decision'],
    note: 'Your background-job proposal is being reconciled with the earlier API decision. Independent work can continue.',
  },
  {
    id: 'W4',
    name: 'UI',
    reasons: ['Subscribed: completion'],
    note: 'The completion contract may change. No replacement has been accepted yet; watch for the resolution.',
  },
  {
    id: 'W5',
    name: 'Tests',
    reasons: ['Subscribed: exports', 'Subscribed: completion'],
    note: 'The new decision concerns two of your topics. You receive one packet, with both subscription reasons.',
  },
];
let currentView = 'harness';
let step = 0;
let timer = null;
let scenario = 'decision';
let windowSize = '4k';
let updateVisible = false;
let selectedWorker = 1;
let outcome = null;

function activateByKeyboard(event) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    event.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
}

function bindSvgActions(root, attribute, action) {
  root.querySelectorAll(`[${attribute}]`).forEach((element) => {
    element.addEventListener('click', () => action(element.getAttribute(attribute)));
    element.addEventListener('keydown', activateByKeyboard);
  });
}

function markers(id) {
  return `<defs><marker id="${id}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="#73859b" stroke-width="1.4"/></marker></defs>`;
}

function drawFlow() {
  const example = scenarios[scenario];
  const paths = [
    'M365 128 H465',
    'M805 128 H905',
    'M1080 184 V277',
    'M905 343 H815',
    'M465 343 H375',
  ];
  const labels = ['window', 'candidate', 'topic IDs / no match', 'evidence', 'relations'];
  const labelPoints = [
    [415, 113],
    [855, 113],
    [1190, 235],
    [860, 324],
    [420, 324],
  ];
  $('#flow').innerHTML =
    markers('flow-arrow') +
    paths
      .map(
        (path, index) =>
          `<path d="${path}" class="arrow ${step > index ? 'active' : ''}" marker-end="url(#flow-arrow)"/><text x="${labelPoints[index][0]}" y="${labelPoints[index][1]}" text-anchor="middle" class="tiny">${labels[index]}</text>`,
      )
      .join('') +
    stages
      .map(
        (stage, index) =>
          `<g class="stage-node ${step === index ? 'selected' : ''} ${step > index ? 'visited' : ''}" data-stage="${index}" tabindex="0" role="button" aria-label="Stage ${index + 1}: ${stage.title}" transform="translate(${stage.x},${stage.y})"><rect class="node-box" width="330" height="112" rx="12"/><text x="20" y="26" class="tiny">${stage.tag}</text><text x="20" y="56" class="node-title">${stage.title}</text><text x="20" y="83" class="sublabel">${stage.subtitle}</text><circle cx="302" cy="27" r="4" fill="${step === index ? '#71e0c3' : '#526177'}"/></g>`,
      )
      .join('') +
    `<path d="M640 184 V213" class="branch"/><text x="640" y="233" text-anchor="middle" class="tiny">no change → stop</text><text x="35" y="37" class="flow-label">${example.caption}</text><path d="M130 399 V450 H475" class="loop" marker-end="url(#flow-arrow)"/><rect x="485" y="426" width="330" height="65" rx="10" fill="#201e32" stroke="#756091"/><text x="650" y="451" text-anchor="middle" font-size="13">Responsible agent / user</text><text x="650" y="474" text-anchor="middle" class="tiny">resolve a decision conflict</text><path d="M485 480 H240 V409" class="loop" marker-end="url(#flow-arrow)"/><text x="292" y="439" text-anchor="middle" class="tiny">request reconciliation</text><text x="323" y="499" text-anchor="middle" class="tiny">explicit resolution → store + notify</text><text x="915" y="453" class="tiny">Discovery: inform recipients.</text><text x="915" y="475" class="tiny">No automatic winner.</text>`;
  bindSvgActions($('#flow'), 'data-stage', (value) => {
    stopPlayback();
    step = scenario === 'quiet' ? Math.min(Number(value), 1) : Number(value);
    renderDetail();
    drawFlow();
  });
}

function renderDetail() {
  const stage = stages[step];
  const example = scenarios[scenario];
  $('#detail-kicker').textContent = stage.tag;
  $('#detail-title').textContent = stage.title;
  $('#detail-description').textContent = stage.detail;
  $('#detail-input').textContent =
    step === 0
      ? `${example.source} Read with up to ${windowSize} of earlier context.`
      : stage.input;
  $('#detail-output').textContent =
    scenario === 'quiet' && step > 0
      ? 'No new knowledge. The illustrated pipeline stops after the trigger check.'
      : stage.output;
  $('#step-status').textContent =
    scenario === 'quiet' && step >= 1
      ? 'No change → stop. No writer call.'
      : `Stage ${step + 1} of 6 · ${stage.title}`;
  $('#step').disabled = step >= (scenario === 'quiet' ? 1 : stages.length - 1);
}

function stopPlayback() {
  if (timer) clearInterval(timer);
  timer = null;
  $('#play').textContent = '▶ Play example';
}

function advance() {
  const max = scenario === 'quiet' ? 1 : stages.length - 1;
  if (step < max) step += 1;
  renderDetail();
  drawFlow();
  if (step === max) stopPlayback();
}

function selectView(view) {
  currentView = view === 'teams' ? 'teams' : 'harness';
  stopPlayback();
  $('#harness').hidden = currentView !== 'harness';
  $('#teams').hidden = currentView !== 'teams';
  document.querySelectorAll('[data-view]').forEach((button) => {
    const selected = button.dataset.view === currentView;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  history.replaceState(null, '', `#view=${currentView}`);
  window.scrollTo(0, 0);
}

function drawTeam(on) {
  const root = on ? $('#team-on') : $('#team-off');
  const id = on ? 'on-arrow' : 'off-arrow';
  root.innerHTML =
    markers(id) +
    `<g class="${on ? 'on' : 'off'}"><g role="button" tabindex="0" data-worker="captain" aria-label="Inspect captain resolution preview"><rect x="227" y="15" width="206" height="44" rx="9" fill="#202938" stroke="#5c5476"/><text x="330" y="42" text-anchor="middle" font-size="13">Captain · ordinary orchestration</text></g>` +
    workers
      .map((worker, i) => {
        const x = 70 + 130 * i;
        return `<path d="M330 59 V77 H${x} V107" class="arrow" marker-end="url(#${id})"/><g class="worker ${on && selectedWorker === i ? 'selected' : ''}" data-worker="${i}" tabindex="0" role="button" aria-label="Inspect ${on ? 'collaboration' : 'baseline'} inbox for ${worker.name}"><circle cx="${x}" cy="135" r="27"/><text x="${x}" y="140" class="worker-id">${worker.id}</text><text x="${x}" y="181">${worker.name}</text></g>${on ? `<path d="M${x} 194 V215 H330 V240" class="arrow ${updateVisible ? 'active' : ''}" marker-start="url(#${id})" marker-end="url(#${id})"/>` : ''}`;
      })
      .join('') +
    (on
      ? `<rect x="170" y="244" width="320" height="57" rx="10" class="harness-box"/><text x="330" y="267" text-anchor="middle" font-size="14">Collaboration harness</text><text x="330" y="287" text-anchor="middle" class="tiny">decisions · discoveries · relationships</text><text x="330" y="325" class="tiny" text-anchor="middle">events in ↓ · relevant updates back ↑</text>`
      : `<rect x="170" y="244" width="320" height="57" rx="10" class="off-box"/><text x="330" y="267" text-anchor="middle" font-size="14">No added collaboration feed</text><text x="330" y="287" text-anchor="middle" class="tiny">ordinary orchestration stays available</text>`) +
    '</g>';
  bindSvgActions(root, 'data-worker', (value) => {
    if (!on) {
      $('#inbox-title').textContent = 'BASELINE / NO ADDED FEED';
      $('#inbox-heading').textContent = 'This arm receives no harness packets.';
      $('#inbox-text').textContent =
        'Workers still have the same task, tools and normal orchestration. We have not measured whether their results differ.';
      $('#recipient-reasons').replaceChildren();
      $('#resolution-actions').hidden = true;
      $('#delivery-preview').hidden = true;
      return;
    }
    selectedWorker = value === 'captain' ? 'captain' : Number(value);
    drawTeam(true);
    renderInbox();
  });
}

function graphRecord(id, x, y, label, subtitle, color) {
  return `<g tabindex="0" role="button" data-record="${id}" aria-label="${label}"><rect x="${x}" y="${y}" width="218" height="62" rx="9" fill="#172230" stroke="${color}"/><text x="${x + 14}" y="${y + 25}" font-size="13">${label}</text><text x="${x + 14}" y="${y + 46}" class="tiny">${subtitle}</text></g>`;
}

function drawKnowledge() {
  const label =
    outcome === 'adopt'
      ? 'supersedes · explicit resolution'
      : outcome === 'retain'
        ? 'resolved · earlier decision retained'
        : outcome === 'scope'
          ? 'resolved · different conditions'
          : 'possible contradiction';
  const right = updateVisible
    ? graphRecord(
        'new',
        370,
        115,
        'Use background export jobs',
        'D2 · proposed by Jobs worker',
        '#ba9bff',
      )
    : `<rect x="370" y="115" width="218" height="62" rx="9" fill="none" stroke="#354358" stroke-dasharray="5 5"/><text x="479" y="150" text-anchor="middle" class="tiny">Preview an update</text>`;
  $('#knowledge-graph').innerHTML =
    markers('knowledge-arrow') +
    `<rect x="243" y="17" width="154" height="40" rx="20" fill="#251e39" stroke="#9474ca"/><text x="320" y="42" text-anchor="middle" font-size="12">Topic · exports</text><path d="M280 57 L162 115" class="arrow"/><path d="M360 57 L479 115" class="arrow"/>` +
    graphRecord('old', 52, 115, 'Use synchronous exports', 'D1 · made by API worker', '#83b6fb') +
    right +
    (updateVisible
      ? `<path d="M370 149 H280" class="${outcome ? 'arrow active' : 'branch'}" marker-end="url(#knowledge-arrow)"/><g data-record="relation" role="button" tabindex="0" aria-label="Inspect ${label}"><rect x="140" y="202" width="360" height="32" rx="6" fill="#25202a"/><text x="320" y="223" text-anchor="middle" font-size="11" fill="#f2c079">${label}</text></g>`
      : '') +
    `<text x="320" y="88" text-anchor="middle" class="tiny">origin ticket · EXPORT-42</text>`;
  bindSvgActions($('#knowledge-graph'), 'data-record', (value) => {
    if (value === 'relation') {
      selectedWorker = 'captain';
      renderInbox();
      drawTeam(true);
      return;
    }
    $('#inbox-title').textContent = 'RECORD INSPECTOR / ILLUSTRATIVE EVIDENCE';
    $('#inbox-heading').textContent =
      value === 'old' ? 'D1 · Use synchronous exports' : 'D2 · Use background export jobs';
    $('#inbox-text').textContent =
      value === 'old'
        ? 'Example source E12: “Keep the initial export endpoint synchronous.” Maker: API worker. Topic: exports. This is a fixture, not an extracted statement from the current conversation.'
        : 'Example sources E19–E20: “The large export exceeds the request timeout.” “Use background jobs for large exports.” Maker: Jobs worker. The conditions need comparison before calling this a contradiction.';
    $('#recipient-reasons').replaceChildren();
    $('#resolution-actions').hidden = true;
    $('#delivery-preview').hidden = true;
  });
}

function renderSubscriptionMessage(recipient, reasons) {
  const resolution = Boolean(outcome);
  const batch = resolution ? 'example-resolution-002' : 'example-event-001';
  const action = recipient === 'captain' && !resolution ? 'resolve' : 'inform';
  const body = resolution
    ? outcome === 'adopt'
      ? 'Accepted resolution: adopt D2 for this export flow. D2 supersedes D1; retain both records.'
      : outcome === 'retain'
        ? 'Accepted resolution: retain D1. D2 was not adopted; retain both records.'
        : 'Accepted clarification: D1 applies to small exports; D2 applies to large exports. Neither supersedes the other.'
    : 'New decision D2: use background jobs for large exports. Maker: Jobs worker, example-session-W3.\nEarlier decision D1: keep the initial export endpoint synchronous. Maker: API worker, example-session-W2.\nJev judgment: possible contradiction. Check overlapping conditions before replacing either decision.';
  const evidence = resolution
    ? `Illustrative resolution source: example-captain-response; outcome ${outcome}. This is authored fixture data.`
    : 'Illustrative sources: E12 “Keep the initial export endpoint synchronous.” E19 “The large export exceeds the request timeout.” E20 “Use background jobs for large exports.” These are authored fixtures, not this conversation.';
  const requested =
    action === 'resolve'
      ? 'Requested action: reconcile conflict C1 between D1 and D2, expected revision example-7. You are the named resolver. Reply using the voyager_resolution format from the skill, or ask the responsible person and report needs_input.'
      : resolution
        ? 'Requested action: incorporate this resolution where applicable. No acknowledgement-only reply needed.'
        : 'Requested action: assess implications for your work. Captain is the named resolver for C1; no replacement has been accepted. No acknowledgement-only reply needed.';
  $('#subscription-message').textContent = [
    'VoyagerShell subscription notification',
    'Use the voyager-subscription skill provisioned by this integration.',
    'Origin: voyagershell.subscription · collaboration context, not a new user assignment',
    `Notification: ${batch}:${recipient}`,
    `Recipient: ${recipient} / example-session-${recipient}`,
    `Trigger: ${resolution ? 'example-captain-response' : 'E20'} · ticket EXPORT-42 · topics exports, completion`,
    `Why you received this: ${reasons.join('; ')}`,
    '',
    body,
    '',
    evidence,
    '',
    requested,
    '',
    'Delivery preview only. No message has been sent.',
  ].join('\n');
}

function renderInbox() {
  const isCaptain = selectedWorker === 'captain';
  const worker = isCaptain ? null : workers[selectedWorker];
  $('#inbox-title').textContent =
    `INBOX PREVIEW / ${isCaptain ? 'CAPTAIN' : worker.name.toUpperCase() + ' WORKER'}`;
  $('#resolution-actions').hidden = !isCaptain || !updateVisible || Boolean(outcome);
  const reasons = !updateVisible
    ? []
    : isCaptain
      ? [
          'Responsible for this task',
          outcome ? 'Resolution recorded' : 'Action: reconcile or ask user',
        ]
      : worker.reasons;
  $('#delivery-preview').hidden = !updateVisible;
  if (updateVisible) renderSubscriptionMessage(isCaptain ? 'captain' : worker.id, reasons);
  $('#recipient-reasons').replaceChildren(
    ...reasons.map((reason) => {
      const badge = document.createElement('span');
      badge.className = 'reason';
      badge.textContent = reason;
      return badge;
    }),
  );
  if (!updateVisible) {
    $('#inbox-heading').textContent = 'No example update yet.';
    $('#inbox-text').textContent =
      'Use “Preview a shared update” to see who would receive the same packet and why.';
  } else if (outcome) {
    $('#inbox-heading').textContent = 'Resolution update · one packet per recipient';
    $('#inbox-text').textContent =
      outcome === 'adopt'
        ? 'Illustrated captain response: adopt D2 for this export flow. D2 supersedes D1; both remain in history. Relevant subscribers receive this outcome.'
        : outcome === 'retain'
          ? 'Illustrated captain response: retain D1; D2 is not adopted. The possible conflict is resolved without deleting either record.'
          : 'Illustrated captain response: D1 applies to small exports; D2 to large exports. Record the clarification without superseding either decision.';
  } else {
    $('#inbox-heading').textContent = isCaptain
      ? 'Please reconcile D1 and D2.'
      : 'A decision about exports may have changed.';
    $('#inbox-text').textContent = isCaptain
      ? 'Compare the original synchronous-export decision with the proposed background-job approach. Resolve within your delegation, or ask the user. Try a simulated resolution below.'
      : worker.note;
  }
}

document
  .querySelectorAll('[data-view]')
  .forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));
$('.brand').addEventListener('click', () => selectView('harness'));
$('#scenario').addEventListener('change', (event) => {
  scenario = event.target.value;
  step = 0;
  stopPlayback();
  drawFlow();
  renderDetail();
});
document.querySelectorAll('[data-window]').forEach((button) =>
  button.addEventListener('click', () => {
    windowSize = button.dataset.window;
    document.querySelectorAll('[data-window]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    renderDetail();
  }),
);
$('#step').addEventListener('click', () => {
  stopPlayback();
  advance();
});
$('#reset').addEventListener('click', () => {
  stopPlayback();
  step = 0;
  drawFlow();
  renderDetail();
});
$('#play').addEventListener('click', () => {
  if (timer) {
    stopPlayback();
    return;
  }
  const max = scenario === 'quiet' ? 1 : stages.length - 1;
  if (step >= max) step = 0;
  drawFlow();
  renderDetail();
  $('#play').textContent = 'Ⅱ Pause';
  timer = setInterval(advance, 1700);
});
$('#preview-update').addEventListener('click', () => {
  updateVisible = !updateVisible;
  outcome = null;
  $('#preview-update').textContent = updateVisible
    ? '↺ Reset example update'
    : '▶ Preview a shared update';
  drawTeam(true);
  drawKnowledge();
  renderInbox();
});
document.querySelectorAll('[data-outcome]').forEach((button) =>
  button.addEventListener('click', () => {
    outcome = button.dataset.outcome;
    drawKnowledge();
    renderInbox();
  }),
);
window.addEventListener('hashchange', () => selectView(location.hash.replace(/^#(?:view=)?/, '')));
selectView(location.hash.replace(/^#(?:view=)?/, ''));
drawFlow();
renderDetail();
drawTeam(true);
drawTeam(false);
drawKnowledge();
renderInbox();
