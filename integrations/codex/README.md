# Native Codex identity

The adapter uses normally installed Codex. It does not patch or replace its executable.

Discovery finds the frontend on the selected Ghostty PTY and verifies its existing local Unix app-server connection. Discovery does not type into the interface. Adoption acquires the PTY observer, reads the displayed conversation through native `/status`, then validates that ID with the same daemon. Control actions check the displayed conversation again. A changed conversation is refused.

`src/native_status.rs` observes the terminal with a VT parser. A temporary Linux observer reads the frontend’s own output so Ghostty rendering does not delay identity checks. It uses native composer history to retain an unfinished draft while querying status. Ghostty's input writer is held briefly at its event-loop wait; input remains queued. The observer answers cursor-position queries during that hold. Unknown composer layouts and modal states are refused. The original terminal dimensions and input writer are released on exit.

This replacement is under experiment. Idle and active-task draft/cursor checks, plus queued native keyboard input, have passed on Codex 0.163.0 and Ghostty 1.1.3. These isolated mechanism checks do not establish the complete avatar journey, which remains unproved. The earlier custom frontend bridge has been removed; its historical results are not stock-Codex proof. See [native adoption](../../docs/native-adoption.md) for the acceptance boundary.
