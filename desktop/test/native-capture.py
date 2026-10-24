import json
import math
import subprocess
import sys
import time
from gi.repository import Gio, GLib

rectangle = json.loads(sys.argv[1])
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
name = 'org.gnome.Mutter.ScreenCast'
def call(path, interface, method, args=None):
    return bus.call_sync(name, path, interface, method, args, None, Gio.DBusCallFlags.NONE, 3000, None).unpack()
config = 'org.gnome.Mutter.DisplayConfig'
monitors = bus.call_sync(config, '/org/gnome/Mutter/DisplayConfig', config, 'GetCurrentState', None, None, Gio.DBusCallFlags.NONE, 3000, None).unpack()[2]
session = call('/org/gnome/Mutter/ScreenCast', name, 'CreateSession', GLib.Variant('(a{sv})', ({},)))[0]
nodes = []
started = False
try:
    choices = []
    for monitor in monitors:
        connector = monitor[5][0][0]
        stream = call(session, name + '.Session', 'RecordMonitor', GLib.Variant('(sa{sv})', (connector, {'cursor-mode': GLib.Variant('u', 0)})))[0]
        params = call(stream, 'org.freedesktop.DBus.Properties', 'Get', GLib.Variant('(ss)', (name + '.Stream', 'Parameters')))[0]
        x, y = params['position']
        width, height = params['size']
        if x <= rectangle['x'] and y <= rectangle['y'] and rectangle['x'] + rectangle['width'] <= x + width and rectangle['y'] + rectangle['height'] <= y + height:
            choices.append((stream, x, y, width, height))
    assert len(choices) == 1, 'Capture must fit one monitor'
    stream, x, y, width, height = choices[0]
    bus.signal_subscribe(name, name + '.Stream', 'PipeWireStreamAdded', stream, None, Gio.DBusSignalFlags.NONE, lambda *args: nodes.append(args[5].unpack()[0]))
    call(session, name + '.Session', 'Start')
    started = True
    deadline = time.monotonic() + 5
    while not nodes and time.monotonic() < deadline:
        GLib.MainContext.default().iteration(False)
        time.sleep(.01)
    assert nodes, 'No compositor video stream'
    left = math.floor(rectangle['x'] - x)
    top = math.floor(rectangle['y'] - y)
    right = width - left - math.ceil(rectangle['width'])
    bottom = height - top - math.ceil(rectangle['height'])
    subprocess.run(['gst-launch-1.0', '-q', 'pipewiresrc', f'path={nodes[0]}', 'num-buffers=1', '!', 'videoconvert', '!', 'videoscale', '!', f'video/x-raw,width={width},height={height}', '!', 'videocrop', f'left={left}', f'right={right}', f'top={top}', f'bottom={bottom}', '!', 'pngenc', '!', 'filesink', f'location={sys.argv[2]}'], check=True, timeout=10)
finally:
    if started:
        call(session, name + '.Session', 'Stop')
