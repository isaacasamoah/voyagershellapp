import subprocess
import sys
import time
from gi.repository import Gio, GLib

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
name = 'org.gnome.Mutter.ScreenCast'

def call(path, interface, method, args=None):
    return bus.call_sync(name, path, interface, method, args, None, Gio.DBusCallFlags.NONE, 3000, None)

session = call('/org/gnome/Mutter/ScreenCast', name, 'CreateSession', GLib.Variant('(a{sv})', ({},))).unpack()[0]
stream = call(session, name + '.Session', 'RecordMonitor', GLib.Variant('(sa{sv})', (sys.argv[1], {'cursor-mode': GLib.Variant('u', 1)}))).unpack()[0]
nodes = []
bus.signal_subscribe(name, name + '.Stream', 'PipeWireStreamAdded', stream, None, Gio.DBusSignalFlags.NONE, lambda *args: nodes.append(args[5].unpack()[0]))
call(session, name + '.Session', 'Start')
try:
    deadline = time.monotonic() + 5
    while not nodes and time.monotonic() < deadline:
        GLib.MainContext.default().iteration(False)
        time.sleep(.01)
    assert nodes, 'No compositor video stream'
    subprocess.run(['gst-launch-1.0', '-q', 'pipewiresrc', f'path={nodes[0]}', 'num-buffers=1', '!', 'videoconvert', '!', 'pngenc', '!', 'filesink', f'location={sys.argv[2]}'], check=True, timeout=10)
finally:
    call(session, name + '.Session', 'Stop')
