import argparse
import ctypes
import json
import os
import select
import shlex
import signal
import subprocess
import time
from pathlib import Path

from gi.repository import Gio, GLib


def wait_until(predicate, label, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.05)
    raise RuntimeError(label)


def inventory(binary):
    return json.loads(subprocess.check_output([binary], text=True))["windows"]


def line(process):
    ready, _, _ = select.select([process.stdout], [], [], 5)
    if not ready:
        raise RuntimeError("Rust inspection response timed out")
    result = process.stdout.readline()
    if not result:
        raise RuntimeError(process.stderr.read())
    return json.loads(result)


def alive(handle):
    poll = select.poll()
    poll.register(handle, select.POLLIN)
    return not poll.poll(0)


def duplicate_master(terminal_handle, pid, tty):
    index = tty.rsplit("/", 1)[1]
    matches = []
    for entry in Path(f"/proc/{pid}/fdinfo").iterdir():
        try:
            if any(row.split() == ["tty-index:", index] for row in entry.read_text().splitlines()):
                matches.append(int(entry.name))
        except FileNotFoundError:
            continue
    if len(matches) != 1:
        raise RuntimeError("Ambiguous PTY master")
    libc = ctypes.CDLL(None, use_errno=True)
    result = libc.syscall(438, terminal_handle, matches[0], 0)
    if result < 0:
        raise OSError(ctypes.get_errno(), "pidfd_getfd refused; policy is unchanged")
    return result


def gtk_identity(window):
    def property_value(name):
        output = subprocess.check_output(
            ["xprop", "-id", str(window), name], text=True
        )
        return output.split('"')[1]

    return property_value("_GTK_UNIQUE_BUS_NAME"), property_value("_GTK_WINDOW_OBJECT_PATH")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[1]
    inspect = root / "target/debug/examples/adoption_inspect"
    windows = root / "target/debug/voyager-windows"
    processes, handles, inspectors, shells = [], [], [], []
    report = {"surface": "Ghostty XWayland with ordinary Bash startup", "cases": []}
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    try:
        for mode in ("caught", "ignored"):
            log = (args.output / f"{mode}.log").open("w")
            with log:
                terminal = subprocess.Popen(
                    ["ghostty", "--gtk-single-instance=false", "--confirm-close-surface=false", "-e", "/bin/bash"],
                    env={**os.environ, "GDK_BACKEND": "x11"},
                    cwd=args.output,
                    stdin=subprocess.DEVNULL,
                    stdout=log,
                    stderr=log,
                )
            processes.append(terminal)
            window = wait_until(
                lambda: next((w for w in inventory(windows) if w["pid"] == terminal.pid), None),
                "Native window missing",
            )["id"]
            time.sleep(0.5)
            inspector = subprocess.Popen(
                [inspect, str(window), "--retain"],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, bufsize=1,
            )
            inspectors.append(inspector)
            retained = line(inspector)
            shell = retained["shell"]
            shell_handle = os.pidfd_open(shell["pid"])
            terminal_handle = os.pidfd_open(terminal.pid)
            shells.append(shell_handle)
            handles.extend([shell_handle, terminal_handle])
            master = duplicate_master(terminal_handle, terminal.pid, retained["tty"])
            handles.append(master)
            acknowledged = args.output / f"{mode}.ready"
            handler = ":" if mode == "caught" else ""
            command = (
                f"unset HISTFILE; trap {shlex.quote(handler)} HUP; "
                f"export VOYAGER_ADOPTION_PROBE=retained; "
                f"printf '%s' ready > {shlex.quote(str(acknowledged))}\n"
            )
            os.write(master, command.encode())
            wait_until(acknowledged.exists, "Shell did not acknowledge cooperation")
            gtk_bus, gtk_path = gtk_identity(window)
            owner = bus.call_sync(
                "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
                "GetConnectionUnixProcessID", GLib.Variant("(s)", (gtk_bus,)),
                None, Gio.DBusCallFlags.NONE, 3000, None,
            ).unpack()[0]
            if owner != terminal.pid:
                raise RuntimeError("GTK owner changed")
            error = None
            try:
                bus.call_sync(
                    gtk_bus, gtk_path, "org.gtk.Actions", "Activate",
                    GLib.Variant("(sava{sv})", ("close", [], {})),
                    None, Gio.DBusCallFlags.NONE, 2000, None,
                )
            except GLib.GError as failure:
                error = str(failure)
            time.sleep(0.3)
            inspector.stdin.write("status\n")
            inspector.stdin.flush()
            status = line(inspector)
            visible = any(w["id"] == window for w in inventory(windows))
            report["cases"].append({
                "handler": mode, "inspection": retained, "after_close": status,
                "window_remains": visible, "native_close_error": error,
                "cooperation_acknowledged": acknowledged.read_text() == "ready",
            })
            if alive(shell_handle):
                signal.pidfd_send_signal(shell_handle, signal.SIGKILL)
            wait_until(lambda: not alive(shell_handle), "Probe Bash did not exit")
            terminal.wait(timeout=5)
            inspector.stdin.close()
            inspector.wait(timeout=5)
        report["result"] = (
            "candidate: graceful closure preserved Bash; lifecycle parity remains unproved"
            if any(not case["window_remains"] and case["after_close"]["shell_alive"] and case["native_close_error"] is None for case in report["cases"])
            else "rework: neither handler established graceful persistent adoption"
        )
    finally:
        for handle in shells:
            if alive(handle):
                signal.pidfd_send_signal(handle, signal.SIGKILL)
        for inspector in inspectors:
            if inspector.poll() is None:
                inspector.kill()
            inspector.wait(timeout=5)
        for process in processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
        for handle in handles:
            os.close(handle)
        report["cleanup"] = "Only disposable probe processes stopped; global config unchanged"
        (args.output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 2 if report["result"].startswith("rework:") else 0


if __name__ == "__main__":
    raise SystemExit(main())
