import json
import subprocess
import wave

import numpy as np


def refresh_viewer(page, evidence):
    assert "core-workspace/index.html" in page.url
    assert page.locator("#voice").get_attribute("aria-pressed") != "true"
    assert not page.locator("#send").is_disabled()
    before = page.evaluate("window.voyager.call('processes')")["terminals"]
    snapshot = page.evaluate("""() => ({
      messages:[...document.querySelector('#messages').children].filter(e=>e.matches('.message,.tool-line')).map(e=>({role:e.classList.contains('user')?'user':e.classList.contains('tool-line')?'tool':'assistant',text:e.textContent})),
      draft:document.querySelector('#chat-text').value, open:!document.querySelector('#chat').hidden,
      focusedPortal:document.activeElement.classList.contains('xterm-helper-textarea')?focused:null
    })""")
    page.reload()
    page.wait_for_function(
        "() => typeof state !== 'undefined' && state && [...terminals.values()].filter(v=>v.node.isConnected).every(v=>v.attached)"
    )
    page.wait_for_selector("#home-brand")
    page.evaluate(
        """snapshot => {
      const messages=document.querySelector('#messages');
      if(snapshot.messages.length) messages.replaceChildren();
      for(const item of snapshot.messages) {
        const line=document.createElement('div');
        line.className=item.role==='tool'?'tool-line':`message ${item.role}`;
        line.textContent=item.text;
        messages.append(line);
      }
      document.querySelector('#chat-text').value=snapshot.draft;
      window.voyagerChat.open(snapshot.open);
      if(snapshot.focusedPortal) focusPortal(snapshot.focusedPortal,true);
    }""",
        snapshot,
    )
    after = page.evaluate("window.voyager.call('processes')")["terminals"]
    live_before = {t["address"]: t["pid"] for t in before if t["state"] == "live"}
    live_after = {t["address"]: t["pid"] for t in after if t["state"] == "live"}
    assert live_before == live_after
    assert page.locator(".message,.tool-line").count() == len(snapshot["messages"])
    page.screenshot(path=str(evidence / "identity-owner.png"))
    (evidence / "identity-refresh.json").write_text(
        json.dumps(
            {
                "preservedTerminalPids": live_after,
                "visibleConversationEntries": len(snapshot["messages"]),
                "draftCharacters": len(snapshot["draft"]),
                "sameViewerReload": True,
                "providerRestarted": False,
            },
            indent=2,
        )
    )
    print(
        "Refreshed the same viewer, preserving its terminal PIDs and visible conversation."
    )


