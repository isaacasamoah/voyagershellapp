import json
from pathlib import Path

from playwright.sync_api import expect
from proof_common import content_directory, open_picker, processes, recorder, settled


def picker_journey(page, evidence, reject=True):
    picker = page.locator("#content-picker")
    opener = page.locator(
        '.portal-header [aria-label="Split this Vessel side by side"]'
    ).first

    initial = processes(page)
    record = recorder(evidence, "picker")

    def same_processes(page):
        assert processes(page) == initial

    open_picker(page, opener)
    bounds, origin = picker.bounding_box(), opener.bounding_box()
    assert abs(bounds["y"] - origin["y"] - origin["height"]) <= 12
    page.keyboard.press("Escape")
    expect(opener).to_be_focused()
    same_processes(page)
    record("Picker opens beside the control; Escape returns focus and creates nothing")
    open_picker(page, opener)
    page.get_by_role("button", name="Text chat", exact=True).click()
    expect(picker).to_be_hidden()
    expect(page.locator("#chat")).to_be_visible()
    page.get_by_role("button", name="Close conversation", exact=True).click()
    same_processes(page)
    record(
        "Outside click follows the requested control without stealing focus or creating content"
    )
    open_picker(page, opener)
    page.evaluate(
        "window.oldPickerChoice = document.querySelector('#content-picker button')"
    )
    page.get_by_role("button", name="New Fleet", exact=True).click()
    page.wait_for_function("() => active().realm.dimensions.length === 2")
    settled(page)
    expect(picker).to_be_hidden()
    initial = processes(page)
    page.evaluate("window.oldPickerChoice.click()")
    same_processes(page)
    open_picker(page, opener)
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
    page.locator("iframe.portal-frame:not([hidden])").content_frame.locator(
        "body"
    ).click()
    same_processes(page)
    record(
        "Fleet navigation invalidates old choices and keyboard activation creates Notes in the new Fleet"
    )
    notes = page.locator(".portal").filter(has=page.locator(".web-portal")).first
    split = notes.get_by_role(
        "button", name="Split this Vessel top and bottom", exact=True
    )
    split.focus()
    split.click()
    expect(picker).to_be_visible()
    page.evaluate(
        "window.oldPickerChoice = document.querySelector('#content-picker button')"
    )
    opener.focus()
    opener.click()
    page.evaluate("window.oldPickerChoice.click()")
    expect(picker).to_be_visible()
    same_processes(page)
    page.keyboard.press("Escape")
    record("A new opener invalidates the old Split selection")
    types = content_directory(evidence) / "packages"
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
    open_picker(page, opener)
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
    same_processes(page)
    page.keyboard.press("Escape")
    expect(opener).to_be_focused()
    record(
        "Live catalogue addition and removal refresh an open picker; removed controls cannot create"
    )
    split = notes.get_by_role(
        "button", name="Split this Vessel side by side", exact=True
    )
    split.focus()
    split.click()
    page.evaluate(
        "window.singleChoice = document.querySelector('#content-picker [data-type=\"terminal\"]'); singleChoice.click(); singleChoice.click()"
    )
    page.wait_for_function("() => allLeaves(active().dimension.root).length === 3")
    current = processes(page)
    assert len(current) == len(initial) + 1
    assert page.evaluate("active().dimension.root.axis") == "horizontal"
    page.screenshot(path=str(evidence / "picker.png"))
    record(
        "One terminal Split activation creates exactly one live process beside Notes"
    )
    opener.focus()
    opener.click()
    page.locator("iframe.portal-frame:not([hidden])").content_frame.locator(
        "body"
    ).click()
    expect(picker).to_be_hidden()
    record("Clicking embedded web content dismisses the picker")
    moved_id = notes.get_attribute("data-portal")
    open_picker(page, split)
    page.evaluate(
        "window.movedSourceChoice = document.querySelector('#content-picker button')"
    )
    notes.locator(".portal-header").focus()
    page.keyboard.press("Space")
    target = page.locator("[data-dimension]:not(.active)").first
    target.focus()
    page.keyboard.press("Enter")
    settled(page)
    page.wait_for_function(
        "id => allLeaves(active().dimension.root).some(p => p.id === id)", arg=moved_id
    )
    expect(picker).to_be_hidden()
    layout = page.evaluate("JSON.stringify(state)")
    page.evaluate("""() => {
      window.movedSourceAct = act;
      window.movedSourceDispatches = 0;
      act = (...args) => {
        window.movedSourceDispatches++;
        return window.movedSourceAct(...args);
      };
    }""")
    try:
        page.evaluate("window.movedSourceChoice.click()")
        assert page.evaluate("window.movedSourceDispatches") == 0
        assert page.evaluate("JSON.stringify(state)") == layout
        assert processes(page) == current
    finally:
        page.evaluate("() => { act = window.movedSourceAct; }")
    record(
        "Moving the source invalidates its retained Split choice without an action or process"
    )
    if reject:
        picker_rejection(page, evidence, opener)


def picker_rejection(page, evidence, opener=None):
    picker = page.locator("#content-picker")
    current = processes(page)
    page.keyboard.press("Escape")
    if opener is None:
        opener = page.locator(
            '.portal-header [aria-label="Split this Vessel side by side"]'
        ).first
    opener.focus()
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
    assert processes(page) == current
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
