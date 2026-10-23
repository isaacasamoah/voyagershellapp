import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, timeout=5).stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", required=True, type=Path)
    parser.add_argument("--cycles", type=int, default=30)
    parser.add_argument("--resize-only", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.cycles <= 300 or not args.probe.is_absolute():
        parser.error("use an absolute probe path and 1–300 cycles")
    root = Path(tempfile.mkdtemp(prefix="voyager-window-probe-"))
    fixture = root / "terminal.py"
    fixture.write_text(
        "import time\n"
        "from pathlib import Path\n"
        "count = 0\n"
        "while True:\n"
        " print('frame', count, flush=True)\n"
        " count += 1\n"
        " temporary = Path(__file__ + '.tmp')\n"
        " temporary.write_text(str(count))\n"
        " temporary.replace(__file__ + '.tick')\n"
        " time.sleep(.2)\n"
    )
    result = {
        "mode": "resize-only" if args.resize_only else "minimise-restore-resize",
        "cycles_requested": args.cycles,
        "observations": [],
        "limits": "Standalone Ghostty; no Voyager service, Codex, docking or voice",
    }
    child = None
    try:
        with (root / "stderr.log").open("wb") as log:
            child = subprocess.Popen(
                [
                    "ghostty",
                    "--gtk-single-instance=false",
                    "--confirm-close-surface=false",
                    "--title=Voyager disposable window probe",
                    "-e",
                    sys.executable,
                    "-u",
                    str(fixture),
                ],
                env={**os.environ, "GDK_BACKEND": "x11"},
                stdout=subprocess.DEVNULL,
                stderr=log,
                start_new_session=True,
            )
            window = None
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and child.poll() is None:
                windows = json.loads(run(str(args.probe)))["windows"]
                found = [w for w in windows if w.get("pid") == child.pid and w.get("visible")]
                if len(found) == 1:
                    window = str(found[0]["id"])
                    break
                time.sleep(.1)
            if window is None:
                raise RuntimeError("the probe's native window did not map uniquely")
            result.update(pid=child.pid, window=window)
            for index in range(args.cycles):
                if child.poll() is not None:
                    raise RuntimeError("the probe's terminal exited")
                windows = json.loads(run(str(args.probe)))["windows"]
                if not any(str(w["id"]) == window and w.get("pid") == child.pid for w in windows):
                    raise RuntimeError("the probe's window identity changed")
                if not args.resize_only:
                    run("xdotool", "windowminimize", window)
                    time.sleep(.08)
                    run("xdotool", "windowmap", window)
                run("xdotool", "windowactivate", "--sync", window)
                run("xdotool", "windowsize", window, str(800 + index % 2 * 120), str(600 + index % 3 * 40))
                time.sleep(.15)
                before = run("import", "-window", window, "rgb:-")
                tick_before = int(Path(str(fixture) + ".tick").read_text())
                time.sleep(.4)
                after = run("import", "-window", window, "rgb:-")
                if before == after:
                    time.sleep(2)
                    after = run("import", "-window", window, "rgb:-")
                tick_after = int(Path(str(fixture) + ".tick").read_text())
                observation = {
                    "cycle": index,
                    "frames_differ": before != after,
                    "writer_progress": tick_after > tick_before,
                    "ticks": [tick_before, tick_after],
                    "alive": child.poll() is None,
                    "before_sha256": hashlib.sha256(before).hexdigest(),
                    "after_sha256": hashlib.sha256(after).hexdigest(),
                }
                result["observations"].append(observation)
                print(json.dumps(observation), flush=True)
                if not observation["frames_differ"] or not observation["writer_progress"]:
                    (root / "stalled.png").write_bytes(run("import", "-window", window, "png:-"))
                    result["outcome"] = "stalled" if observation["alive"] and observation["writer_progress"] else "fixture-failed"
                    break
            else:
                result["outcome"] = "responsive-through-sampled-cycles"
    except Exception as error:
        result.update(outcome="probe-failed", error=str(error))
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        (root / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(f"Evidence: {root}", flush=True)
    return 0 if result.get("outcome") == "responsive-through-sampled-cycles" else 1


if __name__ == "__main__":
    sys.exit(main())
