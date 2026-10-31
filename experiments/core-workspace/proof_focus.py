import json


def focus_journey(page, context, evidence, env):
    native = next(item for item in context.pages if item.url.endswith("/floating.html"))
    errors = []
    native.on("pageerror", lambda error: errors.append(str(error)))
    before = page.evaluate("window.voyager.call('processes')")["terminals"]
    page.locator("#home").click()
    if page.locator("#chat").get_attribute("hidden") is None:
        page.locator("#close-chat").click()
    page.get_by_role("button", name="Text chat", exact=True).click()
    page.wait_for_timeout(250)
    assert page.locator("#sidebar #chat").count() == 1
    assert page.locator("#voyager-avatar #avatar-chat").count() == 0
    home = page.locator("#home-dock").bounding_box()
    chat = page.locator("#chat").bounding_box()
    assert chat["y"] >= home["y"] + home["height"] - 12
    assert chat["x"] < 300
    page.screenshot(path=str(evidence / "focus-sidebar.png"))
    page.get_by_role("button", name="Split side by side", exact=True).click()
    page.wait_for_function("() => document.querySelectorAll('.portal').length === 2")
    realm = page.locator(".realm").first
    realm.hover()
    realm.locator("..").locator(".scope-dock").click()
    page.wait_for_function("() => state.dock.startsWith('realm:')")
    assert page.locator("#chat").get_attribute("hidden") is not None
    assert page.evaluate("window.voyager.call('focus')")["kind"] == "realm"
    page.get_by_role("button", name="New dimension", exact=True).click()
    page.wait_for_function("() => document.querySelectorAll('.dimension').length === 2")
    dimension = page.locator(".dimension").first
    dimension.hover()
    dimension.locator("..").locator(".scope-dock").click()
    page.wait_for_function("() => state.dock.startsWith('dimension:')")
    pinned = page.evaluate("state.dock")
    page.locator(".dimension").nth(1).click()
    page.wait_for_function("() => document.querySelectorAll('.portal').length === 1")
    assert page.evaluate("state.dock") == pinned
    assert page.locator(".dimension").first.locator("#avatar").count() == 1
    page.locator(".dimension").first.click()
    page.wait_for_function("() => document.querySelectorAll('.portal').length === 2")
    page.locator(".dock-spot").first.dblclick()
    page.wait_for_function("() => state.dock.startsWith('portal:')")
    page.locator(".dimension").nth(1).click()
    page.wait_for_function(
        "() => document.querySelector('#voyager-avatar').dataset.outOfView === 'true'"
    )
    assert "Go there" in page.locator("#scope-label").inner_text()
    page.locator("#scope-label").click()
    page.wait_for_selector(".portal-avatar-anchor #avatar")
    focus = page.evaluate("window.voyager.call('focus')")
    assert (
        focus["terminal"]
        == page.locator(".portal-dock").first.get_attribute("data-dock").split(":")[1]
    )
    brand = page.locator("#home-brand").bounding_box()
    assert brand["x"] == home["x"]
    avatar = page.locator("#voyager-avatar").bounding_box()
    page.mouse.move(avatar["x"] + 47, avatar["y"] + 47)
    page.get_by_role("button", name="Minimize Voyager", exact=True).click()
    page.wait_for_function(
        "async () => (await window.voyager.call('window-state')).minimized"
    )
    native.wait_for_function(
        "() => document.querySelector('#avatar').title.includes('Portal')"
    )
    native.screenshot(path=str(evidence / "focus-desktop.png"))
    native.get_by_role("button", name="Start voice", exact=True).click()
    native.wait_for_function(
        "() => document.querySelector('#voice').dataset.connection === 'connected'",
        timeout=90000,
    )
    stream = native.evaluate("document.querySelector('#voice-output').srcObject.id")
    native.get_by_role("button", name="Open Voyager workspace", exact=True).click()
    page.wait_for_function(
        "async () => !(await window.voyager.call('window-state')).minimized"
    )
    assert page.evaluate("window.voyager.call('window-state')")["floating"]
    assert page.locator("#voyager-avatar").is_hidden()
    assert page.evaluate("window.voyager.call('focus')") == focus
    source = context.new_cdp_session(native)
    destination = context.new_cdp_session(page)
    intercepted = []
    source.send("Input.setInterceptDrags", {"enabled": True})
    source.on("Input.dragIntercepted", lambda event: intercepted.append(event["data"]))
    face = native.locator("#avatar").bounding_box()
    x, y = face["x"] + face["width"] / 2, face["y"] + face["height"] / 2
    native.mouse.move(x, y)
    native.mouse.down()
    native.mouse.move(x + 20, y + 10, steps=6)
    for _ in range(30):
        if intercepted:
            break
        native.wait_for_timeout(100)
    assert intercepted, "The native Chromium avatar must initiate the drag."
    home = page.locator("#home-dock").bounding_box()
    for kind in ["dragEnter", "dragOver", "drop"]:
        destination.send(
            "Input.dispatchDragEvent",
            {
                "type": kind,
                "x": home["x"] + 100,
                "y": home["y"] + 90,
                "data": intercepted[0],
            },
        )
    source.send("Input.cancelDragging")
    native.mouse.up()
    page.wait_for_function(
        "async () => (await window.voyager.call('window-state')).floating === false",
        timeout=10000,
    )
    page.wait_for_function("() => state.dock === 'home'")
    assert (
        native.evaluate("document.querySelector('#voice-output').srcObject.id")
        == stream
    )
    assert page.locator("#voice").get_attribute("data-connection") == "connected"
    page.get_by_role("button", name="Stop voice", exact=True).click()
    page.wait_for_function(
        "() => document.querySelector('#chat-state').textContent === 'Voice stopped'",
        timeout=20000,
    )
    after = page.evaluate("window.voyager.call('processes')")["terminals"]
    assert all(
        any(a["address"] == b["address"] and a["pid"] == b["pid"] for a in after)
        for b in before
    )
    assert not errors
    page.screenshot(path=str(evidence / "focus-returned.png"))
    (evidence / "focus.json").write_text(
        json.dumps(
            {
                "focusBeforeFloat": focus,
                "nativeDragDocked": True,
                "dragRoute": "Chromium intercepted native drag between actual Electron windows; compositor pointer routing unproved",
                "sameVoiceStream": stream,
                "preservedPids": {t["address"]: t["pid"] for t in before},
                "errors": errors,
            },
            indent=2,
        )
    )
    print(
        "Sidebar drawer, pinned focus, desktop float, real cross-window drag and continuous voice passed."
    )


