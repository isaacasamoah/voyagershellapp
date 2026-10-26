#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import threading
import time
import tomllib
from pathlib import Path

path = sys.argv[sys.argv.index('--listen') + 1].removeprefix('unix://')
settings = [sys.argv[n + 1] for n, arg in enumerate(sys.argv[:-1]) if arg == '-c']
runtime_settings = tomllib.loads('\n'.join(settings))
policy = runtime_settings['shell_environment_policy']['set']
assert Path(policy['VOYAGER_BIN']).is_file()
assert Path(policy['VOYAGER_STATE']) == Path(path).parent.parent

listener = socket.socket(socket.AF_UNIX)
listener.bind(path)
listener.listen()
parent = os.getppid()
counter = 0
active = False
current_turn = None
lock = threading.Lock()
subscribers = []
connections = []


def exact(stream, size):
    result = b''
    while len(result) < size:
        part = stream.recv(size - len(result))
        if not part:
            raise EOFError
        result += part
    return result


def metadata():
    return {'id': 'worker-thread', 'sessionId': 'worker-thread', 'cwd': '/synthetic',
            'status': {'type': 'active' if active else 'idle'},
            'turns': [{'id': current_turn, 'status': 'inProgress'}] if active else []}


def handle(stream):
    global counter, active, current_turn
    write_lock = threading.Lock()
    resume_preflight = False

    def send(value):
        data = json.dumps(value).encode()
        header = bytes([129, len(data)]) if len(data) < 126 else bytes([129, 126]) + struct.pack('!H', len(data))
        with write_lock:
            stream.sendall(header + data)

    def event(method, params):
        send({'method': method, 'params': {'threadId': 'worker-thread', **params}})

    subscribers.append(send)
    connections.append(stream)

    def complete(turn):
        global active
        time.sleep(1)
        while (Path(policy['VOYAGER_STATE']) / 'hold-turn').exists():
            time.sleep(.01)
        try:
            for notify in list(subscribers):
                try:
                    notify({'method': 'item/completed', 'params': {'threadId': 'worker-thread', 'turnId': turn, 'item': {'id': 'answer', 'type': 'agentMessage', 'text': 'fixture worker done'}}})
                    notify({'method': 'turn/completed', 'params': {'threadId': 'worker-thread', 'turn': {'id': turn, 'status': 'completed'}}})
                except OSError:
                    pass
            with lock:
                active = False
        except OSError:
            pass

    try:
        request = b''
        while not request.endswith(b'\r\n\r\n'):
            request += exact(stream, 1)
        key = next(line.split(b':', 1)[1].strip() for line in request.split(b'\r\n') if line.lower().startswith(b'sec-websocket-key:'))
        accept = base64.b64encode(hashlib.sha1(key + b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
        stream.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + b'\r\n\r\n')
        while True:
            first, second = exact(stream, 2)
            if first & 15 == 8:
                return
            size = second & 127
            if size == 126:
                size = struct.unpack('!H', exact(stream, 2))[0]
            elif size == 127:
                size = struct.unpack('!Q', exact(stream, 8))[0]
            assert size < 65536
            mask = exact(stream, 4)
            data = bytes(c ^ mask[i % 4] for i, c in enumerate(exact(stream, size)))
            r = json.loads(data)
            if 'id' not in r:
                continue
            method = r['method']
            result = {}
            if method == 'initialize' and (Path(policy['VOYAGER_STATE']) / 'verified-settings').exists():
                result = {'userAgent': 'codex/0.164.0 fixture'}
            elif method == 'config/read':
                if (Path(policy['VOYAGER_STATE']) / 'invalid-config').exists():
                    send({'id': r['id'], 'error': {'code': -32602, 'message': 'invalid configuration'}})
                    continue
                changed = (Path(policy['VOYAGER_STATE']) / 'config-changed').exists()
                result = {'config': {'model': 'changed-model' if changed else 'fixture-model',
                                    'model_reasoning_effort': 'low' if changed else 'medium',
                                    'approval_policy': 'on-request', 'sandbox_mode': 'read-only'},
                          'layers': [{'version': 'changed' if (Path(policy['VOYAGER_STATE']) / 'unrelated-config').exists() else 'original'}]}
                if (Path(policy['VOYAGER_STATE']) / 'default-model').exists():
                    result['config'].update(model=None, model_reasoning_effort=None)
            elif method == 'model/list':
                result = {'data': [{'model': 'fixture-model', 'isDefault': True, 'defaultReasoningEffort': 'medium'}] if r['params'].get('cursor') else [], 'nextCursor': None if r['params'].get('cursor') else 'second-page'}
            elif method == 'thread/goal/get':
                if (Path(policy['VOYAGER_STATE']) / 'missing-thread').exists():
                    send({'id': r['id'], 'error': {'code': -32602, 'message': 'saved thread is unavailable'}})
                    continue
                resume_preflight = True
                if (Path(policy['VOYAGER_STATE']) / 'slow-resume').exists():
                    time.sleep(.2)
                result = {'goal': {'status': 'active'} if (Path(policy['VOYAGER_STATE']) / 'active-goal').exists() else None}
            elif method == 'thread/start':
                assert r['params']['historyMode'] == 'legacy'
                result = {'thread': metadata(), 'model': r['params']['model'], 'modelProvider': 'openai',
                          'cwd': str(Path(policy['VOYAGER_STATE'])), 'approvalPolicy': r['params']['approvalPolicy'], 'approvalsReviewer': 'user',
                          'sandbox': {'type': 'dangerFullAccess'},
                          'activePermissionProfile': {'id': r['params']['permissions'], 'extends': None}, 'runtimeWorkspaceRoots': [], 'instructionSources': [],
                          'reasoningEffort': r['params']['config']['model_reasoning_effort']}
                result['thread']['cwd'] = str(Path(policy['VOYAGER_STATE']))
            elif method == 'thread/resume':
                hold_reconnect = Path(policy['VOYAGER_STATE']) / 'hold-reconnect'
                if not resume_preflight and hold_reconnect.exists():
                    (hold_reconnect.parent / 'reconnect-pending').write_text('1')
                    while hold_reconnect.exists():
                        time.sleep(.01)
                hold = Path(policy['VOYAGER_STATE']) / 'hold-resume'
                if resume_preflight and hold.exists():
                    (hold.parent / 'resume-loaded').write_text('1')
                    while hold.exists():
                        if os.getppid() != parent:
                            os._exit(0)
                        time.sleep(.01)
                if resume_preflight:
                    assert r['params']['excludeTurns'] is True
                result = {'thread': metadata(), 'model': 'fixture-model', 'modelProvider': 'openai',
                          'cwd': str(Path(policy['VOYAGER_STATE'])), 'approvalPolicy': 'never', 'approvalsReviewer': 'user',
                          'sandbox': {'type': 'dangerFullAccess'}, 'activePermissionProfile': None,
                          'runtimeWorkspaceRoots': [], 'instructionSources': [], 'reasoningEffort': None}
                if (Path(policy['VOYAGER_STATE']) / 'resume-wrong-thread').exists():
                    result['thread']['id'] = 'unexpected-thread'
                if (Path(policy['VOYAGER_STATE']) / 'resume-setting-mismatch').exists():
                    result['model'] = 'different-model'
                if resume_preflight:
                    result.update(model=r['params']['model'], reasoningEffort=r['params']['config']['model_reasoning_effort'],
                                  approvalPolicy=r['params']['approvalPolicy'],
                                  sandbox={'type': 'dangerFullAccess'}, activePermissionProfile={'id': r['params']['permissions'], 'extends': None})
                    if (Path(policy['VOYAGER_STATE']) / 'resume-setting-mismatch').exists():
                        result['model'] = 'different-model'
            elif method == 'fixture/slow':
                time.sleep(.4)
            elif method == 'fixture/count':
                result = {'turns': counter}
            elif method == 'fixture/disconnect':
                for other in list(connections):
                    if other is not stream:
                        try:
                            other.shutdown(socket.SHUT_RDWR)
                        except OSError:
                            pass
            elif method == 'thread/read':
                result = {'thread': metadata()}
            elif method == 'thread/loaded/list':
                result = {'data': ['worker-thread'], 'nextCursor': None}
            elif method == 'thread/realtime/stop':
                send({'id': r['id'], 'result': {}})
                if not (Path(policy['VOYAGER_STATE']) / 'voice-stop-unconfirmed').exists():
                    event('thread/realtime/closed', {})
                continue
            elif method == 'turn/start':
                with lock:
                    counter += 1
                    active = True
                    turn = f'worker-turn-{counter}'
                    current_turn = turn
                if (Path(policy['VOYAGER_STATE']) / 'incomplete-settings-update').exists():
                    event('thread/settings/updated', {'threadSettings': {'model': 'fixture-model'}})
                event('turn/started', {'turn': {'id': turn, 'status': 'inProgress'}})
                event('item/completed', {'turnId': turn, 'item': {'id': 'user', 'type': 'userMessage', 'content': r['params']['input']}})
                result = {'turn': {'id': turn, 'status': 'inProgress'}}
                threading.Thread(target=complete, args=(turn,), daemon=True).start()
            elif method == 'turn/steer':
                with lock:
                    expected = r['params']['expectedTurnId']
                    matches = active and current_turn == expected
                if not matches:
                    send({'id': r['id'], 'error': {'code': -32602, 'message': 'expected turn is no longer active'}})
                    continue
                event('item/completed', {'turnId': expected, 'item': {'id': 'steered', 'type': 'userMessage', 'content': r['params']['input']}})
                result = {'turnId': expected}
            send({'id': r['id'], 'result': result})
    except (EOFError, OSError):
        pass
    finally:
        stream.close()


while True:
    connection, _ = listener.accept()
    threading.Thread(target=handle, args=(connection,), daemon=True).start()
