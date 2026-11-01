import json
from pathlib import Path

from playwright.sync_api import expect


def picker_journey(page, evidence):
    picker = page.locator("#content-picker")
    opener = page.get_by_role("button", name="New Vessel", exact=True)

    def processes():
        return {
            p["address"]: p["pid"]
            for p in page.evaluate("api.call('processes')")["terminals"]
        }

    initial = processes()
    results = []

    def record(name):
        results.append(name)
        (evidence / "picker.json").write_text(
            json.dumps({"passed": results, "modelRequests": 0}, indent=2)
        )
        print(name, flush=True)

    def open_picker():
        opener.click()
        expect(picker).to_be_visible()
        assert not page.locator("#dialog").is_visible()

    def same_processes():
        assert processes() == initial

    open_picker()
    bounds, origin = picker.bounding_box(), opener.bounding_box()
    assert abs(bounds["y"] - origin["y"] - origin["height"]) <= 12
    page.keyboard.press("Escape")
    expect(opener).to_be_focused()
    same_processes()
    record("Picker opens beside the control; Escape returns focus and creates nothing")
    open_picker()
    page.get_by_role("button", name="Text chat", exact=True).click()
    expect(picker).to_be_hidden()
    expect(page.locator("#chat")).to_be_visible()
    page.get_by_role("button", name="Close conversation", exact=True).click()
    same_processes()
    record(
        "Outside click follows the requested control without stealing focus or creating content"
    )
    open_picker()
    page.evaluate(
        "window.oldPickerChoice = document.querySelector('#content-picker button')"
    )
    page.get_by_role("button", name="New Fleet", exact=True).click()
    page.wait_for_function("() => active().realm.dimensions.length === 2")
    expect(picker).to_be_hidden()
    initial = processes()
    page.evaluate("window.oldPickerChoice.click()")
    same_processes()
    open_picker()
    expect(picker).to_contain_text(page.evaluate("active().dimension.name"))
    page.keyboard.press("ArrowDown")
    expect(picker.locator("button").nth(1)).to_be_focused()
    picker.get_by_role("button", name="Notes", exact=True).focus()
    page.keyboard.press("Enter")
    page.wait_for_selector(".portal-frame")
    assert page.evaluate(
        "allLeaves(active().dimension.root).some(p => p.type === 'notes')"
    )
    notes = page.locator(".portal").filter(has=page.locator(".web-portal")).first
    page.locator("iframe.portal-frame").content_frame.locator("body").click()
    same_processes()
    record(
        "Fleet navigation invalidates old choices and keyboard activation creates Notes in the new Fleet"
    )
    notes.get_by_role(
        "button", name="Split this Vessel top and bottom", exact=True
    ).click()
    expect(picker).to_be_visible()
    page.evaluate(
        "window.oldPickerChoice = document.querySelector('#content-picker button')"
    )
    opener.click()
    page.evaluate("window.oldPickerChoice.click()")
    expect(picker).to_be_visible()
    same_processes()
    page.keyboard.press("Escape")
    record("A new opener invalidates the old Split selection")
    profile = (
        Path.home()
        / ".config"
        / json.loads((evidence / "launch.json").read_text())["session"]
    )
    types = profile / "portals" / "packages"
    assert types.exists(), str(types)
    package = types / "picker-trial"
    package.mkdir()
    manifest = {
        "id": "picker-trial",
        "name": "Picker trial",
        "renderer": "web",
        "entry": "view.html",
        "seed": {},
    }
    (package / "view.html").write_text(
        "<!doctype html><title>Picker trial</title><p>Live type</p>"
    )
    open_picker()
    (package / "portal.json").write_text(json.dumps(manifest))
    choice = picker.get_by_role("button", name="Picker trial", exact=True)
    expect(choice).to_be_visible()
    choice.focus()
    page.evaluate(
        "window.removedChoice = document.querySelector('#content-picker [data-type=\"picker-trial\"]')"
    )
    package.rename(types / "picker-trial-removed")
    expect(choice).to_have_count(0)
    page.evaluate("window.removedChoice.click()")
    expect(picker).to_be_visible()
    same_processes()
    page.keyboard.press("Escape")
    expect(opener).to_be_focused()
    record(
        "Live catalogue addition and removal refresh an open picker; removed controls cannot create"
    )
    notes.get_by_role(
        "button", name="Split this Vessel side by side", exact=True
    ).click()
    page.evaluate(
        "window.singleChoice = document.querySelector('#content-picker [data-type=\"terminal\"]'); singleChoice.click(); singleChoice.click()"
    )
    page.wait_for_function("() => allLeaves(active().dimension.root).length === 3")
    current = processes()
    assert len(current) == len(initial) + 1
    assert page.evaluate("active().dimension.root.axis") == "horizontal"
    page.screenshot(path=str(evidence / "picker.png"))
    record(
        "One terminal Split activation creates exactly one live process beside Notes"
    )
    opener.click()
    page.locator("iframe.portal-frame").content_frame.locator("body").click()
    expect(picker).to_be_hidden()
    record("Clicking embedded web content dismisses the picker")
    picker_rejection(page, evidence)


def picker_rejection(page, evidence):
    picker = page.locator("#content-picker")
    current = {
        p["address"]: p["pid"]
        for p in page.evaluate("api.call('processes')")["terminals"]
    }
    page.keyboard.press("Escape")
    opener = page.get_by_role("button", name="New Vessel", exact=True)
    opener.click()
    page.evaluate(
        "() => { if (window.priorAct) act = window.priorAct; window.priorAct = act; window.pickerDispatches = 0; act = (...args) => { window.pickerDispatches++; return window.priorAct(...args) }; }"
    )
    import subprocess

    session = json.loads((evidence / "launch.json").read_text())["session"]
    subprocess.run(
        [
            "node",
            "-e",
            """
const {Core}=require('./core.cjs');
(async()=>{
  const core=new Core(process.argv[1]);
  await core.open();
  const doc=await core.rpc('doc.get',{name:'voyager-workspace'});
  await core.rpc('doc.set',{name:'voyager-workspace',value:doc.value,version:doc.version});
  core.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
""",
            session,
        ],
        cwd=Path(__file__).resolve().parent,
        check=True,
    )
    picker.get_by_role("button", name="Notes", exact=True).click()
    expect(page.locator("#toast")).to_contain_text("Layout save unconfirmed")
    page.wait_for_timeout(500)
    assert page.evaluate("window.pickerDispatches") == 1
    assert {
        p["address"]: p["pid"]
        for p in page.evaluate("api.call('processes')")["terminals"]
    } == current
    page.evaluate("() => { act = window.priorAct; }")
    (evidence / "picker-rejection.json").write_text(
        json.dumps(
            {"realServiceRejection": True, "dispatches": 1, "processesUnchanged": True},
            indent=2,
        )
    )
    print(
        "Actual service save rejection is visible after one dispatch, without replay or process creation"
    )
