import json
import shutil
import time
from pathlib import Path

from playwright.sync_api import expect


def portal_journey(page, evidence, with_companion=False):
    output = evidence / "portals.json"
    result = (
        json.loads(output.read_text())
        if output.exists()
        else {"passed": [], "realCompanion": False, "humanVoice": False}
    )

    def record(name):
        result["passed"].append(name)
        output.write_text(json.dumps(result, indent=2))
        print(name, flush=True)

    def call(action, **fields):
        return page.evaluate(
            "input => api.call('portal', input)", {"action": action, **fields}
        )

    def open_type(kind):
        existing = page.evaluate(
            "type => allLeaves(active().dimension.root).find(p => p.type === type)",
            kind,
        )
        if existing:
            return existing
        page.get_by_role("button", name="New portal", exact=True).click()
        page.locator("select[name=type]").select_option(kind)
        page.locator("#dialog-actions button").click()
        page.wait_for_function(
            "type => allLeaves(active().dimension.root).some(p => p.type === type)",
            arg=kind,
        )
        return page.evaluate(
            "type => allLeaves(active().dimension.root).find(p => p.type === type)",
            kind,
        )

    def frame(portal):
        return page.frame_locator(f'iframe[data-portal="{portal["id"]}"]')

    def snapshot(portal):
        return call("inspect", id=portal["id"])

    catalog = call("catalog")
    root = Path(catalog["root"])
    before = page.evaluate("api.call('processes')")
    original = next(item for item in before["terminals"] if item["state"] == "live")
    result["original"] = {"terminal": original["address"], "pid": original["pid"]}
    if not result["realCompanion"]:
        package = root / "packages/research-card"
        shutil.copytree(root / "packages/notes", package, dirs_exist_ok=True)
        manifest = json.loads((package / "portal.json").read_text())
        manifest.update(
            id="research-card",
            name="Research card",
            seed={
                "title": "Installed while running",
                "text": "An ordinary editable package.",
            },
        )
        (package / "portal.json").write_text(json.dumps(manifest, indent=2))
        page.wait_for_function(
            "() => portalTypes.some(type => type.id === 'research-card')"
        )
        card = open_type("research-card")
        frame(card).get_by_role("textbox", name="Note title").wait_for()
        assert (
            frame(card).get_by_role("textbox", name="Note title").input_value()
            == "Installed while running"
        )
        record("New package appears and opens without app restart")
        source = package / "view.html"
        original_source = source.read_text()
        source.write_text(original_source.replace("NOTES", "LIVE PACKAGE EDIT"))
        frame(card).get_by_text("LIVE PACKAGE EDIT", exact=True).wait_for()
        record("Source edit replaces the applicable live view")
        source.write_text(original_source.replace("let snapshot;", "let snapshot = ;"))
        page.wait_for_selector(".portal-error")
        assert frame(card).get_by_text("LIVE PACKAGE EDIT", exact=True).is_visible()
        source.write_text(original_source.replace("NOTES", "RESTORED PACKAGE"))
        frame(card).get_by_text("RESTORED PACKAGE", exact=True).wait_for()
        record("Invalid JavaScript retains the previous view and a visible error")
        board = open_type("whiteboard")
        frame(board).get_by_role("button", name="+ Note").click()
        frame(board).get_by_role("button", name="New thought", exact=True).wait_for()
        state = snapshot(board)
        state["data"]["nodes"][0]["text"] = "Updated from agent-readable data"
        call("update", id=board["id"], data=state["data"], expected=state["version"])
        frame(board).get_by_role(
            "button", name="Updated from agent-readable data", exact=True
        ).wait_for()
        try:
            call("update", id=board["id"], data={}, expected=state["version"])
            raise AssertionError("stale data write was accepted")
        except Exception as error:
            assert "changed" in str(error)
        record(
            "Whiteboard edits round-trip through the shared data contract; stale writes refuse"
        )
        if with_companion:
            page.locator(f'.portal[data-portal="{board["id"]}"] .dock-spot').dblclick()
            page.wait_for_function(
                "id => state.dock === 'portal:' + id", arg=board["id"]
            )
            if page.locator("#chat").is_hidden():
                page.get_by_role("button", name="Text chat", exact=True).click()
            if result.get("companionRequested"):
                raise AssertionError(
                    "The companion request was already sent. Reconcile its existing result before continuing."
                )
            result["companionRequested"] = True
            output.write_text(json.dumps(result, indent=2))
            page.get_by_role("textbox", name="Message Voyager", exact=True).fill(
                "Inspect the whiteboard portal in your current focus. Change only the first existing note text to 'Verified by Voyager'. Keep all other fields and notes unchanged. Use the named portal tool, read again to verify it, and report the result. Do not change focus, start processes, or edit source files."
            )
            page.get_by_role("button", name="Send message", exact=True).click()
            page.wait_for_function(
                "() => document.querySelector('#chat-state').textContent === 'Ready when you are' && document.querySelector('.message.assistant')",
                timeout=180000,
            )
            assert snapshot(board)["data"]["nodes"][0]["text"] == "Verified by Voyager"
            result["realCompanion"] = True
            result["assistant"] = page.locator(".message.assistant").all_inner_texts()
            page.get_by_role("button", name="Close conversation", exact=True).click()
            record(
                "Real companion inspects, updates and verifies a portal through the generic tool"
            )
    else:
        card = page.evaluate(
            "allLeaves(active().dimension.root).find(p => p.type === 'research-card')"
        )
        board = page.evaluate(
            "allLeaves(active().dimension.root).find(p => p.type === 'whiteboard')"
        )
    page.get_by_role("button", name="Home", exact=False).first.click()
    page.wait_for_function("() => state.view === 'home'")
    page.screenshot(path=str(evidence / "portals-home.png"))
    page.get_by_role("button", name="Workbench", exact=True).click()
    backend = open_type("backend-demo")
    frame(backend).get_by_role("button", name="Ask the backend", exact=True).click()
    expect(frame(backend).locator("pre")).to_contain_text('"pid"')
    backend_before = snapshot(backend)
    pid = backend_before["data"]["backend"]["pid"]
    current = page.evaluate("api.call('processes')")
    assert (
        next(
            item
            for item in current["terminals"]
            if item["address"] == backend["terminal"]
        )["pid"]
        == pid
    )
    data = {**backend_before["data"], "message": "Live backend data changed"}
    call("update", id=backend["id"], data=data, expected=backend_before["version"])
    frame(backend).get_by_role("button", name="Ask the backend", exact=True).click()
    frame(backend).locator("pre").filter(
        has_text="Live backend data changed"
    ).wait_for()
    record("A real Core-owned HTTP backend reflects portal data edits")
    page.locator(f'.portal[data-portal="{card["id"]}"]').get_by_role(
        "button", name="Move this portal", exact=True
    ).click()
    page.locator("select[name=target]").select_option(board["id"])
    page.locator("select[name=position]").select_option("top")
    page.locator("#dialog-actions button").click()
    page.get_by_role("button", name="Dimension layouts", exact=True).click()
    page.get_by_role("button", name="Save current layout", exact=True).click()
    page.locator("input[name=name]").fill("Research layout")
    page.locator("#dialog-actions button").click()
    dimension = page.evaluate("active().dimension.id")
    saved = next(
        item for item in call("catalog")["layouts"] if item.get("owner") == dimension
    )
    saved_root = page.evaluate("active().dimension.root")
    page.locator(f'.portal[data-portal="{card["id"]}"]').get_by_role(
        "button", name="Hide this portal, keep process running", exact=True
    ).click()
    page.evaluate("terminal => api.call('stop', {terminal})", backend["terminal"])
    page.get_by_role("button", name="Dimension layouts", exact=True).click()
    page.get_by_role("button", name="Restore this layout", exact=True).click()
    page.wait_for_function(
        "id => allLeaves(active().dimension.root).some(item => item.id === id)",
        arg=card["id"],
    )
    assert page.evaluate("active().dimension.root") == saved_root
    assert (
        next(
            item
            for item in page.evaluate("api.call('processes')")["terminals"]
            if item["address"] == backend["terminal"]
        )["state"]
        == "finished"
    )
    result["layout"] = saved
    result["backend"] = {
        "terminal": backend["terminal"],
        "pid": pid,
        "stateAfterRestore": "finished",
    }
    record(
        "Move, hide and layout restore preserve identities; stopped backend stays stopped"
    )
    before_removal = snapshot(card)
    page.get_by_role("button", name="Portal packages", exact=True).click()
    page.get_by_role("button", name="Uninstall Research card", exact=True).click()
    page.locator("#dialog header button").click()
    page.get_by_text("research-card is not installed.", exact=False).wait_for()
    assert (
        json.loads(Path(before_removal["dataFile"]).read_text())
        == before_removal["data"]
    )
    page.get_by_role("button", name="Portal packages", exact=True).click()
    page.get_by_role("button", name="Restore research-card", exact=True).click()
    page.locator("#dialog header button").click()
    frame(card).get_by_text("RESTORED PACKAGE", exact=True).wait_for()
    after = page.evaluate("api.call('processes')")
    assert (
        next(
            item
            for item in after["terminals"]
            if item["address"] == original["address"]
        )["pid"]
        == original["pid"]
    )
    assert snapshot(card)["data"] == before_removal["data"]
    assert Path(root / "layouts" / saved["file"]).exists()
    record(
        "Uninstall and restore preserve data, layout references and the unrelated live shell"
    )
    page.screenshot(path=str(evidence / "portals-workbench.png"))


