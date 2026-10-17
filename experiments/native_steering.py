import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

root = Path(__file__).resolve().parents[1]
state = Path(tempfile.mkdtemp(prefix='vsa-steering-'))
(state / 'bin').mkdir()
binary = state / 'bin' / 'voyager'
shutil.copy2(root / 'target/debug/voyager', binary)
env = dict(os.environ)
for key in ['VOYAGER_CALLER', 'VOYAGER_SESSION_CONTEXT']:
    env.pop(key, None)
session = None
observations = {}


def cli(*args):
    result = subprocess.run([binary, '--state', state, *args], env=env,
                            capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)


print(state, flush=True)
try:
    observations['service'] = cli('start')
    created = cli('create', 'codex', 'steering-create', 'Steering proof', str(state), '--background')
    session = created['session_id']
    first = cli('send', session, 'steering-start',
                'Run one shell command: sleep 5. Afterward reply with a short acknowledgement.')
    assert first['state'] == 'accepted' and first['dispatch_mode'] == 'start'
    steered = cli('send', session, 'steering-update',
                  'Keep the same task running. When it finishes reply exactly: NATIVE_STEER_42')
    assert steered['state'] == 'accepted' and steered['dispatch_mode'] == 'steer'
    assert steered['native_turn_id'] == first['native_turn_id']
    assert steered['expected_turn_id'] == first['native_turn_id']
    assert cli('send', session, 'steering-update',
               'Keep the same task running. When it finishes reply exactly: NATIVE_STEER_42') == steered
    observations.update(created=created, initial=first, steered=steered)
    cursor = 0
    events = []
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        page = cli('events', str(cursor))
        cursor = page['cursor']
        events.extend(page['events'])
        completed = [e for e in events if e['type'] == 'turn.completed'
                     and e['native_turn_id'] == first['native_turn_id']]
        if completed:
            assert completed[0]['payload']['status'] == 'completed'
            assert any(e['type'] == 'message' and e['payload'].get('role') == 'assistant'
                       and e['payload'].get('text') == 'NATIVE_STEER_42' for e in events)
            observations['verdict'] = 'pass'
            observations['completion'] = completed[0]
            break
        time.sleep(.1)
    else:
        raise TimeoutError('Native completion was not observed')
except Exception as error:
    observations.update(verdict='rework', error=str(error))
finally:
    if session:
        try:
            observations['stop'] = cli('stop-instance', session, '--runtime-only', '--request-id', 'steering-stop')
        except Exception as error:
            observations['cleanup_error'] = str(error)
    try:
        observations['service_stop'] = cli('stop')
    except Exception as error:
        observations['service_stop_error'] = str(error)
    (state / 'native-steering-proof.json').write_text(json.dumps(observations, indent=2))
print(observations.get('verdict'), flush=True)
sys.exit(0 if observations.get('verdict') == 'pass' else 1)
