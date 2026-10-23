# Spec: voice acknowledgement and result handoff

Module id: `voice-handoff`. Project: VoyagerShellApp. Draft for review, 24 October 2026.
The [capability map](SPEC.md) is approved. This specification awaits review before planning or implementation.

## Objective and scope

When the owner asks Voyager's private app conversation to inspect or act, it acknowledges the request and reports the actual result. A long-running request does not leave him wondering whether it was heard. The result remains readable if audio fails.

This increment covers the floating app conversation and its backing Codex runtime. A docked terminal uses a separate native voice path. Preserve that routing and test it, but do not claim that changing private-conversation instructions fixes native terminal voice. No permission, model, rank or tool-catalog expansion is part of this module.

The [source inspection](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/src/service/conversation.rs) established that Voyager disables native delegation acknowledgement. It did not establish the cause of every missing spoken final. Protocol inspection used Codex 0.163.0 generated schemas. It found acknowledgement and native automatic handoff controls; their presence is not behavioral proof. Recheck the installed provider schema before implementation.

## Behavior and boundary contract

1. For a request requiring the backing model or tools, speak a short acknowledgement when the user finishes speaking. Say what will happen, for example "I'll check the running agents." Do not claim inspection has started or finished before it has. Ordinary direct conversation does not need an extra handoff acknowledgement.
2. Keep native automatic return handoffs. Initially enable the supported acknowledgement control and give explicit public-response instructions. Do not introduce a second independent completion announcer. A fast final can follow a brief acknowledgement without a separate progress message.
3. While work runs, publish concise progress only when grounded in a real stage or finding. A timer may report that no result has arrived; it must not invent progress such as "finishing touches." Progress never starts another copy of the task.
4. On completion, return the answer or actual action outcome, its material limits and any next action. A tool receipt proves only what it reports. A failed or interrupted turn returns that outcome rather than a success summary. An empty completion leaves a visible "Finished without an answer" status and is a failed acceptance case for an ordinary successful request.
5. Preserve the final text in the existing private conversation history. If audio is unavailable, show that the result is ready to read. Do not claim it was spoken merely because audio was requested or decoded.
6. Respect user interruption. Do not talk over the user with a queued update. If a newer request supersedes an earlier one, keep the earlier outcome in history but suppress its unsolicited late announcement. Do not silently cancel or resubmit its underlying action. Concurrent relevant work needs distinct request identities.
7. Losing the desktop voice lease stops audio and retires that voice generation. The backing runtime continues under its existing rules. Reconnection does not replay old audio, resend a command or claim a previous result was heard.

Use the existing request, native turn, item and voice-client identities. Correlate each acknowledgement/progress/result with the request or native turn and current voice generation. An unknown association cannot announce completion of another request. Deduplicate repeated final events by native item identity; duplicate delivery must not become duplicate speech.

The [official app-server contract](https://learn.chatgpt.com/docs/app-server) distinguishes turn completion from its completed, failed or interrupted status. The adapter must validate provider events at ingress and inspect that outcome. Raw reasoning is not part of this contract. Public progress messages are sufficient.

A supported protocol is necessary but insufficient. Begin with `delegationAckFiller: true` and native automatic handoff, leaving client-managed handoffs disabled. If final speech remains missing, locate the failed stage and test supported routing before proposing a bounded fallback. Any fallback must have a single delivery owner and preserve deduplication. This spec does not approve a parallel custom transport, general notification framework or new model call merely to announce completion.

## Source ownership, stack and style

Use the existing Rust 2024 service, Codex app-server adapter and Electron 44.7.0 / Node 24 client. Pin the actual provider version in test evidence; the earlier schema is a reference, not a claim that all installed versions behave alike.

- `src/service/conversation.rs` owns provider requests, public events and private runtime state. `conversation_tools.rs` continues to dispatch existing tools.
- `desktop/src/conversation.cjs` owns the service client; `desktop/src/ui/conversation.js` owns the visible conversation, microphone and playback.
- `src/service/voice.rs` owns routing between private and native destinations. The existing escalation presenter remains separate.
- Extend `tests/conversation.rs`, its provider fixture and `desktop/test/conversation.test.cjs`. The owning context is [harness-runtime.md](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/harness-runtime.md), with [voice.md](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/voice.md) for routing.

Follow [CONTRIBUTING](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/CONTRIBUTING.md), including small functions, explicit states and comment-free changed source. Existing [conversation UI](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/desktop/src/ui/conversation.js) keeps user-visible feedback explicit:

```javascript
function feedback(message) {
  $('chat-status').textContent = message || '';
  $('chat-status').hidden = !message;
  if (!docked) toggle.title = message || (status.voice === 'on' ? 'Stop voice' : 'Start voice');
}
```

## Commands

Run from the selected worktree root when implementation is authorized:

```sh
cargo build --locked --bins
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
npm --prefix desktop ci
npm --prefix desktop run format:check
npm --prefix desktop test
node --test desktop/test/conversation.test.cjs
```

Normal tests use fixtures and make no model calls. The existing conversation proof is documented in harness-runtime.md, but its silent playback does not meet audible acceptance. The later plan must specify the real input, output device, app/service revisions and authorized isolated state before running a model or microphone trial.

## Success criteria and verification

| Id | Case and required evidence |
|---|---|
| V1 | A delegated inspection produces an audible acknowledgement and an audible answer grounded in the actual result. The visible history retains the answer. |
| V2 | A delayed tool produces acknowledgement before its result. Any intermediate message describes observed progress or honest waiting. |
| V3 | Tool refusal, provider failure and user interruption produce the right outcome, without success language or automatic resubmission. |
| V4 | Duplicate completion events produce one final item and at most one spoken announcement. A late result from a superseded request is not spoken as the current answer. |
| V5 | Disconnect during work, reconnect and complete the original turn. Its result is readable; old audio and commands are not replayed. |
| V6 | While the user speaks, defer queued progress/results. Verify interruption with real microphone input and audible playback. |
| V7 | Stop audio or deny playback. Preserve a visible result and useful status. The service stays responsive and the backing runtime is not stopped. |
| V8 | Switch between private conversation, docked Codex and Bash. Audio still belongs to the correct destination; a private result is never injected into a Vessel. |

Use fixture events for ordering, duplicate, stale, failure and disconnect cases. Use a real native conversation for acknowledgement wording, actual result delivery and interruption. The known-different control is the same delegated request with acknowledgement disabled; it must distinguish missing acknowledgement from slow completion.

Proposed local timing budgets: for 20 successful delegated requests on a quiet active voice connection, at least 19 begin acknowledgement within one second of detected speech end and begin their final spoken answer within two seconds of backing-turn completion. All 20 must deliver the correct result without duplicate or wrong-request speech. Report speech-end detection latency separately from the user's physical end of speech. Exclude user-speaking intervals from the final-delivery delay and report them explicitly. These budgets await approval and live measurement.

Capture timestamps for recognized input, delegation, acknowledgement audio onset, backing completion and final audio onset. Correlate them without saving credentials or private reasoning. Decoded audio and event receipts supplement human or loopback confirmation; they do not establish audible playback alone.

## Boundaries and review decisions

Always preserve existing tool authorization, distinguish submitted work from completed work, and retain readable outcomes when audio fails. Seek review before a custom return transport or a change to native terminal voice. Never expose private reasoning, fabricate progress, automatically retry an uncertain action or enable two competing result-announcement paths.

Review the proposed timing budgets. Native automatic delivery must pass the required cases; if it cannot, report the specific limitation and revise the design before calling this capability complete. Persistent private-conversation recovery across service restart remains outside this increment.
