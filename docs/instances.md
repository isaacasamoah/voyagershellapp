# Create an instance from the panel

Open Voyager, click **+** above Instances, choose **Codex** or **Terminal · Bash**,
enter a name and folder, then choose **Create and open**. A real Ghostty window
opens; the new instance is already registered and capturing. No preparation
prompt, manually copied conversation ID or dock step is required for creation.

Dock the astronaut onto that window to select the human command surface.
Undock to release that selection. Neither operation starts or stops the instance.
Click **↗** beside a running instance to reopen its native interface after closing
it. If its launched window is still alive, the same operation asks the desktop
to bring that exact window forward. It does not start another instance or dock it.

This increment supports Codex 0.162.1 and a managed Bash in separate Ghostty
XWayland windows on Linux. There is one native viewer per shell. Claude, Ptyxis,
other shell profiles, tabs, native Wayland and macOS need their own implementation
and proof. Discovery of independently opened terminals remains separate.

## Start the app

Use Rust, Node 24, Ghostty and native Codex from a graphical login. Authentication
and model selection stay with Codex. `VOYAGER_CODEX_BIN` can select its absolute
executable when starting Voyager.

```sh
cargo build --locked --bins
cd desktop
npm ci
npm start -- --expanded
```

Electron calls the Rust `start` operation. It connects to an existing service or
starts one with its own process session and private log. Closing Electron leaves
the service and instances running. The default state is
`$HOME/.local/share/voyagershell`; set `VOYAGER_STATE` to use a different private
directory. This is not an OS service installer or crash/reboot supervisor.

## Lifecycle controls

Use **⋯** beside an instance for **Run in background**, **Stop**, **Remove** or
**Stop and remove**. Removed but running owned instances appear under
**Unregistered**, with **Register again**, **↗** and **Stop** available.

