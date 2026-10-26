#!/usr/bin/env python3
import base64
import hashlib
import json
import socket
import struct
import sys
import threading
import time
import tomllib
from pathlib import Path

path = sys.argv[sys.argv.index('--listen') + 1].removeprefix('unix://')
settings = [sys.argv[n + 1] for n, arg in enumerate(sys.argv[:-1]) if arg == '-c']
policy = tomllib.loads('\n'.join(settings))['shell_environment_policy']['set']
assert Path(policy['VOYAGER_BIN']).is_file()
assert Path(policy['VOYAGER_STATE']) == Path(path).parent.parent

listener = socket.socket(socket.AF_UNIX)
listener.bind(path)
listener.listen()
counter = 0
active = False
current_turn = None
lock = threading.Lock()


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

    def send(value):
        data = json.dumps(value).encode()
        header = bytes([129, len(data)]) if len(data) < 126 else bytes([129, 126]) + struct.pack('!H', len(data))
        with write_lock:
            stream.sendall(header + data)

    def event(method, params):
        send({'method': method, 'params': {'threadId': 'worker-thread', **params}})

    def complete(turn):
        global active
        time.sleep(1)
        try:
            event('item/completed', {'turnId': turn, 'item': {'id': 'answer', 'type': 'agentMessage', 'text': 'fixture worker done'}})
            with lock:
                active = False
            event('turn/completed', {'turn': {'id': turn, 'status': 'completed'}})
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
            if size == 127:
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
                result = {'layers': [{'name': {'type': 'user', 'file': '/fixture/config.toml', 'profile': None},
                                      'version': 'changed' if (Path(policy['VOYAGER_STATE']) / 'config-changed').exists() else 'original',
                                      'disabledReason': None}]}
            elif method == 'thread/goal/get':
                result = {'goal': {'status': 'active'} if (Path(policy['VOYAGER_STATE']) / 'active-goal').exists() else None}
            elif method == 'thread/start':
                assert set(r['params']) == {'cwd', 'approvalPolicy', 'sandbox', 'historyMode', 'developerInstructions'}
                assert r['params']['approvalPolicy'] == 'never'
                assert r['params']['sandbox'] == 'danger-full-access'
                assert r['params']['historyMode'] == 'legacy'
                result = {'thread': metadata()}
                if (Path(policy['VOYAGER_STATE']) / 'verified-settings').exists():
                    result['thread']['cwd'] = str(Path(policy['VOYAGER_STATE']))
                    result.update(model='fixture-model', modelProvider='openai', cwd=str(Path(policy['VOYAGER_STATE'])),
                                  approvalPolicy='never', approvalsReviewer='user', sandbox={'type': 'dangerFullAccess'},
                                  activePermissionProfile=None, runtimeWorkspaceRoots=[], instructionSources=[], reasoningEffort=None)
            elif method == 'thread/resume':
                result = {'thread': metadata(), 'model': 'fixture-model', 'modelProvider': 'openai',
                          'cwd': str(Path(policy['VOYAGER_STATE'])), 'approvalPolicy': 'never', 'approvalsReviewer': 'user',
                          'sandbox': {'type': 'dangerFullAccess'}, 'activePermissionProfile': None,
                          'runtimeWorkspaceRoots': [], 'instructionSources': [], 'reasoningEffort': None}
                if (Path(policy['VOYAGER_STATE']) / 'resume-setting-mismatch').exists():
                    result['model'] = 'different-model'
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
