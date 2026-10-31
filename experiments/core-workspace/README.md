# Voyager Core workspace prototype

An isolated Electron workspace connected to Herdr Core's Rust runtime. Realms
contain dimensions, and dimensions contain recursively split portals. Each portal
displays a real Core-owned terminal. This experiment does not replace the installed
Voyager app or its service.

Use Node 24, a working Linux desktop, `hc` 0.1.15 on PATH, and a signed-in `codex`
0.166.0 for chat and voice. From this directory:

```sh
npm ci
npm start
```

The default dedicated Core session is `voyager-workspace`. Reopening attaches to
its existing terminals and layout. Closing the viewer leaves those processes
running. The power button explicitly quits this session and stops its programs.
Stopped programs remain ended on the next launch. New shell is an explicit action.
No agent task is replayed automatically. Chat uses its own private, ephemeral
Codex conversation, separate from terminal agents and the installed Voyager chat.

Use `VOYAGER_WORKSPACE_SESSION=voyager-another-name` for another isolated trial.
`VOYAGER_WORKSPACE_CWD` selects the initial folder. `VOYAGER_HC` and
`VOYAGER_CODEX_BIN` select executable paths. Starting again with the same desktop
profile restores its existing window.

## Try the interface

- Add a realm with its starting folder. Double-click a realm or dimension to rename it.
- Add dimensions with the tab bar's plus button. Split a portal horizontally or vertically.
- Drag a divider, or focus it and use the arrow keys. Each portal has independent shell input.
- Click Voyager to minimize the native app. Collapse the sidebar to dock it beside the active dimension.
- Double-click a portal's diamond to bring Voyager there. Home or Ctrl+1 returns it to the top left.
- Open chat with Ctrl+J. Ask Voyager to inspect the workspace, create a dimension,
  run a command in a selected shell, read its output, or interrupt/stop that process.
- The microphone button starts native realtime voice. It stays off until requested.
- Hiding a portal keeps its process. Open running processes at the bottom of the sidebar to show or stop it.

Ctrl+B toggles the sidebar. Ctrl+backslash splits side by side; adding Shift splits
top and bottom. Ctrl+Shift+C copies a terminal selection. Keyboard labels also
accept the Command modifier on platforms that provide it, but this build has only
been tried on Linux.

## Boundaries and sources

Core owns PTYs, screens and program lifetime. Electron renders xterm.js, stores
layout through Core's versioned document API, and exposes named workspace/process
operations to its private Codex conversation. It does not parse terminal output
into invented task-completion claims. A failed layout save gates later layout
mutations until a deliberate viewer reconnect reconciles persisted state.

Core trusts clients with local-account access. A separate session protects unrelated
work from this prototype's lifecycle operations; it is not an authentication or
rank boundary. Voyager's Captain/Crew assignment policy and bound same-turn native
steering are not ported. Core interruption uses the agent's stop key before a
separate instruction. That difference remains a design question for integration.

The prototype uses the published API without copying upstream implementation:

- [Core README and API, pinned source](https://github.com/herdrdev/herdr-core/blob/4a3591aa835c197f57a5d1b8e8951a75e2a79faa/README.md).
- [Framed transport](https://github.com/herdrdev/herdr-core/blob/4a3591aa835c197f57a5d1b8e8951a75e2a79faa/crates/herdr-core/src/wire.rs).
- [Server scheduling](https://github.com/herdrdev/herdr-core/blob/4a3591aa835c197f57a5d1b8e8951a75e2a79faa/crates/herdr-core/src/server.rs)
  and [local attach](https://github.com/herdrdev/herdr-core/blob/4a3591aa835c197f57a5d1b8e8951a75e2a79faa/crates/herdr-core/src/api.rs).
  This pinned implementation handles attach synchronously on its single-thread
  runtime and prioritizes control replies before queued screen frames. The client
  reserves the returned channel before its asynchronous attach continuation runs.
- [xterm.js terminal API](https://xtermjs.org/docs/api/terminal/classes/terminal/).
- [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

Herdr Core is separately installed Apache-2.0 software. Electron and xterm retain
their own package licenses. This prototype does not bundle Core or copy its code.

## Checks and evidence

```sh
npm test
npm run format:check
npm audit
python prove.py --launch --journey --chat --voice
```

The native runner requires Python Playwright and xdotool. Run it from a desktop
terminal so it inherits the display environment. It uses a separate proof Core
session, synthetic microphone, a local debugging port and a real Codex model
request. Keep that debugging launch for proofs, and use ordinary `npm start` for
the human trial. Evidence stays in ignored `evidence/`, outside implementation
commits. `--session voyager-name` selects a fresh proof session explicitly.

The tests cover actual Core output, detach/reattach and absent-target refusal;
failed-save isolation; known versus uncertain chat starts; and late stream frames.
The native journey drives real input, splits, resize, tabs, realms, docking,
minimize/restore and a real chat effect. Voice proof establishes a connected WebRTC
peer with synthetic microphone input, not human speech recognition or audible
playback. Human UX, full native-agent coordination, sustained load, macOS and
Windows remain unproved. This is a prototype for inspection, not release acceptance.
