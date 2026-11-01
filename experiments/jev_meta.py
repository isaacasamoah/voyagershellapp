import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import statistics
import time
import urllib.error
import urllib.request


DATA = Path(__file__).with_name("jev_meta_cases.json")
SOURCE = Path(__file__).resolve()
OUT = Path("/tmp/voyager-jev-meta-run-2026-11-01")


def encoded(value):
    return json.dumps(value, ensure_ascii=False).encode()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(name, value):
    text = json.dumps(value, indent=2)
    key = os.environ.get("TYPESAFE_API_KEY")
    if key:
        text = text.replace(json.dumps(key)[1:-1], "[redacted]")
    (OUT / name).write_text(text + "\n")


def questions(config, case):
    definition = copy.deepcopy(config["families"][case["family"]])
    if definition["type"] == "atomic-nouls":
        return definition["questions"]
    if case["family"] == "span":
        definition["criteria"] = {
            turn["id"]: f"Source turn by {turn['actor']}: {turn['text']}"
            for turn in case["state"]["turns"]
        }
        definition["criteria"]["none"] = (
            "No supplied turn states an accepted owner decision."
        )
    return {"verdict": definition}


def baseline(case):
    family, state = case["family"], case["state"]
    if family == "attention":
        if "human_reply_required" in state and "work_blocked" in state:
            return bool(state["human_reply_required"] and state["work_blocked"])
        return "abstain"
    if family == "routing":
        if state.get("missing_input"):
            return "clarify"
        if state.get("exact_command"):
            return "code"
        return "abstain"
    if family == "activity":
        if state.get("process_state") == "finished":
            return "process_ended"
        report = state.get("status")
        word = report.get("state") if isinstance(report, dict) else None
        if state.get("process_state") == "live" and word in (
            "working",
            "idle",
            "blocked",
        ):
            return "reported_" + word
        return "unknown"
    if family == "span":
        accepted = [
            turn["id"]
            for turn in state["turns"]
            if turn["actor"] == "owner"
            and turn["text"].lower().startswith(("yes,", "actually,"))
        ]
        return accepted[-1] if accepted else "abstain"
    if family == "relation":
        if state["claim_scope"] != state["evidence_scope"]:
            return "different_scope"
        if state["claim"] == state["evidence"]:
            return "support"
        return "insufficient"
    if family == "overlap":
        files = set(state["a"]["files"]) & set(state["b"]["files"])
        return "coordinate" if files else "independent"
    raise ValueError("Unknown family")


def validate(response, asked, expected_model):
    if response.get("model") != expected_model:
        raise ValueError("Response model identity differs from the pinned model")
    answers = response.get("answers")
    if not isinstance(answers, dict) or set(answers) != set(asked):
        raise ValueError("Answer keys do not match the questions")
    for name, question in asked.items():
        answer = answers[name]
        if answer.get("type") != question["type"]:
            raise ValueError("Answer type mismatch")
        values = (
            [answer.get("noul")]
            if question["type"] == "noul"
            else list(answer.get("probabilities", {}).values())
        )
        if not values or any(
            isinstance(x, bool)
            or not isinstance(x, (float, int))
            or not math.isfinite(x)
            or not 0 <= x <= 1
            for x in values
        ):
            raise ValueError("Invalid probability")
        if question["type"] == "choice":
            confidence = answer.get("confidence")
            if (
                isinstance(confidence, bool)
                or not isinstance(confidence, (float, int))
                or not math.isfinite(confidence)
                or not 0 <= confidence <= 1
            ):
                raise ValueError("Invalid confidence")
            if answer.get("choice") not in question["criteria"]:
                raise ValueError("Choice outside supplied candidates")
            if answer["probabilities"].get(answer["choice"], -1) < max(values) - 1e-9:
                raise ValueError("Choice differs from the highest probability")
            if (
                set(answer["probabilities"]) != set(question["criteria"])
                or abs(sum(values) - 1) > 0.02
            ):
                raise ValueError("Probability distribution mismatch")
    usage = response.get("usage", {})
    count = usage.get("input_tokens")
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        raise ValueError("Missing input-token usage")
    return answers, count


def prediction(case, answers):
    if case["family"] == "attention":
        if any(value["noul"] == 0.5 for value in answers.values()):
            return "abstain"
        return (
            answers["needs_owner"]["noul"] >= 0.5
            and answers["work_waits"]["noul"] >= 0.5
        )
    probabilities = sorted(answers["verdict"]["probabilities"].values(), reverse=True)
    if len(probabilities) > 1 and abs(probabilities[0] - probabilities[1]) <= 1e-9:
        return "abstain"
    return answers["verdict"]["choice"]


