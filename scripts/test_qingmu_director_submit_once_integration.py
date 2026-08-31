"""Real local launcher/API/Host/DSh acceptance with a loopback mock only."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import tempfile
import threading
import unittest


spec = importlib.util.spec_from_file_location(
    "qingmu_local", Path(__file__).with_name("qingmu-local.py")
)
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


class _DeepSeekMock(BaseHTTPRequestHandler):
    requests = 0
    proposal = {}
    fail = False

    def log_message(self, _format, *_args):
        return

    def do_POST(self):
        type(self).requests += 1
        length = int(self.headers.get("content-length", "0"))
        json.loads(self.rfile.read(length))
        if self.path != "/chat/completions" or type(self).fail:
            self.send_response(503)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":{"message":"local mock failure"}}')
            return
        proposal = json.dumps(type(self).proposal, ensure_ascii=False)
        events = [
            {"id": "completion-local-once", "choices": [{"delta": {"content": proposal}}]},
            {"id": "completion-local-once", "choices": [{"delta": {"content": ""},
                "finish_reason": "stop"}], "usage": {"prompt_tokens": 20,
                "completion_tokens": 10, "prompt_cache_hit_tokens": 5}},
        ]
        body = "".join("data: " + json.dumps(item, ensure_ascii=False) + "\n\n" for item in events)
        body += "data: [DONE]\n\n"
        encoded = body.encode()
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("x-request-id", "request-local-once")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


@unittest.skipUnless(os.environ.get("QINGMU_C1_SOURCE_ROOT"), "requires locked synthetic C1 root")
class DirectorSubmitOnceIntegration(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="qingmu-c1-submit-")
        self.root = Path(self.temporary.name) / "instance"
        shutil.copytree(Path(os.environ["QINGMU_C1_SOURCE_ROOT"]), self.root, symlinks=True)
        self.root = self.root.resolve()
        config = json.loads((self.root / "private/instance.json").read_text())
        config.update(root=str(self.root), instanceId=local.secrets.token_hex(16))
        local.write_json(self.root / "private/instance.json", config)
        local.mark_lifecycle(self.root, config, "clean")
        for path in (self.root / "control.sock", self.root / "runtime.json"):
            path.unlink(missing_ok=True)
        for path in self.root.glob("audit/director-submit-once-*.json"):
            path.unlink()
        for path in self.root.glob("private/director-submit-once-*.json"):
            path.unlink()
        self.config = config
        self.task_id = config["directorProductionExecution"]["taskId"]
        with sqlite3.connect(self.root / "storage/jason.db") as connection:
            payload = json.loads(connection.execute(
                "SELECT request_payload_json FROM generation_tasks WHERE id = ?", (self.task_id,)
            ).fetchone()[0])
            work_order = payload["directorWorkOrder"]
            prompt = json.loads(payload["body"]["messages"][0]["content"])
            context = prompt["contextSnapshot"]
        _DeepSeekMock.proposal = {
            "schema": "qingmu.director-proposal.v1",
            "projectId": work_order["projectId"], "episodeId": work_order["episodeId"],
            "sceneId": work_order["sceneId"], "shotId": work_order["shotId"],
            "advisoryOnly": True,
            "items": [{"id": "local-mock-item", "field": "narrative",
                "proposedValue": "本地单次提交建议", "impact": "仅为导演建议"}],
        }
        private_lock = self.root / "private/c1-pre-submit-lock.json"
        binding = json.loads(private_lock.read_text())
        source_snapshots = {
            "scriptRevision": context["script"]["revision"],
            "scriptSha256": context["script"]["sha256"],
            "storyboardId": context["storyboard"]["id"],
            "storyboardVersion": context["storyboard"]["version"],
            "storyboardSha256": context["storyboard"]["sourceHash"],
            "selectedReferenceSnapshotSha256": hashlib.sha256(
                json.dumps(context["selectedReferences"], ensure_ascii=False,
                           sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest(),
            "contextSnapshotSha256": context["contextSnapshotSha256"],
        }
        self.lock_pack = self.root / "c1-phase1-lock-pack.json"
        self.lock_pack.write_text(json.dumps({
            "schema": "qingmu.c1-deepseek-text-pre-submit-lock.v1",
            "canary": {"root": str(self.root), "instanceId": config["instanceId"],
                "database": str(self.root / "storage/jason.db"),
                "isolatedSyntheticProject": True, "humanContentSignoff": False},
            "scope": {"projectId": work_order["projectId"], "episodeId": work_order["episodeId"],
                "sceneId": work_order["sceneId"], "shotId": work_order["shotId"]},
            "sourceSnapshots": source_snapshots,
            "methodPackage": work_order["methodPackage"],
            "workOrder": {"taskId": self.task_id, "routeKey": binding["routeKey"],
                "workOrderSha256": binding["workOrderSha256"],
                "promptSha256": binding["promptSha256"],
                "inputSha256": binding["contextSnapshotSha256"],
                "inputPolicy": binding["inputPolicy"],
                "requestSha256": binding["requestSha256"],
                "payloadSha256": binding["payloadSha256"],
                "pricingSnapshotSha256": binding["pricingSnapshotSha256"],
                "dispatchEpoch": 0,
                "privateBindingSha256": hashlib.sha256(private_lock.read_bytes()).hexdigest()},
            "productionRoute": {"provider": config["directorProductionExecution"]["provider"],
                "model": config["directorProductionExecution"]["model"],
                "baseUrl": config["directorProductionExecution"]["baseUrl"],
                "endpoint": config["directorProductionExecution"]["endpoint"],
                "maxInputTokens": config["directorProductionExecution"]["maxInputTokens"],
                "maxOutputTokens": config["directorProductionExecution"]["maxOutputTokens"],
                "thinking": "disabled", "images": False, "files": False, "tools": False,
                "maxAttempts": 1, "maxRetries": 0,
                "credentialFileMetadataOnly": config["directorProductionExecution"]["credentialFile"],
                "transportEnabled": False},
            "pricing": {"snapshotDate": "2026-08-31", "currency": "CNY",
                "inputCacheMissCnyPerMillion": 9, "outputCnyPerMillion": 27,
                "reservedUpperBoundCny": 0.16,
                "estimatedReservationCny": 0.157824, "actualCostCny": 0},
            "persistedCounts": {"generation_tasks": 1, "provider_preflights": 1,
                "provider_authorization_reservations": 0, "provider_submission_outbox": 0,
                "assets": 0, "prompt_irs": 0, "entity_reference_packs": 0,
                "episode_release_authority": 0, "episode_production_step_receipts": 0,
                "agent_runs": 0, "workflow_runs": 0, "step_runs": 0},
        }, ensure_ascii=False, indent=2))
        self.lock_sha = hashlib.sha256(self.lock_pack.read_bytes()).hexdigest()
        self.credential = Path(self.temporary.name) / "credentials.yaml"
        self.credential.write_text("version: 1\nrefs:\n  DEEPSEEK_API_KEY: isolated-local-mock\n")
        self.credential.chmod(0o600)
        _DeepSeekMock.requests = 0
        _DeepSeekMock.fail = False
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _DeepSeekMock)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def test_local_mock_reaches_settled_once_and_replay_never_posts(self):
        preflight = local.director_submit_preflight(
            self.root, self.config, task_id=self.task_id, lock_pack=self.lock_pack,
            lock_sha256=self.lock_sha, credential_file=self.credential,
        )
        with local.instance_lock(self.root):
            local.require_clean(self.root, self.config)
            result = local.execute_director_submit_once(
                self.root, self.config, preflight,
                mock_base_url=f"http://127.0.0.1:{self.server.server_port}",
            )
        self.assertEqual(result["state"], "settled")
        self.assertEqual(result["dispatchEpoch"], 1)
        self.assertEqual(_DeepSeekMock.requests, 1)
        self.assertFalse((self.root / f"private/director-submit-once-{self.task_id}.json").exists())
        self.assertFalse((self.root / "private/local.patch.yml").exists())
        with self.assertRaisesRegex(ValueError, "锁与易梦|已有提交尝试"):
            local.director_submit_preflight(
                self.root, self.config, task_id=self.task_id, lock_pack=self.lock_pack,
                lock_sha256=self.lock_sha, credential_file=self.credential,
            )
        self.assertEqual(_DeepSeekMock.requests, 1)
        with sqlite3.connect(self.root / "storage/jason.db") as connection:
            self.assertEqual(connection.execute(
                "SELECT kernel_status FROM generation_tasks WHERE id = ?", (self.task_id,)
            ).fetchone()[0], "Succeeded")
            self.assertEqual(connection.execute(
                "SELECT state FROM provider_submission_outbox"
            ).fetchone()[0], "settled")
            self.assertEqual(connection.execute(
                "SELECT count(*) FROM provider_authorization_reservations"
            ).fetchone()[0], 1)

    def test_local_mock_failure_becomes_unknown_and_replay_never_posts(self):
        _DeepSeekMock.fail = True
        preflight = local.director_submit_preflight(
            self.root, self.config, task_id=self.task_id, lock_pack=self.lock_pack,
            lock_sha256=self.lock_sha, credential_file=self.credential,
        )
        with local.instance_lock(self.root):
            result = local.execute_director_submit_once(
                self.root, self.config, preflight,
                mock_base_url=f"http://127.0.0.1:{self.server.server_port}",
            )
        self.assertEqual(result["state"], "submission_unknown")
        self.assertEqual(_DeepSeekMock.requests, 1)
        self.assertFalse((self.root / f"private/director-submit-once-{self.task_id}.json").exists())
        self.assertFalse((self.root / "private/local.patch.yml").exists())
        with self.assertRaises(ValueError):
            local.director_submit_preflight(
                self.root, self.config, task_id=self.task_id, lock_pack=self.lock_pack,
                lock_sha256=self.lock_sha, credential_file=self.credential,
            )
        self.assertEqual(_DeepSeekMock.requests, 1)


if __name__ == "__main__":
    unittest.main()
