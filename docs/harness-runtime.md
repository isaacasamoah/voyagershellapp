# Voyager conversation

The Rust service starts its own Codex app server by default. It has no terminal,
Vessel rank or worker registration. Electron connects the existing glass avatar
and panel to this private conversation.

The panel bottom always shows a subtle chat composer. Messages expand above it;
the small chevron hides or shows that history. The soundwave icon,
opposite the avatar's status dot, starts or stops voice. Opening the app does not
activate the microphone. Voice can remain active while the panel is hidden.

## Run and lifecycle

Build Rust and install the desktop dependencies as usual:

```sh
cargo build --locked --bins
cd desktop
npm ci
npm start
```

Codex must be installed and signed in. `VOYAGER_CODEX_BIN` selects its executable.
A missing provider makes the conversation unavailable while ordinary service
operations remain usable. No model request is made merely by starting the app.

Starting Voyager again reuses the running service and its private runtime.
Closing Electron stops its microphone and voice attachment; the conversation
runtime and Vessels keep running. Reopening the app recovers the same in-memory
conversation. Explicit service shutdown reaps the private runtime, subject to
existing rules requiring Vessels to be stopped first. The private runtime has its
own process group; shutdown kills that group and reaps the provider, including
its helper processes. It never signals the service or another runtime’s group.

This prototype keeps up to 256 recent conversation events in memory, with at most
512 operation receipts per service lifetime. It does not promise conversation
recovery after daemon restart. Private conversation content is not inserted into
Vessel capture or shared knowledge.

## Boundaries

`src/service/conversation.rs` owns the child and bounded protocol reader. A worker
thread handles provider RPCs; the service loop remains available for other work.
The main service owns requests, observations and private conversation state.
Shell and subagent tools are disabled for this runtime, and its sandbox is
read-only. It has named Voyager tools and no public internal-reasoning API. Tool calls use
the same private service operations as the CLI and panel. The runtime acts for the
local owner; it does not gain a worker rank or pass that authority to Vessels.
The bundled `conversation-tools.json` defines the exact tool inputs. Native call
IDs retain their first result; repeats do not repeat an effect.

Owner CLI operations are explicit:

```sh
voyager --state PRIVATE_DIR conversation
voyager --state PRIVATE_DIR conversation AFTER
voyager --state PRIVATE_DIR chat UNIQUE_REQUEST_ID "A question"
voyager --state PRIVATE_DIR chat-operation UNIQUE_REQUEST_ID
```

A chat receipt distinguishes pending delivery, provider acceptance and actual turn
completion. Identical request IDs retrieve their saved receipt; changed inputs
refuse. A disconnected or timed-out request is never automatically replayed.
Instances cannot use the conversation operations, even while docked.

The desktop's `conversation.cjs` uses the same private service socket through
named operations. Preload exposes text and voice start/stop, not arbitrary RPC.
`ui/conversation.js` owns progressive disclosure, microphone and WebRTC playback.
Only the avatar renderer may request audio permission. A held socket binds voice
to that desktop; losing it stops voice without stopping Codex. Negotiation data is
returned only to the attached voice client and excluded from ordinary CLI history.

Text travels through Rust to Codex. Audio travels through Electron's WebRTC
connection after Codex negotiates the call. Credentials remain with Codex. The
installed version's experimental realtime v3 path worked with one
ChatGPT-authenticated account; other accounts, providers and platforms need proof.
Read [the app-server contract](https://learn.chatgpt.com/docs/app-server).

`VOYAGER_WRITING_GUIDELINES` optionally names a UTF-8 instruction file, at most
32 KiB, loaded at service startup. No personal vault path is assumed. Codex's
thread response reports its model and reasoning effort; turns explicitly request
medium effort. These are separate from worker launch settings.

## Checks and live proof

Run the usual Cargo and desktop checks. The conversation integration tests use a
stdio provider fixture to check service responsiveness, idempotency, provider
failure, voice ownership and process cleanup. They make no model calls.

For the opt-in native test, set `VOYAGER_CONVERSATION_PROOF_DIR` to an evidence
directory and `VOYAGER_CONVERSATION_PROOF_AUDIO` to a short speech WAV, then launch
Electron with `--expanded --proof-conversation` against a fresh private service
state. It submits text through the actual panel and a native Enter sequence,
checks icon placement and measures decoded WebRTC return audio. The audio input
is a generated fixture and playback is silent during this test. Human microphone,
audible playback and interruption still require a real user trial on this build.

Set `VOYAGER_CONVERSATION_PROOF_TOOLS=1` and
`VOYAGER_ASSIGNMENT_PROOF_AUDIO` to an explicit test-answer WAV to extend the
proof through a real Codex Vessel, Fleet tools, agent-originated escalation,
rewriting, notification audio and bound spoken reply. It uses only its fresh
state and removes its test Vessel/Fleet afterward. Results remain private.


The standalone experiment window and Rust example were replaced by this shared
implementation. Their historical source remains in Git at `8cfd225`.

## Tools and escalations

Named tools cover service status, Vessel creation, instructions, lifecycle,
captured events, operation receipts, rank/assignments, shell commands and Fleet
creation/membership. Resolve live IDs; do not route by display name alone. Creating
opens Ghostty by default unless background work was requested. Sending to a busy
Vessel steers its current turn. Neither acceptance nor a launch receipt proves
completion. Ordinary instance callers cannot access the private conversation.

Owner escalations are presented inside chat. A separate ephemeral thread with no
Voyager tools applies `skills/present-escalation/SKILL.md` and the configured
writing guidelines. The concise explanation has the original behind disclosure;
if rewriting fails the source remains available. This thread cannot approve or
reply. The conversation's `voyager_answer` tool forwards the latest actual human
words unchanged, binds the original request and records an ordinary `resolve`
answer. It does not fabricate an approval decision. Ambiguous targets need a
clarifying question. Answer delivery and the agent's work completion stay separate.

Pending explanations are spoken once when app voice is active and quiet. The
current owner request is checked again before appendSpeech. Answered or removed
sources are skipped; uncertain speech is not replayed. Renderer speech-activity
events defer notification speech during a human or assistant utterance. Realtime
transport, microphone and turn-taking still need native/user proof; the scheduler
is not a claim of sample-accurate audio arbitration.

Fleet metadata now has one writer in `service/fleets.rs`. The existing private
fleets.json format is retained. The panel uses named CLI actions through
`desktop/src/fleets.cjs`; it does not edit that file. Fleet membership remains
presentation data and grants no authority.

Native voice takeover between the app and docked terminal agents is the next
increment after this user trial. Desktop thinking mode, collaboration and shared
knowledge are later work.