def call(config, case, asked):
    key = os.environ.get("TYPESAFE_API_KEY")
    if not key:
        raise RuntimeError("Load TypeSafe through the approved secret loader")
    files = sorted(OUT.glob("request-*.json"))
    if len(files) >= config["request_cap"]:
        raise RuntimeError("Request cap reached")
    prior = [json.loads(path.read_text()) for path in files]
    if any(row["status"] != "complete" for row in prior):
        raise RuntimeError("An earlier request is incomplete; no retry or continuation")
    if any(row["caseId"] == case["id"] for row in prior):
        raise RuntimeError("This case already ran; no duplicate request")
    used = sum(row["estimatedUsd"] for row in prior)
    payload = {"model": config["model"], "state": case["state"], "questions": asked}
    body = encoded(payload)
    reserve = (
        config["reserved_input_tokens_per_request"]
        * config["input_token_usd_per_million"]
        / 1_000_000
    )
    if (
        len(body) > config["max_body_bytes"]
        or used + reserve > config["estimated_usd_cap"]
    ):
        raise RuntimeError("Input or estimated cost cap reached")
    filename = f"request-{len(files) + 1:02}.json"
    record = {
        "caseId": case["id"],
        "family": case["family"],
        "split": case["split"],
        "status": "in_flight",
        "request": payload,
        "requestSha256": hashlib.sha256(body).hexdigest(),
    }
    save(filename, record)
    request = urllib.request.Request(
        "https://api.typesafe.ai/v1/systemone",
        data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )

    def retain(reply):
        record["httpStatus"] = reply.status
        record["providerRequestId"] = reply.headers.get(
            "x-request-id"
        ) or reply.headers.get("request-id")
        raw = reply.read(1_048_577)
        record["rawResponseSha256"] = hashlib.sha256(raw).hexdigest()
        record["rawResponse"] = (
            raw[:1_048_576].decode("utf-8", errors="replace").replace(key, "[redacted]")
        )
        record["rawResponseTruncated"] = len(raw) > 1_048_576
        if record["rawResponseTruncated"]:
            raise ValueError("Provider body exceeds recorded limit")
        return raw

    started = time.monotonic()
    try:
        try:
            with urllib.request.urlopen(request, timeout=30) as reply:
                raw = retain(reply)
        except urllib.error.HTTPError as error:
            with error:
                retain(error)
            raise
        response = json.loads(raw)
        record["seconds"] = time.monotonic() - started
        record["response"] = response
        answers, tokens = validate(response, asked, config["model"])
        if tokens > config["reserved_input_tokens_per_request"]:
            raise ValueError(
                "Reported input exceeds reserved context; stop and inspect cost"
            )
        record.update(
            status="complete",
            inputTokens=tokens,
            estimatedUsd=tokens * config["input_token_usd_per_million"] / 1_000_000,
            predicted=prediction(case, answers),
            expected=case["expected"],
            baseline=baseline(case),
            inputStratum=case.get("input_stratum", "schema-smoke"),
        )
    except Exception as error:
        record.update(
            status="failed_or_unknown",
            seconds=time.monotonic() - started,
            errorType=type(error).__name__,
            error=str(error).replace(key, "[redacted]"),
        )
        save(filename, record)
        raise RuntimeError(
            "Request failed or outcome is unknown; saved and stopped without retry"
        ) from None
    save(filename, record)
    print(case["id"], record["predicted"], f"{record['seconds']:.3f}s", flush=True)


def complete_phase(config, phase):
    expected = (
        {"smoke"}
        if phase == "smoke"
        else {"order-control"}
        if phase == "order-control"
        else {c["id"] for c in config["cases"] if c["split"] == phase}
    )
    rows = [json.loads(path.read_text()) for path in sorted(OUT.glob("request-*.json"))]
    selected = [row for row in rows if row["split"] == phase]
    if (
        not expected
        or len(selected) != len(expected)
        or {row["caseId"] for row in selected} != expected
        or any(row["status"] != "complete" for row in selected)
    ):
        raise RuntimeError("The prior phase is not complete: " + phase)
    return selected


