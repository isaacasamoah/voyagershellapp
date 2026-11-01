import json
from pathlib import Path

from playwright.sync_api import expect


def processes(page):
    return {
        item["address"]: item["pid"]
        for item in page.evaluate("api.call('processes')")["terminals"]
    }


def recorder(evidence, name):
    passed = []

    def record(step):
        passed.append(step)
        (evidence / (name + ".json")).write_text(
            json.dumps({"passed": passed, "modelRequests": 0}, indent=2)
        )
        print(step, flush=True)

    return record


def settled(page):
    page.wait_for_function("""() => {
      const ids = [...document.querySelectorAll('.portal')].map(n => n.dataset.portal);
      return document.querySelector('.dimension.active')?.dataset.dimension === active().dimension.id
        && allLeaves(active().dimension.root).every(p => ids.includes(p.id));
    }""")


def open_picker(page, opener):
    opener.focus()
    opener.click()
    expect(page.locator("#content-picker")).to_be_visible()
    expect(page.locator("#dialog")).to_be_hidden()


def content_directory(evidence):
    session = json.loads((evidence / "launch.json").read_text())["session"]
    return Path.home() / ".config" / session / "portals"
