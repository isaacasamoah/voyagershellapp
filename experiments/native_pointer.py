import json
import sys
import time

from gi.repository import Gio, GLib

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
remote = 'org.gnome.Mutter.RemoteDesktop'
cast = 'org.gnome.Mutter.ScreenCast'

def call(name, path, interface, method, args=None):
    return bus.call_sync(name, path, interface, method, args, None, Gio.DBusCallFlags.NONE, 3000, None)

session = call(remote, '/org/gnome/Mutter/RemoteDesktop', remote, 'CreateSession').unpack()[0]
session_id = call(remote, session, 'org.freedesktop.DBus.Properties', 'Get', GLib.Variant('(ss)', (remote + '.Session', 'SessionId'))).unpack()[0]
cast_session = call(cast, '/org/gnome/Mutter/ScreenCast', cast, 'CreateSession', GLib.Variant('(a{sv})', ({'remote-desktop-session-id': GLib.Variant('s', session_id)},))).unpack()[0]
config = 'org.gnome.Mutter.DisplayConfig'
monitors = call(config, '/org/gnome/Mutter/DisplayConfig', config, 'GetCurrentState').unpack()[2]
streams = []
for monitor in monitors:
    connector = monitor[5][0][0]
    stream = call(cast, cast_session, cast + '.Session', 'RecordMonitor', GLib.Variant('(sa{sv})', (connector, {}))).unpack()[0]
    params = call(cast, stream, 'org.freedesktop.DBus.Properties', 'Get', GLib.Variant('(ss)', (cast + '.Stream', 'Parameters'))).unpack()[0]
    streams.append((stream, params['position'], params['size']))
call(remote, session, remote + '.Session', 'Start')
try:
    for line in sys.stdin:
        try:
            args = json.loads(line)
            if args[0] == 'move':
                x, y = float(args[1]) / float(args[3]), float(args[2]) / float(args[3])
                matches = [(s, x - p[0], y - p[1]) for s, p, size in streams if p[0] <= x < p[0] + size[0] and p[1] <= y < p[1] + size[1]]
                assert len(matches) == 1, 'Pointer target is outside the monitor layout'
                call(remote, session, remote + '.Session', 'NotifyPointerMotionAbsolute', GLib.Variant('(sdd)', matches[0]))
                time.sleep(.08)
            elif args[0] == 'button':
                call(remote, session, remote + '.Session', 'NotifyPointerButton', GLib.Variant('(ib)', (272, args[1])))
            else:
                raise ValueError('Unknown pointer action')
            print(json.dumps({'ok': True}), flush=True)
        except Exception as error:
            print(json.dumps({'error': str(error)}), flush=True)
finally:
    call(remote, session, remote + '.Session', 'Stop')