def portal_boundaries(page, evidence):
    page.reload()
    page.wait_for_selector(".xterm-screen")
    portals = page.evaluate(
        "allLeaves(active().dimension.root).filter(p => p.type === 'notes')"
    )
    for _ in range(max(0, 2 - len(portals))):
        page.get_by_role("button", name="New portal", exact=True).click()
        page.locator("select[name=type]").select_option("notes")
        page.locator("#dialog-actions button").click()
        page.wait_for_timeout(250)
        portals = page.evaluate(
            "allLeaves(active().dimension.root).filter(p => p.type === 'notes')"
        )
    page.wait_for_timeout(350)
    assert len(portals) >= 2
    portals = portals[-2:]
    first = page.frame_locator(f'iframe[data-portal="{portals[0]["id"]}"]')
    second = page.frame_locator(f'iframe[data-portal="{portals[1]["id"]}"]')
    expect(first.get_by_role("textbox", name="Note title")).to_be_visible()
    expect(second.get_by_role("textbox", name="Note title")).to_be_visible()
    index = page.locator("iframe").evaluate_all(
        "(frames,id) => frames.findIndex(frame => frame.dataset.portal === id)",
        portals[1]["id"],
    )
    isolation = first.locator("body").evaluate(
        "(body,index) => { try { return typeof parent.frames[index].portal; } catch(error) { return error.name; } }",
        index,
    )
    assert isolation == "SecurityError", isolation
    origin = first.locator("body").evaluate("location.origin")
    assert origin == f"voyager-portal://{portals[0]['id']}"
    before = first.locator("body").evaluate("location.href")
    before_data = page.evaluate(
        "id => api.call('portal',{action:'inspect',id})", portals[0]["id"]
    )
    revision = (
        page.locator(f'iframe[data-portal="{portals[0]["id"]}"]')
        .get_attribute("src")
        .split("v=")[1]
    )
    first.locator("body").evaluate("location.href = 'https://example.com'")
    page.wait_for_timeout(400)
    external_url = first.locator("body").evaluate("location.href")
    first.locator("body").evaluate(
        "(body,input) => parent.postMessage(input,'*')",
        {
            "topic": "voyager-portal",
            "portal": portals[0]["id"],
            "version": revision,
            "op": "update",
            "request": "forged-after-navigation",
            "input": {"data": {"title": "forged"}, "expected": before_data["version"]},
        },
    )
    page.wait_for_timeout(200)
    after_data = page.evaluate(
        "id => api.call('portal',{action:'inspect',id})", portals[0]["id"]
    )
    assert after_data["data"] == before_data["data"]
    catalog = page.evaluate("api.call('portal', {action:'catalog'})")
    file = Path(catalog["root"]) / "packages/notes/portal.json"
    manifest = json.loads(file.read_text())
    previous_revision = page.evaluate(
        "portalTypes.find(t => t.id === 'notes').revision"
    )
    file.write_text(
        json.dumps({**manifest, "description": "Reload after navigation test"})
    )
    page.wait_for_function(
        "previous => portalTypes.find(t => t.id === 'notes').revision > previous",
        arg=previous_revision,
    )
    page.wait_for_function(
        "id => { const frames = Array.from(document.querySelectorAll('iframe')).filter(f => f.dataset.portal === id); return frames.length === 1 && Number(new URL(frames[0].src).searchParams.get('v')) === portalTypes.find(t => t.id === 'notes').revision; }",
        arg=portals[0]["id"],
    )
    expect(first.get_by_role("textbox", name="Note title")).to_be_visible()
    file.write_text(json.dumps({**manifest, "name": {}}))
    page.wait_for_function("() => !!portalTypes.find(t => t.id === 'notes').error")
    page.wait_for_selector(".portal-error")
    assert first.get_by_role("textbox", name="Note title").is_visible()
    file.write_text(json.dumps(manifest))
    page.wait_for_timeout(250)
    page.wait_for_function(
        "id => { const frames = Array.from(document.querySelectorAll('iframe')).filter(f => f.dataset.portal === id); return frames.length === 1 && Number(new URL(frames[0].src).searchParams.get('v')) === portalTypes.find(t => t.id === 'notes').revision; }",
        arg=portals[0]["id"],
    )
    expect(first.get_by_role("textbox", name="Note title")).to_be_visible()
    report = {
        "separateInstanceOrigins": True,
        "siblingApiAccess": isolation,
        "afterNavigationUrl": external_url,
        "forgedUpdateRejectedAfterNavigation": True,
        "invalidManifestRetainedView": True,
        "origin": origin,
    }
    (evidence / "portal-boundaries.json").write_text(json.dumps(report, indent=2))
    print(
        "Separate origins, rejected API rebinding after navigation and invalid-manifest retention passed",
        flush=True,
    )
