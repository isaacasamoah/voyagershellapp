# Learning before building

Research checkpoint: 9 October 2026. These are source observations; our separate [experiment results](experiments.md) distinguish what the prototype actually proves.

## Herdr: ownership behind the terminal interface

Herdr has a terminal UI and a background service. In its [public source at `2563803`](https://github.com/herdrdev/herdr/tree/2563803dca97c040beaf3dc3acdcb5a3221b4238):

- [The Unix PTY backend](https://github.com/herdrdev/herdr/blob/2563803dca97c040beaf3dc3acdcb5a3221b4238/src/pty/backend/unix.rs#L12-L40) launches the child on the slave side and retains a master descriptor.
- [The runtime registry](https://github.com/herdrdev/herdr/blob/2563803dca97c040beaf3dc3acdcb5a3221b4238/src/terminal/runtime_registry.rs#L5-L12) separates live runtimes from serializable application state.
- [Client cleanup](https://github.com/herdrdev/herdr/blob/2563803dca97c040beaf3dc3acdcb5a3221b4238/src/server/headless.rs#L931-L965) releases the client's input/resize ownership without deleting the terminal runtime.
- [Writable attachment](https://github.com/herdrdev/herdr/blob/2563803dca97c040beaf3dc3acdcb5a3221b4238/src/server/headless.rs#L1722-L1824) resolves an existing terminal and handles controller ownership separately from observers.

The lesson for Voyager is the ownership boundary, not Herdr's UI. The inspected source is not asserted to be byte-identical to any installed release.

Herdr's documented [direct attach](https://herdr.dev/docs/persistence-remote/) attaches to a server-owned terminal. We have not established that it can adopt an arbitrary agent already running outside its server. Its [automation documentation](https://herdr.dev/docs/agent-automation/) also distinguishes prompt waiting from individual turn tracking. Voyager needs explicit task and turn attribution for its event history.

## tmux: client lifetime is not pane lifetime

The [tmux guide](https://github.com/tmux/tmux/wiki/Getting-Started) explains the server, session, window, pane and client model. In source pinned to [`82abcd1`](https://github.com/tmux/tmux/tree/82abcd175cca43c671af3690cd0af74c4c75621c):

- [`spawn.c`](https://github.com/tmux/tmux/blob/82abcd175cca43c671af3690cd0af74c4c75621c/spawn.c#L482) creates a pane's process and PTY.
- [`server-client.c`](https://github.com/tmux/tmux/blob/82abcd175cca43c671af3690cd0af74c4c75621c/server-client.c#L374-L430) handles a lost client separately from pane creation and ownership.

The useful principle is separating a terminal connection from the process that keeps work alive. Our initial probe tests transfer of an existing connection; a reconnectable client remains a later increment. We are not using tmux, reproducing its command model or building pane layouts.

## Pi: structured capture is its own interface

[Pi's JSON event stream](https://pi.dev/docs/latest/json) distinguishes turns, final messages and tool execution. Its [RPC protocol](https://pi.dev/docs/latest/rpc) is a bidirectional control interface for a long-lived worker. Command acceptance, intermediate run endings and the end of automatic work are different observations.

For Voyager, this suggests a typed event envelope with native source identity, session, request/task attribution where known, time and scope. Terminal bytes can support a live display, but cannot become invented assistant messages or successful task outcomes. We intend to model capture on this structure without requiring every agent to become a Pi agent.

## Existing-terminal attachment needs cooperation

Unix sockets can transfer an open descriptor using [`SCM_RIGHTS`](https://man7.org/linux/man-pages/man7/unix.7.html). That gives a receiver access to the same PTY; it does not change who can signal the child, move its parentage, or coordinate two readers. Our fixture explicitly pauses the old reader and relinquishes its descriptor after acknowledgement.

Closing a terminal can also explicitly kill its child. For example, [Ghostty's shutdown path at `b115e45`](https://github.com/ghostty-org/ghostty/blob/b115e456749e2820a14d3942a63159ff8d46d925/src/termio/Exec.zig#L1172-L1209) signals the process group. Keeping another master descriptor would not prevent that action. Our negative fixture reproduces that policy boundary; it is not a runtime test of Ghostty itself.

[Ptyxis at `2a8ae6f`](https://gitlab.gnome.org/chergert/ptyxis/-/blob/2a8ae6f299bf2b9a3019de3cea11aab96ca07b2e/src/ptyxis-tab.c#L1877-L1914) likewise has an explicit force-quit path. The inspected [agent protocol](https://gitlab.gnome.org/chergert/ptyxis/-/blob/2a8ae6f299bf2b9a3019de3cea11aab96ca07b2e/agent/org.gnome.Ptyxis.Agent.xml) did not establish an external live-tab handoff API. That is a bounded source finding, not a claim about every possible extension.

Linux tools such as [reptyr](https://github.com/nelhage/reptyr/tree/f4589b3f7bdda8bcc56453bf0748b40225e045da) investigate non-cooperative terminal adoption. These involve different permissions and failure modes and do not supply a general macOS solution. We have not run them against live agents or changed system security settings. A window remaining usable after ownership transfer is another requirement still to prove.

## Native interface and structured capture

A service can launch the actual agent executable and relay its terminal bytes. The agent remains responsible for its own interface and other capabilities; microphone/audio traffic does not become terminal text. Retaining the interface does not automatically expose a structured event feed. Voyager needs a harness integration for that independently, with explicit missing-event and failure reporting. Preserving ANSI output in our fixture is not proof of every native UI or voice path.

## The next questions

1. Can a harness integration register an existing native agent and expose Voyager tools without replacing its interface?
2. Which real terminal can cooperatively transfer ownership, suppress its old kill-on-close policy, and keep the same window usable through a relay? The desired starting experience attaches an already-running CLI; a launcher wrapper is not the chosen substitute.
3. What structured events does the chosen harness expose, including voice-driven turns, and which identities are missing?

Registration alone does not answer persistence. Detach persistence does not answer daemon-restart or reboot recovery. We will publish measured answers as the experiments run.
