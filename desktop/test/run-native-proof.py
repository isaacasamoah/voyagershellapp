import ctypes
import json
import os
import shutil
import signal
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
packaged = Path(os.environ['VOYAGER_PROOF_APP']).resolve() if os.environ.get('VOYAGER_PROOF_APP') else None
exe = str(packaged.parent / 'resources/bin/voyager') if packaged else str(root / 'target/debug/voyager')
def call(*args):
    return json.loads(subprocess.check_output([exe, '--state', str(state), *args], timeout=25))
env = dict(os.environ, VOYAGER_STATE=str(state), VOYAGER_PROOF_JOURNEY=journey)
if os.environ.get('VOYAGER_PROOF_CURRENT_CONFIG') == '1':
    assert journey in ['resume', 'panel-resume']
    provider_home = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex'))
    isolated = state / 'codex-home'
    isolated.mkdir(mode=0o700)
    shutil.copy2(provider_home / 'auth.json', isolated / 'auth.json')
    (isolated / 'auth.json').chmod(0o600)
    (isolated / 'config.toml').write_text('model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\napproval_policy = "on-request"\ndefault_permissions = ":read-only"\n')
    env['CODEX_HOME'] = str(isolated)
    env['VOYAGER_PROOF_SOURCE_ROOT'] = str(root)
libc = ctypes.CDLL(None, use_errno=True)
if journey == 'reconnect':
    assert libc.prctl(36, 1, 0, 0, 0) == 0, 'Could not retain orphaned fixture children'
owned = {}
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
    args = ([str(packaged)] if packaged else [str(root / 'desktop/node_modules/electron/dist/electron'), str(root / 'desktop')]) + ['--ozone-platform=x11', '--expanded', '--proof-native']
    app = subprocess.Popen(args, env=env, stdout=(state / 'desktop.log').open('w'), stderr=subprocess.STDOUT)
    (state / 'launch.json').write_text(json.dumps({'app': args, 'app_pid': app.pid, 'service': exe, 'service_pid': service.pid, 'provider': subprocess.check_output([os.environ.get('VOYAGER_CODEX_BIN', 'codex'), '--version'], text=True).strip()}, indent=2))
    deadline = time.monotonic() + 360
    while time.monotonic() < deadline:
        control = state / 'proof-service-control.json'
        if control.exists():
            request = json.loads(control.read_text())
            assert journey == 'reconnect' and request['action'] == 'restart'
            for row in call('list'):
                if row['ownership'] == 'managed' and row['lifecycle']['runtime'] == 'running':
                    info = call('attach-info', row['id'])
                    if info['pid'] not in owned:
                        owned[info['pid']] = os.pidfd_open(info['pid'])
            previous = service.pid
            service.kill()
            service.wait(timeout=10)
            service = subprocess.Popen([exe, '--state', str(state), 'serve'], env=env, stdout=(state / 'restarted-service.log').open('w'), stderr=subprocess.STDOUT)
            control.unlink()
            (state / 'proof-service-restarted.json').write_text(json.dumps({'request': request['request'], 'before': previous, 'after': service.pid}))
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
    errors = []
    def clean(label, action):
        try:
            return action()
        except Exception as error:
            errors.append({'stage': label, 'error': str(error)})
    def close_app():
        if app and app.poll() is None:
            app.terminate()
            try:
                app.wait(timeout=10)
            except subprocess.TimeoutExpired:
                app.kill()
                app.wait(timeout=5)
    clean('desktop', close_app)
    rows = clean('list-test-vessels', lambda: call('list', '--include-removed'))
    for row in rows or []:
        if row['ownership'] == 'managed' and row.get('worker_state') == 'running':
            result = clean('stop-test-vessel', lambda: call('stop-instance', row['id'], '--request-id', 'native-cleanup-' + row['id']))
            cleanup.append(result)
    cleanup.append(clean('stop-service', lambda: call('stop')))
    clean('wait-service', lambda: service.wait(timeout=15))
    for pid, handle in owned.items():
        try:
            signal.pidfd_send_signal(handle, signal.SIGKILL, None, 4)
        except ProcessLookupError:
            pass
        except OSError as error:
            errors.append({'stage': 'owned-runtime-cleanup', 'pid': pid, 'error': str(error)})
        os.close(handle)
        clean('reap-owned-runtime', lambda pid=pid: os.waitpid(pid, 0))
    (state / 'cleanup.json').write_text(json.dumps({'receipts': cleanup, 'errors': errors, 'service_exit': service.returncode, 'desktop_exit': app and app.returncode}, indent=2))
finished = manifest()
(state / 'finish-manifest.json').write_text(json.dumps(finished, indent=2))
assert started['hashes'] == finished['hashes'], 'Candidate changed during proof'
print(json.dumps({'state': str(state), 'verdict': verdict and verdict.get('verdict'), 'error': verdict and verdict.get('error')}))
if errors or service.returncode != 0 or not verdict or verdict['verdict'] != 'pass':
    raise SystemExit(1)
