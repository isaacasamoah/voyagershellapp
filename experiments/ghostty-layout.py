import argparse
import ctypes as C
import json
import os
from pathlib import Path
import subprocess
import time

from gi.repository import Gio, GLib


class Data(C.Union):
    _fields_ = [('l', C.c_long * 5), ('b', C.c_char * 20)]


class Client(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int),
               ('display', C.c_void_p), ('window', C.c_ulong),
               ('message_type', C.c_ulong), ('format', C.c_int), ('data', Data)]


class Event(C.Union):
    _fields_ = [('client', Client), ('pad', C.c_long * 24)]


class Desktop:
    def __init__(self):
        self.lib = C.CDLL('libX11.so.6')
        signatures = {
            'XOpenDisplay': ([C.c_char_p], C.c_void_p),
            'XDefaultRootWindow': ([C.c_void_p], C.c_ulong),
            'XInternAtom': ([C.c_void_p, C.c_char_p, C.c_int], C.c_ulong),
            'XGetWindowProperty': ([C.c_void_p, C.c_ulong, C.c_ulong, C.c_long,
                C.c_long, C.c_int, C.c_ulong, C.POINTER(C.c_ulong),
                C.POINTER(C.c_int), C.POINTER(C.c_ulong), C.POINTER(C.c_ulong),
                C.POINTER(C.POINTER(C.c_ubyte))], C.c_int),
            'XSendEvent': ([C.c_void_p, C.c_ulong, C.c_int, C.c_long, C.POINTER(Event)], C.c_int),
            'XFlush': ([C.c_void_p], C.c_int),
            'XFree': ([C.c_void_p], C.c_int),
            'XCloseDisplay': ([C.c_void_p], C.c_int),
        }
        for name, (arguments, result) in signatures.items():
            function = getattr(self.lib, name)
            function.argtypes, function.restype = arguments, result
        self.display = self.lib.XOpenDisplay(None)
        if not self.display:
            raise RuntimeError('Run from an X11/XWayland graphical session')
        self.root = self.lib.XDefaultRootWindow(self.display)

    def property(self, window, name):
        atom = self.lib.XInternAtom(self.display, name.encode(), 0)
        actual, fmt, count, left = C.c_ulong(), C.c_int(), C.c_ulong(), C.c_ulong()
        data = C.POINTER(C.c_ubyte)()
        result = self.lib.XGetWindowProperty(self.display, window, atom, 0, 8192,
            0, 0, C.byref(actual), C.byref(fmt), C.byref(count), C.byref(left), C.byref(data))
        if result:
            raise RuntimeError('X11 property request failed')
        if not data:
            return None
        try:
            if fmt.value == 8:
                return C.string_at(data, count.value).decode().rstrip('\0')
            if fmt.value == 32:
                return list(C.cast(data, C.POINTER(C.c_ulong))[:count.value])
            return None
        finally:
            self.lib.XFree(data)

    def windows(self, pid):
        return [w for w in self.property(self.root, '_NET_CLIENT_LIST') or []
                if self.property(w, '_NET_WM_PID') == [pid]]

    def move(self, window, desktop):
        event = Event()
        event.client.type, event.client.send_event = 33, 1
        event.client.display, event.client.window = self.display, window
        event.client.message_type = self.lib.XInternAtom(self.display, b'_NET_WM_DESKTOP', 0)
        event.client.format = 32
        event.client.data.l[0], event.client.data.l[1] = desktop, 2
        if not self.lib.XSendEvent(self.display, self.root, 0,
                (1 << 19) | (1 << 20), C.byref(event)):
            raise RuntimeError('Workspace request failed')
        self.lib.XFlush(self.display)
        wait(lambda: self.property(window, '_NET_WM_DESKTOP') == [desktop], 'Workspace unchanged')

    def close(self):
        self.lib.XCloseDisplay(self.display)


def wait(read, failure):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        value = read()
        if value:
            return value
        time.sleep(0.05)
    raise RuntimeError(failure)


