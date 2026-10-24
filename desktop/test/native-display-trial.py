import copy
import json
import pathlib
import select
import signal
import sys
from gi.repository import Gio, GLib

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
name = 'org.gnome.Mutter.DisplayConfig'
def call(method, args=None):
    return bus.call_sync(name, '/org/gnome/Mutter/DisplayConfig', name, method, args, None, Gio.DBusCallFlags.NONE, 5000, None).unpack()
def config(state):
    modes = {m[0][0]: next(mode[0] for mode in m[1] if mode[6].get('is-current')) for m in state[1]}
    return [[m[0], m[1], m[2], m[3], m[4], [(spec[0], modes[spec[0]], {}) for spec in m[5]]] for m in state[2]]
def apply(layout):
    state = call('GetCurrentState')
    call('ApplyMonitorsConfig', GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', (state[0], 1, layout, {})))
def interrupted(*_):
    raise RuntimeError('Display trial interrupted')
original = call('GetCurrentState')
layout = config(original)
changed = copy.deepcopy(layout)
internal = next(m for m in changed if m[5][0][0].startswith('eDP'))
if sys.argv[1] == 'arrangement':
    internal[0] += 80
elif sys.argv[1] == 'scale':
    internal[2] = 2.0 if internal[2] != 2 else 1.6666666269302368
else:
    raise ValueError('Unknown display trial')
receipt = {'before': original, 'requested': changed}
for sig in [signal.SIGTERM, signal.SIGINT]:
    signal.signal(sig, interrupted)
try:
    apply(changed)
    receipt['changed'] = call('GetCurrentState')
    print(json.dumps({'applied': True}), flush=True)
    select.select([sys.stdin], [], [], 15)
finally:
    apply(layout)
    receipt['restored'] = call('GetCurrentState')
    pathlib.Path(sys.argv[2]).write_text(json.dumps(receipt, indent=2))
    assert config(receipt['restored']) == layout, 'Display restoration differs'
