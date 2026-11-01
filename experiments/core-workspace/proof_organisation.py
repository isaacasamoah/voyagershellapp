import json
import subprocess
from playwright.sync_api import expect


def organisation_journey(page, evidence, root, errors, stage="all"):
    placement_only = stage != "all"
    session = json.loads((evidence / "launch.json").read_text())["session"]
    assert session.startswith("voyager-organisation-")
    existing = evidence / "organisation.json"
    result = (
        json.loads(existing.read_text())
        if placement_only
        else {"passed": [], "session": session, "modelRequests": 0}
    )
    assert result["session"] == session

    def button(name):
        return page.get_by_role("button", name=name, exact=True)

    def record(name):
        result["passed"].append(name)
        (evidence / "organisation.json").write_text(json.dumps(result, indent=2))
        print(name, flush=True)

    def rename(selector, kind, value, cancel=False):
        node = page.locator(selector)
        node.focus()
        page.keyboard.press("F2")
        edit = page.get_by_role("textbox", name=f"Rename {kind}", exact=True)
        edit.fill(value)
        edit.press("Escape" if cancel else "Enter")
        edit.wait_for(state="hidden")
        if not cancel:
            expect(node).to_contain_text(value)

    def move(id, destination):
        page.locator(f'.portal[data-portal="{id}"]').get_by_role(
            "button", name="Move this Vessel", exact=True
        ).click()
        page.locator('#dialog select[name="target"]').select_option(destination)
        button("Move").click()
        page.wait_for_function(
            'id => document.querySelector(`.portal[data-portal="${id}"]`)', arg=id
        )
        if destination.startswith("dimension:"):
            page.wait_for_function(
                "id => active().dimension.id === id", arg=destination[10:]
            )

    def processes():
        return {
            p["address"]: p.get("pid")
            for p in page.evaluate("api.call('processes')")["terminals"]
        }

    def document(bump=False):
        script = """
const {Core}=require('./core.cjs');
(async()=>{
 const core=new Core(process.argv[1]);
 await core.open();
 let doc=await core.rpc('doc.get',{name:'voyager-workspace'});
 if(process.argv[2]==='bump') doc=await core.rpc('doc.set',{name:'voyager-workspace',value:doc.value,version:doc.version});
 console.log(JSON.stringify(doc));
 core.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
"""
        return json.loads(
            subprocess.check_output(
                ["node", "-e", script, session, "bump" if bump else "read"],
                cwd=root,
                text=True,
            )
        )

    setup_file = evidence / "organisation-setup.json"
    if placement_only:
        setup = json.loads(setup_file.read_text())
        assert setup["session"] == session
        (
            realm1,
            fleet1,
            realm2,
            fleet2,
            fleet3,
            terminal_id,
            other,
            realm_selector,
            second,
        ) = setup["ids"]
    else:
        first = page.evaluate("state.realms[0]")
        realm1, fleet1 = first["id"], first["activeDimension"]
        terminal = page.evaluate("allLeaves(active().dimension.root)[0]")
        terminal_id = terminal["id"]
        realm_selector = f'[data-realm="{realm1}"]'
        revision = document()["version"]
        rename(realm_selector, "Voyage", "Research")
        assert document()["version"] == revision + 1
        rename(f'[data-dimension="{fleet1}"]', "Fleet", "Build")
        rename(
            f'.portal[data-portal="{terminal_id}"] .portal-header',
            "Vessel",
            "Build shell",
        )
        rename(realm_selector, "Voyage", "Discard this", cancel=True)
        expect(page.locator(realm_selector)).to_contain_text("Research")
        record(
            "Inline rename and Escape preserve identities and cancel without changing the label"
        )
        button("New Voyage").click()
        page.get_by_label("Name", exact=True).fill("Review")
        button("Create").click()
        page.wait_for_function("() => state.realms.length === 2")
        second = page.evaluate("state.realms.find(r => r.name === 'Review')")
        realm2, fleet3 = second["id"], second["activeDimension"]
        page.locator(f'[data-realm="{realm2}"]').drag_to(
            page.locator(realm_selector), target_position={"x": 15, "y": 3}
        )
        page.wait_for_function("id => state.realms[0].id === id", arg=realm2)
        page.locator(f'[data-realm="{realm2}"]').focus()
        page.keyboard.press("Alt+Shift+ArrowDown")
        page.wait_for_function("id => state.realms[0].id === id", arg=realm1)
        page.locator(realm_selector).click()
        page.wait_for_function("id => state.activeRealm === id", arg=realm1)
        page.locator(realm_selector).click()
        edit = page.get_by_role("textbox", name="Rename Voyage", exact=True)
        edit.fill("Research workspace")
        edit.press("Enter")
        expect(page.locator(realm_selector)).to_contain_text("Research workspace")
        page.wait_for_selector(f'[data-dimension="{fleet1}"]')
        button("New Fleet").click()
        page.wait_for_function("() => active().realm.dimensions.length === 2")
        fleet2 = page.evaluate("active().dimension.id")
        other = page.evaluate("allLeaves(active().dimension.root)[0].id")
        first_fleet = page.locator(f'[data-dimension="{fleet1}"]')
        first_fleet.click()
        page.wait_for_function("id => active().dimension.id === id", arg=fleet1)
        first_fleet.click()
        edit = page.get_by_role("textbox", name="Rename Fleet", exact=True)
        edit.fill("")
        edit.press("Enter")
        expect(page.locator("#toast")).to_contain_text("Enter a name")
        expect(first_fleet).to_contain_text("Build")
        first_fleet.focus()
        page.keyboard.press("F2")
        edit = page.get_by_role("textbox", name="Rename Fleet", exact=True)
        edit.fill("Build planned")
        page.locator("#breadcrumb").click()
        expect(first_fleet).to_contain_text("Build planned")
        revision = document()["version"]
        rename(f'[data-dimension="{fleet1}"]', "Fleet", "Build planned")
        assert document()["version"] == revision
        record(
            "Inactive navigation double-clicks, blur-save, empty refusal and unchanged-name no-op"
        )
        page.locator(f'[data-dimension="{fleet2}"]').focus()
        page.keyboard.press("Alt+Shift+ArrowLeft")
        page.wait_for_function(
            "id => active().realm.dimensions[0].id === id", arg=fleet2
        )
        setup_file.write_text(
            json.dumps(
                {
                    "session": session,
                    "ids": [
                        realm1,
                        fleet1,
                        realm2,
                        fleet2,
                        fleet3,
                        terminal_id,
                        other,
                        realm_selector,
                        second,
                    ],
                },
                indent=2,
            )
        )
    if stage == "finish":
        note_id = setup["note_id"]
        data_before, before, dock = setup["data_before"], setup["before"], setup["dock"]
    else:
        page.locator(f'[data-dimension="{fleet2}"]').drag_to(
            page.locator(f'[data-dimension="{fleet1}"]'),
            target_position={"x": 110, "y": 6},
        )
        page.wait_for_function(
            "id => active().realm.dimensions[0].id === id", arg=fleet1
        )
        record("Voyages and Fleets reorder by pointer and keyboard")
        page.locator(f'[data-dimension="{fleet2}"]').click()
        move(other, f"dimension:{fleet1}")
        page.wait_for_function(
            "() => document.querySelectorAll('.portal').length === 2"
        )
        button("New Vessel").click()
        page.locator('#dialog select[name="type"]').select_option("notes")
        button("Open").click()
        page.wait_for_function(
            "() => allLeaves(active().dimension.root).some(p => p.type === 'notes')"
        )
        note_id = page.evaluate(
            "allLeaves(active().dimension.root).find(p => p.type === 'notes').id"
        )
        note = page.frame_locator(f'iframe[data-portal="{note_id}"]')
        note.get_by_role("textbox", name="Note text", exact=True).fill(
            "Preserve this content while moving"
        )
        note.get_by_role("textbox", name="Note text", exact=True).press("Tab")
        expect(note.locator("#state")).to_have_text("Saved")
        data_before = page.evaluate(
            "id => api.call('portal', {action:'inspect', id})", note_id
        )["data"]
        before = processes()
        header = page.locator(f'.portal[data-portal="{terminal_id}"] .portal-header')
        header.focus()
        page.keyboard.press("Shift+Enter")
        page.wait_for_function("() => state.dock.startsWith('portal:')")
        dock = page.evaluate("state.dock")
        header.drag_to(page.locator(f'[data-dimension="{fleet2}"]'))
        page.wait_for_function("id => active().dimension.id === id", arg=fleet2)
        assert page.evaluate("state.dock") == dock
        move(terminal_id, f"dimension:{fleet1}")
        header = page.locator(f'.portal[data-portal="{terminal_id}"] .portal-header')
        tree_before = page.evaluate("JSON.stringify(active().dimension.root)")
        header.drag_to(page.locator(f'.portal[data-portal="{other}"] .portal-header'))
        page.wait_for_function(
            "before => JSON.stringify(active().dimension.root) !== before",
            arg=tree_before,
        )
        assert page.evaluate(
            """ids => {
          const pair = node => node?.children && (
            (node.axis === 'horizontal' && node.children[0].id === ids[0] && node.children[1].id === ids[1]) || node.children.some(pair));
          return !!pair(active().dimension.root);
        }""",
            [other, terminal_id],
        )
        assert processes() == before
        record(
            "An empty destination and same-Fleet split retain live terminal identity"
        )
        original = page.evaluate("JSON.stringify(state)")
        bounds = header.bounding_box()
        destination = page.locator(f'[data-dimension="{fleet2}"]').bounding_box()
        page.mouse.move(bounds["x"] + 15, bounds["y"] + 10)
        page.mouse.down()
        page.mouse.move(destination["x"] + 20, destination["y"] + 12, steps=10)
        page.keyboard.press("Escape")
        page.mouse.up()
        page.context.new_cdp_session(page).send(
            "Input.dispatchDragEvent",
            {
                "type": "dragCancel",
                "x": 0,
                "y": 0,
                "data": {"items": [], "dragOperationsMask": 1},
            },
        )
        assert page.evaluate("JSON.stringify(state)") == original
        sent = page.evaluate(
            """ids => {
          document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
          const transfer = new DataTransfer();
          transfer.setData('application/x-voyager-portal', ids[0]);
          const original = act;
          const submitted = [];
          act = (...args) => { submitted.push(args); return original(...args); };
          document.querySelector(`.portal[data-portal="${ids[1]}"] .portal-header`).dispatchEvent(new DragEvent('drop', {dataTransfer:transfer, bubbles:true}));
          act = original;
          return submitted;
        }""",
            [terminal_id, other],
        )
        assert not sent
        record(
            "Native drag cancellation and a synthetic late header-drop submit no move"
        )
        setup = json.loads(setup_file.read_text())
        setup.update(
            {
                "note_id": note_id,
                "data_before": data_before,
                "before": before,
                "dock": dock,
            }
        )
        setup_file.write_text(json.dumps(setup, indent=2))
    header = page.locator(f'.portal[data-portal="{terminal_id}"] .portal-header')
    bounds = header.bounding_box()
    realm_bounds = page.locator(f'[data-realm="{realm2}"]').bounding_box()
    page.mouse.move(bounds["x"] + 15, bounds["y"] + 10)
    page.mouse.down()
    page.mouse.move(realm_bounds["x"] + 20, realm_bounds["y"] + 15, steps=12)
    page.mouse.move(realm_bounds["x"] + 21, realm_bounds["y"] + 16)
    target = button(f"Move into {second['dimensions'][0]['name']}")
    target.wait_for()
    target_bounds = target.bounding_box()
    page.mouse.move(target_bounds["x"] + 25, target_bounds["y"] + 12, steps=6)
    page.mouse.up()
    page.wait_for_function("id => active().dimension.id === id", arg=fleet3)
    focus = page.evaluate("api.call('focus')")
    assert (focus["id"], focus["realm"], focus["dimension"]) == (dock, realm2, fleet3)
    page.locator(realm_selector).click()
    page.locator(f'[data-dimension="{fleet1}"]').click()
    move(note_id, f"dimension:{fleet3}")
    assert (
        page.evaluate("id => api.call('portal', {action:'inspect', id})", note_id)[
            "data"
        ]
        == data_before
    )
    assert processes() == before
    result["stableBackends"] = before
    result["movedNote"] = note_id
    result["pinnedAvatar"] = focus
    record(
        "Cancelled drag and cross-Voyage pointer/keyboard moves preserve content, process and avatar target"
    )
    page.reload()
    page.wait_for_selector(f'.portal[data-portal="{terminal_id}"]')
    expect(
        page.frame_locator(f'iframe[data-portal="{note_id}"]').get_by_role(
            "textbox", name="Note text"
        )
    ).to_have_value(data_before["text"])
    assert processes() == before
    assert page.evaluate("api.call('focus')")["id"] == dock
    record(
        "Renderer reconnection restores saved placement, content and pinned identity"
    )
    page.screenshot(path=str(evidence / "organisation.png"))
    document(bump=True)
    header = page.locator(f'.portal[data-portal="{terminal_id}"] .portal-header')
    header.focus()
    page.keyboard.press("F2")
    edit = page.get_by_role("textbox", name="Rename Vessel", exact=True)
    edit.fill("Uncommitted name")
    edit.press("Enter")
    expect(page.locator("#toast")).to_contain_text("Layout save unconfirmed")
    expect(header).to_contain_text("Build shell")
    assert processes() == before
    assert not errors
    record(
        "A real concurrent document write rejects the stale save without false success or process replay"
    )
