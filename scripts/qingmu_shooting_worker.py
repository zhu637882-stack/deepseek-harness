"""Inspect exact native shooting tasks; never discover or dispatch a queue."""
import hashlib
import json
import re
import sqlite3


def inspect_task(database, request, production):
    required = {"taskId", "projectId", "episodeId", "frameId", "requestHash"}
    if set(request) != required or any(not isinstance(request[k], str) for k in required):
        raise ValueError("shooting_activation_invalid")
    if not re.fullmatch(r"[a-f0-9]{64}", request["requestHash"]):
        raise ValueError("shooting_activation_hash_invalid")
    if not production or any(request[k] != production[k] for k in ("projectId", "episodeId")):
        raise ValueError("shooting_activation_scope_mismatch")
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM generation_tasks WHERE id=?", (request["taskId"],)).fetchone()
    if row is None:
        raise ValueError("shooting_activation_task_missing")
    task = dict(row)
    payload = json.loads(task["request_payload_json"])
    if (task["request_hash"] != request["requestHash"] or task["max_attempts"] != 1
        or payload.get("project_id") != request["projectId"] or payload.get("episode_id") != request["episodeId"]):
        raise ValueError("shooting_activation_task_mismatch")
    if task["capability"] == "image.generate":
        preflight = (payload.get("view_params") or {}).get("shootingPreflightId", "")
        expected = "asset:image.generate:shooting_first_frame:frame:" + request["frameId"] + ":first_frame:"
        expected += hashlib.sha256(("shooting-" + preflight).encode()).hexdigest()[:24]
        if (not re.fullmatch(r"[a-f0-9]{64}", preflight) or task["idempotency_key"] != expected
            or payload.get("owner_id") != request["frameId"] or payload.get("role") != "first_frame"
            or payload.get("select_as_official") is not False):
            raise ValueError("shooting_activation_image_binding_invalid")
        lane = "image"
    elif task["capability"] == "video.visual":
        contract = payload.get("qingmu_writer_production_contract") or {}
        body = {k: v for k, v in contract.items() if k != "contractSha256"}
        digest = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        intent = contract.get("requestContract") or {}
        intent_digest = hashlib.sha256(json.dumps(intent, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        if (not contract or contract.get("contractSha256") != digest
            or json.loads(task["input_snapshot_json"] or "{}").get("qingmuWriterProductionContract") != contract
            or contract.get("schema") != "jason.qingmu-writer-production-task-contract.v1"
            or contract.get("requestContractSha256") != intent_digest
            or intent.get("shotId") != request["frameId"]
            or any(intent.get(k) != request[k] for k in ("projectId", "episodeId"))
            or intent.get("selectAsOfficial") is not False or intent.get("paidConfirmed") is not True
            or intent.get("candidateCount") != 1 or intent.get("maxAttempts") != 1
            or contract.get("takeOrdinal") not in (1, 2) or contract.get("takeLimit") != 2
            or task["source_type"] != "StoryboardFrame" or task["source_id"] != request["frameId"]):
            raise ValueError("shooting_activation_video_binding_invalid")
        lane = "video"
    else:
        raise ValueError("shooting_activation_capability_invalid")
    status = task["kernel_status"]
    if status in {"Succeeded", "Failed", "Cancelled"}:
        action = "finished"
    elif task.get("provider_task_id"):
        action = "poll"
    elif (status == "DispatchPending" and task["local_status"] == "dispatch_pending"
          and task["provider_status"] == "PENDING_DISPATCH" and task["dispatch_epoch"] == 0):
        action = "dispatch"
    else:
        action = "unknown"
    return {**request, "lane": lane, "action": action, "kernelStatus": status}


def worker_command(writer, binding, action):
    """Reuse the leased Worker with one exact task and no parent/whole-episode scan."""
    if action not in {"dispatch", "poll"}:
        raise ValueError("shooting_activation_action_invalid")
    return [str(writer / ".venv/bin/python"), "-B", "-m", "jason.apps.studio.worker_cli",
        "--lane", binding["lane"], "--once", "--max-tasks", "1", "--max-attempts", "1",
        "--max-concurrent-dispatches", "1", "--allowed-task-id", binding["taskId"],
        "--allowed-project-id", binding["projectId"], "--allowed-episode-id", binding["episodeId"],
        "--disable-durable-director-orchestration",
        "--allow-new-provider-dispatch" if action == "dispatch" else "--allow-existing-provider-poll"]