The [lifecycle contract](lifecycle.md) defines each action's effects, defaults,
retry behavior and ownership limits. The [CLI reference](service.md#commands)
lists the same operations available to an agent or script. Docking remains
independent of registration and runtime lifetime.

## The same operations from an agent or script

From the repository root:

```sh
VOYAGER_STATE="$HOME/.local/share/voyagershell"
target/debug/voyager --state "$VOYAGER_STATE" start
target/debug/voyager --state "$VOYAGER_STATE" create codex create-001 "Navigator" "$PWD"
target/debug/voyager --state "$VOYAGER_STATE" create shell create-002 "Workbench" "$PWD"
target/debug/voyager --state "$VOYAGER_STATE" list
```

Use each returned `session_id`, not its name, for commands:

```sh
target/debug/voyager --state "$VOYAGER_STATE" open SESSION_ID ghostty
target/debug/voyager --state "$VOYAGER_STATE" shell-exec SHELL_SESSION shell-task-001 'pwd'
target/debug/voyager --state "$VOYAGER_STATE" shell-read SHELL_SESSION
target/debug/voyager --state "$VOYAGER_STATE" watch --pretty
```

`create` stores kind, name, canonical folder and native identity. Repeating the
same request ID with identical inputs returns its saved receipt; conflicting
inputs fail. Unknown delivery is never silently retried with a new ID. The form
also keeps its creation ID when opening fails, so retry opens the existing
instance. An invalid folder fails without registration.

`open` waits for the exact launched window to map, or asks the desktop to focus
its existing window. Mapping is not proof of keyboard focus or native UI
usability. Failed opening retains the instance and saved result; inspect it
before using a new-ID `open` to repair the same instance.

Owned Codex tool environments explicitly receive `VOYAGER_BIN`, `VOYAGER_STATE`
through the [native environment policy](https://learn.chatgpt.com/docs/config-file/config-advanced#shell-environment-policy), plus the small
[orchestration instructions](../src/orchestration.md). They can call the same
CLI operations as the panel. No captain/crew role system is introduced.
[Docking control](control.md) is a current human selection, not an isolation
boundary between mutually untrusted agents running under the same OS user.

## What a bare terminal means

The service starts one interactive Bash and owns its pseudo-terminal (PTY).
Ghostty runs a small attach client that forwards keyboard bytes, output and
resize messages. Ghostty still renders the terminal; Voyager has no screen
emulator. Agent `shell-exec` commands enter this same Bash, rather than a new
subprocess with a different working directory or environment.

The first profile is deliberately **Bash without user startup files**. It installs
only a prompt and command-boundary hooks. It does not edit `.bashrc`, `.profile`
or the person's terminal preferences. Another shell or user-customized profile
requires a separately tested capture adapter.

Bash's `PS0` identifies a submitted command and `PROMPT_COMMAND` records its return
to the prompt. These are documented [interactive Bash boundaries](https://www.gnu.org/software/bash/manual/html_node/Interactive-Shell-Behavior.html).
The `shell-commands-v1` events contain:

- `shell.command`: text, working directory, command ID and human/agent attribution;
  agent submissions also carry their request ID.
- `shell.completed`: matching command ID, final command-line exit code and folder.
- Shell start, exit and explicit stop; capture failure records an explicit gap.

The exit status describes Bash's command line, not every process or pipeline
stage. Shell history is in memory, not written to a separate history file. Command
text persists in the private Voyager database and can itself contain sensitive
values. Raw keystrokes and password input are not stored. Terminal output is a
bounded **64 KiB in-memory buffer**, available to `shell-read` with a byte cursor
and gap marker; it is not a durable transcript. Command text has the shared
16 KiB truncation limit.

An agent may submit one command line only at an untouched, ready prompt.
Busy shells and unfinished human input reject it. This also protects partial
input typed while an earlier command is running. A submitted request is only an
acknowledgement; inspect `shell.completed` for the observed outcome. Interactive
programs, nested shells and modified hooks are not promised agent-input targets.
Humans may use the native terminal normally; Voyager will not invent completion
for a command that exits or replaces Bash before another prompt appears.

## Persistence and stop

Closing the terminal disconnects its viewer. Bash, its current state and active
work remain owned by the service. Reopening reconnects to the same process and
replays the bounded output buffer. Full-screen applications have no reconstructed
screen state beyond that buffer. Codex reopen uses its own native history.

```sh
target/debug/voyager --state "$VOYAGER_STATE" stop-instance SESSION_ID
target/debug/voyager --state "$VOYAGER_STATE" stop
```

`stop-instance` explicitly ends an owned runtime and closes its owned native window by default. `--runtime-only` leaves window closure out of the request. For Bash it sends SIGHUP to
Bash, which forwards it to its jobs, with a bounded process-group kill fallback.
Disowned or independently escaped processes are outside that contract. An
external registration cannot be stopped this way. `stop` refuses while any owned
instance is alive. Service restart marks old launches unknown; it never adopts
stored PIDs or resubmits work. Investigate unknown launches before creating more.

## Proof and source

See [the panel journey report](panel-journey.md) for this increment's actual
observations and remaining human checks. Earlier Codex creation established that
`thread/name/set` materializes an empty native conversation with zero turns;
`historyMode: legacy` was needed by this installed version. Native remote resume
uses the owned server's `never` / `danger-full-access` policy, without unsupported
permission flags on the resume CLI. These are version-specific adapter decisions;
see the [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server).

- `src/service.rs`: service loop and sole runtime/store ownership.
- `src/service/lifecycle.rs`: creation and nonblocking lifecycle transitions.
- `src/service/native.rs`: native discovery, registration and turn submission.
- `src/actions.rs`: typed lifecycle actions, phases and operation identity.
- `src/worker.rs`: native Codex server and empty conversation creation.
- `src/shell.rs`, `shell.bash`: interactive shell ownership and capture.
- `src/shell_transport.rs`: byte transport and terminal-mode restoration.
- `src/terminal.rs`: native window opening.
- `src/store.rs`: registration, request receipts and event persistence.
- `desktop/src/instances.cjs`: form validation and creation/open retry identity.

Service tests exercise real PTYs and disposable protocol fixtures: multiple
owned runtimes, shared shell state, busy/input refusal, viewer close/reopen,
explicit stop, idempotency, missing executables and migration. Fixtures do not
establish native desktop behavior. Run [the standard checks](../CONTRIBUTING.md).

### Bringing an existing window forward

The service retains the exact terminal `Child` returned by its launcher. `open`
checks that child is still alive, identifies its single X11 window by PID, and
requests activation with the window manager. It never selects a window by title.
Missing or ambiguous windows produce an error; no duplicate terminal is launched
as a fallback. The service records `interface.focus_requested`, and control
ownership is unchanged. This uses the desktop's
[EWMH activation request](https://specifications.freedesktop.org/wm/latest-single/);
window-manager focus policy still applies. Native Wayland needs its own adapter.
