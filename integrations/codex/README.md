# Native Codex identity

The adapter uses normally installed Codex. It does not patch or replace its executable.

Discovery finds the frontend on the selected Ghostty PTY and verifies its existing local Unix app-server connection. Discovery does not type into the interface. Adoption acquires the PTY observer, reads the displayed conversation through native `/status`, then validates that ID with the same daemon. Control actions check the displayed conversation again. A changed conversation is refused.

`src/native_status.rs` observes the terminal with a VT parser. A temporary Linux observer reads the frontend’s own output so Ghostty rendering does not delay identity checks. It uses native composer history to retain an unfinished draft while querying status. Ghostty's input writer is held briefly at its event-loop wait; input remains queued. The observer answers cursor-position queries during that hold. Unknown composer layouts and modal states are refused. The original terminal dimensions and input writer are released on exit.

The native journey passed with unmodified Codex 0.163.0 and Ghostty 1.1.3 on a separate Mutter/XWayland desktop: actual avatar drops, ongoing work and draft preservation, worker launch, work after native close, same-instance reopen, stale-conversation refusal and unrelated-conversation isolation. The earlier custom bridge is removed. This remains a version-aware Linux prototype, not a claim about every Codex release or composer mode.

Connection health checks only inspect process and socket identity. Native `/status` runs at adoption and explicit control actions, never during hover, inventory or routine health polling.

## Empty conversations

The installed Codex rejects `thread/resume` before a fresh conversation has usable saved history. The adapter uses the exact transcript path returned by that verified daemon when the file is absent or contains only matching session metadata. It records future append-only events from that point. It never writes the file, imports prior conversation, adds a setup message or changes thread metadata. Conversations with work keep the app-server notification source.

`src/transcript.rs` owns this bounded fallback. It verifies the tested transcript format and thread ID, handles incomplete trailing records, checks file identity and the previous byte boundary, and stops capture on replacement, truncation or unsupported records. Removal drops the reader. Registration again establishes a fresh capture boundary. Process lifecycle and instructions still use the same verified native instance and daemon.

The native empty-conversation journey passed: first-message capture, busy re-docking, worker launch, work after viewer closure, same-instance reopen and stop/removal. Parsing and cutoff also have ordinary tests. See [native adoption](../../docs/native-adoption.md) for the acceptance boundary and current proof.
