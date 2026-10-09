#!/usr/bin/env python3
"""Disposable protocol fixture, never a real model or user's Codex server."""
import base64
import hashlib
import json
import socket
import struct
import sys
import threading
import time

path = sys.argv[sys.argv.index('--listen') + 1].removeprefix('unix://')
listener = socket.socket(socket.AF_UNIX)
listener.bind(path)
listener.listen()
counter = 0
active = False
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
            'status': {'type': 'active' if active else 'idle'}}


def handle(stream):
    global counter, active
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
            if method == 'thread/start':
                assert set(r['params']) == {'cwd'}
                result = {'thread': metadata()}
            elif method in ['thread/read', 'thread/resume']:
                result = {'thread': metadata()}
            elif method == 'thread/loaded/list':
                result = {'data': ['worker-thread'], 'nextCursor': None}
            elif method == 'turn/start':
                with lock:
                    counter += 1
                    active = True
                    turn = f'worker-turn-{counter}'
                event('turn/started', {'turn': {'id': turn, 'status': 'inProgress'}})
                event('item/completed', {'turnId': turn, 'item': {'id': 'user', 'type': 'userMessage', 'content': r['params']['input']}})
                result = {'turn': {'id': turn, 'status': 'inProgress'}}
                threading.Thread(target=complete, args=(turn,), daemon=True).start()
            send({'id': r['id'], 'result': result})
    except (EOFError, OSError):
        pass
    finally:
        stream.close()


while True:
    connection, _ = listener.accept()
    threading.Thread(target=handle, args=(connection,), daemon=True).start()
