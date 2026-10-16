import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time
import urllib.request


ROLES = {
    "captain": "Own integration, shared interface agreements, whole-product acceptance, README and proof notes. Coordinate the four workers through ordinary Voyager messages. Integrate their commits into your branch. Do not implement their entire tasks in parallel. When finished, write .trial/result.json with your final commit, acceptance results R1 through R8, checks and remaining limitations. This file is a handoff, not self-certified proof.",
    "snapshot": "Own Rust Git snapshot capture, baseline/comparison behavior and tests for real repositories. Propose your public types and service interface to the captain and walkthrough worker before integration. Keep changes in your own modules where possible. The captain owns central integration files.",
    "walkthrough": "Own Rust walkthrough generation, structured response validation, snapshot references, provider failures and corresponding tests. Agree on captured-input types with snapshot and output types with the renderer through normal team messages. The captain owns central integration files.",
    "desktop": "Own Electron main/preload integration, panel geometry, docked-session identity, asynchronous requests and stale-response handling. Coordinate the service operation contract with the captain and DOM/state contract with renderer. Preserve lifecycle controls and docking.",
    "renderer": "Own the review renderer, styling, progressive disclosure, keyboard behavior and renderer tests. Agree on data and lifecycle interfaces with desktop and walkthrough. Use the existing panel visual style and safe local DOM rendering.",
}

TASK = "Read .trial/BRIEF.md, .trial/ROLE.md and .trial/team.json. Implement your assigned role in this five-person team. You are not alone in the codebase. Preserve teammates' work and coordinate shared interfaces through Voyager messages. Use only these five sessions, and only this team's worktrees. Do not use subagents or spawn additional models. Do not inspect other trials, global memories or private session history. Do not push, merge to main or publish. Report important decisions and findings naturally with their evidence as you work. Commit your owned changes and send the captain your commit and verification. Follow the brief's completion and handoff requirements. Begin now."

REMINDER = "Ten minutes remain in this run. Finish integration, run the agreed checks and preserve an honest handoff. Do not extend the deadline. Captain: write .trial/result.json with the final commit, R1-R8 outcomes, checks and remaining limitations. Workers: send your commit and any incomplete work to the captain."


def invoke(args, cwd=None, timeout=60, env=None):
    result = subprocess.run(
        [str(x) for x in args],
        cwd=cwd,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip()[:2000]}")
    return result.stdout.strip()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def load(root):
    return json.loads((root / "manifest.json").read_text())


def prepare(args):
    root = args.root.resolve()
    if root.exists():
        raise RuntimeError(
            "Trial directory already exists; preserve it and choose a new one"
        )
    source = args.source.resolve()
    revision = invoke(["git", "rev-parse", args.revision + "^{commit}"], source)
    if invoke(["git", "status", "--porcelain"], source):
        raise RuntimeError("Freeze a clean source checkout before preparing a pair")
    root.mkdir(parents=True, mode=0o700)
    inputs = root / "inputs"
    inputs.mkdir()
    shutil.copyfile(args.brief, inputs / "BRIEF.md")
    shutil.copyfile(args.protocol, inputs / "PROTOCOL.md")
    for role, text in ROLES.items():
        (inputs / f"{role}.md").write_text(text + "\n")
    (inputs / "TASK.txt").write_text(TASK + "\n")
    (inputs / "REMINDER.txt").write_text(REMINDER + "\n")
    order = ["A", "B"]
    secrets.SystemRandom().shuffle(order)
    treatment = secrets.choice(order)
    manifest = {
        "version": 1,
        "created_at": time.time(),
        "revision": revision,
        "source": str(source),
        "order": order,
        "treatment": treatment,
        "model": "gpt-6.1-sol",
        "effort": "medium",
        "minutes": 60,
        "voyager": str(args.voyager.resolve()),
        "codex": str(args.codex.resolve()),
        "binary_sha256": digest(args.voyager),
        "inputs": {p.name: digest(p) for p in inputs.iterdir()},
        "arms": {},
        "state": "preparing",
        "rehearsal": "not_run",
    }
    save(root / "manifest.json", manifest)
    token = hashlib.sha256(str(root).encode()).hexdigest()[:8]
    for arm in order:
        directory = root / arm
        directory.mkdir()
        repository = directory / "captain"
        invoke(["git", "init", "--quiet", repository])
        invoke(["git", "fetch", "--quiet", "--no-tags", source, revision], repository)
        invoke(
            [
                "git",
                "checkout",
                "--quiet",
                "-b",
                "experiment/review-canvas",
                "FETCH_HEAD",
            ],
            repository,
        )
        with (repository / ".git/info/exclude").open("a") as file:
            file.write("\n/.trial/\n")
        paths = {"captain": str(repository)}
        for role in ROLES:
            if role != "captain":
                worktree = directory / role
                invoke(
                    [
                        "git",
                        "worktree",
                        "add",
                        "--quiet",
                        "-b",
                        f"experiment/review-canvas-{role}",
                        worktree,
                        revision,
                    ],
                    repository,
                )
                paths[role] = str(worktree)
            local = Path(paths[role]) / ".trial"
            local.mkdir()
            shutil.copyfile(inputs / "BRIEF.md", local / "BRIEF.md")
            shutil.copyfile(inputs / f"{role}.md", local / "ROLE.md")
        state = Path.home() / ".local/share" / f"vrc-{token}-{arm}"
        if state.exists():
            raise RuntimeError("Private service directory already exists")
        manifest["arms"][arm] = {
            "paths": paths,
            "state_dir": str(state),
            "sessions": {},
            "phase": "prepared",
            "cursor": 0,
        }
        save(root / "manifest.json", manifest)
    manifest["state"] = "prepared"
    save(root / "manifest.json", manifest)
    check(root)


