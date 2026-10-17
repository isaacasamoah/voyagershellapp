import sys
import time
from pathlib import Path

import gi

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

if sys.argv[1:] == ['--check']:
    assert Atspi.get_desktop(0) is not None
    sys.exit(0)

pid, started, service = map(int, sys.argv[1:])

def retained():
    try:
        stat = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        tracer = next(int(line.split()[1]) for line in Path(f'/proc/{pid}/status').read_text().splitlines() if line.startswith('TracerPid:'))
        tgid = next(int(line.split()[1]) for line in Path(f'/proc/{tracer}/status').read_text().splitlines() if line.startswith('Tgid:'))
        return int(stat[19]) == started and tgid == service
    except (OSError, StopIteration, ValueError):
        return False

Atspi.set_timeout(250, 250)
deadline = time.monotonic() + 5
while time.monotonic() < deadline and retained():
    desktop = Atspi.get_desktop(0)
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        if app.get_process_id() != pid:
            continue
        for child in range(app.get_child_count()):
            dialog = app.get_child_at_index(child)
            if dialog.get_role() != Atspi.Role.DIALOG:
                continue
            pending, nodes = [dialog], []
            while pending and len(nodes) < 128:
                node = pending.pop()
                nodes.append(node)
                pending.extend(node.get_child_at_index(i) for i in range(node.get_child_count()))
            names = {node.get_name() for node in nodes}
            if not {'Close this window?', 'All terminal sessions in this window will be terminated.'} <= names:
                continue
            buttons = [node for node in nodes if node.get_role() == Atspi.Role.PUSH_BUTTON and node.get_name() == 'Yes']
            if len(buttons) == 1 and retained():
                action = buttons[0].get_action_iface()
                for i in range(action.get_n_actions()):
                    if action.get_action_name(i) in ('click', 'activate'):
                        if not action.do_action(i):
                            raise RuntimeError('Ghostty declined its close action')
                        sys.exit(0)
    time.sleep(.1)
sys.exit(0 if not Path(f'/proc/{pid}').exists() else 1)
