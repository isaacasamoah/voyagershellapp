"""Black-box Linux fixtures. No agents, credentials, model calls or live terminals."""

import array
import ctypes
import json
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest


def read_line(stream, timeout=5):
    """Bound every fixture handshake, including failure before a newline."""
    deadline = time.monotonic() + timeout
    data = bytearray()
    while time.monotonic() < deadline:
        if select.select([stream], [], [], max(0, deadline - time.monotonic()))[0]:
            byte = os.read(stream.fileno(), 1)
            if not byte:
                raise RuntimeError(f"fixture closed before line: {data!r}")
            data.extend(byte)
            if byte == b"\n":
                return bytes(data)
    raise TimeoutError("fixture handshake timed out")


def terminal_owner(gate_fd, kill_on_close):
    """Already-running agent analogue, launched by its original terminal owner."""
    pid, master = os.forkpty()
    if pid == 0:
        signal.signal(signal.SIGHUP, signal.SIG_DFL)
        os.write(1, f"READY {os.getpid()}\n".encode())
        # The test releases this only AFTER the original owner has exited.
        if os.read(gate_fd, 1) == b"G":
            os.write(1, f"\x1b[32mAFTER {os.getpid()}\x1b[0m\n".encode())
        os.close(gate_fd)
        os._exit(0)
    os.close(gate_fd)
    print(json.dumps({"pid": pid}), flush=True)
    ready = bytearray()
    while b"\n" not in ready:
        if not select.select([master], [], [], 5)[0]:
            raise TimeoutError("child never became ready")
        ready.extend(os.read(master, 4096))
    print(json.dumps({"ready": ready.decode()}), flush=True)
    request = json.loads(read_line(sys.stdin.buffer))
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(5)
        connection.connect(request["socket"])
        # No reads from master after this point: one new owner, not two readers.
        connection.sendmsg([b"H"], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [master]))])
        if connection.recv(1) != b"+":
            raise RuntimeError("handoff not acknowledged")
        os.close(master)
        if kill_on_close:
            os.killpg(pid, signal.SIGHUP)
        connection.sendall(b"D")


