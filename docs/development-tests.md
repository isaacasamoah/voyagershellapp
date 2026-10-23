# Scoped development runs

An owner can grant a registered agent permission to test one canonical Voyager
checkout. The agent retains its normal bound identity when requesting a run.
Neither rank, supervision nor docking supplies this grant. Bash cannot use it.
The grant is a service-lifetime permission to execute the checkout's mutable
code, not approval of a particular commit. Build and review that checkout first.

This is a cooperative same-user development facility, not an OS sandbox for
hostile code. Its purpose is to prevent ordinary agent requests accidentally
launching against the installed service or reaching an unrelated test run.
Candidate processes still have the human's OS permissions and inherited provider
configuration. A separate state/profile does not isolate accounts, microphone,
keyboard focus, GPU, files or network access.

## Prepare and grant

Build the candidate's debug Rust binaries with `cargo build --locked --bins` and
install its desktop dependencies with `npm ci` in `desktop/`. The fixed executable
locations are `target/debug/voyager`, `target/debug/voyager-windows` and
`desktop/node_modules/electron/dist/electron`. Those resolved files must remain
inside the granted checkout. Shared or redirected artifact directories are refused.
The runner does not build code or attest that a binary matches a commit.

From an ordinary owner terminal connected to a service containing this feature:

```sh
voyager --state PRIVATE_DIR test-grant INSTANCE_ID grant-request /absolute/candidate
```

The instance must be registered in that service. Reusing a request ID returns its
saved receipt; use a new ID for a deliberate new grant after revocation or restart.
There is one checkout grant per instance. A new grant replaces that checkout for
future runs without retargeting an existing run.

This requires one owner activation of the updated service. An older service
cannot grant itself this capability. Rebuilding a CLI does not update a running
service. A service restart expires grants and bound credentials; it does not
restore runtimes or transfer an existing conversation's identity to another
service. Follow the normal owner lifecycle when activating, then grant the
registered instance that will perform development testing.

## Run and inspect

The instance uses its normal caller environment, unchanged:

```sh
"$VOYAGER_BIN" --state "$VOYAGER_STATE" capabilities
"$VOYAGER_BIN" --state "$VOYAGER_STATE" test-start manual-request manual
"$VOYAGER_BIN" --state "$VOYAGER_STATE" test-runs
"$VOYAGER_BIN" --state "$VOYAGER_STATE" test-read RUN_ID
"$VOYAGER_BIN" --state "$VOYAGER_STATE" test-stop RUN_ID stop-request
```

`manual` opens the expanded candidate app for the human. It creates no Vessels
automatically. Closing this test app ends its run and requests cleanup of the
candidate service's managed instances. This differs from closing the ordinary app.

`polish` launches the existing `--proof-polish` journey with xterm. It creates real
test Vessels, exercises the desktop, voice and docking, and can consume provider
usage. It takes desktop focus. Its result retains the proof's observations and
limits. A fixture pass is not this live proof; Web Audio timing is not acoustic
output or human acceptance.

Each request starts a helper owned by the authorizing service. That helper starts
the candidate service and Electron against a fresh private directory under the
OS temporary directory, with a new desktop profile. It receives no caller token
or copied context. Instance callers cannot directly invoke `test-host`, `start`,
`serve` or `dock`. There is no raw owner RPC proxy or arbitrary command argument.

`test-start` acknowledges only `runner_spawned`. The saved operation and
`test-runs` show `run_state`: starting, running, stopping, finished or uncertain.
`finished` means cleanup was confirmed; inspect `result.error` and the proof's
`verdict` separately to determine whether the experiment succeeded. A failed
desktop launch can finish with completed cleanup and an error. `test-stop`
acknowledges `stop_requested`; it does not claim cleanup has finished.

One active or uncertain run per instance is allowed. The service retains at most
64 runs per lifetime; `test-runs` returns the latest 64 saved receipts. `test-read`
reads only that run's log, in at most 32 KiB pages with byte offsets. Result JSON
is limited to 1 MiB. Runs are limited to four hours for manual work and five minutes
for polish. Evidence remains private on disk for owner review; there is no
automatic retention deletion. Logs can contain application data. Remove only the
specific reviewed run directory after confirming its processes have stopped.

## Revocation, cleanup and failures

```sh
voyager --state PRIVATE_DIR test-revoke INSTANCE_ID revoke-request
```

Revocation blocks new starts and closes the run's control pipe to request cleanup.
Removal also invalidates the grant and requests cleanup. The creator can still
read and stop its own run after revocation while its registration remains valid.
Peers, supervisors and docked agents get no access to another agent's test run.
The owner can inspect and stop any run. Normal service shutdown refuses while a
test helper is active, just as it refuses while managed Vessels remain active.

The helper closes only its own Electron child, asks its fresh candidate service
to stop each managed runtime/viewer through the existing lifecycle API, then
asks that service to stop. External registered processes are never killed.
Desktop close and cleanup run outside the parent service loop. If cleanup fails,
the receipt reports uncertainty and retains the state path; the runner does not
kill an unverified PID, force service shutdown or repeat an uncertain operation.
The owner must inspect any surviving candidate service or resources.

Parent disconnection closes the control pipe and requests the same cleanup.
If the helper itself crashes, or the candidate service becomes unreachable,
cleanup is not guaranteed. On parent restart, live run receipts become uncertain,
grants expire and no processes are rediscovered, restarted or resubmitted.
Request IDs prevent retrying a lost launch acknowledgement from launching twice.

## Checks and limits

Service-boundary fixtures exercise explicit grants, peer denial, fixed arguments,
duplicate/conflicting request IDs, revocation, separate service identity, cleanup
of a real Bash runtime, passing and failing proof results, desktop failure and
parent disconnection. They use a small fake Electron executable and fixture Codex
provider. They establish policy and lifecycle behavior, not graphical reliability.
Run the full Cargo suite in an owner test environment or CI. Bound callers must
not remove their identity variables to start disposable test services.

The real branch-built Fedora app/service journey and human acceptance remain
required before activation is called reliable. This feature neither fixes
Ghostty's rendering failure nor establishes macOS or Windows support.
