# Voyager's own conversation: experiment

This opt-in experiment tests a private Codex runtime and an independent Electron
conversation. It does not change normal Voyager startup, add a Vessel, connect to
an existing terminal or give this conversation orchestration tools.

## Run

Requires the installed Codex CLI, an existing Codex sign-in and the desktop's
Electron dependencies (`cd desktop && npm ci`). From the repository root:

```sh
cargo build --locked --example harness-runtime
cargo run --locked --example harness-runtime -- --proof
```

The proof starts a real terminal-free app server, requests a computed answer,
checks successful completion and an invalid-request failure, then reaps its child.
It consumes one model turn. Its private reasoning method has no frontend IPC or
Voyager CLI action. This is product-interface privacy, not isolation from the
computer's owner or other processes running as that user.

To open the conversation window from the repository root:

```sh
VOYAGER_RUNTIME_PROBE="$PWD/target/debug/examples/harness-runtime" \
VOYAGER_EXPERIMENT_PROFILE="$(mktemp -d)" \
  desktop/node_modules/.bin/electron desktop/experiments/harness/main.cjs
```

Type a question, or press **Start voice** and speak. **Stop voice** stops the
microphone and call. Closing this experimental window ends its Rust harness and
Codex child. Its ephemeral conversation is not durable memory. It leaves regular
Voyager services and terminal sessions alone.

## Ownership

```text
Internal reasoning: Rust method → owned pipes → Codex app server → completed result
User text: Electron renderer → named preload IPC → main → Rust → Codex turn
Voice control: same route → thread/realtime/start with a WebRTC offer
Audio: Electron RTCPeerConnection ↔ Codex-negotiated voice service
```

`examples/harness-runtime/main.rs` owns the child, JSONL framing, bounded waits and
Codex requests. The frontend receives only chat and voice start/stop operations;
it cannot select arbitrary app-server methods. The separate Electron main,
preload and renderer live in `desktop/experiments/harness/`. Context isolation,
renderer sandboxing, sender checks and restrictive local content policy remain on.
Codex reads its own sign-in; credentials never enter the renderer.

Private reasoning and user conversation are distinct uses. The current proof runs
the private method separately; the window starts its own conversation. Combining
both beneath the regular Voyager service remains a later change. None of this
proves automatic invocation by production harness code.

## Observed on 18 October 2026

Fedora, stock Codex 0.163.0 and Electron 44.7.0, with ChatGPT sign-in:

- Rust received the correct answer and `turn/completed`, then reaped Codex.
- Text entered through Electron returned an actual completed Codex reply.
- WebSocket realtime failed with `realtime conversation requires API key auth`.
- WebRTC realtime v3 connected with that same ChatGPT account, without an API key
  or terminal interface. An electronically generated speech sample was
  transcribed and non-silent returned audio was decoded in Electron.
- Muted-media RTP `totalAudioEnergy` remained zero despite decoded sound. The
  corrected instrument measured the actual decoded waveform; packet arrival
  alone was insufficient proof.

Human microphone input, audible speaker playback, interruption and conversational
quality remain user tests. The automated speech fixture is a transport test, not
human voice acceptance. Other accounts, plan entitlements, operating systems,
providers and future Codex versions are unproved. The realtime methods are
experimental; the successful local account is not an availability guarantee.

## Reproduce the desktop probe

Generate a harmless input fixture and use a new evidence directory:

```sh
proof_dir="$(mktemp -d)"
espeak-ng -w "$proof_dir/input.wav" 'Hello Voyager. What is two plus two? Please answer briefly.'
VOYAGER_RUNTIME_PROBE="$PWD/target/debug/examples/harness-runtime" \
VOYAGER_EXPERIMENT_PROFILE="$proof_dir/profile" \
VOYAGER_EXPERIMENT_EVIDENCE="$proof_dir" \
VOYAGER_EXPERIMENT_AUDIO="$proof_dir/input.wav" \
  desktop/node_modules/.bin/electron desktop/experiments/harness/main.cjs --proof
```

The probe performs one text turn, opens voice without the microphone, sends the
fixture and measures decoded return audio with silent playback. It writes JSON
observations and a screenshot, stops voice and leaves the window open for a human
trial. Evidence stays outside the repository. There is no automatic retry after
an uncertain turn. This probe does not claim the entire spoken answer completed.

Read [OpenAI's app-server contract](https://learn.chatgpt.com/docs/app-server).
Voice request shapes were generated from the installed binary using
`codex app-server generate-json-schema --experimental`; the authentication-path
choice was checked against the unmodified realtime source at upstream revision
`83086188ae0614bd882818ff1aa23f3194962012` (`rust-v0.163.0`).

## Escalation presentation follow-up

`skills/present-escalation/SKILL.md` is a draft presentation skill for this runtime.
It takes an original escalation and supplied writing guidance, and explains the
issue without changing its meaning or approving it. A separate live model trial
used it with recorded requests; the normal application does not load it yet.

The proposed integration presents human questions in the same conversation and
binds explicit replies to the existing service adjudication operation. Voice
scheduling and stale-request removal still need an integrated desktop test.
The skill grants no service permissions and never substitutes for service policy.
