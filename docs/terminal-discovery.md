# Ordinary terminal discovery — investigation

12 October 2026. This is a proposed next increment, not implemented support.

## The workflow to prove

Open a terminal normally, start Codex normally, then drop Voyager onto it.
Voyager identifies that exact conversation, registers it and takes interface
control. No special title, injected conversation ID, prepared prompt, or
Voyager-specific shell launch may be required for this acceptance test.

A second entry point is useful: open a native agent interface from Voyager.
That creation belongs to a service operation callable by the panel, CLI and
agents. It must be tested separately; it does not prove recognition of an
existing ordinary terminal.

## Three identities, three boundaries

| Boundary | Required evidence | What does not establish it |
| --- | --- | --- |
| Desktop window → terminal process | Compositor window identity, live process and start time | Title, location, or keyboard focus |
| Terminal → native frontend | Process ancestry and terminal association, with explicit handling of tabs/panes | One direct child, executable name alone, or a matching working directory |
| Frontend → current conversation | Native client metadata or a deliberate, explicit pairing | Latest thread, most recently modified transcript, or the only newly observed thread |

Discovery is read-only. It does not subscribe to conversations, import history,
start model turns, change permissions, or grant control. Registration and
control acquisition occur on intentional docking. Detachment releases control
and records an event; it leaves registration, capture and agent work alone.

## What the current inspection established

- `src/bin/voyager-windows.rs` inventories and positions X11/XWayland windows.
  Native Wayland windows are absent by design. A normally opened Fedora terminal
  can therefore be missing before agent identification even begins. The existing
  GNOME prototype demonstrates compositor integration as a direction; it is not
  integrated with this Electron app.
- `desktop/src/binding.cjs` accepts one Ghostty process with a direct native
  Codex child whose command line supplies an explicit Unix endpoint and fixed
  resume UUID. A shell between the two, a normal `codex` start, or multiple
  windows fails that matcher. Broadening the executable list alone cannot solve
  this.
- The installed Codex 0.162.1 JSON schemas provide loaded-thread enumeration and
  thread metadata. The inspected thread responses have no terminal PID or
  window identity. A read-only request against the existing test conversation
  confirmed the response shape; its optional `extra` field was null.
- `thread/attachmentOwner/list` looks up persisted attachment identities. It is
  not an inventory of native frontend clients. No attachment-based client
  mapping was established.
- The native control socket speaks the app-server WebSocket protocol. Its name
  alone does not establish a terminal control or frontend-discovery API.

These observations leave automatic frontend-to-current-conversation matching
unresolved. They are not proof that no integration is possible. In particular,
upstream source can differ from the installed build; a source hypothesis needs
a live test before it becomes an implementation assumption.

## Proposed implementation order

Update, 12 October: the selected first step is now
[creation through Voyager](instances.md). Its backend create/open journey has
native evidence. The ordinary-terminal sequence below remains a separate
unimplemented requirement; creation does not satisfy it.

1. Establish desktop window/process discovery on the actual Fedora compositor.
   Read-only discovery must distinguish an ordinary shell, an agent frontend,
   and an ambiguous multi-pane process. Do not present any of these as a
   registered conversation yet.
2. Establish an authoritative current-conversation handshake. Fully automatic
   matching remains the product target. A one-time conversation choice is a
   possible interim UX only if explicitly accepted; it must not be represented
   as automatic discovery. A client integration that publishes live identity
   is another option to investigate.
3. Put resolve, register and control acquisition behind the service tool
   boundary, and have Electron submit the intended window target. Revalidate
   identity before attachment; session switches must not keep control attached
   to the previous conversation.
4. Add native instance creation through that same backend boundary. Decide and
   document whether the native daemon or Voyager owns the agent process. A
   creation receipt must distinguish launch requested, process started,
   conversation identified, registered, and controlled. No setup model turn
   should be needed merely to manufacture a discoverable identity.
5. Verify effective YOLO permissions on actual native turns for each supported
   creation/resume path, including a harmless service status call. A launch flag
   or label is not evidence of the effective policy. This investigation has
   not changed global Codex configuration or existing conversations' policies.

Names, groups and captain/crew permissions follow as separate increments.
Captain may issue instructions; crew may send/receive status and receive work,
but may not issue instructions. Runtime role, human docking control and Voyage
community administration are distinct. Backend authorization must enforce the
chosen role contract; UI labels cannot enforce it.

## Acceptance experiment

Actor: a developer using their normal terminal and native Codex interface.

1. Open two normal terminals with separate Codex conversations, using the same
   directory and similar titles. Open a third terminal containing only a shell.
2. Dock to the first conversation. Verify the exact native thread and a real
   user/assistant exchange in Voyager's event store. The other conversation
   must remain unregistered and uncaptured.
3. Undock and verify the release event, continued registration and capture.
   Dock to the second conversation and verify control moves to that identity.
4. Try the plain shell and an ambiguous tab/pane arrangement. Neither may
   silently register a guessed conversation.
5. Switch the displayed Codex conversation within a running frontend. Voyager
   must invalidate or update the binding using fresh identity evidence.
6. Separately create an instance from Voyager and verify its native interface,
   actual turn permissions and explicit process ownership. Closing its client
   must be tested independently of undocking.

Fixtures can exercise regressions, but cannot pass this native desktop journey.
Current verdict: **rework** for ordinary-terminal docking; the prepared-client
mechanism remains the earlier demonstrated capability.

## References

- [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server).
- [Native Unix transport at upstream revision a9b0815](https://github.com/openai/codex/blob/a9b0815167c27ab13719dd12d13b63e02b70d221/codex-rs/app-server-transport/src/transport/unix_socket.rs).
- [Native TUI session facade at that revision](https://github.com/openai/codex/blob/a9b0815167c27ab13719dd12d13b63e02b70d221/codex-rs/tui/src/app_server_session.rs).
- Current Voyager boundaries: [desktop](desktop.md), [service](service.md),
  [control](control.md), and [workers](workers.md).
