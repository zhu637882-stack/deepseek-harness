"""Scoped dispatch/recovery tests on synthetic SQLite; no real child or Provider."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


local = load("qingmu-local")
shooting = load("qingmu_shooting_worker")


class ShootingWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "storage").mkdir()
        (self.root / "private").mkdir()
        self.db = self.root / "storage/jason.db"
        self.request = dict(taskId="task-one", projectId="p", episodeId="e", frameId="f", requestHash="b" * 64)
        self.production = dict(projectId="p", episodeId="e", credentialEnvFile="/unused", maxPaidCny=1000)
        self.preflight = "a" * 64
        self.payload = dict(project_id="p", episode_id="e", owner_id="f", role="first_frame", select_as_official=False,
            view_params={"shootingPreflightId": self.preflight})
        key = "asset:image.generate:shooting_first_frame:frame:f:first_frame:" + hashlib.sha256(("shooting-" + self.preflight).encode()).hexdigest()[:24]
        with sqlite3.connect(self.db) as conn:
            conn.execute("CREATE TABLE generation_tasks (id TEXT, capability TEXT, request_hash TEXT, max_attempts INTEGER, request_payload_json TEXT, idempotency_key TEXT, kernel_status TEXT, local_status TEXT, provider_status TEXT, provider_task_id TEXT, dispatch_epoch INTEGER, input_snapshot_json TEXT, source_type TEXT, source_id TEXT)")
            conn.execute("INSERT INTO generation_tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("task-one", "image.generate", "b" * 64, 1, json.dumps(self.payload), key, "DispatchPending", "dispatch_pending", "PENDING_DISPATCH", "", 0, "{}", "frame", "f"))
        self.supervisor = local.Supervisor(self.root, {"yimengRoot": "/unused", "instanceId": "unit"})
        self.supervisor._worker_environment = Mock(return_value={})
        self.supervisor._shooting_module = lambda: shooting
        self.supervisor.launch_owned = Mock(side_effect=self.launch)
        self.supervisor.stop_owned = Mock(side_effect=lambda role: setattr(self.supervisor, role, None))
        for name, result in (("validate_text_foundation_production_config", self.production), ("require_build_manifest_matches", None), ("_private_regular_file", None)):
            p = patch.object(local, name, return_value=result)
            p.start(); self.addCleanup(p.stop)

    def launch(self, role, argv, env, label):
        child = Mock(); child.poll.return_value = None
        setattr(self.supervisor, role, child)
        return child

    def update(self, **values):
        with sqlite3.connect(self.db) as conn:
            conn.execute("UPDATE generation_tasks SET " + ",".join(k + "=?" for k in values) + " WHERE id='task-one'", tuple(values.values()))

    def test_exact_dispatch_is_once_and_never_scans_another_shot(self):
        self.supervisor.activate_shooting_task(self.request)
        self.supervisor.activate_shooting_task(self.request)
        self.assertEqual(self.supervisor.launch_owned.call_count, 1)
        argv = self.supervisor.launch_owned.call_args.args[1]
        self.assertEqual(argv[argv.index("--allowed-task-id") + 1], "task-one")
        self.assertIn("--allow-new-provider-dispatch", argv)
        self.assertNotIn("--allow-existing-provider-poll", argv)
        other = {**self.request, "frameId": "other"}
        with self.assertRaises(ValueError):
            self.supervisor.activate_shooting_task(other)
        self.assertEqual(self.supervisor.launch_owned.call_count, 1)

    def test_crash_after_dispatch_marker_without_provider_ack_never_reposts(self):
        self.supervisor.shooting_binding = dict(request=self.request, dispatchStarted=True, stopped=False, startedAtEpoch=local.time.time())
        self.supervisor._advance_shooting_task()
        self.assertTrue(self.supervisor.shooting_binding["stopped"])
        self.supervisor.activate_shooting_task(self.request)
        self.supervisor.launch_owned.assert_not_called()

    def test_acknowledged_task_recovery_can_only_poll(self):
        self.update(provider_task_id="provider-existing", dispatch_epoch=1, kernel_status="ProviderPending", provider_status="RUNNING")
        self.supervisor.activate_shooting_task(self.request)
        argv = self.supervisor.launch_owned.call_args.args[1]
        self.assertIn("--allow-existing-provider-poll", argv)
        self.assertNotIn("--allow-new-provider-dispatch", argv)

    def test_restart_recovers_old_ack_without_new_submission(self):
        self.update(provider_task_id="provider-existing", dispatch_epoch=1, kernel_status="ProviderPending", provider_status="RUNNING")
        binding = dict(request=self.request, dispatchStarted=True, stopped=False, startedAtEpoch=local.time.time() - 3600)
        local.write_json(self.root / "private/shooting-task-activation.json", binding)
        self.supervisor.start_asset_worker()
        argv = self.supervisor.launch_owned.call_args.args[1]
        self.assertIn("--allow-existing-provider-poll", argv)
        self.assertNotIn("--allow-new-provider-dispatch", argv)

    def test_project_mode_blocks_startup_and_tick_of_saved_scoped_task(self):
        binding = dict(request=self.request, dispatchStarted=False, stopped=False, startedAtEpoch=local.time.time())
        local.write_json(self.root / "private/shooting-task-activation.json", binding)
        with patch.object(local, "validate_project_production_config", return_value={"active": True}):
            self.supervisor.start_asset_worker()
        self.supervisor.shooting_binding = binding
        self.supervisor._project_production_active = True
        self.assertFalse(self.supervisor._advance_shooting_task())
        self.supervisor.launch_owned.assert_not_called()

    def test_review_mode_and_unknown_task_do_not_start_worker(self):
        self.supervisor.review_only = True
        with self.assertRaises(ValueError):
            self.supervisor.activate_shooting_task(self.request)
        self.supervisor.review_only = False
        self.update(dispatch_epoch=1, provider_status="SUBMISSION_UNKNOWN")
        self.assertFalse(self.supervisor.activate_shooting_task(self.request)["activated"])
        self.supervisor.launch_owned.assert_not_called()

    def test_video_requires_the_saved_writer_contract(self):
        request_contract = {"projectId": "p", "episodeId": "e", "shotId": "f", "selectAsOfficial": False, "paidConfirmed": True, "candidateCount": 1, "maxAttempts": 1}
        body = {"schema": "jason.qingmu-writer-production-task-contract.v1", "requestContract": request_contract,
            "requestContractSha256": hashlib.sha256(json.dumps(request_contract, sort_keys=True, separators=(",", ":")).encode()).hexdigest(), "takeOrdinal": 1, "takeLimit": 2}
        contract = {**body, "contractSha256": hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}
        self.update(capability="video.visual", request_payload_json=json.dumps({"project_id": "p", "episode_id": "e", "qingmu_writer_production_contract": contract}),
            input_snapshot_json=json.dumps({"qingmuWriterProductionContract": contract}), source_type="StoryboardFrame", source_id="f")
        self.assertEqual(shooting.inspect_task(self.db, self.request, self.production)["lane"], "video")
        self.update(input_snapshot_json="{}")
        with self.assertRaisesRegex(ValueError, "video_binding_invalid"):
            shooting.inspect_task(self.db, self.request, self.production)

    def test_drift_during_recovery_stops_only_scoped_execution(self):
        self.supervisor.shooting_binding = dict(request=self.request, dispatchStarted=False, stopped=False, startedAtEpoch=local.time.time())
        self.update(request_hash="c" * 64)
        self.assertFalse(self.supervisor._advance_shooting_task())
        self.assertTrue(self.supervisor.shooting_binding["stopped"])
        self.supervisor.launch_owned.assert_not_called()

    def test_once_worker_exit_between_reap_and_health_check_keeps_ui_alive(self):
        self.supervisor.activate_shooting_task(self.request)
        self.supervisor.assetWorker.poll.return_value = 0
        self.assertFalse(self.supervisor._unexpected_asset_worker_exit())
        self.supervisor._reap_terminal_asset_worker()
        self.assertIsNone(self.supervisor.assetWorker)
        self.assertEqual(self.supervisor.launch_owned.call_count, 1)
        # Non-scoped failures retain the original supervisor shutdown behavior.
        self.supervisor.shooting_binding = None
        self.supervisor.assetWorker = Mock()
        self.supervisor.assetWorker.poll.return_value = 1
        self.assertTrue(self.supervisor._unexpected_asset_worker_exit())


if __name__ == "__main__":
    unittest.main()
