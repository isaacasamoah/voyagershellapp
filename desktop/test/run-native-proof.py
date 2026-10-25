import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[2]
state = Path(sys.argv[1]).resolve()
journey = sys.argv[2]
if any(os.environ.get(key) for key in ['VOYAGER_CALLER', 'VOYAGER_SESSION_CONTEXT']):
    raise SystemExit('Use the authorized scoped development runner from a bound instance')
state.mkdir(mode=0o700)
manifest = lambda: json.loads(subprocess.check_output(['python3', str(root / 'desktop/test/candidate-manifest.py')]))
started = manifest()
(state / 'launch-manifest.json').write_text(json.dumps(started, indent=2))
exe = str(root / 'target/debug/voyager')
def call(*args):
    return json.loads(subprocess.check_output([exe, '--state', str(state), *args], timeout=25))
env = dict(os.environ, VOYAGER_STATE=str(state), VOYAGER_PROOF_JOURNEY=journey)
service = subprocess.Popen([exe, '--state', str(state), 'serve'], env=env, stdout=(state / 'service.log').open('w'), stderr=subprocess.STDOUT)
app = None
verdict = None
cleanup = []
try:
    deadline = time.monotonic() + 10
    while not (state / 'service.sock').exists() and time.monotonic() < deadline:
        if service.poll() is not None:
            raise RuntimeError('Candidate service exited before ready')
        time.sleep(.1)
    assert call('list') == [], 'Native proof requires fresh empty service state'
    args = [str(root / 'desktop/node_modules/electron/dist/electron'), '--ozone-platform=x11', str(root / 'desktop'), '--expanded', '--proof-native']
    app = subprocess.Popen(args, env=env, stdout=(state / 'desktop.log').open('w'), stderr=subprocess.STDOUT)
    (state / 'launch.json').write_text(json.dumps({'app': args, 'app_pid': app.pid, 'service': exe, 'service_pid': service.pid, 'provider': subprocess.check_output([os.environ.get('VOYAGER_CODEX_BIN', 'codex'), '--version'], text=True).strip()}, indent=2))
    deadline = time.monotonic() + 360
    while time.monotonic() < deadline:
        try:
            result = json.loads((state / 'native-proof.json').read_text())
            if result.get('verdict') in ['pass', 'rework']:
                verdict = result
                break
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        if app.poll() is not None:
            break
        time.sleep(.25)
finally:
    if app and app.poll() is None:
        app.terminate()
        app.wait(timeout=10)
    for row in call('list', '--include-removed'):
        if row['ownership'] == 'managed' and row.get('worker_state') == 'running':
            cleanup.append(call('stop-instance', row['id'], '--request-id', 'native-cleanup-' + row['id']))
    cleanup.append(call('stop'))
    service.wait(timeout=15)
    (state / 'cleanup.json').write_text(json.dumps({'receipts': cleanup, 'service_exit': service.returncode, 'desktop_exit': app and app.returncode}, indent=2))
finished = manifest()
(state / 'finish-manifest.json').write_text(json.dumps(finished, indent=2))
assert started['hashes'] == finished['hashes'], 'Candidate changed during proof'
print(json.dumps({'state': str(state), 'verdict': verdict and verdict.get('verdict'), 'error': verdict and verdict.get('error')}))
if not verdict or verdict['verdict'] != 'pass':
    raise SystemExit(1)
