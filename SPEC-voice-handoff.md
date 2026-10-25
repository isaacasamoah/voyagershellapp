# Spec: voice acknowledgement and result handoff

Module id: `voice-handoff`. Project: VoyagerShellApp. Approved by the owner, 24 October 2026. The owner authorized the approved voice build after docking merged on 25 October 2026.
The [capability map](SPEC.md) is approved. The owner approved this specification and requested planning. The approved implementation plan and task list now cover this module.

## Objective and scope

When the owner asks Voyager's private app conversation to inspect something or take an action, it says that it heard the request, explains what it will do, and reports the actual result. The owner should not be left wondering whether a long-running request was heard. The result must remain readable if audio fails.

This change covers the floating app conversation and the Codex runtime that performs its work. A docked terminal uses its own native voice connection. Preserve and test that routing, but do not claim that changing the private app conversation fixes terminal voice. This module adds no permissions, models, ranks or tools.

The [source inspection](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/src/service/conversation.rs) found that Voyager disables Codex's built-in acknowledgement when voice hands work to the backing runtime. It did not explain every missing spoken answer. The generated protocol definitions for Codex 0.163.0 include controls for acknowledgement and automatic return of results. Their presence does not prove that they work in Voyager. Recheck the installed version's protocol definitions before implementation.

## Behavior and boundary contract

1. When a request needs the backing model or tools, give a short spoken acknowledgement after the user finishes speaking. Say what will happen, for example "I'll check the running agents." Do not claim inspection has started or finished before it has. Ordinary conversation answered directly does not need an extra acknowledgement.
2. Keep Codex's built-in mechanism for returning results to voice. First enable its supported acknowledgement setting and give explicit instructions for responses the user should hear or read. Do not add another independent mechanism that announces completion. If the result arrives quickly, it can follow the acknowledgement without a separate progress update.
3. While work runs, give short progress updates only when there is a real stage or finding to report. A timer may say that no result has arrived yet, but must not invent progress such as "finishing touches." Sending a progress update must never start another copy of the task.
4. When work ends, report the answer or what the action actually did, any important limits, and any next action. A tool's operation record proves only what it records. If the model turn failed or was interrupted, report that outcome instead of claiming success. If it finishes without an answer, show "Finished without an answer". That counts as a failed test for an ordinary request expected to succeed.
5. Save the final text in the existing private conversation history. If audio is unavailable, show that the result is ready to read. Requesting or decoding audio does not prove that it was spoken.
6. Respect interruptions. Do not play a queued update over the user. If a newer request replaces an earlier one, retain the earlier result in history but do not announce it late without being asked. Do not silently cancel or repeat the underlying action. When multiple requests remain relevant, track each with a separate request identifier.
7. If the desktop loses its voice lease, meaning its right to use the active voice connection, stop audio and retire that connection's generation. A generation identifies that particular voice connection. Keep the backing runtime operating under its existing rules. Reconnecting must not replay old audio, resend a command or claim the user heard an earlier result.

Use the existing identifiers for requests, native model turns, response items and voice clients. Associate each acknowledgement, progress update and result with its request or native turn and the current voice generation. If that association is unknown, do not announce it as another request's completion. Use the native response item's identifier to recognise repeated final events and prevent duplicate speech.

