# Review trial preparation and supervision

This experimental helper freezes externally supplied task and protocol files,
creates two independent local Git repositories with five worktrees each, and
verifies their inputs. It keeps trial state and receipts outside the repository.
It does not contain private planning notes or provider credentials.

```sh
python3 tools/review_trial.py prepare \
  --source /absolute/path/to/clean/source \
  --revision COMMIT \
  --brief /absolute/path/to/brief.md \
  --protocol /absolute/path/to/protocol.md \
  --root /absolute/path/to/new/private/trial \
  --voyager /absolute/path/to/voyager \
  --codex /absolute/path/to/codex
python3 tools/review_trial.py check /absolute/path/to/private/trial
python3 tools/review_trial.py status /absolute/path/to/private/trial
```

Preparation makes no model calls and starts no services or agents. Reusing an
existing trial directory is refused. The manifest saves the randomized arm order
and treatment assignment, exact revision and input hashes. Each native participant
will receive the same task text and its corresponding role text.

Before a measured run, the supervising operator conducts a separate two-session
native rehearsal and records its actual receipts. The rehearsal receipt JSON has
boolean terminal_open, source_capture, native_completed, direct_message and
subscription_delivered fields, plus a receipts list of evidence paths. Register it:

```sh
python3 tools/review_trial.py rehearsal /absolute/path/to/private/trial /absolute/path/to/rehearsal.json
```

This is an operator attestation. The helper checks the required fields and saves
its hash; it does not judge screenshots or establish that supplied evidence is true.

Run the first arm named in the saved order, then the other. Start from the actual
desktop session. Supply OPENAI_API_KEY and TYPESAFE_API_KEY through the approved
secret manager in the service environment. Do not write keys to the manifest.

```sh
python3 tools/review_trial.py run /absolute/path/to/private/trial A
```

The run command uses the existing Voyager CLI to create five native sessions,
opens their terminals, checks actual native completion and model settings, then
submits the task. It records attributed events and treatment state, sends a common
ten-minute reminder and stops its recorded instances at the deadline or handoff.
It refuses to resume or resubmit a previously started arm. An interrupted launch
can leave an uncertain instance that needs operator inspection through the saved
service state and request ID. Never rerun with a fresh ID to guess around it.

The supervisor remains responsible for interpreting failures, inspecting native
windows, recording model usage and notification delay, and independently assessing
final artifacts. A final handoff is not a passing score. Source event snapshots are
paged; graph HTTP views retain their documented recent-event limits, with complete
data in the private service database. Worktrees and untracked files are preserved.

The first preparation checks use real disposable Git repositories:

```sh
python3 -m unittest discover -s tools -p 'test_review_trial.py'
```

These tests prove isolation, matching inputs, drift detection and refusal paths.
The native run controller still requires its live rehearsal. No completed
five-agent comparison is claimed by adding this helper.
