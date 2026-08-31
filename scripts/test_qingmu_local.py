"""Focused launcher ownership checks; no existing service or credentials used."""
import importlib.util
import json
from pathlib import Path
import socket
import sqlite3
import subprocess
import shutil
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("qingmu_local", Path(__file__).with_name("qingmu-local.py"))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


class OwnershipTests(unittest.TestCase):
    def director_submit_world(self, parent: Path):
        root = parent / "instance"
        for part in ("private", "storage", "logs", "home", "dsh", "work", "audit"):
            (root / part).mkdir(parents=True, exist_ok=True)
        production = {
            "productionOnly": True,
            "provider": "deepseek-official",
            "model": "deepseek-v4-pro",
            "baseUrl": "https://api.deepseek.com",
            "endpoint": "/chat/completions",
            "routeKey": "qingmu.director.text.proposal.c1",
            "projectId": "project-1",
            "episodeId": "episode-1",
            "methodPackageVersion": "method.v1",
            "methodPackageSha256": "a" * 64,
            "maxPaidCny": 0.16,
            "maxInputTokens": 16000,
            "maxOutputTokens": 512,
            "thinking": "disabled",
            "images": False,
            "files": False,
            "tools": False,
            "credentialFile": str(local.DEEPSEEK_PRODUCTION_CREDENTIAL_FILE),
            "transportEnabled": False,
            "taskId": "task-1",
        }
        config = {
            "instanceId": "instance-1", "root": str(root), "harnessRoot": str(local.HARNESS),
            "yimengRoot": str(parent / "writer"), "node": "/usr/bin/node",
            "coreRoot": str(parent / "core"),
            "directorProductionExecution": production,
        }
        binding = {
            "taskId": "task-1", "workOrderSha256": "b" * 64,
            "contextSnapshotSha256": "c" * 64, "promptSha256": "d" * 64,
            "requestSha256": "e" * 64, "payloadSha256": "f" * 64,
            "provider": "deepseek-official", "model": "deepseek-v4-pro",
            "routeKey": production["routeKey"],
            "inputPolicy": {"unit": "utf8_bytes_upper_bound", "promptUtf8Bytes": 100,
                            "maxInputTokens": 16000},
            "methodPackageSha256": "a" * 64, "pricingSnapshotSha256": "1" * 64,
            "dispatchKey": "", "dispatchEpoch": 0, "claimToken": "", "claimEpoch": 0,
            "exclusiveExecutionLane": "qingmu_director_host_permit_v1",
        }
        inspection = {
            **binding, "schema": "jason.qingmu-director-submit-inspection.v1",
            "projectId": "project-1", "episodeId": "episode-1", "sceneId": "scene-1",
            "shotId": "shot-1", "methodPackageVersion": "method.v1",
            "localStatus": "dispatch_pending", "providerStatus": "PENDING_DISPATCH",
            "kernelStatus": "DispatchPending", "maxAttempts": 1,
            "preflightAllowed": True, "preflightDryRun": False,
            "estimatedCny": 0.157824, "authorizationCapCny": 0.16,
            "counts": {"generation_tasks": 1, "provider_preflights": 1,
                "provider_authorization_reservations": 0,
                "provider_submission_outbox": 0, "assets": 0, "prompt_irs": 0,
                "entity_reference_packs": 0, "episode_release_authority": 0,
                "episode_production_step_receipts": 0, "agent_runs": 0,
                "workflow_runs": 0, "step_runs": 0},
            "sourceSnapshots": {
                "scriptRevision": 1, "scriptSha256": "2" * 64,
                "storyboardId": "storyboard-1", "storyboardVersion": 1,
                "storyboardSha256": "3" * 64,
                "selectedReferenceSnapshotSha256": "4" * 64,
                "contextSnapshotSha256": "c" * 64,
            },
        }
        private_lock = root / "private/c1-pre-submit-lock.json"
        local.write_json(private_lock, binding)
        lock = (
            Path(config["coreRoot"])
            / "docs/qingmu-os/evidence/2026-08-31-director-deepseek-text-canary-c1-phase1"
            / "c1-phase1-lock-pack.json"
        )
        lock.parent.mkdir(parents=True)
        lock.write_text(json.dumps({
            "schema": "qingmu.c1-deepseek-text-pre-submit-lock.v1",
            "canary": {"root": str(root), "instanceId": "instance-1",
                       "database": str(root / "storage/jason.db"),
                       "isolatedSyntheticProject": True, "humanContentSignoff": False},
            "scope": {"projectId": "project-1", "episodeId": "episode-1",
                      "sceneId": "scene-1", "shotId": "shot-1"},
            "sourceSnapshots": inspection["sourceSnapshots"],
            "methodPackage": {"version": "method.v1", "sha256": "a" * 64},
            "workOrder": {"taskId": "task-1", "routeKey": production["routeKey"],
                          "workOrderSha256": binding["workOrderSha256"],
                          "promptSha256": binding["promptSha256"],
                          "inputSha256": binding["contextSnapshotSha256"],
                          "inputPolicy": binding["inputPolicy"],
                          "requestSha256": binding["requestSha256"],
                          "payloadSha256": binding["payloadSha256"],
                          "pricingSnapshotSha256": binding["pricingSnapshotSha256"],
                          "dispatchEpoch": 0,
                          "privateBindingSha256": local.hashlib.sha256(private_lock.read_bytes()).hexdigest()},
            "productionRoute": {"provider": production["provider"], "model": production["model"],
                "baseUrl": production["baseUrl"], "endpoint": production["endpoint"],
                "maxInputTokens": production["maxInputTokens"],
                "maxOutputTokens": production["maxOutputTokens"], "thinking": "disabled",
                "images": False, "files": False, "tools": False, "maxAttempts": 1,
                "maxRetries": 0, "credentialFileMetadataOnly": production["credentialFile"],
                "transportEnabled": False},
            "pricing": {"snapshotDate": "2026-08-31", "currency": "CNY",
                "inputCacheMissCnyPerMillion": 9, "outputCnyPerMillion": 27,
                "reservedUpperBoundCny": 0.16, "estimatedReservationCny": 0.157824,
                "actualCostCny": 0},
            "persistedCounts": inspection["counts"],
        }))
        return root, config, lock, local.hashlib.sha256(lock.read_bytes()).hexdigest(), inspection

    def test_new_instance_has_distinct_private_director_execution_key(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            (writer / "scripts").mkdir(parents=True)
            (writer / "scripts/qingmu_local_api.py").touch()
            completed = subprocess.CompletedProcess(
                args=[], returncode=0, stdout='{"userId":"user_1","username":"qingmu-local"}\n', stderr=""
            )
            with patch("subprocess.run", return_value=completed):
                local.initialize(root, writer)
            config = json.loads((root / "private/instance.json").read_text())
            self.assertGreaterEqual(len(config["directorExecutionKey"].encode()), 32)
            self.assertNotIn(
                config["directorExecutionKey"],
                {config["jwtSecret"], config["attestationKey"], config["controlKey"]},
            )
            self.assertEqual((root / "private/instance.json").stat().st_mode & 0o777, 0o600)

    def test_existing_directory_is_never_initialized(self):
        with tempfile.TemporaryDirectory() as directory:
            writer = Path(directory) / "writer"
            (writer / "scripts").mkdir(parents=True)
            (writer / "scripts/qingmu_local_api.py").touch()
            with self.assertRaises(FileExistsError):
                local.initialize(Path(directory), writer)

    def test_occupied_port_is_not_reused(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            with self.assertRaises(OSError):
                local.available_port(listener.getsockname()[1])
            self.assertGreater(listener.fileno(), -1)

    def test_lock_rejects_parallel_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            with local.instance_lock(root):
                with self.assertRaises(RuntimeError):
                    with local.instance_lock(root):
                        self.fail("second owner acquired lock")

    def test_scrubs_ambient_secrets_and_paths(self):
        with patch.dict("os.environ", {"YIMENG_API_TOKEN": "unrelated", "DATABASE_URL": "formal", "OPENAI_API_KEY": "unrelated"}):
            env = local.safe_env(Path("/isolated"))
        self.assertNotIn("YIMENG_API_TOKEN", env)
        self.assertNotIn("DATABASE_URL", env)
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertEqual(env["HOME"], "/isolated/home")

    def test_director_mock_origin_is_http_loopback_only(self):
        self.assertEqual(
            local.require_http_loopback_origin("http://127.0.0.1:49152"),
            "http://127.0.0.1:49152",
        )
        for value in (
            "https://127.0.0.1:49152",
            "http://example.invalid:49152",
            "http://127.0.0.1:49152/v1",
            "http://user:secret@127.0.0.1:49152",
            "http://127.0.0.1",
        ):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "HTTP loopback"):
                local.require_http_loopback_origin(value)

    def test_production_config_is_exact_separate_and_default_disabled(self):
        self.assertIsNone(local.validate_director_production_config(None))
        value = {
            "productionOnly": True,
            "provider": "deepseek-official",
            "model": "deepseek-v4-pro",
            "baseUrl": "https://api.deepseek.com",
            "endpoint": "/chat/completions",
            "routeKey": "qingmu.director.text.proposal.c1",
            "projectId": "project-1",
            "episodeId": "episode-1",
            "methodPackageVersion": "method.v1",
            "methodPackageSha256": "a" * 64,
            "maxPaidCny": 0.16,
            "maxInputTokens": 16000,
            "maxOutputTokens": 512,
            "thinking": "disabled",
            "images": False,
            "files": False,
            "tools": False,
            "credentialFile": str(local.DEEPSEEK_PRODUCTION_CREDENTIAL_FILE),
            "transportEnabled": False,
        }
        self.assertEqual(local.validate_director_production_config(value), value)
        with self.assertRaisesRegex(ValueError, "production 配置无效"):
            local.validate_director_production_config({**value, "baseUrl": "http://127.0.0.1:1"})
        with self.assertRaisesRegex(ValueError, "production 配置无效"):
            local.validate_director_production_config({**value, "transportEnabled": True})

    def test_stale_pid_is_not_a_signal_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            (root / "runtime.json").write_text(json.dumps({"supervisorPid": 1, "apiPid": 1}))
            with patch("os.kill", side_effect=AssertionError("must not signal persisted PID")):
                with self.assertRaises(FileNotFoundError):
                    local.control(root, {"controlKey": "new", "instanceId": "new"}, "stop")

    def test_stop_waits_for_own_child(self):
        child = subprocess.Popen(["/bin/sleep", "30"])
        local.stop_child(child)
        self.assertIsNotNone(child.poll())
        local.stop_child(child)

    def test_partial_start_cleans_only_owned_child(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for part in ("private", "logs", "work"):
                (root / part).mkdir()
            supervisor = local.Supervisor(root, {"instanceId": "unit", "root": str(root),
                "yimengRoot": str(root), "controlKey": "unit"})
            local.mark_lifecycle(root, supervisor.config, "clean")
            child = subprocess.Popen(["/bin/sleep", "30"])
            try:
                with patch.object(supervisor, "launch", return_value=child), patch.object(supervisor, "wait_ready"), \
                     patch.object(supervisor, "start_host", side_effect=RuntimeError("Host unavailable")):
                    with self.assertRaisesRegex(RuntimeError, "Host unavailable"):
                        supervisor.run()
                self.assertIsNotNone(child.poll())
                self.assertFalse((root / "control.sock").exists())
                local.require_clean(root, supervisor.config)
            finally:
                local.stop_child(child)

    def test_tampered_backup_is_rejected_before_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "backup"
            (source / "private").mkdir(parents=True)
            (source / "storage").mkdir()
            local.write_json(source / "private/instance.json", {"root": "owned", "harnessRoot": str(local.HARNESS)})
            (source / "storage/media").write_text("tampered")
            local.write_json(source / "manifest.json", {"root": "owned", "sha256": {"storage/media": "0" * 64}})
            target = Path(directory) / "restore"
            with self.assertRaisesRegex(ValueError, "SHA"):
                local.restore(source, target)
            self.assertFalse(target.exists())

    def test_orphan_uncertainty_refuses_cold_backup_and_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            config = {"instanceId": "orphan", "root": str(root), "harnessRoot": str(local.HARNESS), "controlKey": "unit"}
            local.write_json(root / "private/instance.json", config)
            local.mark_lifecycle(root, config, "dirty")
            child = subprocess.Popen(["/bin/sleep", "30"])
            try:
                for operation in (lambda: local.backup(root), lambda: local.start(root, config), lambda: local.require_clean(root, config)):
                    with self.assertRaisesRegex(RuntimeError, "状态未知"):
                        operation()
                self.assertIsNone(child.poll())
                self.assertFalse((root / "backups").exists())
            finally:
                local.stop_child(child)

    def test_incomplete_backup_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "backup"
            (source / "private").mkdir(parents=True)
            (source / "storage").mkdir()
            local.write_json(source / "private/instance.json", {"root": "owned", "harnessRoot": str(local.HARNESS)})
            (source / "storage/jason.db").touch()
            (source / "storage/unlisted-media").write_text("not covered")
            local.write_json(source / "manifest.json", {"root": "owned", "sha256": {"storage/jason.db": "0" * 64}})
            with self.assertRaisesRegex(ValueError, "全部storage"):
                local.restore(source, Path(directory) / "restored")

    def test_cold_integrity_does_not_ignore_wal_or_write_sidecars(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "a # database.db"
            with sqlite3.connect(database) as db:
                db.execute("create table sample (id integer)")
            self.assertEqual(local.cold_integrity(database), "ok")
            self.assertEqual(len(list(Path(directory).iterdir())), 1)
            database.with_name(database.name + "-wal").write_bytes(b"uncheckpointed")
            with self.assertRaisesRegex(ValueError, "WAL"):
                local.cold_integrity(database)

    def test_data_symlink_cannot_redirect_instance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "storage").symlink_to("/unrelated")
            with self.assertRaisesRegex(ValueError, "符号链接"):
                local.read_config(root)

    def test_director_submit_preflight_binds_lock_state_price_and_credential_without_transport(self):
        with tempfile.TemporaryDirectory() as directory:
            root, config, lock, digest, inspection = self.director_submit_world(Path(directory))
            with patch.object(local, "_writer_submit_inspection", return_value=inspection), \
                 patch.object(local, "_probe_director_method", return_value={
                     "version": "method.v1", "methodPackageSha256": "a" * 64,
                     "sourceBindings": [],
                 }) as method_probe, \
                 patch.object(local, "_probe_director_credential", return_value={"available": True}) as probe:
                result = local.director_submit_preflight(
                    root, config, task_id="task-1", lock_pack=lock, lock_sha256=digest,
                    credential_file=Path(directory) / "credential",
                )
            self.assertTrue(result["ready"])
            self.assertEqual(result["providerHttpRequests"], 0)
            self.assertFalse(result["transportConsumed"])
            probe.assert_called_once()
            method_probe.assert_called_once()
            self.assertFalse((root / "audit/director-submit-once-task-1.json").exists())

    def test_director_submit_preflight_fails_closed_on_lock_state_and_existing_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            root, config, lock, digest, inspection = self.director_submit_world(Path(directory))
            with patch.object(local, "_probe_director_credential", return_value={"available": True}):
                with patch.object(local, "_writer_submit_inspection", return_value={**inspection, "dispatchEpoch": 1}):
                    with self.assertRaisesRegex(ValueError, "锁与易梦"):
                        local.director_submit_preflight(
                            root, config, task_id="task-1", lock_pack=lock, lock_sha256=digest
                        )
                with patch.object(local, "_writer_submit_inspection", return_value=inspection), \
                     patch.object(local, "_probe_director_method", return_value={
                         "version": "method.v1", "methodPackageSha256": "9" * 64,
                         "sourceBindings": [],
                     }):
                    with self.assertRaisesRegex(ValueError, "方法当前物化已漂移"):
                        local.director_submit_preflight(
                            root, config, task_id="task-1", lock_pack=lock, lock_sha256=digest
                        )
                local.write_json(root / "audit/director-submit-once-task-1.json", {"state": "unknown"})
                with patch.object(local, "_writer_submit_inspection", return_value=inspection):
                    with self.assertRaisesRegex(ValueError, "已有提交尝试"):
                        local.director_submit_preflight(
                            root, config, task_id="task-1", lock_pack=lock, lock_sha256=digest
                        )

    def test_director_submit_attempt_fence_has_one_global_winner(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "attempt.json"

            def arm(index):
                try:
                    local._write_exclusive_json(path, {"attempt": index})
                    return "armed"
                except FileExistsError:
                    return "rejected"

            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(arm, range(8)))
            self.assertEqual(results.count("armed"), 1)
            self.assertEqual(results.count("rejected"), 7)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_backup_restore_preserves_director_attempt_fence(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            root.mkdir(mode=0o700)
            root.chmod(0o700)
            for part in ("private", "storage", "dsh", "logs", "home", "work", "audit", "backups"):
                (root / part).mkdir(parents=True, mode=0o700, exist_ok=True)
            config = {
                "root": str(root), "harnessRoot": str(local.HARNESS),
                "instanceId": "instance-1", "controlKey": "control",
                "directorExecutionKey": "director", "jwtSecret": "jwt",
                "attestationKey": "attestation",
            }
            local.write_json(root / "private/instance.json", config)
            local.write_json(root / "identity.json", {"kind": "test"})
            local.mark_lifecycle(root, config, "clean")
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute("CREATE TABLE sample (id INTEGER)")
            fence = root / "audit/director-submit-once-task-1.json"
            local._write_exclusive_json(fence, {"state": "armed_no_replay"})
            saved = local.backup(root)
            manifest = json.loads((Path(saved["backup"]) / "manifest.json").read_text())
            self.assertIn("audit/director-submit-once-task-1.json", manifest["sha256"])
            restored = parent / "restored"
            local.restore(Path(saved["backup"]), restored)
            restored_fence = restored / "audit/director-submit-once-task-1.json"
            self.assertEqual(restored_fence.read_bytes(), fence.read_bytes())
            with self.assertRaises(FileExistsError):
                local._write_exclusive_json(restored_fence, {"state": "armed_again"})

    def test_director_credential_probe_uses_prepared_dsh_call_without_transport(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "instance"
            for part in ("home", "dsh"):
                (root / part).mkdir(parents=True, exist_ok=True)
            credential = Path(directory) / "credential.yaml"
            credential.write_text(
                "version: 1\nrefs:\n  DEEPSEEK_API_KEY: isolated-probe-only\n"
            )
            credential.chmod(0o600)
            result = local._probe_director_credential(
                root,
                {"node": shutil.which("node")},
                credential,
            )
            self.assertTrue(result["available"])
            self.assertFalse(result["transportConsumed"])


if __name__ == "__main__":
    unittest.main()