def check(root):
    manifest = load(root)
    for name, expected in manifest["inputs"].items():
        if digest(root / "inputs" / name) != expected:
            raise RuntimeError(f"Frozen input changed: {name}")
    if digest(manifest["voyager"]) != manifest["binary_sha256"]:
        raise RuntimeError("Service binary changed")
    directories = []
    for arm, record in manifest["arms"].items():
        for role, cwd in record["paths"].items():
            path = Path(cwd)
            if digest(path / ".trial/BRIEF.md") != manifest["inputs"]["BRIEF.md"]:
                raise RuntimeError(f"Brief differs in {arm}/{role}")
            if digest(path / ".trial/ROLE.md") != manifest["inputs"][f"{role}.md"]:
                raise RuntimeError(f"Role differs in {arm}/{role}")
            if record["phase"] == "prepared":
                if invoke(["git", "rev-parse", "HEAD"], cwd) != manifest["revision"]:
                    raise RuntimeError(f"Starting revision changed in {arm}/{role}")
                if invoke(["git", "status", "--porcelain"], cwd):
                    raise RuntimeError(f"Starting worktree is dirty: {arm}/{role}")
        directories.append(
            invoke(
                ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                record["paths"]["captain"],
            )
        )
    if len(directories) != 2 or directories[0] == directories[1]:
        raise RuntimeError("Arms must have independent Git directories")
    print(
        json.dumps(
            {
                "state": manifest["state"],
                "revision": manifest["revision"],
                "brief_sha256": manifest["inputs"]["BRIEF.md"],
                "worktrees_verified": 10,
            }
        )
    )


def cli(manifest, arm, *args):
    return json.loads(
        invoke([manifest["voyager"], "--state", arm["state_dir"], *args], timeout=90)
    )


def record_events(manifest, arm, directory):
    records = []
    while True:
        result = cli(manifest, arm, "events", str(arm["cursor"]))
        events = result["events"]
        if not events:
            break
        with (directory / "events.jsonl").open("a") as file:
            for event in events:
                file.write(json.dumps(event) + "\n")
        records.extend(events)
        arm["cursor"] = result["cursor"]
        if len(events) < 100:
            break
    return records


