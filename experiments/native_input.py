import base64
import ctypes
import os
from pathlib import Path
import subprocess
import sys

window, expected_pid, payload = sys.argv[1:]
pid = int(expected_pid)
property_text = subprocess.check_output(['xprop', '-id', window, '_NET_WM_PID'], text=True)
assert int(property_text.split(' = ', 1)[1]) == pid, 'Native window changed owner'
assert Path(f'/proc/{pid}/exe').resolve() == Path('/usr/bin/ghostty'), 'Expected an owned Ghostty experiment'
handle = os.pidfd_open(pid)
try:
    masters = [int(p.name) for p in Path(f'/proc/{pid}/fdinfo').iterdir() if 'tty-index:' in p.read_text()]
    assert len(masters) == 1, 'Expected one native PTY'
    libc = ctypes.CDLL(None, use_errno=True)
    fd = libc.syscall(438, handle, masters[0], 0)
    assert fd >= 0, 'Native PTY duplication denied'
    try:
        data = base64.b64decode(payload, validate=True)
        assert len(data) <= 16384, 'Experiment input is too large'
        while data:
            data = data[os.write(fd, data):]
    finally:
        os.close(fd)
finally:
    os.close(handle)
