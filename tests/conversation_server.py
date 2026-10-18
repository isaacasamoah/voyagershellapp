#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path
import sys
import time


def send(value):
    print(json.dumps(value), flush=True)


def note(method, **params):
    send({'method': method, 'params': {'threadId': 'private-conversation', **params}})


helper = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
Path("conversation-helper.pid").write_text(str(helper.pid))

for line in sys.stdin:
    request = json.loads(line)
    method = request.get('method')
    if 'id' not in request:
        continue
    params = request.get('params', {})
    result = {}
    if method == 'thread/start':
        assert params['ephemeral'] is True
        assert params['sandbox'] == 'read-only'
        assert params['config']['model_reasoning_effort'] == 'medium'
        result = {'thread': {'id': 'private-conversation'}, 'model': 'fixture-model', 'reasoningEffort': 'medium'}
    if method == 'turn/start':
        assert params['effort'] == 'medium'
        text = params['input'][0]['text']
        if text == 'disconnect':
            sys.exit(1)
        note('turn/completed', turn={'id': 'unrelated-turn', 'status': 'completed', 'error': None})
        time.sleep(.4)
        result = {'turn': {'id': 'fixture-turn'}}
    send({'id': request['id'], 'result': result})
    if method == 'turn/start':
        note('item/completed', item={'id': 'answer', 'type': 'agentMessage', 'text': 'Real fixture transport reply'})
        note('turn/completed', turn={'id': 'fixture-turn', 'status': 'completed', 'error': None})
    if method == 'thread/realtime/start':
        assert params['transport']['type'] == 'webrtc'
        note('thread/realtime/started', version='v3')
        note('thread/realtime/sdp', sdp='fixture-answer')
    if method == 'thread/realtime/stop':
        note('thread/realtime/closed')
