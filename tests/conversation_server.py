#!/usr/bin/env python3
import os
import json
import subprocess
from pathlib import Path
import sys
import time


def send(value):
    print(json.dumps(value), flush=True)


def note(method, **params):
    send({'method': method, 'params': {'threadId': params.pop('threadId', 'private-conversation'), **params}})


if '--listen' in sys.argv and sys.argv[sys.argv.index('--listen') + 1].startswith('unix://'):
    os.execv(sys.executable, [sys.executable, str(Path(__file__).with_name('worker_server.py')), *sys.argv[1:]])

presenters = set()
next_presenter = 0

helper = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
Path("conversation-helper.pid").write_text(str(helper.pid))

for line in sys.stdin:
    request = json.loads(line)
    method = request.get('method')
    with Path('conversation-methods.jsonl').open('a') as log:
        log.write(json.dumps({'method':method}) + '\n')
    if 'id' not in request:
        continue
    params = request.get('params', {})
    result = {}
    if method == 'thread/start':
        assert params['ephemeral'] is True
        assert params['sandbox'] == 'read-only'
        assert params['config']['model_reasoning_effort'] == 'medium'
        thread = 'private-conversation'
        if params.get('dynamicTools') == []:
            next_presenter += 1
            thread = f'presentation-{next_presenter}'
            presenters.add(thread)
        result = {'thread': {'id': thread}, 'model': 'fixture-model', 'reasoningEffort': 'medium'}
    if method == 'turn/start':
        assert params['effort'] == 'medium'
        text = params['input'][0]['text']
        if text == 'disconnect':
            sys.exit(1)
        if text.startswith('tool|'):
            call = json.loads(text[5:])
            params_tool = {'threadId': params['threadId'], 'turnId': 'fixture-turn', 'callId': request['id'].__str__(), 'namespace': None, **call}
            send({'id': request['id'], 'result': {'turn': {'id': 'fixture-turn'}}})
            for retry in range(2):
                send({'id': 'tool-' + str(retry), 'method': 'item/tool/call', 'params': params_tool})
                output = json.loads(next(sys.stdin))
                assert output['id'] == 'tool-' + str(retry)
                if retry == 0: original = output['result']
                else: assert output['result'] == original
            note('item/completed', item={'id': 'tool-answer', 'type': 'agentMessage', 'text': original['contentItems'][0]['text']})
            note('turn/completed', turn={'id': 'fixture-turn', 'status': 'completed', 'error': None})
            continue
        if params['threadId'] in presenters:
            time.sleep(.3)
        note('turn/completed', turn={'id': 'unrelated-turn', 'status': 'completed', 'error': None})
        time.sleep(.4)
        result = {'turn': {'id': 'fixture-turn'}}
    send({'id': request['id'], 'result': result})
    if method == 'turn/start' and params['threadId'] in presenters:
        note('item/completed', threadId=params['threadId'], item={'id':'presentation-answer','type':'agentMessage','text':json.dumps({'text':'Your vessel needs a decision.', 'spoken':'Your vessel needs a decision.'})})
        note('turn/completed', threadId=params['threadId'], turn={'id':'fixture-turn','status':'completed','error':None})
    elif method == 'turn/start':
        note('item/completed', item={'id': 'answer', 'type': 'agentMessage', 'text': 'Real fixture transport reply'})
        note('turn/completed', turn={'id': 'fixture-turn', 'status': 'completed', 'error': None})
    if method == 'thread/realtime/start':
        assert params['transport']['type'] == 'webrtc'
        note('thread/realtime/started', version='v3')
        note('thread/realtime/sdp', sdp='fixture-answer')
    if method == 'thread/realtime/stop':
        note('thread/realtime/closed')
