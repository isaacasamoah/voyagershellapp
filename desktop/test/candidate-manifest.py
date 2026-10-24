import hashlib
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
def command(*args):
    return subprocess.check_output(args, cwd=root, text=True).strip()
files = [p for folder in ['desktop/src', 'desktop/test', 'src', 'tests'] for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
files += [root / f for f in ['Cargo.lock', 'desktop/package-lock.json', 'target/debug/voyager', 'target/debug/voyager-windows', 'desktop/node_modules/electron/dist/electron']]
print(json.dumps({'root': str(root), 'revision': command('git', 'rev-parse', 'HEAD'), 'dirty': command('git', 'status', '--porcelain'), 'display': {k: os.environ.get(k) for k in ['DISPLAY', 'XDG_SESSION_TYPE']}, 'backend': 'x11', 'hashes': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}}))