def identity_journey(page, evidence, env):
    page.wait_for_selector("#home-brand")
    page.wait_for_function(
        "() => document.querySelector('#home-brand').naturalWidth > 0"
    )
    assert (
        page.locator("#voyager-avatar #voice svg path").get_attribute("d")
        == "M2 6v4M6 3v10M10 1v14M14 3v10M18 6v4"
    )
    assert page.locator("#home-dock #avatar-chat").count() == 1
    assert page.locator("#voice").count() == 1
    page.evaluate(
        "window.identitySounds = []; window.addEventListener('voyager-dock-sound',e=>window.identitySounds.push(e.detail))"
    )
    before = page.locator("#portals").bounding_box()
    page.get_by_role("button", name="Text chat", exact=True).click()
    assert not page.locator("#chat").is_hidden()
    assert page.locator("#portals").bounding_box() == before
    chat = page.locator("#chat").bounding_box()
    avatar = page.locator("#voyager-avatar").bounding_box()
    home = page.locator("#home-dock").bounding_box()
    assert chat["y"] >= home["y"] + home["height"] - 12
    assert chat["x"] < 300
    page.get_by_role("button", name="Close conversation", exact=True).click()
    assert page.locator("#avatar-chat").get_attribute("aria-expanded") == "false"
    first = page.locator("#astronaut-back").evaluate(
        "(e)=>getComputedStyle(e).transform"
    )
    page.wait_for_timeout(800)
    assert (
        page.locator("#astronaut-back").evaluate("(e)=>getComputedStyle(e).transform")
        != first
    )
    page.wait_for_function(
        "() => document.querySelector('#avatar').dataset.gesture?.startsWith('stretch-frames/')",
        timeout=43000,
    )
    page.screenshot(path=str(evidence / "identity-stretch.png"))
    face = page.locator("#avatar").bounding_box()
    page.mouse.move(face["x"] + face["width"] / 2, face["y"] + face["height"] / 2)
    count = page.evaluate("identitySounds.length")
    page.mouse.down()
    page.wait_for_timeout(450)
    page.mouse.up()
    assert page.evaluate("identitySounds.length") == count
    assert not page.evaluate("window.voyager.call('window-state')")["minimized"]
    page.get_by_role("button", name="Split side by side", exact=True).click()
    page.wait_for_function("() => document.querySelectorAll('.portal').length === 2")
    page.locator(".xterm-helper-textarea").first.click()
    page.keyboard.type(
        "for i in $(seq 1 80); do printf 'selectable terminal line %03d\\n' $i; done"
    )
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    page.get_by_role("button", name="Bring Voyager here", exact=True).first.dblclick()
    page.wait_for_selector(".portal-avatar-anchor #avatar")
    portal = page.locator(".portal").first.bounding_box()
    avatar = page.locator("#voyager-avatar").bounding_box()
    assert (
        abs(avatar["x"] + avatar["width"] / 2 - (portal["x"] + portal["width"] / 2)) < 3
    )
    assert (
        abs(
            avatar["y"] + avatar["height"] / 2 - (portal["y"] + portal["height"] * 0.67)
        )
        < 3
    )
    page.mouse.move(10, 10)
    assert page.locator("#avatar").evaluate("(e)=>getComputedStyle(e).opacity") == "0.3"
    page.mouse.click(portal["x"] + 22, portal["y"] + 65)
    focused = page.evaluate("document.activeElement.className")
    assert "xterm-helper-textarea" in focused
    page.mouse.move(avatar["x"] + 20, avatar["y"] + 20)
    page.wait_for_function(
        "() => document.querySelector('#voyager-avatar').dataset.hovered === 'true'"
    )
    assert page.evaluate("document.activeElement.className") == focused
    assert page.locator("#avatar").evaluate("(e)=>getComputedStyle(e).opacity") == "1"
    page.mouse.move(avatar["x"] - 35, avatar["y"] + 45)
    page.mouse.down()
    page.mouse.move(avatar["x"] + avatar["width"] + 35, avatar["y"] + 45, steps=12)
    assert page.locator("#voyager-avatar").get_attribute("data-dragging") == "false"
    assert page.evaluate("[...terminals.values()].some(v=>v.term.hasSelection())")
    page.mouse.up()
    page.mouse.move(10, 10)
    page.screenshot(path=str(evidence / "identity-embedded.png"))
    original = page.evaluate("state.dock")
    face = page.locator("#avatar").bounding_box()
    page.mouse.move(face["x"] + 40, face["y"] + 40)
    page.mouse.down()
    page.mouse.move(face["x"] + 80, face["y"] + 80, steps=5)
    page.keyboard.press("Escape")
    page.mouse.up()
    assert page.evaluate("state.dock") == original
    assert page.locator(".portal-avatar-anchor #avatar").count() == 1
    page.evaluate(
        "window.addEventListener('pointerdown',e=>window.identityPointer=e.pointerId,{once:true,capture:true})"
    )
    face = page.locator("#avatar").bounding_box()
    page.mouse.move(face["x"] + 40, face["y"] + 40)
    page.mouse.down()
    page.mouse.move(face["x"] + 85, face["y"] + 85, steps=5)
    page.evaluate(
        "document.querySelector('#avatar').releasePointerCapture(window.identityPointer)"
    )
    page.mouse.move(face["x"] + 90, face["y"] + 90)
    page.wait_for_function(
        "() => document.querySelector('#voyager-avatar').dataset.dragging === 'false'"
    )
    page.mouse.up()
    assert page.evaluate("state.dock") == original
    page.keyboard.press("Control+1")
    page.wait_for_selector("#avatar-home #avatar")
    page.wait_for_timeout(400)
    sink = subprocess.check_output(
        ["pactl", "get-default-sink"], env=env, text=True
    ).strip()
    recording = evidence / "identity-dock-tones.wav"
    recorder = subprocess.Popen(
        [
            "ffmpeg",
            "-y",
            "-nostdin",
            "-loglevel",
            "error",
            "-f",
            "pulse",
            "-i",
            sink + ".monitor",
            "-t",
            "3",
            "-ac",
            "1",
            "-ar",
            "48000",
            str(recording),
        ],
        env=env,
    )
    try:
        page.wait_for_timeout(350)
        face = page.locator("#avatar").bounding_box()
        destination = page.locator(".portal").nth(1).bounding_box()
        page.mouse.move(face["x"] + 47, face["y"] + 47)
        page.mouse.down()
        page.mouse.move(face["x"] + 80, face["y"] + 80, steps=4)
        page.wait_for_timeout(280)
        page.mouse.move(
            destination["x"] + destination["width"] / 2,
            destination["y"] + destination["height"] / 2,
            steps=12,
        )
        page.mouse.up()
        recorder.wait(timeout=8)
    finally:
        if recorder.poll() is None:
            recorder.terminate()
            recorder.wait(timeout=3)
    page.wait_for_function(
        "() => state.dock === document.querySelectorAll('.portal-dock')[1].dataset.dock"
    )
    spectrum = tone_directions(recording)
    assert len(spectrum) == 2, spectrum
    assert spectrum[0]["lastHz"] < spectrum[0]["firstHz"] - 100, spectrum
    assert spectrum[1]["lastHz"] > spectrum[1]["firstHz"] + 100, spectrum
    page.keyboard.press("Control+1")
    page.get_by_role("button", name="Text chat", exact=True).click()
    page.screenshot(path=str(evidence / "identity-home-chat.png"))
    (evidence / "identity.json").write_text(
        json.dumps(
            {
                "portalOpacity": 0.3,
                "placement": "center at 67 percent portal height",
                "stationaryHoldSilent": True,
                "hoverKeptTerminalFocus": True,
                "selectionPassedThrough": True,
                "escapeRestoredDock": True,
                "releasedCaptureRestoredDock": True,
                "outputMonitor": spectrum,
                "soundRequests": page.evaluate("identitySounds"),
                "humanAudibility": False,
            },
            indent=2,
        )
    )


def tone_directions(path):
    with wave.open(str(path)) as file:
        rate = file.getframerate()
        samples = (
            np.frombuffer(file.readframes(file.getnframes()), dtype=np.int16).astype(
                float
            )
            / 32768
        )
    groups = []
    current = []
    window = 1024
    for offset in range(0, len(samples) - window, 512):
        block = samples[offset : offset + window]
        if np.sqrt(np.mean(block**2)) > 0.001:
            frequency = (
                np.argmax(abs(np.fft.rfft(block * np.hanning(window)))) * rate / window
            )
            if 250 <= frequency <= 750:
                if current and (offset / rate - current[-1][0]) > 0.08:
                    groups.append(current)
                    current = []
                current.append((offset / rate, frequency))
    if current:
        groups.append(current)
    return [
        {
            "start": group[0][0],
            "end": group[-1][0],
            "firstHz": group[0][1],
            "lastHz": group[-1][1],
        }
        for group in groups
        if len(group) > 2
    ]