def finish(manifest, arm, directory):
    errors = []
    if arm.get("service_started"):
        try:
            save(
                directory / "pause-receipt.json", cli(manifest, arm, "collab", "pause")
            )
        except Exception as error:
            errors.append(str(error))
        for role, session in arm["sessions"].items():
            try:
                receipt = cli(
                    manifest,
                    arm,
                    "stop-instance",
                    session["session_id"],
                    "--request-id",
                    f"trial-stop-{role}",
                )
                save(directory / f"stop-{role}.json", receipt)
                if receipt.get("state") != "completed":
                    errors.append(f"Stop not completed for {role}")
            except Exception as error:
                errors.append(f"{role}: {error}")
        try:
            record_events(manifest, arm, directory)
            save(directory / "final-graph.json", cli(manifest, arm, "collab", "status"))
        except Exception as error:
            errors.append(str(error))
    arm["cleanup_errors"] = errors
    for role, cwd in arm["paths"].items():
        (directory / f"{role}.patch").write_text(
            invoke(["git", "diff", "--binary", "HEAD"], cwd)
        )
        save(
            directory / f"{role}-tree.json",
            {
                "head": invoke(["git", "rev-parse", "HEAD"], cwd),
                "status": invoke(["git", "status", "--porcelain"], cwd),
                "untracked": invoke(
                    ["git", "ls-files", "--others", "--exclude-standard"], cwd
                ).splitlines(),
            },
        )


def native_settings(thread):
    base = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "sessions"
    matches = list(base.rglob(f"*{thread}.jsonl"))
    for path in matches:
        for line in path.read_text().splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("type") == "turn_context":
                data = row["payload"]
                return {
                    "model": data.get("model"),
                    "effort": data.get("effort", data.get("reasoning_effort")),
                    "source": str(path),
                }
    return None