def portal_border(page, evidence):
    before = page.evaluate("window.voyager.call('processes')")
    page.screenshot(path=str(evidence / "portal-border-before.png"))
    page.evaluate(
        "document.querySelector('link[href^=\"style.css\"]').href = 'style.css?portal-focus=' + Date.now()"
    )
    page.wait_for_function(
        "() => [...document.querySelectorAll('.xterm-viewport')].filter(e=>e.clientWidth).every(e=>getComputedStyle(e).backgroundColor === 'rgb(17, 19, 22)')"
    )
    page.locator(".xterm-helper-textarea").first.click()
    first = page.locator(".portal").first.get_attribute("data-portal")
    assert page.evaluate("focused") == first
    assert page.locator(".portal.focused").count() == 1
    assert "linear-gradient" in page.locator(".portal.focused").evaluate(
        "(e)=>getComputedStyle(e).backgroundImage"
    )
    page.locator(".xterm-helper-textarea").nth(1).click()
    assert page.locator(".portal.focused").count() == 1
    assert (
        page.locator(".portal").first.evaluate(
            "(e)=>getComputedStyle(e).backgroundImage"
        )
        == "none"
    )
    page.screenshot(path=str(evidence / "portal-border-after.png"))
    assert page.evaluate("window.voyager.call('processes')") == before
    (evidence / "portal-border.json").write_text(
        json.dumps(
            {
                "onlySelectedHasGradient": True,
                "viewportMatchesWorkspace": True,
                "processesUnchanged": True,
            },
            indent=2,
        )
    )
    print(
        "Black viewport frame removed; Voyager outline follows only the selected portal."
    )


