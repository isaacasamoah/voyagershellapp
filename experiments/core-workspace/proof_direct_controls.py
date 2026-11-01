from playwright.sync_api import expect
from proof_picker import picker_rejection
from proof_common import content_directory, processes, recorder, settled


def direct_controls_journey(page, evidence):
    page.get_by_role("button", name="New Voyage", exact=True).click()
    page.get_by_label("Name", exact=True).fill("Direct controls")
    page.get_by_role("button", name="Create", exact=True).click()
    page.wait_for_function(
        "() => active().realm.name === 'Direct controls' && document.querySelector('.dimension.active')?.dataset.dimension === active().dimension.id && document.querySelectorAll('.portal').length===1"
    )
    record = recorder(evidence, "direct-controls")
    picker = page.locator("#content-picker")
    page.keyboard.press("Escape")
    cdp = page.context.new_cdp_session(page)
    cdp.send("Input.setInterceptDrags", {"enabled": False})

    def wrapper(id):
        return page.locator(f'.portal[data-portal="{id}"]')

    def drag(source, target, x, y, expected, cancel=False, during=None):
        head = wrapper(source).locator(".portal-title")
        rect = head.bounding_box()
        dest = wrapper(target).bounding_box()
        tx, ty = dest["x"] + dest["width"] * x, dest["y"] + dest["height"] * y
        try:
            page.mouse.move(rect["x"] + 5, rect["y"] + 5)
            page.mouse.down()
            page.mouse.move(tx, ty, steps=25)
            expect(wrapper(source)).to_have_class(
                __import__("re").compile("drag-source")
            )
            if source == target:
                assert wrapper(target).get_attribute("data-drop-position") is None
            else:
                expect(wrapper(target)).to_have_attribute(
                    "data-drop-position", expected
                )
            page.screenshot(path=str(evidence / f"drag-{expected}.png"))
            if during:
                during()
            if cancel:
                page.keyboard.press("Escape")
            page.mouse.up()
        finally:
            cdp.send(
                "Input.dispatchDragEvent",
                {
                    "type": "dragCancel",
                    "x": 0,
                    "y": 0,
                    "data": {"items": [], "dragOperationsMask": 1},
                },
            )
            page.mouse.up()
        page.wait_for_function(
            "() => !document.body.classList.contains('moving-portal') && !document.querySelector('[data-drop-position]')"
        )

    def select_text(id):
        term = wrapper(id).locator(".xterm-helper-textarea")
        term.click()
        page.keyboard.type("printf 'DRAG_SELECTION_MARKER\\n'")
        page.keyboard.press("Enter")
        page.wait_for_timeout(200)
        info = page.evaluate(
            """id => {
          const portal=allLeaves(active().dimension.root).find(p=>p.id===id);
          const term=terminals.get(portal.terminal).term;
          const buffer=term.buffer.active;
          let row=-1;
          for(let i=0;i<buffer.length;i++)if(buffer.getLine(i)?.translateToString().trim()==='DRAG_SELECTION_MARKER')row=i-buffer.viewportY;
          const rect=term.element.querySelector('.xterm-screen').getBoundingClientRect();
          return {x:rect.x,y:rect.y,row,cell:rect.width/term.cols,line:rect.height/term.rows};
        }""",
            id,
        )
        assert info["row"] >= 0
        x, y = (
            info["x"] + info["cell"] / 2,
            info["y"] + (info["row"] + 0.5) * info["line"],
        )
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + info["cell"] * 21, y, steps=6)
        page.mouse.up()
        assert page.evaluate(
            "id => terminals.get(allLeaves(active().dimension.root).find(p=>p.id===id).terminal).term.getSelection()",
            id,
        ).startswith("DRAG_SELECTION")

    first = page.evaluate(
        "allLeaves(active().dimension.root).find(p => p.type === 'terminal')"
    )
    assert (
        page.locator(
            '#new-portal,#split-horizontal,#split-vertical,[aria-label="Move this Vessel"]'
        ).count()
        == 0
    )
    first = page.evaluate("allLeaves(active().dimension.root)[0]")
    realm = page.locator(f'[data-realm="{page.evaluate("state.activeRealm")}"]')
    realm.focus()
    page.keyboard.press("Shift+Enter")
    page.wait_for_function("() => state.dock.startsWith('realm:')")
    fleet = page.locator("[data-dimension]").first
    fleet.focus()
    page.keyboard.press("Shift+Enter")
    page.wait_for_function("() => state.dock.startsWith('dimension:')")
    wrapper(first["id"]).locator(".portal-header").focus()
    page.keyboard.press("Shift+Enter")
    page.wait_for_function("id => state.dock === `portal:${id}`", arg=first["terminal"])
    avatar = page.locator("#avatar").bounding_box()
    home = page.locator("#home-dock").bounding_box()
    page.mouse.move(avatar["x"] + 47, avatar["y"] + 47, steps=4)
    page.mouse.down()
    page.mouse.move(home["x"] + 100, home["y"] + 100, steps=15)
    page.mouse.up()
    page.wait_for_function("() => state.dock === 'home'")
    record(
        "Voyage, Fleet and Vessel keyboard docking plus avatar drag to Home work before failure tests"
    )
    select_text(first["id"])
    actions = wrapper(first["id"]).locator(".portal-actions")
    center = wrapper(first["id"]).bounding_box()
    page.mouse.move(
        center["x"] + center["width"] / 2, center["y"] + center["height"] / 2
    )
    expect(actions).to_have_css("opacity", "0")
    page.mouse.move(center["x"] + center["width"] - 45, center["y"] + 15)
    expect(actions).to_have_css("opacity", "1")
    page.keyboard.press("Control+Shift+O")
    picker = page.locator("#content-picker")
    expect(picker).to_be_visible()
    picker.get_by_role("button", name="Notes", exact=True).click()
    page.wait_for_selector("iframe.portal-frame:not([hidden])")
    notes = page.evaluate(
        "allLeaves(active().dimension.root).find(p=>p.type==='notes')"
    )
    frame = page.locator(
        f'iframe.portal-frame[data-portal="{notes["id"]}"]'
    ).content_frame
    edit = frame.get_by_role("textbox", name="Note text", exact=True)

    def edit_note(value):
        if edit.input_value() == value:
            return
        revision = page.evaluate("renderVersion")
        edit.fill(value)
        edit.press("Tab")
        expect(frame.locator("#state")).to_have_text("Saved")
        page.wait_for_function("value => renderVersion > value", arg=revision)
        expect(edit).to_have_value(value)

    edit_note("Preserve this content through direct dragging")
    before = processes(page)
    layout = page.evaluate("JSON.stringify(active().dimension.root)")
    drag(first["id"], notes["id"], 0.75, 0.5, "right", cancel=True)
    assert page.evaluate("JSON.stringify(active().dimension.root)") == layout
    edit.click()
    edit_note("Preserve this content through direct dragging after cancel")
    edit_note("Preserve this content through direct dragging")
    select_text(first["id"])
    record(
        "Cancelled drag clears its preview/shield; terminal selection and web editing still work"
    )
    wrapper(first["id"]).locator(".portal-header").focus()
    page.keyboard.press("Shift+Enter")
    page.wait_for_function("id => state.dock === `portal:${id}`", arg=first["terminal"])
    drag(first["id"], notes["id"], 0.75, 0.5, "right")
    page.wait_for_function(
        "id => active().dimension.root.children[1].id===id", arg=first["id"]
    )
    assert processes(page) == before
    assert page.evaluate("state.dock") == f"portal:{first['terminal']}"
    drag(first["id"], notes["id"], 0.5, 0.8, "bottom")
    page.wait_for_function("() => active().dimension.root.axis==='vertical'")
    assert processes(page) == before
    edit.click()
    expect(edit).to_have_value("Preserve this content through direct dragging")
    select_text(first["id"])
    record(
        "Horizontal and vertical landing previews commit their shown side with exact process/data identity"
    )
    wrapper(first["id"]).locator(".portal-header").focus()
    page.keyboard.press("Alt+Shift+K")
    page.wait_for_function(
        "id => active().dimension.root.children[0].id===id", arg=first["id"]
    )
    wrapper(first["id"]).locator(".portal-header").focus()
    page.keyboard.press("Control+Shift+E")
    expect(picker).to_be_visible()
    page.keyboard.press("Escape")
    expect(
        wrapper(first["id"]).get_by_role(
            "button", name="Split this Vessel top and bottom", exact=True
        )
    ).to_be_focused()
    record(
        "Directional keyboard movement and local split picker cancellation retain keyboard access"
    )
    layout = page.evaluate("JSON.stringify(active().dimension.root)")
    drag(first["id"], first["id"], 0.5, 0.5, None)
    assert page.evaluate("JSON.stringify(active().dimension.root)") == layout
    record("A real self-drop leaves placement unchanged and removes the drag shield")
    page.keyboard.press("Control+Shift+T")
    page.wait_for_function("() => active().realm.dimensions.length===2")
    record("Herdr new-tab shortcut creates a Fleet")
    page.locator(".portal-header").focus()
    page.get_by_role(
        "button", name="Hide this Vessel, keep process running", exact=True
    ).click()
    page.wait_for_selector(".empty-workspace")
    page.get_by_role("button", name="New Vessel", exact=True).click()
    picker.get_by_role("button", name="Notes", exact=True).click()
    page.wait_for_function(
        "() => allLeaves(active().dimension.root).length===1 && allLeaves(active().dimension.root)[0].type==='notes'"
    )
    record("An empty Fleet retains one local creation control without a global toolbar")
    page.locator("[data-dimension]").first.click()
    page.wait_for_selector("iframe.portal-frame:not([hidden])")
    source = wrapper(notes["id"]).locator(".portal-header")
    source.focus()
    page.keyboard.press("Space")
    page.locator("[data-dimension]").nth(1).focus()
    page.keyboard.press("Enter")
    page.wait_for_function(
        "id => allLeaves(active().dimension.root).some(p=>p.id===id)", arg=notes["id"]
    )
    expect(frame.get_by_role("textbox", name="Note text", exact=True)).to_have_value(
        "Preserve this content through direct dragging"
    )
    record(
        "Keyboard pick-up and placement moves the same web Vessel across Fleets without a dialog"
    )
    wrapper(notes["id"]).locator(".portal-header").focus()
    page.keyboard.press("Space")
    page.locator("[data-dimension]").first.focus()
    page.keyboard.press("Enter")
    page.wait_for_function(
        "id => allLeaves(active().dimension.root).some(p=>p.id===id)", arg=first["id"]
    )
    page.locator("[data-dimension]").first.click()
    page.wait_for_selector("iframe.portal-frame:not([hidden])")
    assert processes(page).items() >= before.items()
    origin = page.evaluate("({realm:active().realm.id,fleet:active().dimension.id})")
    destination = page.evaluate("state.realms.find(r => r.id !== state.activeRealm)")

    def carry(realm, fleet):
        wrapper(notes["id"]).locator(".portal-header").focus()
        page.keyboard.press("Space")
        page.locator(f'[data-realm="{realm}"]').focus()
        page.keyboard.press("Enter")
        page.wait_for_function("id => state.activeRealm === id", arg=realm)
        page.locator(f'[data-dimension="{fleet}"]').focus()
        page.keyboard.press("Enter")
        settled(page)
        expect(edit).to_have_value("Preserve this content through direct dragging")

    before_carry = processes(page)
    carry(destination["id"], destination["activeDimension"])
    carry(origin["realm"], origin["fleet"])
    assert processes(page) == before_carry
    record(
        "Keyboard carry across Voyages and back preserves exact content and process identity"
    )
    datafile = content_directory(evidence) / "data" / (notes["id"] + ".json")
    original = datafile.read_bytes()
    layout = page.evaluate("JSON.stringify(state)")

    def refresh_catalogue():
        datafile.write_bytes(original)
        page.wait_for_function(
            "() => !document.body.classList.contains('moving-portal') && !organisation.canDrop()"
        )

    page.evaluate("""() => {
      window.watchAct = act;
      window.watchMoves = 0;
      act = (...args) => {
        if (args[0] === "move") window.watchMoves++;
        return window.watchAct(...args);
      };
    }""")
    try:
        drag(first["id"], notes["id"], 0.75, 0.5, "right", during=refresh_catalogue)
        assert page.evaluate("window.watchMoves") == 0
        assert page.evaluate("JSON.stringify(state)") == layout
        assert datafile.read_bytes() == original
        assert processes(page) == before_carry
    finally:
        page.evaluate("() => { act = window.watchAct; }")
    edit.click()
    expect(edit).to_have_value("Preserve this content through direct dragging")
    select_text(first["id"])
    record(
        "Actual watcher refresh cancels an active pointer drag without late movement or data loss"
    )
    split = wrapper(first["id"]).get_by_role(
        "button", name="Split this Vessel side by side", exact=True
    )
    wrapper(first["id"]).locator(".portal-header").focus()
    picker_rejection(page, evidence, split)
    record(
        "A real stale save remains a visible refusal with no replay; normal docking was checked first"
    )
