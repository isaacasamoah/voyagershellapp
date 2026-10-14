"""One user-selected screenshot through the Linux desktop portal (Python GI)."""
import json
import os
import signal
import sys

from gi.repository import Gio, GLib

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
portal = "org.freedesktop.portal.Desktop"
request_interface = "org.freedesktop.portal.Request"
token = f"voyager{os.getpid()}"
sender = bus.get_unique_name()[1:].replace(".", "_")
request = f"/org/freedesktop/portal/desktop/request/{sender}/{token}"
loop = GLib.MainLoop()
result = None


def response(_bus, _sender, _path, _interface, _signal, parameters):
    global result
    status, values = parameters.unpack()
    if status == 0:
        result = {"uri": values["uri"]}
    elif status == 1:
        result = {"cancelled": True}
    else:
        result = {"error": "Desktop capture failed"}
    loop.quit()


def cancel(*_args):
    global result
    result = {"cancelled": True}
    loop.quit()
    return False


subscription = bus.signal_subscribe(
    portal, request_interface, "Response", request, None,
    Gio.DBusSignalFlags.NONE, response,
)
signal.signal(signal.SIGTERM, cancel)
signal.signal(signal.SIGINT, cancel)
try:
    options = {
        "handle_token": GLib.Variant("s", token),
        "interactive": GLib.Variant("b", True),
    }
    handle, = bus.call_sync(
        portal, "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Screenshot", "Screenshot",
        GLib.Variant("(sa{sv})", ("", options)), GLib.VariantType.new("(o)"),
        Gio.DBusCallFlags.NONE, 10000, None,
    ).unpack()
    if handle != request:
        raise RuntimeError("Desktop portal returned an unexpected request path")
    GLib.timeout_add_seconds(120, cancel)
    if result is None:
        loop.run()
    print(json.dumps(result))
except Exception as error:
    print(json.dumps({"error": str(error)}))
    sys.exit(1)
finally:
    bus.signal_unsubscribe(subscription)
    try:
        bus.call_sync(
            portal, request, request_interface, "Close", None, None,
            Gio.DBusCallFlags.NONE, 1000, None,
        )
    except GLib.Error:
        pass  # A completed request has already closed.