def controls_journey(page, context, evidence):
    assert page.evaluate("window.voyager.call('boot')")["session"].startswith(
        "voyager-controls-"
    )
    native = next(item for item in context.pages if item.url.endswith("/floating.html"))
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.wait_for_selector("#home-controls #voice")
        voice = page.locator("#voice").bounding_box()
        text = page.locator("#avatar-chat").bounding_box()
        tagline = page.locator("#home-tagline").bounding_box()
        assert voice["x"] < text["x"] and abs(voice["y"] - text["y"]) < 1
        assert voice["y"] >= tagline["y"] + tagline["height"]
        page.locator("#voice").click()
        page.wait_for_function(
            "() => document.querySelector('#voice').dataset.connection === 'connected'",
            timeout=90000,
        )
        stream = native.evaluate("document.querySelector('#voice-output').srcObject.id")
        page.get_by_role("button", name="Dock Voyager in Voyager", exact=True).click()
        page.wait_for_function("() => document.body.dataset.voyagerFocus === 'realm'")
        assert page.locator(".realm").first.locator("#avatar").count() == 1
        circle = page.locator("#avatar").bounding_box()
        row = page.locator(".realm").first.bounding_box()
        assert (
            row["y"] <= circle["y"]
            and circle["y"] + circle["height"] <= row["y"] + row["height"]
        )
        assert page.locator("#voyager-avatar #voice").count() == 0
        assert page.locator("#home-controls #voice").is_visible()
        assert page.locator("#chat-focus").text_content() == "Realm · Voyager"
        assert page.locator(".scope-row.voyager-focused").count() == 1
        page.locator("#chat-toggle").click()
        assert "Realm · Voyager" in page.locator("#chat-text").get_attribute(
            "placeholder"
        )
        page.screenshot(path=str(evidence / "controls-realm.png"))
        page.get_by_role("button", name="New dimension", exact=True).click()
        page.get_by_role(
            "button", name="Dock Voyager in Dimension 2", exact=True
        ).click()
        page.wait_for_function(
            "() => document.body.dataset.voyagerFocus === 'dimension'"
        )
        assert page.locator("#home-controls #voice").is_visible()
        assert page.locator("#avatar").bounding_box()["width"] == 38
        page.locator("#toggle-sidebar").click()
        page.wait_for_selector("#workspace-controls #voice")
        assert page.locator("#workspace-controls #voice").is_visible()
        page.locator("#chat-toggle").click()
        page.wait_for_selector("#home-controls #voice")
        assert page.locator("#chat-focus").text_content() == "Dimension · Dimension 2"
        page.get_by_role("button", name="Split side by side", exact=True).click()
        page.wait_for_function(
            "() => document.querySelectorAll('.portal').length === 2"
        )
        page.locator(".dock-spot").first.dblclick()
        page.wait_for_selector("#voyager-avatar #voice")
        assert page.locator("#avatar").bounding_box()["width"] == 94
        assert page.locator(".portal.voyager-focused").count() == 1
        focused = page.evaluate("window.voyager.call('focus')")
        before = {
            item["address"]: item["pid"]
            for item in page.evaluate("window.voyager.call('processes')")["terminals"]
        }
        page.get_by_role(
            "button", name="Hide this portal, keep process running", exact=True
        ).first.click()
        page.wait_for_function(
            "() => document.querySelector('#voyager-avatar').dataset.outOfView === 'true'"
        )
        assert page.locator("#home-controls #voice").is_visible()
        page.locator("#scope-label").click()
        page.wait_for_selector(".portal.voyager-focused #voyager-avatar #voice")
        assert page.evaluate("window.voyager.call('focus')") == focused
        after = {
            item["address"]: item["pid"]
            for item in page.evaluate("window.voyager.call('processes')")["terminals"]
        }
        assert after == before
        assert (
            native.evaluate("document.querySelector('#voice-output').srcObject.id")
            == stream
        )
        page.screenshot(path=str(evidence / "controls-portal.png"))
        page.keyboard.press("Control+1")
        page.wait_for_selector("#home-controls #voice")
        page.locator("#voice").click()
        page.wait_for_function(
            "() => document.querySelector('#chat-state').textContent === 'Voice stopped'",
            timeout=20000,
        )
        assert page.locator("#voice").count() == 1
        page.locator(".dock-spot").first.dblclick()
        page.wait_for_selector("#voyager-avatar #voice")
        page.mouse.move(5, 5)
        assert (
            page.locator("#voice").evaluate("(e)=>getComputedStyle(e).opacity") == "0.2"
        )
        face = page.locator("#avatar").bounding_box()
        page.mouse.move(face["x"] + 47, face["y"] + 47)
        page.wait_for_function(
            "() => document.querySelector('#voyager-avatar').dataset.hovered === 'true'"
        )
        assert (
            page.locator("#voice").evaluate("(e)=>getComputedStyle(e).opacity") == "1"
        )
        assert not errors
        (evidence / "controls.json").write_text(
            json.dumps(
                {
                    "compactAvatarOnly": True,
                    "sidebarAndTopbarSpeech": True,
                    "fullPortalSpeech": True,
                    "sharedFocusLabels": True,
                    "hiddenPortalReturn": True,
                    "preservedTerminalPids": before,
                    "sameAudioStream": stream,
                    "humanAudio": False,
                    "errors": errors,
                },
                indent=2,
            )
        )
        print(
            "Compact speech placement, shared context cues and hidden-portal return passed with one continuous WebRTC stream."
        )
    finally:
        page.evaluate("window.voyager.call('quit')")


