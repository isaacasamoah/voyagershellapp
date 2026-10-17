import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
assert len(sys.argv) == 2, 'Usage: python3 experiments/run_adoption.py /absolute/integrated/codex'
codex = Path(sys.argv[1]).resolve(strict=True)
state = Path(tempfile.mkdtemp(prefix='vsad-'))
(state / 'bin').mkdir()
(state / 'bin' / 'codex').symlink_to(codex)
env = {**os.environ, 'GDK_BACKEND': 'x11', 'VOYAGER_STATE': str(state), 'PATH': str(state / 'bin') + ':' + os.environ['PATH']}
print(state, flush=True)
with (state / 'desktop.log').open('w') as log:
    desktop = subprocess.Popen([root / 'desktop/node_modules/.bin/electron', '.', '--proof-adoption'], cwd=root / 'desktop', env=env, stdout=log, stderr=log, start_new_session=True)
    (state / 'process.json').write_text(json.dumps({'desktop': desktop.pid}))
    desktop.wait()
result = json.loads((state / 'adoption-proof.json').read_text())
if result.get('verdict') != 'pass':
    print(result.get('error', 'Native proof did not pass'), file=sys.stderr)
    sys.exit(2)
stop = subprocess.run([root / 'target/debug/voyager', '--state', state, 'stop'], capture_output=True, text=True, env=env, timeout=10)
result['service_stop'] = {'exit_code': stop.returncode, 'stdout': stop.stdout, 'stderr': stop.stderr}
(state / 'adoption-proof.json').write_text(json.dumps(result, indent=2))
print('pass', flush=True)