def run(root, label, require_presentation=False):
    manifest = load(root)
    check(root)
    if manifest["rehearsal"] != "passed":
        raise RuntimeError(
            "Record a passed, separate native rehearsal before a measured run"
        )
    arm = manifest["arms"][label]
    earlier = manifest["order"][: manifest["order"].index(label)]
    if any(
        manifest["arms"][key]["phase"] not in ("finished", "interrupted")
        for key in earlier
    ):
        raise RuntimeError("Follow the frozen randomized arm order")
    if digest(root / "rehearsal.json") != manifest["rehearsal_sha256"]:
        raise RuntimeError("Rehearsal evidence changed")
    if arm["phase"] != "prepared":
        raise RuntimeError("This arm already started. Inspect it; do not resubmit")
    if Path(arm["state_dir"]).exists():
        raise RuntimeError("Measured service state must be fresh")
    if not os.environ.get("DISPLAY"):
        raise RuntimeError(
            "Start from the desktop session so native terminals can open"
        )
    if label == manifest["treatment"] and not all(
        os.environ.get(k) for k in ("OPENAI_API_KEY", "TYPESAFE_API_KEY")
    ):
        raise RuntimeError(
            "Treatment requires provider credentials in the service environment"
        )
    directory = root / label
    wrapper = directory / "codex-pinned"
    settings = [
        "-c",
        'model="' + manifest["model"] + '"',
        "-c",
        'model_reasoning_effort="' + manifest["effort"] + '"',
        "-c",
        "check_for_update_on_startup=false",
    ]
    wrapper.write_text(
        "#!/usr/bin/env python3\nimport os, sys\na = sys.argv[1:]\ns = "
        + repr(settings)
        + "\nos.execv("
        + repr(manifest["codex"])
        + ", ["
        + repr(manifest["codex"])
        + "] + (a + s if a and a[0] == 'app-server' else s + a))\n"
    )
    wrapper.chmod(0o700)
    arm["phase"] = "starting"
    save(root / "manifest.json", manifest)
    try:
        environment = dict(os.environ, VOYAGER_CODEX_BIN=str(wrapper))
        receipt = json.loads(
            invoke(
                [manifest["voyager"], "--state", arm["state_dir"], "start"],
                env=environment,
            )
        )
        arm["service_started"] = True
        save(directory / "service-start.json", receipt)
        save(root / "manifest.json", manifest)
        for role, cwd in arm["paths"].items():
            receipt = cli(
                manifest,
                arm,
                "create",
                "codex",
                f"trial-create-{role}",
                f"Review {label} {role}",
                cwd,
            )
            save(directory / f"create-{role}.json", receipt)
            session_id = receipt.get("session_id")
            if session_id:
                arm["sessions"][role] = {
                    "session_id": session_id,
                    "role": role,
                    "cwd": cwd,
                }
            save(root / "manifest.json", manifest)
            if receipt.get("state") != "completed" or not session_id:
                raise RuntimeError(
                    f"Native creation incomplete for {role}; inspect its saved receipt"
                )
            info = cli(manifest, arm, "attach-info", session_id)
            arm["sessions"][role]["native_thread_id"] = info["native_thread_id"]
        for role, session in arm["sessions"].items():
            save(Path(session["cwd"]) / ".trial/team.json", arm["sessions"])
            receipt = cli(
                manifest,
                arm,
                "send",
                session["session_id"],
                f"trial-preflight-{role}",
                "Reply exactly READY. Do not use tools.",
            )
            session["preflight_turn"] = receipt.get("native_turn_id")
        completed = set()
        deadline = time.monotonic() + 90
        while len(completed) < 5 and time.monotonic() < deadline:
            for event in record_events(manifest, arm, directory):
                if (
                    event["type"] == "turn.completed"
                    and event["payload"].get("status") == "completed"
                ):
                    completed.add(event["session_id"])
            time.sleep(1)
        if len(completed) != 5:
            raise RuntimeError(
                "Native preflight did not complete for every participant"
            )
        for session in arm["sessions"].values():
            settings = native_settings(session["native_thread_id"])
            session["settings_evidence"] = settings
            if (
                not settings
                or settings["model"] != manifest["model"]
                or settings["effort"] != manifest["effort"]
            ):
                raise RuntimeError(
                    "Could not verify the effective native model and effort"
                )
        if label == manifest["treatment"]:
            jobs = set()
            for role, session in arm["sessions"].items():
                file = directory / f"assignment-{role}.json"
                save(
                    file,
                    {
                        "session_id": session["session_id"],
                        "brief": "Build Voyager review canvas: docked click opens a workspace review, Git snapshots, generated walkthrough and progressive disclosure to exact captured code. "
                        + ROLES[role],
                        "ticket": "review-canvas",
                        "supervisor": None
                        if role == "captain"
                        else arm["sessions"]["captain"]["session_id"],
                        "delivery": True,
                        "delivery_mode": "steer",
                    },
                )
                receipt = cli(manifest, arm, "collab", "assign", file)
                save(directory / f"assignment-{role}-receipt.json", receipt)
                jobs.add(receipt["job_id"])
            deadline = time.monotonic() + 60
            while jobs and time.monotonic() < deadline:
                status = cli(manifest, arm, "collab", "status")
                for job in status.get("worker", {}).get("recent_jobs", []):
                    if job["id"] in jobs:
                        if "error" in job["result"]:
                            raise RuntimeError("Assignment job failed")
                        jobs.remove(job["id"])
                time.sleep(1)
            if jobs:
                raise RuntimeError("Assignment completion was not established")
            config = directory / "graph-run.json"
            save(config, {"window_chars": 16000, "max_events": 500, "follow": True})
            save(
                directory / "graph-run-receipt.json",
                cli(manifest, arm, "collab", "run", config),
            )
        if require_presentation:
            arm["phase"] = "presentation"
            save(root / "manifest.json", manifest)
            ready = directory / "presentation-ready.json"
            deadline = time.monotonic() + 300
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(1)
            if not ready.exists():
                raise RuntimeError(
                    "Presentation was not confirmed before setup deadline"
                )
            arm["presentation"] = json.loads(ready.read_text())
        manifest["state"] = "running"
        arm["started_at"] = time.time()
        arm["phase"] = "running"
        save(root / "manifest.json", manifest)
        for role, session in arm["sessions"].items():
            save(
                directory / f"task-{role}.json",
                cli(
                    manifest,
                    arm,
                    "send",
                    session["session_id"],
                    f"trial-task-{role}",
                    (root / "inputs/TASK.txt").read_text(),
                ),
            )
        start = time.monotonic() - (time.time() - arm["started_at"])
        reminded = False
        arm["outcome"] = "time_limit"
        while time.monotonic() - start < manifest["minutes"] * 60:
            elapsed = time.monotonic() - start
            events = record_events(manifest, arm, directory)
            status = cli(manifest, arm, "status")
            graph = cli(manifest, arm, "collab", "status")
            with urllib.request.urlopen(
                graph["url"] + "api/state", timeout=5
            ) as response:
                snapshot = json.load(response)
            save(directory / "graph-latest.json", snapshot)
            with (directory / "observations.jsonl").open("a") as file:
                file.write(
                    json.dumps(
                        {
                            "at": time.time(),
                            "elapsed_seconds": elapsed,
                            "service": status,
                            "graph": graph,
                        }
                    )
                    + "\n"
                )
            if any(
                event["type"] in ("capture.gap", "worker.exited") for event in events
            ):
                raise RuntimeError(
                    "Native capture or runtime failed during the measured run"
                )
            if label == manifest["treatment"]:
                worker = graph.get("worker", {})
                if worker.get("state") == "paused" or worker.get("last_job", {}).get(
                    "pipeline_error"
                ):
                    raise RuntimeError(
                        "Treatment pipeline stopped; preserve this interrupted arm"
                    )
            if not reminded and elapsed >= (manifest["minutes"] - 10) * 60:
                for role, session in arm["sessions"].items():
                    save(
                        directory / f"reminder-{role}.json",
                        cli(
                            manifest,
                            arm,
                            "send",
                            session["session_id"],
                            f"trial-reminder-{role}",
                            (root / "inputs/REMINDER.txt").read_text(),
                            "--steer",
                        ),
                    )
                reminded = True
            result = Path(arm["paths"]["captain"]) / ".trial/result.json"
            if result.exists() and any(
                e["type"] == "turn.completed"
                and e["session_id"] == arm["sessions"]["captain"]["session_id"]
                and e["payload"].get("status") == "completed"
                for e in events
            ):
                handoff = json.loads(result.read_text())
                if handoff.get("commit") == invoke(
                    ["git", "rev-parse", "HEAD"], arm["paths"]["captain"]
                ):
                    arm["outcome"] = "handoff_received"
                    break
            save(root / "manifest.json", manifest)
            print(
                json.dumps(
                    {
                        "arm": label,
                        "elapsed_seconds": round(elapsed),
                        "event_cursor": arm["cursor"],
                    }
                ),
                flush=True,
            )
            time.sleep(10)
        arm["ended_at"] = time.time()
        arm["phase"] = "finished"
    except BaseException as error:
        arm["phase"] = "interrupted"
        arm["error"] = str(error)
        raise
    finally:
        try:
            finish(manifest, arm, directory)
        finally:
            save(root / "manifest.json", manifest)


