import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

os.umask(0o077)
root = Path(__file__).resolve().parents[1]
state = Path(sys.argv[1]).resolve()
mode = sys.argv[2]
if any(os.environ.get(key) for key in ['VOYAGER_CALLER', 'VOYAGER_SESSION_CONTEXT']):
    raise SystemExit('Use an authorized unbound experiment runner')


def call(request):
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(25)
        connection.connect(str(state / 'service.sock'))
        connection.sendall((json.dumps(request) + '\n').encode())
        response = json.loads(connection.makefile('rb').readline())
        if 'error' in response:
            raise RuntimeError(response['error'])
        return response['result']


def wait(receipt):
    deadline = time.monotonic() + 35
    while receipt.get('state') == 'pending':
        assert time.monotonic() < deadline, 'Operation outcome unresolved; do not repeat'
        time.sleep(.1)
        receipt = call({'op': 'operation', 'request_id': receipt['request_id']})
    assert receipt.get('state') == 'completed', receipt
    return receipt


if mode == 'setup':
    assert not state.exists(), 'Use a fresh private state'
    state.mkdir(mode=0o700)
    cwd = state / 'workspace'
    cwd.mkdir()
    executable = root / 'target/debug/voyager'
    log = (state / 'service.log').open('w')
    environment = dict(os.environ, VOYAGER_DIRECT_TOOL_PROBE='1')
    service = subprocess.Popen([str(executable), '--state', str(state), 'serve'], env=environment,
                               stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    manifest = {'service_pid': service.pid, 'binary': str(executable), 'state': str(state)}
    (state / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    deadline = time.monotonic() + 20
    while not (state / 'service.sock').exists():
        assert service.poll() is None, 'Candidate service exited'
        assert time.monotonic() < deadline, 'Service socket missing'
        time.sleep(.1)
    created = wait(call({'op': 'create', 'kind': 'codex', 'request_id': 'direct-probe-create',
                         'name': 'Direct tool probe', 'cwd': str(cwd), 'rank': 'crew', 'open': False}))
    manifest.update({'session_id': created['session_id'], 'creation': created})
    manifest['attachment'] = call({'op': 'attach-info', 'session_id': created['session_id']})
    (state / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest))
else:
    manifest = json.loads((state / 'manifest.json').read_text())
    session = manifest['session_id']
    if mode == 'observe':
        page = call({'op': 'events', 'after': 0})
        (state / 'events.json').write_text(json.dumps(page, indent=2))
        events = page['events']
        tools = [e for e in events if e['type'] == 'experiment.direct_tool']
        complete = [e for e in events if e['type'] == 'turn.completed']
        summary = {'direct_tools': [e['payload'] for e in tools],
                   'completed_turns': [e['payload'] for e in complete],
                   'native_tool_kinds': [e['payload'].get('tool_kind') for e in events
                                         if e['type'] == 'tool.started']}
        if tools and complete:
            identity = next(e['payload']['reply'] for e in tools
                            if e['payload']['tool'] == 'voyager_identity')
            denied = next(e['payload']['reply'] for e in tools
                          if e['payload']['tool'] == 'voyager_owner_probe')
            actual = json.loads(identity['contentItems'][0]['text'])
            assert identity['success'] and actual['actor']['kind'] == 'instance'
            assert actual['actor']['session_id'] == session and actual['rank'] == 'crew'
            assert denied['success'] is False and 'forbidden' in denied['contentItems'][0]['text']
            assert any(e['payload'].get('has_error') is False for e in complete)
            assert 'commandExecution' not in summary['native_tool_kinds']
            summary['result'] = 'supported for the observed native turn'
        else:
            summary['result'] = 'pending or inconclusive; inspect native client output'
        (state / 'observation.json').write_text(json.dumps(summary, indent=2))
        print(json.dumps(summary))
    elif mode == 'cleanup':
        info = call({'op': 'attach-info', 'session_id': session})
        assert info['pid'] == manifest['attachment']['pid'], 'Native runtime identity changed'
        stopped = wait(call({'op': 'stop-instance', 'session_id': session,
                             'request_id': 'direct-probe-cleanup', 'close_window': False}))
        result = call({'op': 'stop'})
        (state / 'cleanup.json').write_text(json.dumps({'stopped': stopped, 'service': result}, indent=2))
        print(json.dumps({'session_id': session, 'runtime': stopped['runtime'], 'service': result}))
    else:
        raise SystemExit('Unknown experiment phase')