def request_focus_journey(page, context, evidence, voice_only=False):
    assert page.evaluate("window.voyager.call('boot')")["session"].startswith(
        "voyager-context-"
    )
    native = next(item for item in context.pages if item.url.endswith("/floating.html"))
    page.evaluate(
        "() => {window.focusEvents=[];window.focusReceipts=[];window.modelTurns=0;window.voyager.on('conversation',e=>{if(['error','voice-error','voice-closed','focus-context','status','complete'].includes(e.type)) window.focusEvents.push({type:e.type,text:e.text,focus:e.focus,voice:e.voice});if(e.type==='focus-context') window.focusReceipts.push(e);if(e.type==='status'&&e.text==='Thinking…') window.modelTurns++});}"
    )
    answers = []
    prompt = "Return only JSON with id and path from the Voyager application focus attached to this request. Do not use tools or run any process."
    try:
        for scope in [] if voice_only else ["home", "realm", "dimension", "portal"]:
            if scope == "home":
                page.locator("#home").click()
            elif scope == "realm":
                page.get_by_role(
                    "button", name="Dock Voyager in Voyager", exact=True
                ).click()
            elif scope == "dimension":
                page.get_by_role(
                    "button", name="Dock Voyager in Workbench", exact=True
                ).click()
            else:
                page.locator(".dock-spot").dblclick()
            page.wait_for_function(
                "kind=>document.body.dataset.voyagerFocus===kind", arg=scope
            )
            target = page.evaluate("window.voyager.call('focus')")
            page.locator("#chat-toggle").click()
            message_count = page.locator(".message.assistant").count()
            page.locator("#chat-text").fill(prompt)
            page.locator("#send").click()
            page.wait_for_function(
                "() => document.querySelector('#chat-state').textContent==='Ready when you are' && !document.querySelector('#send').disabled",
                timeout=180000,
            )
            responses = page.locator(".message.assistant").all_text_contents()
            raw = "\n".join(responses[message_count:])
            (evidence / "request-focus-progress.json").write_text(
                json.dumps(
                    {"scope": scope, "response": raw, "priorAnswers": answers}, indent=2
                )
            )
            assert target["id"] in raw
            answer = {"id": target["id"], "response": raw}
            assert page.locator(".message.user").last.text_content() == prompt
            assert page.locator(".tool-line").count() == 0
            answers.append(answer)
        page.keyboard.press("Control+1")
        page.wait_for_selector("#home-controls #voice")
        page.locator("#voice").click()
        page.wait_for_function(
            "() => document.querySelector('#voice').dataset.connection==='connected'",
            timeout=90000,
        )
        native.evaluate(
            "window.focusAudio = document.querySelector('#voice-output').srcObject"
        )
        turns = page.evaluate("window.modelTurns")
        page.get_by_role("button", name="Dock Voyager in Voyager", exact=True).click()
        page.wait_for_function(
            "() => window.focusReceipts.some(e=>e.voice&&e.focus.kind==='realm')",
            timeout=30000,
        )
        page.wait_for_timeout(1500)
        assert page.evaluate("window.modelTurns") == turns
        assert native.evaluate(
            "window.focusAudio === document.querySelector('#voice-output').srcObject"
        )
        assert page.locator("#voice").get_attribute("data-connection") == "connected"
        page.locator("#voice").click()
        page.wait_for_function(
            "() => document.querySelector('#chat-state').textContent==='Voice stopped'",
            timeout=20000,
        )
        (evidence / "request-focus.json").write_text(
            json.dumps(
                {
                    "answers": answers,
                    "voiceOnlyRun": voice_only,
                    "noNewTaskObservationSeconds": 1.5,
                    "metadataOnlyTurns": page.evaluate("window.modelTurns") - turns,
                    "voiceFocusAcknowledged": True,
                    "sameAudioObject": True,
                    "humanAudio": False,
                },
                indent=2,
            )
        )
        print(
            "Voice focus update acknowledged with the same audio object and no new task during the bounded observation."
            if voice_only
            else "All four real requests saw explicit focus without tool lookups; voice focus update acknowledged without audio replacement."
        )
    except Exception:
        failure = page.evaluate(
            "({events:window.focusEvents,state:document.querySelector('#chat-state').textContent,voice:document.querySelector('#voice').dataset.connection,focus:state.dock})"
        )
        (evidence / "request-focus-failure.json").write_text(
            json.dumps(failure, indent=2)
        )
        raise
    finally:
        page.evaluate("window.voyager.call('quit')")