The [official app-server contract](https://learn.chatgpt.com/docs/app-server) distinguishes a turn ending from whether it completed successfully, failed or was interrupted. Validate events as they arrive from Codex and check the reported outcome. Show public progress messages, not the model's private reasoning.

Begin with `delegationAckFiller: true` and Codex's automatic handoff, leaving client-managed handoffs disabled. Protocol support alone is not enough; test the actual behavior. If the final answer is still not spoken, identify where delivery failed and test the supported routing before proposing a limited fallback. Any fallback must have one component responsible for delivery and must prevent duplicate announcements. This spec does not approve a second custom delivery channel, a general notification framework or an extra model call just to announce completion.

## Source ownership, stack and style

Use the existing Rust 2024 service, Codex app-server adapter and Electron 44.7.0 / Node 24 client. Record the exact Codex version used in testing. The earlier protocol definitions are a reference; they do not establish that every installed version behaves the same way.

- `src/service/conversation.rs` owns provider requests, public events and private runtime state. `conversation_tools.rs` continues to dispatch existing tools.
- `desktop/src/conversation.cjs` owns the service client; `desktop/src/ui/conversation.js` owns the visible conversation, microphone and playback.
- `src/service/voice.rs` owns routing between private and native destinations. The existing escalation presenter remains separate.
- Extend `tests/conversation.rs`, its simulated provider and `desktop/test/conversation.test.cjs`. The existing behavior is documented in [harness-runtime.md](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/harness-runtime.md), with voice routing in [voice.md](https://github.com/isaacasamoah/voyagershellapp/blob/fcffc1a23189414c5640a3792335221ae3b25085/docs/voice.md).

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

Normal tests use simulated responses and make no model calls. The existing conversation test is documented in harness-runtime.md, but its silent playback does not prove that the user can hear a response. Before a real model or microphone trial, the later plan must identify the input, output device, app and service revisions, and authorized isolated test state.

## Success criteria and verification

| Id | Case and required evidence |
|---|---|
| V1 | Ask voice to hand an inspection request to the backing runtime. Hear both an acknowledgement and an answer based on the actual inspection result. The answer must also remain in the visible history. |
| V2 | Make a tool take longer to finish. Hear the acknowledgement before its result. Any update in between must describe observed progress or honestly say that Voyager is waiting. |
| V3 | Test a refused tool request, a Codex failure and a user interruption. Report each outcome accurately, without claiming success or automatically submitting the request again. |
| V4 | Deliver duplicate completion events. Show one final response item and speak it at most once. If a newer request replaces an earlier one, do not speak the earlier request's late result as the current answer. |
| V5 | Disconnect during work, reconnect, and let the original model turn finish. Its result must be readable. Do not replay old audio or commands. |
| V6 | While the user speaks, defer queued progress updates and results. Test interruption using a real microphone and audible playback. |
| V7 | Stop audio or prevent playback. Keep the result visible and show a useful status. The service must remain responsive and the backing runtime must keep running. |
| V8 | Switch between the private app conversation, docked Codex and Bash. Voice must follow the correct destination. A private app result must never be sent into a Vessel's conversation. |

Use simulated events to test arrival order, duplicates, outdated events, failures and disconnects. Use a real native conversation to test acknowledgement wording, result delivery and interruption. As a comparison, run the same delegated request with acknowledgement disabled. The test must distinguish a missing acknowledgement from a result that simply takes longer to arrive.

The owner approved these local timing targets. Live measurement is still required. Run 20 successful delegated requests on a quiet, active voice connection. For at least 19, the acknowledgement must begin within one second after the system detects that the user stopped speaking, and the final spoken answer must begin within two seconds after the backing model turn finishes. All 20 must deliver the correct result without duplicate speech or an answer belonging to the wrong request.

Measure separately how long the system takes to detect that the user stopped speaking. When measuring the delay before the final answer, exclude time spent waiting because the user is speaking, and report that excluded time explicitly.

Record when input is recognised, work is handed to the backing runtime, acknowledgement audio begins, the backing turn finishes, and final-answer audio begins. Associate those times with the correct request without saving credentials or private reasoning. Confirm playback by listening or recording the system's audio output. Decoded audio and event records are supporting evidence, not proof of audible playback by themselves.

## Boundaries and review decisions

Keep the existing rules for who may use each tool. Do not present submitted work as completed work. Keep the result readable when audio fails.

Review any proposal for a custom result-delivery channel or a change to native terminal voice before implementing it. Never expose private reasoning, invent progress, automatically retry an action with an uncertain outcome, or enable two competing ways to announce the same result.

The local timing targets are approved and still require live proof. Codex's automatic result delivery must pass the required cases. If it cannot, report the specific limitation and revise the design before declaring this capability complete. Restoring the private conversation after a service restart remains outside this increment.