def require_phase_report(config, phase):
    rows = complete_phase(config, phase)
    path = OUT / (phase + "-report.json")
    if not path.exists() or json.loads(path.read_text()).get("cases") != rows:
        raise RuntimeError("A complete saved phase report is required: " + phase)


def counts(group):
    result = {"cases": len(group)}
    for label, field in [("model", "predicted"), ("baseline", "baseline")]:
        result[label + "Correct"] = sum(r[field] == r["expected"] for r in group)
        result[label + "Abstentions"] = sum(r[field] == "abstain" for r in group)
    for name, family, positive in [
        ("interruptions", "attention", True),
        ("coordination", "overlap", "coordinate"),
    ]:
        relevant = [r for r in group if r["family"] == family]
        if relevant:
            negatives = [r for r in relevant if r["expected"] != positive]
            positives = [r for r in relevant if r["expected"] == positive]
            result[name] = {
                "negativeCases": len(negatives),
                "positiveCases": len(positives),
                "modelFalsePositives": sum(
                    r["predicted"] == positive for r in negatives
                ),
                "baselineFalsePositives": sum(
                    r["baseline"] == positive for r in negatives
                ),
                "modelMisses": sum(r["predicted"] != positive for r in positives),
                "baselineMisses": sum(r["baseline"] != positive for r in positives),
            }
    return result


def report(config, phase):
    selected = complete_phase(config, phase)
    rows = [json.loads(path.read_text()) for path in sorted(OUT.glob("request-*.json"))]
    result = {
        "phase": phase,
        "summary": counts(selected),
        "families": {
            family: counts([r for r in selected if r["family"] == family])
            for family in sorted({r["family"] for r in selected})
        },
        "inputStrata": {
            stratum: counts([r for r in selected if r["inputStratum"] == stratum])
            for stratum in sorted({r["inputStratum"] for r in selected})
        },
        "allAttemptedRequests": len(rows),
        "inputTokens": sum(r.get("inputTokens", 0) for r in rows),
        "estimatedUsd": sum(r.get("estimatedUsd", 0) for r in rows),
        "cases": selected,
        "timingScope": "serial API calls from this host, not application latency",
    }
    times = [r["seconds"] for r in selected]
    if times:
        result["medianApiSeconds"] = statistics.median(times)
        result["maxApiSeconds"] = max(times)
    save(phase + "-report.json", result)
    print(json.dumps({k: v for k, v in result.items() if k != "cases"}, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "phase",
        choices=[
            "freeze",
            "smoke",
            "development",
            "reserved",
            "order-control",
            "report",
        ],
    )
    args = parser.parse_args()
    config = json.loads(DATA.read_text())
    OUT.mkdir(exist_ok=True)
    frozen = {
        "sourceSha256": digest(SOURCE),
        "casesSha256": digest(DATA),
        "model": config["model"],
        "created": "2026-11-01",
        "privateTranscripts": False,
        "productActivation": False,
    }
    manifest = OUT / "manifest.json"
    if args.phase == "freeze":
        if manifest.exists():
            raise RuntimeError("Manifest already exists; do not replace it")
        save("manifest.json", frozen)
        print("Frozen", frozen)
        return
    if json.loads(manifest.read_text()) != frozen:
        raise RuntimeError("Research source/data changed after freeze")
    if args.phase == "report":
        phases = {
            json.loads(p.read_text())["split"] for p in OUT.glob("request-*.json")
        }
        for phase in ["development", "reserved", "order-control"]:
            if phase in phases:
                report(config, phase)
        return
    if args.phase == "smoke":
        case = {
            "id": "smoke",
            "family": "attention",
            "split": "smoke",
            "state": {
                "message": "Isaac must choose a storage provider before I can continue."
            },
            "expected": True,
        }
        call(config, case, questions(config, case))
        return
    if args.phase == "development":
        complete_phase(config, "smoke")
    if args.phase == "reserved":
        require_phase_report(config, "development")
    if args.phase == "order-control":
        require_phase_report(config, "development")
        require_phase_report(config, "reserved")
        case = copy.deepcopy(
            next(c for c in config["cases"] if c["id"] == config["order_control_case"])
        )
        case.update(id="order-control", split="order-control")
        asked = questions(config, case)
        asked["verdict"]["criteria"] = dict(
            reversed(list(asked["verdict"]["criteria"].items()))
        )
        call(config, case, asked)
    else:
        for case in config["cases"]:
            if case["split"] == args.phase:
                call(config, case, questions(config, case))
    report(config, args.phase)


if __name__ == "__main__":
    main()
