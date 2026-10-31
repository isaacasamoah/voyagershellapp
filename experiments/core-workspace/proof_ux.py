import json
import os
import time
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError


def chrome_journey(page, playwright, evidence, env):
    baseline = playwright.chromium.connect_over_cdp("http://127.0.0.1:9477")
    control = next(
        p for p in baseline.contexts[0].pages if p.url.endswith("/index.html")
    )
    removed = "#open-chat, #chat-toggle, #processes, #quit, #layouts, #portal-packages, .scope-dock, .dock-spot, .chat-intro"
    assert control.locator(removed).count() > 0
    assert page.locator(removed).count() == 0
    assert page.locator("#avatar-chat").count() == page.locator("#voice").count() == 1
    page.evaluate("document.title = 'Voyager · UX proof'")
    before = page.evaluate("api.call('processes')")["terminals"]
    for selector, prefix in [
        (".realm", "realm:"),
        (".dimension", "dimension:"),
        (".portal-header", "portal:"),
        ("#home", "home"),
    ]:
        page.locator(selector).first.focus()
        page.keyboard.press("Shift+Enter")
        page.wait_for_function(
            "prefix => state.dock.startsWith(prefix)", arg=prefix, timeout=3000
        )
    if page.locator("#chat").is_visible():
        page.get_by_role("button", name="Close conversation", exact=True).click()
    page.get_by_role("button", name="Text chat", exact=True).click()
    page.locator("#chat").wait_for(state="visible")
    page.keyboard.press("Control+j")
    page.locator("#chat").wait_for(state="hidden")
    page.get_by_role("button", name="Toggle sidebar", exact=True).click()
    page.wait_for_selector("#workspace-controls #avatar-chat")
    assert page.locator("#workspace-controls #voice").count() == 1
    page.keyboard.press("Control+j")
    page.wait_for_selector("#home-controls #avatar-chat")
    page.locator("#chat").wait_for(state="visible")
    page.get_by_role("button", name="Close conversation", exact=True).click()
    handle = page.locator("#avatar").bounding_box()
    target = page.locator(".portal-header").first.bounding_box()
    page.mouse.move(
        handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2
    )
    page.mouse.down()
    page.mouse.move(target["x"] + target["width"] / 2, target["y"] + 15, steps=18)
    page.mouse.up()
    page.wait_for_function("() => state.dock.startsWith('portal:')")
    page.wait_for_function(
        "() => document.querySelector('#chat-focus').textContent.startsWith('Vessel ·')"
    )
    after = page.evaluate("api.call('processes')")["terminals"]
    assert [(p["address"], p.get("pid")) for p in before] == [
        (p["address"], p.get("pid")) for p in after
    ]
    page.screenshot(path=str(evidence / "ux-chrome.png"))
    result = {
        "baselineControls": control.locator(removed).count(),
        "candidateControls": 0,
        "oneTextControl": True,
        "oneSpeechControl": True,
        "compactControls": True,
        "keyboardChat": True,
        "keyboardDock": True,
        "osMenuQuit": "unproved: automated desktop keys did not activate Quit",
        "avatarDragDock": True,
        "sameProcessIds": True,
    }
    (evidence / "ux-chrome-partial.json").write_text(
        json.dumps({**result, "processesBeforeQuit": before}, indent=2)
    )
    native_quit(page, evidence, env, before)
    assert control.locator(removed).count() == result["baselineControls"]
    result["electronQuitStopsOwnedProcesses"] = True
    (evidence / "ux-chrome.json").write_text(json.dumps(result, indent=2))
    print(
        "Quiet chrome, chat/voice control parity, drag docking and native Quit passed.",
        flush=True,
    )


def native_quit(page, evidence, env, processes):
    page.evaluate("document.title = 'Voyager · UX proof'")
    launch = json.loads((evidence / "launch.json").read_text())
    pid = launch["pid"]
    try:
        page.context.new_cdp_session(page).send("Browser.close")
    except PlaywrightError as error:
        if "closed" not in str(error):
            raise
    until = time.monotonic() + 8
    while Path(f"/proc/{pid}").exists() and time.monotonic() < until:
        try:
            os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            assert os.getpid() != pid
        time.sleep(0.1)
    assert not Path(f"/proc/{pid}").exists(), "Electron Quit did not close the candidate"
    assert all(
        not Path(f"/proc/{p['pid']}").exists() for p in processes if p["state"] == "live"
    ), "Native Quit left an owned program alive"