def shells(pid):
    children = set()
    for task in (Path('/proc') / str(pid) / 'task').iterdir():
        try:
            children.update(int(value) for value in (task / 'children').read_text().split())
        except FileNotFoundError:
            pass
    result = []
    for child in children:
        proc = Path('/proc') / str(child)
        try:
            if (proc / 'exe').resolve() != Path('/usr/bin/bash'):
                continue
            stat = (proc / 'stat').read_text()
            fields = stat[stat.rfind(')') + 2:].split()
            result.append({'pid': child, 'start': fields[19], 'tty': fields[4]})
        except FileNotFoundError:
            pass
    return sorted(result, key=lambda row: row['pid'])


def run(output):
    output.mkdir(mode=0o700)
    desktop = Desktop()
    connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    observations = []
    record = {'verdict': 'running', 'observations': observations,
        'limits': ['Counts cover this controlled Bash-only Ghostty process, not per-tab inventory.',
                   'GTK actions do not prove agent assignment, pane-specific docking or lifecycle.',
                   'No Voyager default or global desktop/terminal setting is changed.']}
    log = (output / 'ghostty.log').open('w')
    process = subprocess.Popen(['ghostty', '--gtk-single-instance=false',
        '--confirm-close-surface=false', '--title=Voyager layout experiment',
        '--command=/bin/bash --noprofile --norc', '--working-directory=' + str(output)],
        env={**os.environ, 'GDK_BACKEND': 'x11'}, stdin=subprocess.DEVNULL,
        stdout=log, stderr=log)
    try:
        window = wait(lambda: desktop.windows(process.pid), 'Ghostty window missing')[0]
        bus = desktop.property(window, '_GTK_UNIQUE_BUS_NAME')
        path = desktop.property(window, '_GTK_WINDOW_OBJECT_PATH')
        actual = connection.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'GetConnectionUnixProcessID', GLib.Variant('(s)', (bus,)),
            None, Gio.DBusCallFlags.NONE, 3000, None).unpack()[0]
        if actual != process.pid:
            raise RuntimeError('GTK action owner does not match the launched child')

        def observe(name, expected):
            wait(lambda: len(shells(process.pid)) == expected, 'Unexpected surface count')
            rows = shells(process.pid)
            if len({row['tty'] for row in rows}) != expected:
                raise RuntimeError('Surfaces do not have distinct PTYs')
            observation = {'action': name, 'surfaces': expected, 'children': rows,
                'windows': desktop.windows(process.pid)}
            observations.append(observation)
            print(json.dumps(observation), flush=True)

        def action(name, expected, target=path):
            connection.call_sync(bus, target, 'org.gtk.Actions', 'Activate',
                GLib.Variant('(sava{sv})', (name, [], {})), None,
                Gio.DBusCallFlags.NONE, 3000, None)
            observe(name, expected)

        observe('initial', 1)
        for name, expected in [('split_right', 2), ('split_down', 3), ('split_left', 4),
                ('new_tab', 5), ('split_right', 6), ('close', 5), ('close', 4), ('new_window', 5)]:
            action(name, expected)
        windows = wait(lambda: desktop.windows(process.pid) if len(desktop.windows(process.pid)) == 2 else None,
            'Second window missing')
        second = next(w for w in windows if w != window)
        action('close', 4, desktop.property(second, '_GTK_WINDOW_OBJECT_PATH'))
        count = desktop.property(desktop.root, '_NET_NUMBER_OF_DESKTOPS')[0]
        if count > 1:
            original = desktop.property(window, '_NET_WM_DESKTOP')[0]
            current = desktop.property(desktop.root, '_NET_CURRENT_DESKTOP')
            before = shells(process.pid)
            try:
                desktop.move(window, (original + 1) % count)
                if before != shells(process.pid) or current != desktop.property(desktop.root, '_NET_CURRENT_DESKTOP'):
                    raise RuntimeError('Workspace move changed processes or active desktop')
                observations.append({'action': 'workspace move', 'processes_preserved': True})
            finally:
                desktop.move(window, original)
        else:
            observations.append({'action': 'workspace move', 'state': 'not tested: only one desktop'})
        record['verdict'] = 'pass'
    except Exception as error:
        record.update(verdict='rework', error=str(error))
        raise
    finally:
        (output / 'results.json').write_text(json.dumps(record, indent=2) + '\n')
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        log.close()
        desktop.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    arguments = parser.parse_args()
    if not arguments.output.is_absolute() or arguments.output.exists():
        parser.error('Provide a fresh absolute output directory')
    run(arguments.output)