class Experiments(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="voyager-probe-")
        self.directory = Path(self.temp.name)
        self.binary = os.environ["VOYAGER_PROBE"]
        self.processes = []
        self.children = set()
        self.fds = []
        self.addCleanup(self.cleanup)

    def cleanup(self):
        # Only handles/PIDs created and owned by this test. Never process-name scans.
        for process in reversed(self.processes):
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
            for stream in [process.stdin, process.stdout, process.stderr]:
                if stream:
                    stream.close()
        for pid in self.children:
            try:
                done, _ = os.waitpid(pid, os.WNOHANG)
                if not done:
                    os.kill(pid, signal.SIGKILL)
                    os.waitpid(pid, 0)
            except ChildProcessError:
                pass  # Already reaped by this test or the original owner.
        for fd in self.fds:
            os.close(fd)
        self.temp.cleanup()

    def spawn(self, args, **kwargs):
        process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, bufsize=0, **kwargs)
        self.processes.append(process)
        return process

    def receiver(self):
        path = self.directory / "handoff.sock"
        receiver = self.spawn([self.binary, "receive", str(path)])
        self.assertEqual(read_line(receiver.stderr), b"receiver_ready\n")
        return receiver, path

    def collect(self, data, name="events.jsonl"):
        path = self.directory / name
        result = subprocess.run([self.binary, "capture-fixture", str(path), "synthetic:session-1"],
                                input=data, capture_output=True, timeout=5)
        # JSONL uses LF; Unicode line separators can be part of JSON strings.
        records = [json.loads(line) for line in path.read_bytes().split(b"\n") if line]
        return result, records, path

    def handoff(self, kill_on_close=False, failed_capture=False):
        read_fd, write_fd = os.pipe()
        self.fds.append(write_fd)
        owner = self.spawn([sys.executable, __file__, "--owner", str(read_fd), str(int(kill_on_close))],
                           pass_fds=(read_fd,))
        os.close(read_fd)
        pid = json.loads(read_line(owner.stdout))["pid"]
        self.children.add(pid)
        ready = json.loads(read_line(owner.stdout))["ready"]
        self.assertEqual(ready, f"READY {pid}\r\n")
        # The child is already running before Voyager's receiver is started.
        receiver, path = self.receiver()
        owner.stdin.write((json.dumps({"socket": str(path)}) + "\n").encode())
        self.assertEqual(owner.wait(timeout=5), 0, owner.stderr.read().decode())
        self.assertIn(b"handoff_received", read_line(receiver.stderr))
        if failed_capture:
            result, records, _ = self.collect(b'{"type":"turn_start"}\nnot json\n')
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(records[-1]["kind"], "capture_gap")
            self.assertIsNone(receiver.poll(), "capture failure must not close PTY ownership")
        if not kill_on_close:
            os.write(write_fd, b"G")
        output, diagnostics = receiver.communicate(timeout=5)
        self.assertEqual(receiver.returncode, 0, diagnostics.decode())
        self.assertIn(b"pty_closed outcome=unknown", diagnostics)
        done, status = os.waitpid(pid, 0)
        self.assertEqual(done, pid)
        self.children.remove(pid)
        self.assertFalse(path.exists(), "receiver must remove its socket")
        if kill_on_close:
            self.assertEqual(output, b"")
            self.assertTrue(os.WIFSIGNALED(status))
            self.assertEqual(os.WTERMSIG(status), signal.SIGHUP)
        else:
            self.assertEqual(output, f"\x1b[32mAFTER {pid}\x1b[0m\r\n".encode())
            self.assertTrue(os.WIFEXITED(status))
            self.assertEqual(os.WEXITSTATUS(status), 0)

    def test_existing_child_survives_cooperative_owner_exit(self):
        self.handoff()

    def test_explicit_kill_defeats_descriptor_retention(self):
        self.handoff(kill_on_close=True)

    def test_capture_failure_does_not_stop_terminal_child(self):
        self.handoff(failed_capture=True)

    def test_non_pty_descriptor_rejected(self):
        receiver, path = self.receiver()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client, open(os.devnull, "rb") as invalid:
            client.connect(str(path))
            client.sendmsg([b"H"], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [invalid.fileno()]))])
        output, error = receiver.communicate(timeout=5)
        self.assertNotEqual(receiver.returncode, 0)
        self.assertEqual(output, b"")
        self.assertIn(b"not a PTY master", error)
        self.assertFalse(path.exists())

    def test_second_receiver_cannot_replace_socket(self):
        receiver, path = self.receiver()
        result = subprocess.run([self.binary, "receive", str(path)], capture_output=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(path.exists())
        self.assertIsNone(receiver.poll())

    def test_shared_directory_rejected(self):
        os.chmod(self.directory, 0o755)
        result = subprocess.run([self.binary, "receive", str(self.directory / "socket")],
                                capture_output=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"no group/other permissions", result.stderr)

    def test_structured_records_preserve_order_and_evidence(self):
        events = [
            {"type": "turn_start"},
            {"type": "tool_execution_start", "toolCallId": "fixture-tool-1", "toolName": "read"},
            {"type": "tool_execution_end", "toolCallId": "fixture-tool-1", "isError": False},
            {"type": "message_end", "message": {"role": "assistant", "text": "two\u2028lines"}},
            {"type": "agent_end"},
            {"type": "agent_settled"},
        ]
        wire = b"".join((json.dumps(event, ensure_ascii=False) + "\n").encode() for event in events)
        result, records, path = self.collect(wire)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual([record["event"] for record in records], events)
        self.assertEqual([record["sequence"] for record in records], list(range(1, 7)))
        self.assertTrue(all(record["task_id"] is None for record in records))
        self.assertTrue(all(record["source"] == "synthetic:session-1" for record in records))
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertIn(b"task_outcome=unknown", result.stderr)
        original = path.read_bytes()
        again = subprocess.run([self.binary, "capture-fixture", str(path), "new-source"],
                               input=wire, capture_output=True, timeout=5)
        self.assertNotEqual(again.returncode, 0)
        self.assertEqual(path.read_bytes(), original)

    def test_invalid_and_unbounded_frames_leave_explicit_gap(self):
        for index, invalid in enumerate([b"not-json\n", b'{"type":"partial"}', b"x" * 70000 + b"\n"]):
            with self.subTest(index=index):
                result, records, _ = self.collect(b'{"type":"turn_start"}\n' + invalid, f"gap-{index}.jsonl")
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual([row["kind"] for row in records], ["source_event", "capture_gap"])
                self.assertEqual(records[-1]["sequence"], 2)
                self.assertNotIn("event", records[-1])


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--owner":
        terminal_owner(int(sys.argv[2]), bool(int(sys.argv[3])))
    else:
        # Reap only this suite's orphaned fixtures after their original owner
        # exits. This changes the test process, not any machine-wide setting.
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
            raise OSError(ctypes.get_errno(), "cannot become fixture subreaper")
        unittest.main(verbosity=2)