def main():
    parser = argparse.ArgumentParser()
    actions = parser.add_subparsers(dest="action", required=True)
    setup = actions.add_parser("prepare")
    for name in ("source", "brief", "protocol", "root", "voyager", "codex"):
        setup.add_argument("--" + name, type=Path, required=True)
    setup.add_argument("--revision", required=True)
    for name in ("check", "status", "run", "rehearsal"):
        command = actions.add_parser(name)
        command.add_argument("root", type=Path)
        if name == "run":
            command.add_argument("arm", choices=["A", "B"])
            command.add_argument("--require-presentation", action="store_true")
        if name == "rehearsal":
            command.add_argument("evidence", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if args.action == "prepare":
        prepare(args)
    elif args.action == "check":
        check(args.root)
    elif args.action == "run":
        run(args.root, args.arm, args.require_presentation)
    elif args.action == "rehearsal":
        evidence = json.loads(args.evidence.read_text())
        required = (
            "terminal_open",
            "source_capture",
            "native_completed",
            "direct_message",
            "subscription_delivered",
        )
        if not all(evidence.get(name) is True for name in required) or not evidence.get(
            "receipts"
        ):
            raise RuntimeError("Rehearsal evidence is incomplete")
        shutil.copyfile(args.evidence, args.root / "rehearsal.json")
        manifest = load(args.root)
        manifest["rehearsal"] = "passed"
        manifest["rehearsal_sha256"] = digest(args.root / "rehearsal.json")
        save(args.root / "manifest.json", manifest)
    else:
        print(json.dumps(load(args.root), indent=2))


if __name__ == "__main__":
    main()
