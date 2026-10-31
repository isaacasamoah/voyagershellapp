import argparse
import json
import os
import subprocess
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


root = Path(__file__).resolve().parent
evidence = root / "evidence"
evidence.mkdir(exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument("--launch", action="store_true")
parser.add_argument("--desktop-env")
parser.add_argument("--session", default="voyager-workspace-proof-final")
parser.add_argument("--journey", action="store_true")
parser.add_argument("--chat", action="store_true")
parser.add_argument("--extras", action="store_true")
parser.add_argument("--voice", action="store_true")
args = parser.parse_args()
port = 9473
env = dict(os.environ)
if args.desktop_env:
    env.update(json.loads(Path(args.desktop_env).read_text())[1]["env"])
env["VOYAGER_WORKSPACE_SESSION"] = args.session
if args.launch:
    command = [
        str(root / "node_modules/electron/dist/electron"),
        str(root),
        "--ozone-platform=x11",
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
    ]
    with (evidence / "native.log").open("w") as log:
        process = subprocess.Popen(
            command, env=env, stdout=log, stderr=log, start_new_session=True
        )
    (evidence / "launch.json").write_text(
        json.dumps(
            {"pid": process.pid, "command": command, "session": args.session}, indent=2
        )
    )
    print(f"Native prototype PID {process.pid}")
    time.sleep(3)

with sync_playwright() as playwright:
    browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
    page = browser.contexts[0].pages[0]
    page.wait_for_function(
        "() => typeof state !== 'undefined' && state?.realms?.length > 0"
    )
    page.wait_for_selector(".xterm-screen")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    if args.journey:
        page.locator(".xterm-helper-textarea").first.click()
        page.keyboard.type("printf 'VOYAGER_PORTAL_ONE\\n'")
        page.keyboard.press("Enter")
        page.wait_for_function(
            "() => [...terminals.values()].some(v => Array.from({length:v.term.buffer.active.length},(_,i)=>v.term.buffer.active.getLine(i)?.translateToString()).join('\\n').includes('VOYAGER_PORTAL_ONE'))"
        )
        page.get_by_role("button", name="Split side by side", exact=True).click()
        page.wait_for_function(
            "() => document.querySelectorAll('.portal').length === 2"
        )
        page.locator(".xterm-helper-textarea").nth(1).click()
        page.keyboard.type("printf 'VOYAGER_PORTAL_TWO\\n'")
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        page.get_by_role("button", name="Split top and bottom", exact=True).click()
        page.wait_for_function(
            "() => document.querySelectorAll('.portal').length === 3"
        )
        divider = page.get_by_role("separator").first
        bounds = divider.bounding_box()
        page.mouse.move(bounds["x"] + 2, bounds["y"] + 50)
        page.mouse.down()
        page.mouse.move(bounds["x"] + 90, bounds["y"] + 50, steps=6)
        page.mouse.up()
        page.get_by_role("button", name="New dimension", exact=True).click()
        page.wait_for_function("() => state.realms[0].dimensions.length === 2")
        page.get_by_role("button", name="Workbench", exact=True).click()
        page.wait_for_function(
            "() => document.querySelectorAll('.portal').length === 3"
        )
        page.get_by_role("button", name="Toggle sidebar", exact=True).click()
        page.wait_for_selector("#dimension-avatar #avatar")
        page.get_by_role(
            "button", name="Bring Voyager here", exact=True
        ).first.dblclick()
        page.wait_for_selector(".portal-dock #avatar")
        page.keyboard.press("Control+1")
        page.wait_for_selector("#avatar-home #avatar")
        page.get_by_role("button", name="Toggle conversation", exact=True).click()
        page.screenshot(path=str(evidence / "workspace.png"))
        page.get_by_role("button", name="Minimize Voyager", exact=True).click()
        assert page.evaluate("window.voyager.call('window-state')")["minimized"]
        identity = json.loads((evidence / "launch.json").read_text())
        windows = subprocess.check_output(
            [
                "xdotool",
                "search",
                "--all",
                "--pid",
                str(identity["pid"]),
                "--name",
                "^Voyager$",
            ],
            env=env,
            text=True,
        ).split()
        assert len(windows) == 1
        properties = subprocess.check_output(
            ["xprop", "-id", windows[0], "_NET_WM_PID", "_NET_WM_NAME"],
            env=env,
            text=True,
        )
        assert f"= {identity['pid']}" in properties and '"Voyager"' in properties
        subprocess.run(["xdotool", "windowmap", windows[0]], env=env, check=True)
        subprocess.run(["xdotool", "windowactivate", windows[0]], env=env, check=True)
        assert not page.evaluate("window.voyager.call('window-state')")["minimized"]
        page.get_by_role("button", name="New realm", exact=True).click()
        page.get_by_label("Name", exact=True).fill("Studio")
        page.get_by_role("button", name="Create", exact=True).click()
        page.wait_for_function("() => state.realms.length === 2")
        page.get_by_role("button", name="Voyager", exact=True).click()
        page.wait_for_function(
            "() => document.querySelectorAll('.portal').length === 3"
        )
        result = {
            "phase": "native-workspace",
            "portals": page.locator(".portal").count(),
            "state": page.evaluate("state"),
            "processes": page.evaluate("window.voyager.call('processes')"),
            "nativeMinimizeAndRestore": True,
            "errors": errors,
        }
        (evidence / "journey.json").write_text(json.dumps(result, indent=2))
        print(
            "Workspace, terminal input, splits, resize, tabs, docking, native minimize and restore passed."
        )
    if args.journey or args.extras:
        page.get_by_role("button", name="Dimension 2", exact=True).dblclick()
        page.get_by_label("Name", exact=True).fill("Notes")
        page.get_by_role("button", name="Save", exact=True).click()
        page.get_by_role("button", name="Notes", exact=True).click()
        page.wait_for_function(
            "() => document.querySelectorAll('.portal').length === 1"
        )
        before = page.evaluate(
            "({terminal:allLeaves(active().dimension.root)[0].terminal})"
        )
        terminal = before["terminal"]
        processes = page.evaluate("window.voyager.call('processes')")["terminals"]
        original_pid = next(
            item["pid"] for item in processes if item["address"] == terminal
        )
        page.get_by_role(
            "button", name="Hide this portal, keep process running", exact=True
        ).click()
        page.get_by_role("button", name="Show running processes", exact=True).click()
        row = page.locator(".process-row").filter(has_text=f"{terminal} ·")
        row.get_by_role("button", name="Open this process", exact=True).click()
        page.wait_for_function(
            "() => document.querySelectorAll('.portal').length === 1"
        )
        current = page.evaluate("window.voyager.call('processes')")["terminals"]
        assert (
            next(item["pid"] for item in current if item["address"] == terminal)
            == original_pid
        )
        page.locator("#processes").click()
        page.locator(".process-row").filter(has_text=f"{terminal} ·").get_by_role(
            "button", name="Stop this process", exact=True
        ).click()
        page.get_by_role("button", name="Start a new shell", exact=True).click()
        page.wait_for_function(
            "() => !document.querySelector('.ended') && [...terminals.values()].filter(v=>v.node.isConnected).every(v=>v.attached)"
        )
        restarted = page.evaluate("allLeaves(active().dimension.root)[0].terminal")
        assert restarted != terminal
        page.get_by_role("button", name="Workbench", exact=True).click()
        page.wait_for_function(
            "() => document.querySelectorAll('.portal').length === 3"
        )
        (evidence / "extras.json").write_text(
            json.dumps(
                {
                    "hiddenProcessPidPreserved": original_pid,
                    "stoppedTerminal": terminal,
                    "explicitNewShell": restarted,
                    "errors": errors,
                },
                indent=2,
            )
        )
        print(
            "Rename, hide/show without process loss, explicit stop and explicit new shell passed."
        )
    if args.chat:
        if page.locator("#chat").is_hidden():
            page.get_by_role("button", name="Toggle conversation", exact=True).click()
        page.get_by_role("textbox", name="Message Voyager").fill(
            'Inspect this workspace, create a dimension named Research, and in its shell run printf "CORE_CHAT_PROVED\\n". Read the actual output and tell me what happened. Do not start agents or change any files.'
        )
        page.get_by_role("button", name="Send message", exact=True).click()
        page.wait_for_function(
            "() => document.querySelector('#chat-state').textContent === 'Ready when you are' && document.querySelector('.message.assistant')",
            timeout=180000,
        )
        assert page.get_by_role("button", name="Research", exact=True).count() == 1
        assert page.locator(".message.assistant").last.inner_text()
        (evidence / "chat.json").write_text(
            json.dumps(
                {
                    "messages": page.locator("#messages").inner_text(),
                    "state": page.evaluate("state"),
                    "errors": errors,
                },
                indent=2,
            )
        )
        page.screenshot(path=str(evidence / "chat.png"))
        print("Real Codex conversation and Core workspace effects completed.")
    if args.voice:
        if page.locator("#chat").is_hidden():
            page.get_by_role("button", name="Toggle conversation", exact=True).click()
        page.get_by_role("button", name="Start voice", exact=True).click()
        page.wait_for_function(
            "() => document.querySelector('#voice').getAttribute('aria-pressed') === 'true'",
            timeout=90000,
        )
        page.wait_for_function(
            "() => document.querySelector('#voice').dataset.connection === 'connected'",
            timeout=30000,
        )
        page.screenshot(path=str(evidence / "voice.png"))
        page.get_by_role("button", name="Stop voice", exact=True).click()
        page.wait_for_function(
            "() => document.querySelector('#voice').getAttribute('aria-pressed') === 'false'"
        )
        (evidence / "voice.json").write_text(
            json.dumps(
                {
                    "negotiated": True,
                    "input": "Chromium synthetic microphone",
                    "audibleHumanTrial": False,
                    "errors": errors,
                },
                indent=2,
            )
        )
        print(
            "Native realtime WebRTC negotiated and stopped. Human microphone and audibility remain unproved."
        )
    browser.close()
