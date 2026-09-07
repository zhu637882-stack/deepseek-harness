"""Focused launcher ownership checks; no existing service or credentials used."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import shutil
import tempfile
import time
import unittest
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("qingmu_local", Path(__file__).with_name("qingmu-local.py"))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


class OwnershipTests(unittest.TestCase):
    def tail_supervisor(self):
        scope = {"projectId": "project", "episodeId": "episode"}
        with patch.object(local, "read_tail_audit_scope", return_value=(scope, "scope-sha")):
            supervisor = local.Supervisor(Path('/unused'), {
                "instanceId": "unit", "controlKey": "key", "yimengRoot": "/writer",
            }, review_only=True, tail_audit=True)
        return supervisor, scope

    def test_tail_audit_requires_explicit_review_mode(self):
        with self.assertRaisesRegex(ValueError, "requires_review_only"):
            local.Supervisor(Path('/unused'), {}, tail_audit=True)
        with self.assertRaisesRegex(ValueError, "requires_review_only"):
            local.start(Path('/unused'), {}, tail_audit=True)
        supervisor = local.Supervisor(Path('/unused'), {}, review_only=True)
        with self.assertRaisesRegex(ValueError, "not_enabled"):
            supervisor.tail_audit_tick({})

    def test_tail_audit_start_refuses_scope_replacement(self):
        for requested in (False, True):
            with self.subTest(requested=requested), \
                 patch.object(local, "read_tail_audit_scope", return_value=({}, "new")), \
                 patch.object(local, "control", return_value={"reviewOnly": True, "tailAuditScopeSha256": "old"}), \
                 patch.object(local.subprocess, "Popen") as popen:
                with self.assertRaisesRegex(RuntimeError, "范围不同"):
                    local.start(Path('/unused'), {}, review_only=True, tail_audit=requested)
                popen.assert_not_called()

    def test_tail_audit_api_requires_exact_scope_attestation(self):
        supervisor, _ = self.tail_supervisor()
        supervisor.api = Mock(pid=123)
        supervisor.ports = {"apiUrl": "http://127.0.0.1:1"}
        identity = {"instanceId": "unit", "pid": 123, "root": "/unused", "database": "/unused/storage/jason.db",
                    "storage": "/unused/storage", "reviewOnly": True}
        for digest in (None, "other", "scope-sha"):
            with self.subTest(digest=digest), patch.object(local, "http", return_value={**identity, "tailAuditScopeSha256": digest}):
                if digest == "scope-sha":
                    self.assertEqual(supervisor.api_identity()['tailAuditScopeSha256'], digest)
                else:
                    with self.assertRaises(ValueError):
                        supervisor.api_identity()

    def test_tail_audit_tick_is_single_id_one_attempt_and_never_enables_general_lanes(self):
        for action in ('dispatch', 'poll'):
            supervisor, scope = self.tail_supervisor()
            module = Mock()
            module.inspect_task.return_value = {"taskId": "tail-task", "action": action}
            production = {**scope, "credentialEnvFile": "/private/unit.env"}
            with self.subTest(action=action), \
                 patch.object(local, "read_tail_audit_scope", return_value=(scope, "scope-sha")), \
                 patch.object(local, "tail_audit_module", return_value=module), \
                 patch.object(local, "require_build_manifest_matches"), \
                 patch.object(local, "validate_text_foundation_production_config", return_value=production), \
                 patch.object(local, "validate_project_production_config", side_effect=AssertionError('general scope forbidden')), \
                 patch.object(local, "_private_regular_file"), \
                 patch.object(supervisor, "_worker_environment", return_value={}), \
                 patch.object(supervisor, "launch_owned", return_value=Mock(pid=321)) as launch:
                result = supervisor.tail_audit_tick({"key": "key", "op": "tail_audit_tick", "taskId": "tail-task", "action": action})
            module.inspect_task.assert_called_once_with(Path('/unused/storage/jason.db'), scope, "tail-task", action)
            role, command, environment, label = launch.call_args.args
            self.assertEqual((role, label, result['pid']), ('worker', 'tail-audit-worker', 321))
            for flag, value in (('--lane', 'qa'), ('--max-tasks', '1'), ('--max-attempts', '1'),
                                ('--max-concurrent-dispatches', '1'), ('--allowed-task-id', 'tail-task'),
                                ('--allowed-project-id', 'project'), ('--allowed-episode-id', 'episode')):
                self.assertEqual(command[command.index(flag) + 1], value)
            self.assertIn('--once', command)
            self.assertIn('--disable-durable-director-orchestration', command)
            self.assertEqual('--allow-new-provider-dispatch' in command, action == 'dispatch')
            self.assertEqual('--allow-existing-provider-poll' in command, action == 'poll')
            self.assertEqual(environment['WORKER_CREATIVE_FRESHNESS_ENFORCE'], 'true')

    def test_tail_audit_tick_failures_never_launch(self):
        for failure in ('changed', 'expired', 'busy', 'manifest', 'receipt', 'project', 'extra'):
            supervisor, scope = self.tail_supervisor()
            if failure == 'busy':
                supervisor.worker = Mock()
                supervisor.worker.poll.return_value = None
            request = {"key": "key", "op": "tail_audit_tick", "taskId": "tail-task", "action": "dispatch"}
            if failure == 'extra':
                request['extra'] = True
            module = Mock()
            if failure == 'receipt':
                module.inspect_task.side_effect = ValueError('receipt')
            production = {**scope, "credentialEnvFile": "/private/unit.env"}
            if failure == 'project':
                production['projectId'] = 'other'
            with self.subTest(failure=failure), \
                 patch.object(local, "read_tail_audit_scope", return_value=(scope, 'changed' if failure == 'changed' else 'scope-sha'),
                              side_effect=ValueError('expired') if failure == 'expired' else None), \
                 patch.object(local, "require_build_manifest_matches", side_effect=ValueError('manifest') if failure == 'manifest' else None), \
                 patch.object(local, "tail_audit_module", return_value=module), \
                 patch.object(local, "validate_text_foundation_production_config", return_value=production), \
                 patch.object(supervisor, "launch_owned") as launch:
                with self.assertRaises(ValueError):
                    supervisor.tail_audit_tick(request)
                launch.assert_not_called()

    def test_tail_audit_reaps_exit_without_retry(self):
        supervisor, _ = self.tail_supervisor()
        supervisor.worker = Mock()
        supervisor.worker.poll.return_value = 1
        supervisor.last_tail_audit_worker = {"taskId": "tail-task"}
        with patch.object(local, 'stop_child') as stop, patch.object(supervisor, 'launch_owned') as launch:
            supervisor.reap_tail_audit_worker()
            supervisor.reap_tail_audit_worker()
        self.assertIsNone(supervisor.worker)
        self.assertEqual(supervisor.last_tail_audit_worker['exitCode'], 1)
        self.assertEqual(stop.call_count, 1)
        launch.assert_not_called()

    def rotation_world(self, parent: Path):
        root = parent / "instance"
        for part in ("private", "storage", "audit", "logs", "home", "work", "dsh", "backups", "build-manifest"):
            (root / part).mkdir(parents=True, mode=0o700, exist_ok=True)
        root.chmod(0o700)
        config = {
            "version": 1,
            "instanceId": "rotation-instance",
            "root": str(root),
            "harnessRoot": str(local.HARNESS),
            "yimengRoot": str(parent / "writer"),
            "coreRoot": str(parent / "core"),
            "node": "/private/node",
            "frontendNode": "/private/node20",
            **{name: local.secrets.token_urlsafe(48) for name in local.PRIVATE_CREDENTIAL_FIELDS},
            "futureNonSensitiveSetting": "preserved",
        }
        login = {"username": local.LOCAL_USERNAME, "password": local.secrets.token_urlsafe(32)}
        session = {"token": local.secrets.token_urlsafe(48)}
        local.write_json(root / "private/instance.json", config)
        local.write_json(root / "private/login.json", login)
        local.write_json(root / "private/session.json", session)
        local.mark_lifecycle(root, config, "clean")
        with sqlite3.connect(root / "storage/jason.db") as connection:
            connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL)")
            connection.execute(
                "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
                ("local-user", local.LOCAL_USERNAME, local._hash_local_password(login["password"])),
            )
        return root, config, login, session

    def password_matches(self, password: str, stored: str) -> bool:
        try:
            _algorithm, raw_iterations, salt, expected = stored.split("$", 3)
            actual = local.hashlib.pbkdf2_hmac(
                "sha256", password.encode(), salt.encode("ascii"), int(raw_iterations)
            ).hex()
            return local.secrets.compare_digest(actual, expected)
        except (TypeError, ValueError):
            return False

    def build_manifest_world(self, parent: Path):
        root = parent / "instance"
        writer = parent / "writer"
        harness = parent / "harness"
        core = parent / "core"
        for path in (root / "private", root / "storage", root / "build-manifest"):
            path.mkdir(parents=True, exist_ok=True)
        frontend_build = writer / "frontend/.next/BUILD_ID"
        frontend_build.parent.mkdir(parents=True)
        frontend_build.write_text("unit-build-id\n")
        for relative in local.BUILD_MANIFEST_ARTIFACTS:
            artifact = harness / relative
            artifact.parent.mkdir(parents=True, exist_ok=True)
            artifact.write_text("built:" + relative)
        config = {
            "instanceId": "unit-build-instance",
            "root": str(root),
            "harnessRoot": str(harness),
            "yimengRoot": str(writer),
            "coreRoot": str(core),
        }
        local.mark_lifecycle(root, config, "clean")
        identities = {
            writer: {"root": str(writer), "commit": "1" * 40, "dirty": False,
                     "changeCount": 0, "workingTreeStateSha256": "0" * 64, "changes": []},
            harness: {"root": str(harness), "commit": "2" * 40, "dirty": False,
                      "changeCount": 0, "workingTreeStateSha256": "0" * 64, "changes": []},
            core: {"root": str(core), "commit": "3" * 40, "dirty": True,
                   "changeCount": 1, "workingTreeStateSha256": "4" * 64,
                   "changes": [" M AGENTS.md"]},
        }
        return root, config, identities

    def test_interactive_director_route_starts_without_one_shot_transport_override(self):
        config = {
            "root": "/private/tmp/qingmu-interactive-sample",
            "yimengRoot": "/private/tmp/qingmu-writer-sample",
            "directorProductionExecution": {"interactiveEnabled": True},
        }
        command = local.backend_command(config)
        self.assertNotIn("--director-production-override", command)
        self.assertEqual(command[2], str(local.HARNESS / "packages/experimental/qingmu-director-context-bridge/python/qingmu_api.py"))
        self.assertEqual(command[0], "/private/tmp/qingmu-writer-sample/.venv/bin/python")

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
            "routeKey": "qingmu.director.text.proposal.d1",
            "projectId": "project-1",
            "episodeId": "episode-1",
            "methodPackageVersion": "method.v1",
            "methodPackageSha256": "a" * 64,
            "maxPaidCny": 0.30,
            "maxInputTokens": 8000,
            "maxOutputTokens": 2000,
            "thinking": "disabled",
            "images": False,
            "files": False,
            "tools": False,
            "credentialFile": str(local.DEEPSEEK_PRODUCTION_CREDENTIAL_FILE),
            "transportEnabled": False,
            "interactiveEnabled": False,
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
            "outputContractSha256": "5" * 64,
            "requestSha256": "e" * 64, "payloadSha256": "f" * 64,
            "provider": "deepseek-official", "model": "deepseek-v4-pro",
            "routeKey": production["routeKey"],
            "inputPolicy": {"unit": "utf8_bytes_upper_bound", "promptUtf8Bytes": 100,
                            "maxInputTokens": 8000},
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
            "estimatedCny": 0.133056, "authorizationCapCny": 0.30,
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
        private_lock = root / "private/d1-pre-submit-lock.json"
        local.write_json(private_lock, binding)
        lock = (
            Path(config["coreRoot"])
            / "docs/qingmu-os/evidence/2026-08-31-director-output-semantics-phase1-7"
            / "d1-one-shot-lock-pack.json"
        )
        lock.parent.mkdir(parents=True)
        lock.write_text(json.dumps({
            "schema": "qingmu.d1-deepseek-text-pre-submit-lock.v4",
            "status": "active",
            "submitAllowed": True,
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
                          "outputContractSha256": binding["outputContractSha256"],
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
            "pricing": {"snapshotDate": "2026-08-16", "currency": "CNY",
                "inputCacheMissCnyPerMillion": 9.504, "outputCnyPerMillion": 28.512,
                "reservedUpperBoundCny": 0.30, "estimatedReservationCny": 0.133056,
                "actualCostCny": None},
            "persistedCounts": inspection["counts"],
        }))
        return root, config, lock, local.hashlib.sha256(lock.read_bytes()).hexdigest(), inspection

    def test_new_instance_has_distinct_private_service_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            (writer / "scripts").mkdir(parents=True)
            (writer / "scripts/qingmu_local_api.py").touch()
            (writer / "frontend").mkdir()
            (writer / "frontend/package.json").write_text("{}")
            completed = subprocess.CompletedProcess(
                args=[], returncode=0, stdout='{"userId":"user_1","username":"qingmu-local"}\n', stderr=""
            )
            with patch("subprocess.run", return_value=completed), \
                 patch.object(local, "node20_executable", return_value="/private/node20"):
                local.initialize(root, writer)
            config = json.loads((root / "private/instance.json").read_text())
            self.assertGreaterEqual(len(config["directorExecutionKey"].encode()), 32)
            self.assertNotIn(
                config["directorExecutionKey"],
                {config["jwtSecret"], config["attestationKey"], config["controlKey"]},
            )
            self.assertGreaterEqual(len(config["editorialHandoffKey"].encode()), 32)
            self.assertNotIn(
                config["editorialHandoffKey"],
                {config["jwtSecret"], config["attestationKey"], config["controlKey"],
                 config["directorExecutionKey"]},
            )
            self.assertGreaterEqual(len(config["assetActivationKey"].encode()), 32)
            self.assertNotIn(
                config["assetActivationKey"],
                {config["jwtSecret"], config["attestationKey"], config["controlKey"],
                 config["directorExecutionKey"], config["editorialHandoffKey"]},
            )
            self.assertEqual((root / "private/instance.json").stat().st_mode & 0o777, 0o600)
            bridge = root / "dsh/profiles/node_modules/@deepseek-ai/dsh-experimental-qingmu-director-context-bridge"
            self.assertTrue(bridge.is_symlink())
            self.assertEqual(
                bridge.resolve(),
                local.HARNESS / "packages/experimental/qingmu-director-context-bridge",
            )
            manifest = json.loads((root / "dsh/profiles/qingmu/package.json").read_text())
            self.assertEqual(manifest["dsh"]["profile"]["bundles"], [
                "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
                "@deepseek-ai/dsh-experimental-qingmu-web",
            ])
            bundle = root / "dsh/profiles/node_modules/@deepseek-ai/dsh-experimental-qingmu-web"
            self.assertTrue(bundle.is_symlink())
            self.assertEqual(bundle.resolve(), local.HARNESS / "packages/experimental/qingmu-web")

    def test_native_director_requires_discovered_healthy_preset(self):
        for presets, expected in (
            ([], False),
            ([{"id": "standard"}], False),
            ([{"id": "qingmu-director", "broken": "missing composition"}], False),
            ([{"id": "qingmu-director"}], True),
        ):
            with self.subTest(presets=presets), patch.object(local, "host_rpc", return_value={"presets": presets}) as rpc:
                if expected:
                    local.require_native_director_preset("http://127.0.0.1:41002")
                else:
                    with self.assertRaisesRegex(RuntimeError, "青木导演预设"):
                        local.require_native_director_preset("http://127.0.0.1:41002")
                rpc.assert_called_once_with("http://127.0.0.1:41002", "agentPreset.list", {})

    def test_local_profile_upgrades_legacy_and_rejects_drift_without_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "dsh/profiles/qingmu/package.json"
            manifest.parent.mkdir(parents=True)
            local.write_json(manifest, {"dsh": {"profile": {"bundles": local.LOCAL_PROFILE_BUNDLES[:2]}}})
            with self.assertRaisesRegex(ValueError, "bundle"):
                local.local_director_profile(root)
            local.local_director_profile(root, install=True)
            local.local_director_profile(root)
            before = manifest.read_bytes()
            link = root / "dsh/profiles/node_modules/@deepseek-ai/dsh-experimental-qingmu-web"
            link.unlink()
            link.symlink_to(root / "wrong-source")
            for install in (False, True):
                with self.subTest(install=install), self.assertRaisesRegex(ValueError, "来源不符"):
                    local.local_director_profile(root, install=install)
                self.assertEqual(before, manifest.read_bytes())
            link.unlink()
            with self.assertRaisesRegex(ValueError, "链接缺失"):
                local.local_director_profile(root)

    def test_local_profile_refuses_external_parent_or_custom_bundles(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            root.mkdir()
            outside = parent / "outside"
            outside.mkdir()
            (root / "dsh").symlink_to(outside)
            with self.assertRaisesRegex(ValueError, "越出"):
                local.local_director_profile(root, install=True)
            self.assertEqual(list(outside.iterdir()), [])
            (root / "dsh").unlink()
            manifest = root / "dsh/profiles/qingmu/package.json"
            manifest.parent.mkdir(parents=True)
            local.write_json(manifest, {"dsh": {"profile": {"bundles": ["custom"]}}})
            before = manifest.read_bytes()
            with self.assertRaisesRegex(ValueError, "自定义配置"):
                local.local_director_profile(root, install=True)
            self.assertEqual(before, manifest.read_bytes())

    @unittest.skipUnless(os.environ.get("QINGMU_TEST_NATIVE_HOST") == "1", "requires built local Host")
    def test_native_director_real_host_composition_without_model_turn(self):
        """Real profile loader and session composition, with an empty private home."""
        self.assertTrue((local.HARNESS / "apps/cli/lib/bin.js").is_file())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "instance"
            for part in ("private", "work", "logs", "home", "dsh", "core"):
                (root / part).mkdir(parents=True, exist_ok=True)
            # Reproduce a restored pre-fix profile, then upgrade through the
            # same helper used by initialize/restore. No Writer or production DB.
            manifest = root / "dsh/profiles/qingmu/package.json"
            manifest.parent.mkdir(parents=True)
            local.write_json(manifest, {"name": "qingmu-local-profile", "private": True,
                                       "dsh": {"profile": {"bundles": local.LOCAL_PROFILE_BUNDLES[:2]}}})
            local.local_director_profile(root, install=True)
            supervisor = local.Supervisor(root, {
                "instanceId": "native-director-test", "root": str(root), "node": shutil.which("node"),
                "harnessRoot": str(local.HARNESS), "coreRoot": str(root / "core"),
                "attestationKey": "isolated-test-attestation",
            }, review_only=True)
            port = local.available_port()
            supervisor.ports = {"apiUrl": "http://127.0.0.1:1", "hostPort": port,
                                "hostUrl": f"http://127.0.0.1:{port}"}
            try:
                supervisor.start_host()
                roster = local.host_rpc(supervisor.ports["hostUrl"], "agentPreset.list", {})
                self.assertTrue(any(p.get("id") == "qingmu-director" and not p.get("broken")
                                    for p in roster["presets"]))
                session = local.host_rpc(supervisor.ports["hostUrl"], "session.create", {
                    "cwd": str(root / "work"), "agentPreset": "qingmu-director"})
                self.assertEqual(session["agentPreset"], "qingmu-director")
                readiness = local.http(supervisor.ports["hostUrl"]
                                       + "/qingmu-director-context/readNativeDirectorReadiness", payload={
                    "type": "client-request", "rpcId": "native-readiness-test",
                    "method": "readNativeDirectorReadiness", "payload": {"sessionId": session["sessionId"]}})
                self.assertTrue(readiness["result"]["ok"])
                self.assertEqual(readiness["result"]["value"]["status"], "mounted")
                self.assertEqual(readiness["result"]["value"]["missingTools"], [])
                self.assertEqual(len(readiness["result"]["value"]["tools"]), 6)
            except Exception:
                self.fail((root / "logs/host.log").read_text()[-10000:])
            finally:
                supervisor.stop_owned("host")
                for log in supervisor.logs:
                    log.close()

    def test_api_environment_only_receives_dedicated_asset_activation_control(self):
        root = Path("/private/qingmu-instance")
        env = local.backend_env(root, {
            "yimengRoot": "/private/writer",
            "controlKey": "supervisor-only",
            "assetActivationKey": "api-activation-only",
        })
        self.assertEqual(env["QINGMU_ASSET_ACTIVATION_SOCKET"], "/private/qingmu-instance/private/asset-activation.sock")
        self.assertEqual(env["QINGMU_ASSET_ACTIVATION_KEY"], "api-activation-only")
        self.assertNotIn("controlKey", env)
        self.assertNotIn("supervisor-only", env.values())

    def test_existing_directory_is_never_initialized(self):
        with tempfile.TemporaryDirectory() as directory:
            writer = Path(directory) / "writer"
            (writer / "scripts").mkdir(parents=True)
            (writer / "scripts/qingmu_local_api.py").touch()
            with self.assertRaises(FileExistsError):
                local.initialize(Path(directory), writer)

    def test_frontend_node_must_be_node20(self):
        completed = subprocess.CompletedProcess(args=[], returncode=0, stdout="v20.20.2\n", stderr="")
        with patch("subprocess.run", return_value=completed):
            self.assertEqual(local.node20_executable(Path("/bin/sh")), str(Path("/bin/sh").resolve()))
        wrong = subprocess.CompletedProcess(args=[], returncode=0, stdout="v26.7.0\n", stderr="")
        with patch("subprocess.run", return_value=wrong), \
             patch.object(local.shutil, "which", return_value=None), \
             patch.object(local.Path, "glob", return_value=[]), \
             self.assertRaisesRegex(ValueError, "Node 20"):
            local.node20_executable(Path("/bin/sh"))

    def test_recorded_build_manifest_binds_clean_sources_artifacts_and_instance(self):
        with tempfile.TemporaryDirectory() as directory:
            root, config, identities = self.build_manifest_world(Path(directory))
            with patch.object(local, "source_identity", side_effect=lambda path: identities[path]), \
                 patch.object(local, "require_qingmu_client_build") as check:
                result = local.record_build_manifest(root, config)
                status = local.build_manifest_status(root, config)
            check.assert_called_once_with(config, identities[Path(config["harnessRoot"])]["commit"])
            manifest_path = root / "build-manifest/current.json"
            manifest = json.loads(manifest_path.read_text())
            self.assertTrue(result["matches"])
            self.assertTrue(status["matches"])
            self.assertTrue(manifest["releaseSourcesClean"])
            self.assertFalse(manifest["sources"]["writer"]["dirty"])
            self.assertFalse(manifest["sources"]["harness"]["dirty"])
            self.assertTrue(manifest["sources"]["core"]["dirty"])
            self.assertEqual(manifest["artifacts"]["frontendBuildId"]["value"], "unit-build-id")
            self.assertEqual(manifest_path.stat().st_mode & 0o777, 0o600)
            serialized = manifest_path.read_text()
            self.assertNotIn("controlKey", serialized)
            self.assertNotIn("jwtSecret", serialized)

    def test_record_build_refuses_invalid_client_before_replacing_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root, config, identities = self.build_manifest_world(Path(directory))
            current = root / "build-manifest/current.json"
            current.write_text('{"previous":"preserve"}\n')
            for error in (ValueError("client build invalid"), subprocess.TimeoutExpired("checker", 30)):
                with self.subTest(error=type(error).__name__), \
                     patch.object(local, "source_identity", side_effect=lambda path: identities[path]), \
                     patch.object(local, "require_qingmu_client_build", side_effect=error) as check:
                    with self.assertRaises(type(error)):
                        local.record_build_manifest(root, config)
                    check.assert_called_once()
                    self.assertEqual(current.read_text(), '{"previous":"preserve"}\n')
                    self.assertFalse((root / "build-manifest/history").exists())

    def test_release_identity_includes_native_director_readers_and_build_record(self):
        self.assertNotIn("packages/experimental/qingmu-director-context-bridge/python/dialogue_projection.py",
                         local.BUILD_MANIFEST_ARTIFACTS)
        for relative in ("packages/client/runtime/lib/client.js", "packages/host/apiproxy/lib/index.js",
                         "packages/boot/app-boot/lib/index.js",
                         "packages/experimental/qingmu-director-context-bridge/lib/model-tools.js",
                         "packages/experimental/client-ui-brand-qingmu/lib/client.js",
                         "packages/experimental/qingmu-web/cordis.patch.yml",
                         "packages/experimental/qingmu-web/agent-presets/qingmu-director/preset.yml",
                         "packages/experimental/qingmu-web/agent-presets/qingmu-director/agent.cordis.yml",
                         ".dsh-build/client-build-environment.json"):
            with self.subTest(artifact=relative):
                self.assertIn(relative, local.BUILD_MANIFEST_ARTIFACTS)

    def test_build_manifest_detects_artifact_and_source_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root, config, identities = self.build_manifest_world(Path(directory))
            with patch.object(local, "source_identity", side_effect=lambda path: identities[path]), \
                 patch.object(local, "require_qingmu_client_build"):
                local.record_build_manifest(root, config)
                artifact = Path(config["harnessRoot"]) / local.BUILD_MANIFEST_ARTIFACTS[0]
                artifact.write_text("drifted")
                status = local.build_manifest_status(root, config)
            self.assertEqual(status["state"], "drift")
            self.assertFalse(status["matches"])
            self.assertIn("artifacts", status["mismatches"])

    def test_build_manifest_detects_new_reader_and_build_record_drift_without_rechecking_build(self):
        with tempfile.TemporaryDirectory() as directory:
            root, config, identities = self.build_manifest_world(Path(directory))
            with patch.object(local, "source_identity", side_effect=lambda path: identities[path]), \
                 patch.object(local, "require_qingmu_client_build") as check:
                local.record_build_manifest(root, config)
                check.reset_mock()
                for relative in ("packages/client/runtime/lib/client.js", "packages/host/apiproxy/lib/index.js",
                                 "packages/experimental/qingmu-director-context-bridge/lib/model-tools.js",
                                 "packages/experimental/client-ui-brand-qingmu/lib/client.js",
                                 ".dsh-build/client-build-environment.json"):
                    with self.subTest(artifact=relative):
                        artifact = Path(config["harnessRoot"]) / relative
                        original = artifact.read_bytes()
                        artifact.write_text("drifted")
                        status = local.build_manifest_status(root, config)
                        self.assertFalse(status["matches"])
                        self.assertIn("artifacts", status["mismatches"])
                        artifact.write_bytes(original)
                check.assert_not_called()

    def test_qingmu_client_build_checker_uses_bounded_scrubbed_subprocess(self):
        config = {"harnessRoot": "/isolated/harness", "node": "/isolated/node"}
        completed = subprocess.CompletedProcess(args=[], returncode=0, stdout="{}", stderr="")
        with patch.dict("os.environ", {"OPENAI_API_KEY": "must-not-pass", "NODE_OPTIONS": "must-not-pass"}), \
             patch.object(local.subprocess, "run", return_value=completed) as run:
            local.require_qingmu_client_build(config, "a" * 40)
        self.assertEqual(run.call_args.args[0], ["/isolated/node", "--import", "tsx/esm",
                         "/isolated/harness/scripts/qingmu-client-build-check.ts", "/isolated/harness", "a" * 40])
        self.assertEqual(set(run.call_args.kwargs["env"]), {"PATH"})
        self.assertEqual(run.call_args.kwargs["cwd"], Path("/isolated/harness"))
        self.assertEqual(run.call_args.kwargs["timeout"], 30)
        completed.returncode = 1
        completed.stderr = "client artifacts differ"
        with patch.object(local.subprocess, "run", return_value=completed), \
             self.assertRaisesRegex(ValueError, "client artifacts differ"):
            local.require_qingmu_client_build(config, "a" * 40)

    def test_review_only_manifest_does_not_claim_host_artifacts_or_enable_full_start(self):
        with tempfile.TemporaryDirectory() as directory:
            root, config, identities = self.build_manifest_world(Path(directory))
            with patch.object(local, "source_identity", side_effect=lambda path: identities[path]), \
                 patch.object(local, "require_qingmu_client_build") as check:
                local.record_build_manifest(root, config, review_only=True)
                review = local.build_manifest_status(root, config, review_only=True)
                full = local.build_manifest_status(root, config)
            check.assert_not_called()
            manifest = json.loads((root / "build-manifest/current.json").read_text())
            self.assertEqual(manifest["runtimeProfile"], "review-only")
            self.assertEqual(manifest["artifacts"]["host"], {})
            self.assertTrue(review["matches"])
            self.assertFalse(full["matches"])
            self.assertIn("runtimeProfile", full["mismatches"])
            with patch.object(local, "source_identity", side_effect=lambda path: identities[path]), \
                 self.assertRaisesRegex(RuntimeError, "record-build"):
                local.require_build_manifest_matches(root, config)

    def test_record_build_rejects_dirty_release_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root, config, identities = self.build_manifest_world(Path(directory))
            identities[Path(config["yimengRoot"])] = {
                **identities[Path(config["yimengRoot"])], "dirty": True,
                "changeCount": 1, "changes": [" M frontend/source.ts"],
            }
            with patch.object(local, "source_identity", side_effect=lambda path: identities[path]), \
                 self.assertRaisesRegex(ValueError, "必须干净"):
                local.record_build_manifest(root, config)
            self.assertFalse((root / "build-manifest/current.json").exists())

    def test_start_requires_matching_build_manifest_before_spawning(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            config = {"instanceId": "unit", "root": str(root), "controlKey": "unit"}
            local.mark_lifecycle(root, config, "clean")
            with patch.object(local, "control", side_effect=FileNotFoundError), \
                 self.assertRaisesRegex(RuntimeError, "record-build"):
                local.start(root, config)

    def test_start_uses_writer_python_for_live_database_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            (root / "logs").mkdir()
            writer = root / "writer"
            python = writer / ".venv/bin/python"
            python.parent.mkdir(parents=True)
            python.symlink_to(local.sys.executable)
            config = {"instanceId": "unit", "root": str(root), "yimengRoot": str(writer)}
            local.mark_lifecycle(root, config, "clean")
            with patch.object(local, "control", side_effect=[FileNotFoundError(), {"ready": True}]), \
                 patch.object(local, "require_build_manifest_matches"), \
                 patch.object(local.subprocess, "Popen") as spawn:
                self.assertEqual(local.start(root, config), {"ready": True})
            argv = spawn.call_args.args[0]
            self.assertEqual(argv[:2], [str(python), "-B"])
            self.assertIn("_supervise", argv)
            self.assertEqual(spawn.call_args.kwargs["env"], local.safe_env(root))
            self.assertTrue(spawn.call_args.kwargs["start_new_session"])

    def test_missing_writer_python_does_not_fall_back_to_system_python(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            config = {"instanceId": "unit", "root": str(root), "yimengRoot": str(root / "missing")}
            local.mark_lifecycle(root, config, "clean")
            with patch.object(local, "control", side_effect=FileNotFoundError), \
                 patch.object(local, "require_build_manifest_matches"), \
                 patch.object(local.subprocess, "Popen") as spawn, \
                 self.assertRaisesRegex(RuntimeError, "Writer Python"):
                local.start(root, config)
            spawn.assert_not_called()

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

    def test_qingmu_workspace_uses_correlated_canonical_host_rpc(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "work").mkdir()
            expected = str((root / "work").resolve())
            captured = {}

            def rpc(url, *, token=None, payload=None):
                captured.update({"url": url, "token": token, "payload": payload})
                return {
                    "type": "server-response",
                    "rpcId": payload["rpcId"],
                    "result": {"ok": True, "value": {
                        "workspace": {"path": expected, "workspaceId": "workspace-1"},
                        "created": True,
                    }},
                }

            with patch.object(local, "http", side_effect=rpc):
                workspace = local.ensure_qingmu_workspace(root, "http://127.0.0.1:49901")
            self.assertEqual(workspace["workspaceId"], "workspace-1")
            self.assertEqual(captured["url"], "http://127.0.0.1:49901/api/workspace.create")
            self.assertIsNone(captured["token"])
            self.assertEqual(captured["payload"]["method"], "workspace.create")
            self.assertEqual(captured["payload"]["payload"], {"path": expected})

    def test_qingmu_workspace_rejects_mismatched_response_and_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "work").mkdir()
            with patch.object(local, "http", return_value={
                "type": "server-response", "rpcId": "wrong", "result": {"ok": True, "value": {}},
            }), self.assertRaisesRegex(RuntimeError, "响应身份不匹配"):
                local.ensure_qingmu_workspace(root, "http://127.0.0.1:49901")

    def test_qingmu_workspace_waits_for_host_api_composition(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "work").mkdir()
            expected = str((root / "work").resolve())
            calls = 0

            def becoming_ready(_url, *, token=None, payload=None):
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise urllib.error.HTTPError(_url, 404, "not ready", {}, None)
                return {"type": "server-response", "rpcId": payload["rpcId"],
                        "result": {"ok": True, "value": {"workspace": {"path": expected}}}}

            with patch.object(local, "http", side_effect=becoming_ready), \
                 patch.object(local.time, "sleep"):
                local.ensure_qingmu_workspace(root, "http://127.0.0.1:49901")
            self.assertEqual(calls, 2)

            def wrong_path(_url, *, token=None, payload=None):
                return {"type": "server-response", "rpcId": payload["rpcId"],
                        "result": {"ok": True, "value": {"workspace": {"path": "/other"}}}}
            with patch.object(local, "http", side_effect=wrong_path), \
                 self.assertRaisesRegex(RuntimeError, "workspace 绑定不符"):
                local.ensure_qingmu_workspace(root, "http://127.0.0.1:49901")

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
            "routeKey": "qingmu.director.text.proposal.d1",
            "projectId": "project-1",
            "episodeId": "episode-1",
            "methodPackageVersion": "method.v1",
            "methodPackageSha256": "a" * 64,
            "maxPaidCny": 0.30,
            "maxInputTokens": 8000,
            "maxOutputTokens": 2000,
            "thinking": "disabled",
            "images": False,
            "files": False,
            "tools": False,
            "credentialFile": str(local.DEEPSEEK_PRODUCTION_CREDENTIAL_FILE),
            "transportEnabled": False,
            "interactiveEnabled": False,
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

    def test_login_requires_reopening_the_single_entry_url(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            local.write_json(root / "private/login.json", {
                "username": "qingmu-local", "password": "isolated-password",
            })
            supervisor = local.Supervisor(root, {"instanceId": "unit", "root": str(root)})
            expected_entry = "http://127.0.0.1:49900/qingmu-runtime/local-session"
            supervisor.ports = {
                "apiUrl": "http://127.0.0.1:49899", "entryUrl": expected_entry,
            }
            with patch.object(supervisor, "api_identity"), \
                 patch.object(local, "http", return_value={"token": "renewed-token"}), \
                 patch.object(local, "stop_child"), \
                 patch.object(supervisor, "start_host"), \
                 patch.object(supervisor, "start_frontend"), \
                 patch.object(supervisor, "status", return_value={"entryUrl": expected_entry}):
                result = supervisor.login()
            self.assertEqual(result["entryUrl"], expected_entry)
            self.assertIn("重新打开 entryUrl", result["message"])
            self.assertNotIn("刷新页面", result["message"])
            self.assertEqual(
                json.loads((root / "private/session.json").read_text())["token"],
                "renewed-token",
            )

    def test_login_replacement_is_persisted_and_crash_recovery_sees_new_pids(self):
        class Child:
            def __init__(self, pid):
                self.pid = pid

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for part in ("private", "storage", "audit"):
                (root / part).mkdir()
            config = {"instanceId": "login-ledger", "root": str(root)}
            ports = {
                "apiPort": 49101,
                "hostPort": 49102,
                "webPort": 49103,
                "apiUrl": "http://127.0.0.1:49101",
                "hostUrl": "http://127.0.0.1:49102",
                "webUrl": "http://127.0.0.1:49103",
                "entryUrl": "http://127.0.0.1:49103/qingmu-runtime/local-session",
            }
            local.mark_lifecycle(root, config, "dirty")
            local.write_json(root / "private/ports.json", ports)
            local.write_json(root / "private/login.json", {
                "username": local.LOCAL_USERNAME,
                "password": "isolated-password",
            })
            supervisor = local.Supervisor(root, config)
            supervisor.process_ledger_active = True
            supervisor.ports = ports
            supervisor.api = Child(930001)
            supervisor.worker = Child(930002)
            supervisor.host = Child(930003)
            supervisor.frontend = Child(930004)
            first = supervisor._persist_process_ledger()

            def start_host():
                supervisor.host = Child(930013)
                supervisor._persist_process_ledger()

            def start_frontend():
                supervisor.frontend = Child(930014)
                supervisor._persist_process_ledger()

            current = {
                "instanceId": config["instanceId"],
                "supervisorPid": local.os.getpid(),
                "apiPid": 930001,
                "workerPid": 930002,
                "hostPid": 930013,
                "frontendPid": 930014,
                **ports,
                "ready": True,
            }
            with patch.object(supervisor, "api_identity"), \
                 patch.object(local, "http", return_value={"token": "renewed-token"}), \
                 patch.object(local, "stop_child"), \
                 patch.object(supervisor, "start_host", side_effect=start_host), \
                 patch.object(supervisor, "start_frontend", side_effect=start_frontend), \
                 patch.object(supervisor, "status", return_value=current):
                supervisor.login()

            ledger = json.loads((root / "private/process-ledger.json").read_text())
            self.assertGreater(ledger["generation"], first["generation"])
            self.assertEqual(ledger["hostPid"], 930013)
            self.assertEqual(ledger["frontendPid"], 930014)
            runtime = json.loads((root / "runtime.json").read_text())
            self.assertEqual(runtime["hostPid"], 930013)
            self.assertEqual(runtime["frontendPid"], 930014)

            with patch.object(
                local,
                "_persisted_process_exists",
                side_effect=lambda pid: pid == 930014,
            ):
                with self.assertRaisesRegex(RuntimeError, "历史进程标识仍存活"):
                    local.recover_crashed_instance(root, config, config["instanceId"])

    def test_private_rotation_changes_all_credentials_login_and_session_without_secret_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root, old_config, old_login, _old_session = self.rotation_world(Path(directory))
            with patch.object(local, "node20_executable", return_value="/private/node20"):
                context = local._rotate_private_state(root, "rotation-instance")
            new_config = json.loads((root / "private/instance.json").read_text())
            new_login = json.loads((root / "private/login.json").read_text())
            changed = [
                not local.secrets.compare_digest(old_config[name], new_config[name])
                for name in local.PRIVATE_CREDENTIAL_FIELDS
            ]
            self.assertTrue(all(changed))
            self.assertTrue(context["changed"] == dict(zip(local.PRIVATE_CREDENTIAL_FIELDS, changed)))
            self.assertTrue(new_config["futureNonSensitiveSetting"] == "preserved")
            self.assertTrue(not local.secrets.compare_digest(old_login["password"], new_login["password"]))
            self.assertFalse((root / "private/session.json").exists())
            with sqlite3.connect(root / "storage/jason.db") as connection:
                stored = connection.execute(
                    "SELECT password_hash FROM users WHERE username = ?", (local.LOCAL_USERNAME,)
                ).fetchone()[0]
            self.assertTrue(self.password_matches(new_login["password"], stored))
            self.assertFalse(self.password_matches(old_login["password"], stored))
            for name in ("instance.json", "login.json"):
                self.assertEqual((root / "private" / name).stat().st_mode & 0o777, 0o600)
            self.assertFalse((root / "private/credential-rotation.in-progress.json").exists())

    def test_private_rotation_refuses_wrong_instance_and_running_owner_without_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root, _config, _login, _session = self.rotation_world(Path(directory))
            before_config = (root / "private/instance.json").read_bytes()
            before_login = (root / "private/login.json").read_bytes()
            with patch.object(local, "node20_executable", return_value="/private/node20"):
                with self.assertRaisesRegex(ValueError, "身份不匹配"):
                    local._rotate_private_state(root, "wrong-instance")
                with local.instance_lock(root):
                    with self.assertRaisesRegex(RuntimeError, "正在运行"):
                        local._rotate_private_state(root, "rotation-instance")
            self.assertTrue(local.secrets.compare_digest(before_config, (root / "private/instance.json").read_bytes()))
            self.assertTrue(local.secrets.compare_digest(before_login, (root / "private/login.json").read_bytes()))

    def test_private_rotation_partial_failure_restores_files_session_and_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root, _config, old_login, _session = self.rotation_world(Path(directory))
            before_config = (root / "private/instance.json").read_bytes()
            before_login = (root / "private/login.json").read_bytes()
            before_session = (root / "private/session.json").read_bytes()
            with patch.object(local, "node20_executable", return_value="/private/node20"):
                with self.assertRaisesRegex(RuntimeError, "已恢复原一致状态"):
                    local._rotate_private_state(
                        root, "rotation-instance", failure_stage="after_session"
                    )
            self.assertTrue(local.secrets.compare_digest(before_config, (root / "private/instance.json").read_bytes()))
            self.assertTrue(local.secrets.compare_digest(before_login, (root / "private/login.json").read_bytes()))
            self.assertTrue(local.secrets.compare_digest(before_session, (root / "private/session.json").read_bytes()))
            with sqlite3.connect(root / "storage/jason.db") as connection:
                stored = connection.execute(
                    "SELECT password_hash FROM users WHERE username = ?", (local.LOCAL_USERNAME,)
                ).fetchone()[0]
            self.assertTrue(self.password_matches(old_login["password"], stored))
            self.assertFalse((root / "private/credential-rotation.in-progress.json").exists())

    def test_private_rotation_is_repeatable_and_rejects_unknown_secret_field(self):
        with tempfile.TemporaryDirectory() as directory:
            root, _config, _login, _session = self.rotation_world(Path(directory))
            with patch.object(local, "node20_executable", return_value="/private/node20"):
                first = local._rotate_private_state(root, "rotation-instance")
                local.write_json(root / "private/session.json", {"token": local.secrets.token_urlsafe(48)})
                second = local._rotate_private_state(root, "rotation-instance")
                config = json.loads((root / "private/instance.json").read_text())
                config["futureSigningToken"] = local.secrets.token_urlsafe(48)
                local.write_json(root / "private/instance.json", config)
                with self.assertRaisesRegex(ValueError, "未知私密字段"):
                    local._rotate_private_state(root, "rotation-instance")
            self.assertTrue(all(first["changed"].values()))
            self.assertTrue(all(second["changed"].values()))

    def test_private_rotation_upgrades_legacy_missing_asset_activation_key_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root, _config, _login, _session = self.rotation_world(Path(directory))
            legacy = json.loads((root / "private/instance.json").read_text())
            legacy.pop("assetActivationKey")
            local.write_json(root / "private/instance.json", legacy)
            with patch.object(local, "node20_executable", return_value="/private/node20"):
                local._rotate_private_state(root, "rotation-instance")
            upgraded = json.loads((root / "private/instance.json").read_text())
            self.assertTrue(upgraded["assetActivationKey"])
            upgraded.pop("jwtSecret")
            local.write_json(root / "private/instance.json", upgraded)
            with patch.object(local, "node20_executable", return_value="/private/node20"):
                with self.assertRaisesRegex(ValueError, "缺少完整"):
                    local._rotate_private_state(root, "rotation-instance")

    def test_private_rotation_runtime_verifies_old_auth_then_new_login_with_safe_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root, old_config, old_login, old_session = self.rotation_world(Path(directory))
            new_config = local._new_private_credentials(old_config)
            context = {
                "oldConfig": old_config,
                "oldLogin": old_login,
                "oldSession": old_session,
                "newConfig": new_config,
                "changed": {name: True for name in local.PRIVATE_CREDENTIAL_FIELDS},
            }
            runtime = {"apiUrl": "http://127.0.0.1:49001"}
            logged_in = {
                "instanceId": "rotation-instance", "ready": True,
                "buildManifestMatches": True,
                "session": "已登录：" + local.LOCAL_USERNAME,
            }
            local.write_json(root / "private/session.json", {"token": local.secrets.token_urlsafe(48)})
            with patch.object(local, "_rotate_private_state", return_value=context), \
                 patch.object(local, "record_build_manifest", return_value={
                     "matches": True, "harnessCommit": "1" * 40,
                 }), patch.object(local, "start", return_value=(runtime, None)), \
                 patch.object(local, "_expect_http_unauthorized", return_value=True) as rejected, \
                 patch.object(local, "control", return_value=logged_in):
                receipt = local.rotate_private_credentials(root, "rotation-instance")
            self.assertEqual(rejected.call_count, 2)
            self.assertTrue(receipt["oldPasswordInvalid"])
            self.assertTrue(receipt["oldSessionInvalid"])
            self.assertTrue(receipt["newLoginVerified"])
            serialized = json.dumps(receipt)
            private_values = [
                *(old_config[name] for name in local.PRIVATE_CREDENTIAL_FIELDS),
                old_login["password"], old_session["token"],
                *(new_config[name] for name in local.PRIVATE_CREDENTIAL_FIELDS),
            ]
            for item in private_values:
                self.assertFalse(item in serialized)

    def test_rotation_failure_stops_the_exact_owned_supervisor_when_control_is_unavailable(self):
        owned = subprocess.Popen(["/bin/sleep", "30"])
        try:
            with patch.object(local, "control", side_effect=ConnectionRefusedError), \
                 patch.object(local, "stop_child", wraps=local.stop_child) as stop_owned, \
                 patch.object(local, "instance_lock", return_value=local.contextlib.nullcontext()), \
                 patch.object(local, "require_clean"):
                local._stop_rotated_instance(Path("/unused"), {}, owned)
            stop_owned.assert_called_once_with(owned)
            self.assertIsNotNone(owned.poll())
        finally:
            local.stop_child(owned)

    def test_rotation_start_timeout_stops_child_before_raising(self):
        owned = subprocess.Popen(["/bin/sleep", "30"])
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "logs").mkdir()
                with patch.object(local, "control", side_effect=FileNotFoundError), \
                     patch.object(local, "instance_lock", return_value=local.contextlib.nullcontext()), \
                     patch.object(local, "require_clean"), \
                     patch.object(local, "require_build_manifest_matches"), \
                     patch.object(local.subprocess, "Popen", return_value=owned), \
                     patch.object(local.time, "monotonic", side_effect=[0.0, 76.0]), \
                     patch.object(local, "stop_child", wraps=local.stop_child) as stop_owned:
                    with self.assertRaisesRegex(RuntimeError, "启动尚未确认"):
                        local.start(root, {}, return_owned_supervisor=True)
                stop_owned.assert_called_once_with(owned)
                self.assertIsNotNone(owned.poll())
        finally:
            local.stop_child(owned)

    def test_rotation_failure_reports_when_stopped_state_cannot_be_confirmed(self):
        with patch.object(local, "control", return_value={"stopped": True}), \
             patch.object(local, "instance_lock", side_effect=RuntimeError("still owned")), \
             patch.object(local.time, "monotonic", side_effect=[0.0, 0.0, 6.0]), \
             patch.object(local.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "停止未确认"):
                local._stop_rotated_instance(Path("/unused"), {}, None)

    def test_partial_start_cleans_only_owned_child(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for part in ("private", "logs", "work"):
                (root / part).mkdir()
            supervisor = local.Supervisor(root, {"instanceId": "unit", "root": str(root),
                "yimengRoot": str(root), "controlKey": "unit", "jwtSecret": "unit-media-signing"})
            local.mark_lifecycle(root, supervisor.config, "clean")
            child = subprocess.Popen(["/bin/sleep", "30"])
            try:
                with patch.object(supervisor, "launch", return_value=child), patch.object(supervisor, "wait_ready"), \
                     patch.object(local, "mark_build_started"), \
                     patch.object(supervisor, "start_host", side_effect=RuntimeError("Host unavailable")):
                    with self.assertRaisesRegex(RuntimeError, "Host unavailable"):
                        supervisor.run()
                self.assertIsNotNone(child.poll())
                self.assertFalse((root / "control.sock").exists())
                local.require_clean(root, supervisor.config)
                runtime = json.loads((root / "runtime.json").read_text())
                self.assertFalse(runtime["ready"])
                self.assertIsNone(runtime["supervisorPid"])
                self.assertIsNone(runtime["apiPid"])
                self.assertIsNone(runtime["workerPid"])
                self.assertIsNone(runtime["hostPid"])
                self.assertFalse(runtime["apiProcessAlive"])
                self.assertFalse(runtime["workerProcessAlive"])
                self.assertFalse(runtime["hostListenerAndHttpVerified"])
            finally:
                local.stop_child(child)

    def test_stopped_runtime_replaces_stale_listener_truth_without_signalling(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            config = {"instanceId": "unit-stopped", "root": str(root)}
            local.write_json(root / "private/ports.json", {
                "apiPort": 49899, "webPort": 49900,
                "apiUrl": "http://127.0.0.1:49899", "webUrl": "http://127.0.0.1:49900",
                "entryUrl": "http://127.0.0.1:49900/qingmu-runtime/local-session",
            })
            local.write_json(root / "runtime.json", {
                "instanceId": "unit-stopped", "ready": True,
                "supervisorPid": 999999, "apiPid": 999998, "hostPid": 999997,
                "apiProcessAlive": True, "hostProcessAlive": True,
                "apiIdentityAndStorageVerified": True, "hostListenerAndHttpVerified": True,
            })
            with patch("os.kill", side_effect=AssertionError("must not signal persisted PID")):
                local.write_stopped_runtime(root, config)
            runtime = json.loads((root / "runtime.json").read_text())
            self.assertEqual(runtime["webUrl"], "http://127.0.0.1:49900")
            self.assertEqual(runtime["entryUrl"], "http://127.0.0.1:49900/qingmu-runtime/local-session")
            self.assertFalse(runtime["ready"])
            self.assertEqual(
                [runtime["supervisorPid"], runtime["apiPid"], runtime["hostPid"]],
                [None, None, None],
            )

    def test_ordinary_control_stop_persists_stopped_runtime_after_owned_children_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for part in ("private", "logs", "work"):
                (root / part).mkdir()
            config = {"instanceId": "unit-control-stop", "root": str(root),
                      "yimengRoot": str(root), "controlKey": "unit-control-key"}
            local.mark_lifecycle(root, config, "clean")
            supervisor = local.Supervisor(root, config)
            api = subprocess.Popen(["/bin/sleep", "30"])
            worker = subprocess.Popen(["/bin/sleep", "30"])
            host = subprocess.Popen(["/bin/sleep", "30"])
            frontend = subprocess.Popen(["/bin/sleep", "30"])
            try:
                def start_worker():
                    supervisor.worker = worker

                def start_host():
                    supervisor.host = host

                def start_frontend():
                    supervisor.frontend = frontend

                with patch.object(supervisor, "launch", return_value=api), \
                     patch.object(supervisor, "wait_ready"), \
                     patch.object(local, "mark_build_started"), \
                     patch.object(supervisor, "start_worker", side_effect=start_worker), \
                     patch.object(supervisor, "start_host", side_effect=start_host), \
                     patch.object(supervisor, "start_frontend", side_effect=start_frontend):
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        running = pool.submit(supervisor.run)
                        result = None
                        for _ in range(100):
                            try:
                                result = local.control(root, config, "stop")
                                break
                            except (FileNotFoundError, ConnectionRefusedError):
                                time.sleep(0.01)
                        self.assertEqual(result["stopped"], True)
                        running.result(timeout=5)
                self.assertIsNotNone(api.poll())
                self.assertIsNotNone(worker.poll())
                self.assertIsNotNone(host.poll())
                self.assertIsNotNone(frontend.poll())
                runtime = json.loads((root / "runtime.json").read_text())
                self.assertFalse(runtime["ready"])
                self.assertFalse(runtime["apiProcessAlive"])
                self.assertFalse(runtime["workerProcessAlive"])
                self.assertFalse(runtime["hostProcessAlive"])
                self.assertFalse(runtime["frontendProcessAlive"])
                local.require_clean(root, config)
            finally:
                local.stop_child(api)
                local.stop_child(worker)
                local.stop_child(host)
                local.stop_child(frontend)

    def test_unbound_worker_is_heartbeat_only_and_has_no_provider_authority(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            for part in ("logs", "home", "work", "dsh", "private", "storage", "audit", "build-manifest"):
                (root / part).mkdir(parents=True, exist_ok=True)
            worker_python = writer / ".venv/bin/python"
            worker_python.parent.mkdir(parents=True)
            worker_python.write_text("not executed")
            supervisor = local.Supervisor(root, {
                "instanceId": "unit-worker", "root": str(root), "jwtSecret": "instance-signing-secret", "yimengRoot": str(writer),
            })
            child = subprocess.Popen(["/bin/sleep", "30"])
            try:
                with patch.dict("os.environ", {"DEEPSEEK_API_KEY": "ambient-must-not-pass"}, clear=False), \
                     patch.object(supervisor, "launch", return_value=child) as launch:
                    supervisor.start_worker()
                argv, env, label = launch.call_args.args
                self.assertEqual(argv, [
                    str(worker_python), "-B", "-m", "jason.apps.studio.worker_cli",
                    "--lane", "text", "--heartbeat-only", "--max-tasks", "0",
                    "--disable-durable-director-orchestration",
                ])
                self.assertEqual(label, "worker")
                self.assertEqual(env["DATABASE_URL"], f"sqlite:///{root / 'storage/jason.db'}")
                self.assertEqual(env["STORAGE_ROOT"], str(root / "storage"))
                self.assertEqual(env["JASON_CONFIG_ROOT"], str(writer))
                self.assertEqual(env["JASON_ENV_FILE"], str(root / "private/no-ambient.env"))
                self.assertEqual(env["ALLOW_PAID"], "false")
                self.assertEqual(env["MAX_PAID_CNY"], "0")
                self.assertNotIn("DEEPSEEK_API_KEY", env)
                self.assertNotIn("QINGMU_DIRECTOR_EXECUTION_KEY", env)
            finally:
                local.stop_child(child)

    def test_active_project_worker_uses_exact_all_lane_and_production_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            credential_env = parent / "provider.env"
            for part in ("logs", "home", "work", "dsh", "private", "storage", "audit", "build-manifest"):
                (root / part).mkdir(parents=True, exist_ok=True)
            credential_env.write_text("DASHSCOPE_API_KEY=not-read-by-this-test\nJWT_SECRET=credential-file-secret\n")
            credential_env.chmod(0o600)
            worker_python = writer / ".venv/bin/python"
            worker_python.parent.mkdir(parents=True)
            worker_python.write_text("not executed")
            text_production = {
                "productionOnly": True,
                "provider": "dashscope",
                "projectId": "project-one",
                "episodeId": "episode-one",
                "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                "allowedStages": list(local.TEXT_FOUNDATION_STAGES),
                "credentialEnvFile": str(credential_env),
                "maxTasksPerTick": 1,
                "maxAttempts": 1,
                "allowExistingProviderPoll": True,
                "textFoundationParentTaskId": None,
                "assetReferenceParentTaskId": None,
            }
            project_production = {
                "active": True,
                "projectId": "project-one",
                "episodeId": "episode-one",
                "maxTasksPerTick": 1,
                "maxAttempts": 1,
                "maxConcurrentDispatches": 1,
                "allowExistingProviderPoll": True,
            }
            supervisor = local.Supervisor(root, {
                "instanceId": "unit-worker",
                "jwtSecret": "instance-signing-secret",
                "root": str(root),
                "yimengRoot": str(writer),
                "textFoundationProductionExecution": text_production,
                "projectProductionExecution": project_production,
            })
            child = subprocess.Popen(["/bin/sleep", "30"])
            try:
                with patch.dict("os.environ", {"JWT_SECRET": "ambient-signing-secret"}), \
                     patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), \
                     patch.object(supervisor, "launch", return_value=child) as launch:
                    supervisor.start_worker()
                argv, env, label = launch.call_args.args
                self.assertEqual(label, "worker")
                self.assertEqual(argv[:6], [
                    str(worker_python), "-B", "-m", "jason.apps.studio.worker_cli",
                    "--lane", "all",
                ])
                self.assertEqual(argv[argv.index("--max-tasks") + 1], "1")
                self.assertEqual(argv[argv.index("--max-attempts") + 1], "1")
                self.assertEqual(argv[argv.index("--max-concurrent-dispatches") + 1], "1")
                self.assertEqual(argv[argv.index("--allowed-project-id") + 1], "project-one")
                self.assertEqual(argv[argv.index("--allowed-episode-id") + 1], "episode-one")
                self.assertIn("--allow-existing-provider-poll", argv)
                self.assertNotIn("--allow-new-provider-dispatch", argv)
                self.assertEqual(env["JWT_SECRET"], "instance-signing-secret")
                self.assertEqual(env["APP_ENV"], "production")
                self.assertEqual(env["WORKER_CREATIVE_FRESHNESS_ENFORCE"], "false")
                self.assertEqual(env["ALLOW_PAID"], "true")
                self.assertTrue(supervisor._project_production_active)
                supervisor.start_asset_worker()
                self.assertIsNone(supervisor.assetWorker)
                local.write_json(
                    supervisor._asset_activation_binding_path(),
                    {
                        "schema": "qingmu.asset-parent-activation.v1",
                        "instanceId": "unit-worker",
                        "parentTaskId": "legacy-asset-parent",
                    },
                )
                supervisor.api = child
                supervisor.host = child
                supervisor.frontend = child
                supervisor.ports = {"apiUrl": "http://127.0.0.1:1"}
                with patch.object(supervisor, "_asset_parent_locally_terminal", return_value=False), \
                     patch.object(supervisor, "api_identity", return_value={"verified": True}), \
                     patch.object(supervisor, "host_healthy", return_value=True), \
                     patch.object(supervisor, "frontend_healthy", return_value=True), \
                     patch.object(local, "build_manifest_status", return_value={"matches": True}):
                    status = supervisor.status()
                self.assertFalse(status["assetWorkerProcessAlive"])
                self.assertTrue(status["ready"])
            finally:
                local.stop_child(child)

    @unittest.skipUnless(os.environ.get("QINGMU_WRITER_TEST_ROOT"), "requires Writer source and its Python environment")
    def test_project_worker_dispatch_inlines_only_instance_signed_local_images(self):
        writer = Path(os.environ["QINGMU_WRITER_TEST_ROOT"]).resolve()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            credential_env = root / "provider.env"
            credential_env.write_text("JWT_SECRET=credential-file-secret\nAPP_PUBLIC_BASE_URL=https://relay.example.test\n")
            credential_env.chmod(0o600)
            production = {
                "productionOnly": True, "provider": "dashscope", "projectId": "project-one",
                "episodeId": "episode-one", "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                "allowedStages": list(local.TEXT_FOUNDATION_STAGES), "credentialEnvFile": str(credential_env),
                "maxTasksPerTick": 1, "maxAttempts": 1, "allowExistingProviderPoll": True,
                "textFoundationParentTaskId": None, "assetReferenceParentTaskId": None,
            }
            config = {
                "instanceId": "media-signature-test", "root": str(root), "yimengRoot": str(writer),
                "jwtSecret": "instance-signing-secret", "textFoundationProductionExecution": production,
                "projectProductionExecution": {
                    "active": True, "projectId": "project-one", "episodeId": "episode-one",
                    "maxTasksPerTick": 1, "maxAttempts": 1, "maxConcurrentDispatches": 1,
                    "allowExistingProviderPoll": True,
                },
            }
            supervisor = local.Supervisor(root, config)
            with patch.dict("os.environ", {"JWT_SECRET": "ambient-signing-secret"}), \
                 patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), \
                 patch.object(supervisor, "launch_owned", return_value=Mock(poll=lambda: None)) as launch:
                supervisor.start_worker()
            _role, argv, env, _label = launch.call_args.args
            # Probe the captured production launch environment in a fresh interpreter.
            # Only generated images and in-memory metadata exist; sockets are forbidden.
            probe = r'''
import copy, hashlib, json, socket
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

def deny_network(*args, **kwargs):
    raise AssertionError("network forbidden in media-signature regression")
socket.socket.connect = deny_network
socket.create_connection = deny_network
from PIL import Image
from jason.config import get_settings
from jason.apps.studio.provider_media_access import provider_media_url
from jason.apps.studio.provider_worker_service import ProviderWorkerService
from jason.providers.dashscope_payloads import DashScopePayloadBuilder

settings = get_settings()
storage = Path(settings.storage_root)
(storage / "assets").mkdir(parents=True)
assets, media, references = [], {}, []
for index, size in enumerate([(256, 384), (384, 256)]):
    path = storage / "assets" / f"{index}.png"
    Image.new("RGBA", size, (20 + index, 40, 60, 254)).save(path)
    asset_id, media_id = f"asset-{index}", f"media-{index}"
    local_path = f"storage/assets/{index}.png"
    assets.append({"id": asset_id, "project_id": "project-one", "episode_id": "episode-one",
        "asset_type": "image", "mime_type": "image/png", "local_path": local_path,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    media[asset_id] = [{"id": media_id, "asset_id": asset_id, "media_kind": "image_generation",
        "local_path": local_path}]
    references.append(provider_media_url("https://relay.example.test", media_id,
        "instance-signing-secret", 900))
store = SimpleNamespace(list_assets=lambda project_id: [a for a in assets if a["project_id"] == project_id],
    list_provider_media=lambda *, asset_id: media[asset_id])
worker = ProviderWorkerService.__new__(ProviderWorkerService)
worker.registry = SimpleNamespace(settings=settings)
worker.video_service = SimpleNamespace(store=store, storage_root=storage)
payload = {"project_id": "project-one", "episode_id": "episode-one", "snapshot":
    DashScopePayloadBuilder(settings).build(capability="image.generate", model="wan2.7-image-pro",
        payload={"prompt": "synthetic driving portrait", "size": "1152*2048", "n": 1,
            "reference_urls": references})}
original = copy.deepcopy(payload)
refreshed = worker._refresh_internal_media_urls_for_dispatch(payload, image_reference_variant="provider-image-ref-v1")
envelope = worker._final_dashscope_image_transport_envelope(
    {"provider": "dashscope", "capability": "image.generate"}, refreshed)
assert [i["scheme"] for i in envelope["images"]] == ["data", "data"], "signed references remained HTTPS"
assert settings.jwt_secret == "instance-signing-secret", "Worker did not use the instance secret"
assert [(i["width"], i["height"]) for i in envelope["images"]] == [(256, 384), (384, 256)]
assert [i["mimeType"] for i in envelope["images"]] == ["image/jpeg", "image/jpeg"]
assert payload == original, "durable input changed during transport compilation"
for invalid in ["ambient-signing-secret", "credential-file-secret"]:
    forged = copy.deepcopy(payload)
    for i in range(2):
        forged["snapshot"]["body"]["input"]["messages"][0]["content"][i]["image"] = provider_media_url(
            "https://relay.example.test", f"media-{i}", invalid, 900)
    # A rejected signature must not even enter local asset resolution.
    with patch.object(
            worker, "_local_reference_image_data_url", side_effect=AssertionError("untrusted local read")):
        assert worker._refresh_internal_media_urls_for_dispatch(forged) == forged
for field, value, expected in [("project_id", "other-project", "local_reference_media_scope_not_found"),
                               ("episode_id", "other-episode", "local_reference_media_scope_mismatch")]:
    wrong_scope = {**payload, field: value}
    try:
        worker._refresh_internal_media_urls_for_dispatch(wrong_scope)
    except ValueError as error:
        assert str(error) == expected
    else:
        raise AssertionError("out-of-scope asset accepted")
assets[0]["sha256"] = "0" * 64
try:
    worker._refresh_internal_media_urls_for_dispatch(payload)
except ValueError as error:
    assert str(error) == "local_reference_image_sha_drift"
else:
    raise AssertionError("asset SHA drift accepted")
print(json.dumps({"instanceSecretUsed": True, "validImagesInlined": 2,
    "invalidSignaturesUnchanged": True, "scopeAndShaChecksPreserved": True, "networkCalls": 0}))
'''
            result = subprocess.run([argv[0], "-B", "-c", probe], env=env, cwd=root,
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), {
                "instanceSecretUsed": True, "validImagesInlined": 2,
                "invalidSignaturesUnchanged": True, "scopeAndShaChecksPreserved": True, "networkCalls": 0,
            })

    def test_project_production_validator_rejects_broader_or_malformed_authority(self):
        valid = {
            "active": False,
            "projectId": "project-one",
            "episodeId": "episode-one",
            "maxTasksPerTick": 1,
            "maxAttempts": 1,
            "maxConcurrentDispatches": 1,
            "allowExistingProviderPoll": True,
        }
        self.assertEqual(local.validate_project_production_config(valid), valid)
        for invalid in (
            {**valid, "maxTasksPerTick": 2},
            {**valid, "maxTasksPerTick": True},
            {**valid, "allowExistingProviderPoll": False},
            {**valid, "extraScope": "all"},
        ):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "项目 production"):
                local.validate_project_production_config(invalid)

    def test_bound_text_worker_is_parent_bound_and_never_uses_all_lane(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            credential_env = parent / "provider.env"
            for part in ("logs", "home", "work", "dsh", "private", "storage", "audit", "build-manifest"):
                (root / part).mkdir(parents=True, exist_ok=True)
            credential_env.write_text("DASHSCOPE_API_KEY=not-read-by-this-test\n")
            credential_env.chmod(0o600)
            worker_python = writer / ".venv/bin/python"
            worker_python.parent.mkdir(parents=True)
            worker_python.write_text("not executed")
            production = {
                "productionOnly": True,
                "provider": "dashscope",
                "projectId": "project-one",
                "episodeId": "episode-one",
                "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                "allowedStages": list(local.TEXT_FOUNDATION_STAGES),
                "credentialEnvFile": str(credential_env),
                "maxTasksPerTick": 1,
                "maxAttempts": 1,
                "allowExistingProviderPoll": True,
                "textFoundationParentTaskId": "text-parent-one",
                "assetReferenceParentTaskId": None,
            }
            supervisor = local.Supervisor(root, {
                "instanceId": "unit-worker",
                "root": str(root),
                "jwtSecret": "instance-signing-secret", "yimengRoot": str(writer),
                "textFoundationProductionExecution": production,
            })
            child = subprocess.Popen(["/bin/sleep", "30"])
            try:
                with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), \
                     patch.dict("os.environ", {"DEEPSEEK_API_KEY": "ambient-must-not-pass"}, clear=False), \
                     patch.object(supervisor, "launch", return_value=child) as launch:
                    supervisor.start_worker()
                argv, env, label = launch.call_args.args
                self.assertEqual(label, "worker")
                self.assertEqual(env["ALLOW_PAID"], "true")
                self.assertEqual(env["MAX_PAID_CNY"], str(local.QINGMU_LOCAL_REMAINING_PAID_CNY))
                self.assertEqual(env["PROVIDER_BUDGET_BASELINE_CNY"], "0")
                self.assertEqual(env["PROVIDER_BUDGET_WINDOW_ID"], "")
                self.assertEqual(env["PROVIDER_PAID_SCOPE_REQUIRED"], "true")
                self.assertEqual(env["JASON_ENV_FILE"], str(credential_env))
                self.assertEqual(env["PROVIDER_PAID_SCOPE_PROJECT_ID"], "project-one")
                self.assertEqual(env["PROVIDER_PAID_SCOPE_EPISODE_ID"], "episode-one")
                self.assertNotIn("DEEPSEEK_API_KEY", env)
                self.assertEqual(argv[:6], [
                    str(worker_python), "-B", "-m", "jason.apps.studio.worker_cli",
                    "--lane", "text",
                ])
                self.assertIn("--allow-existing-provider-poll", argv)
                self.assertEqual(argv[argv.index("--allowed-parent-task-id") + 1], "text-parent-one")
                self.assertNotIn("--asset-reference-batch-only", argv)
                self.assertEqual(argv[argv.index("--max-tasks") + 1], "1")
                self.assertEqual(argv[argv.index("--max-attempts") + 1], "1")
                self.assertEqual(argv[argv.index("--allowed-project-id") + 1], "project-one")
                self.assertEqual(argv[argv.index("--allowed-episode-id") + 1], "episode-one")
                self.assertEqual(
                    [argv[index + 1] for index, value in enumerate(argv) if value == "--allowed-foundation-stage"],
                    list(local.TEXT_FOUNDATION_STAGES),
                )
            finally:
                local.stop_child(child)

    def test_terminal_bound_text_parent_starts_heartbeat_without_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            credential_env = parent / "provider.env"
            for part in ("logs", "home", "work", "dsh", "private", "storage", "audit", "build-manifest"):
                (root / part).mkdir(parents=True, exist_ok=True)
            worker_python = writer / ".venv/bin/python"
            worker_python.parent.mkdir(parents=True)
            worker_python.write_text("not executed")
            credential_env.write_text("DASHSCOPE_API_KEY=not-read-by-this-test\n")
            credential_env.chmod(0o600)
            production = {
                "productionOnly": True, "provider": "dashscope", "projectId": "project-one",
                "episodeId": "episode-one", "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                "allowedStages": list(local.TEXT_FOUNDATION_STAGES),
                "credentialEnvFile": str(credential_env), "maxTasksPerTick": 1,
                "maxAttempts": 1, "allowExistingProviderPoll": True,
                "textFoundationParentTaskId": "text-parent-one", "assetReferenceParentTaskId": None,
            }
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute(
                    "CREATE TABLE generation_tasks (id TEXT, capability TEXT, local_status TEXT, "
                    "provider_status TEXT, request_payload_json TEXT)"
                )
                connection.execute(
                    "INSERT INTO generation_tasks VALUES (?, ?, ?, ?, ?)",
                    ("text-parent-one", "workflow.text_foundation", "succeeded", "SUCCEEDED", json.dumps({
                        "project_id": "project-one", "episode_id": "episode-one",
                        "target_stage": local.TEXT_FOUNDATION_STAGES[0],
                    })),
                )
            supervisor = local.Supervisor(root, {
                "instanceId": "unit-terminal-text", "root": str(root), "jwtSecret": "instance-signing-secret", "yimengRoot": str(writer),
                "textFoundationProductionExecution": production,
            })
            child = subprocess.Popen(["/bin/sleep", "30"])
            try:
                with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), \
                     patch.object(supervisor, "launch", return_value=child) as launch:
                    supervisor.start_worker()
                argv, env, label = launch.call_args.args
                self.assertEqual(label, "worker")
                self.assertIn("--heartbeat-only", argv)
                self.assertNotIn("--allowed-parent-task-id", argv)
                self.assertEqual(env["ALLOW_PAID"], "false")
                self.assertEqual(env["JASON_ENV_FILE"], str(root / "private/no-ambient.env"))
                self.assertTrue(supervisor._text_worker_heartbeat_only)
                self.assertEqual(
                    supervisor.config["textFoundationProductionExecution"]["textFoundationParentTaskId"],
                    "text-parent-one",
                )
            finally:
                local.stop_child(child)

    def test_exited_terminal_text_worker_becomes_heartbeat_only(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            credential_env = parent / "provider.env"
            for part in ("logs", "home", "work", "dsh", "private", "storage", "audit", "build-manifest"):
                (root / part).mkdir(parents=True, exist_ok=True)
            worker_python = writer / ".venv/bin/python"
            worker_python.parent.mkdir(parents=True)
            worker_python.write_text("not executed")
            credential_env.write_text("DASHSCOPE_API_KEY=not-read-by-this-test\n")
            credential_env.chmod(0o600)
            production = {
                "productionOnly": True, "provider": "dashscope", "projectId": "project-one",
                "episodeId": "episode-one", "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                "allowedStages": list(local.TEXT_FOUNDATION_STAGES),
                "credentialEnvFile": str(credential_env), "maxTasksPerTick": 1,
                "maxAttempts": 1, "allowExistingProviderPoll": True,
                "textFoundationParentTaskId": "text-parent-one", "assetReferenceParentTaskId": None,
            }
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute(
                    "CREATE TABLE generation_tasks (id TEXT, capability TEXT, local_status TEXT, "
                    "provider_status TEXT, request_payload_json TEXT)"
                )
                connection.execute(
                    "INSERT INTO generation_tasks VALUES (?, ?, ?, ?, ?)",
                    ("text-parent-one", "workflow.text_foundation", "succeeded", "SUCCEEDED", json.dumps({
                        "project_id": "project-one", "episode_id": "episode-one",
                        "target_stage": local.TEXT_FOUNDATION_STAGES[0],
                    })),
                )
            supervisor = local.Supervisor(root, {
                "instanceId": "unit-terminal-text", "root": str(root), "jwtSecret": "instance-signing-secret", "yimengRoot": str(writer),
                "textFoundationProductionExecution": production,
            })
            completed = subprocess.Popen(["/usr/bin/true"])
            completed.wait(timeout=5)
            heartbeat = subprocess.Popen(["/bin/sleep", "30"])
            supervisor.worker = completed
            supervisor._text_worker_heartbeat_only = False
            try:
                with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), \
                     patch.object(supervisor, "launch", return_value=heartbeat) as launch:
                    self.assertTrue(supervisor._reap_terminal_text_worker())
                argv, env, label = launch.call_args.args
                self.assertEqual(label, "worker")
                self.assertIn("--heartbeat-only", argv)
                self.assertEqual(env["ALLOW_PAID"], "false")
                self.assertIs(supervisor.worker, heartbeat)
                self.assertTrue(supervisor._text_worker_heartbeat_only)
            finally:
                local.stop_child(heartbeat)

    def test_text_worker_terminal_downgrade_rejects_unknown_or_scope_drift(self):
        for capability, provider_status, payload in (
            ("workflow.text_foundation", "UNKNOWN", {
                "project_id": "project-one", "episode_id": "episode-one",
                "target_stage": local.TEXT_FOUNDATION_STAGES[0],
            }),
            ("workflow.text_foundation", "SUCCEEDED", {
                "project_id": "wrong-project", "episode_id": "episode-one",
                "target_stage": local.TEXT_FOUNDATION_STAGES[0],
            }),
            ("workflow.other", "SUCCEEDED", {
                "project_id": "project-one", "episode_id": "episode-one",
                "target_stage": local.TEXT_FOUNDATION_STAGES[0],
            }),
        ):
            with self.subTest(capability=capability, provider_status=provider_status, payload=payload), \
                 tempfile.TemporaryDirectory() as directory:
                    parent = Path(directory)
                    root = parent / "instance"
                    for part in ("private", "storage"):
                        (root / part).mkdir(parents=True, exist_ok=True)
                    production = {
                        "productionOnly": True, "provider": "dashscope", "projectId": "project-one",
                        "episodeId": "episode-one", "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                        "allowedStages": list(local.TEXT_FOUNDATION_STAGES),
                        "credentialEnvFile": str(local.YIMENG_PROVIDER_ENV_FILE), "maxTasksPerTick": 1,
                        "maxAttempts": 1, "allowExistingProviderPoll": True,
                        "textFoundationParentTaskId": "text-parent-one", "assetReferenceParentTaskId": None,
                    }
                    with sqlite3.connect(root / "storage/jason.db") as connection:
                        connection.execute(
                            "CREATE TABLE generation_tasks (id TEXT, capability TEXT, local_status TEXT, "
                            "provider_status TEXT, request_payload_json TEXT)"
                        )
                        connection.execute(
                            "INSERT INTO generation_tasks VALUES (?, ?, ?, ?, ?)",
                            ("text-parent-one", capability, "succeeded", provider_status, json.dumps(payload)),
                        )
                    supervisor = local.Supervisor(root, {
                        "instanceId": "unit-text-fail-closed", "root": str(root),
                        "textFoundationProductionExecution": production,
                    })
                    completed = subprocess.Popen(["/usr/bin/true"])
                    completed.wait(timeout=5)
                    supervisor.worker = completed
                    self.assertFalse(supervisor._reap_terminal_text_worker())
                    self.assertIs(supervisor.worker, completed)

    def test_asset_worker_is_exact_parent_bound_and_not_started_without_one(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            credential_env = parent / "provider.env"
            for part in ("logs", "home", "work", "dsh", "private", "storage", "audit", "build-manifest"):
                (root / part).mkdir(parents=True, exist_ok=True)
            (writer / ".venv/bin").mkdir(parents=True)
            (writer / ".venv/bin/python").write_text("not executed")
            credential_env.write_text("DASHSCOPE_API_KEY=not-read-by-this-test\n")
            credential_env.chmod(0o600)
            production = {
                "productionOnly": True, "provider": "dashscope", "projectId": "project-one",
                "episodeId": "episode-one", "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                "allowedStages": list(local.TEXT_FOUNDATION_STAGES),
                "credentialEnvFile": str(credential_env), "maxTasksPerTick": 1,
                "maxAttempts": 1, "allowExistingProviderPoll": True,
                "textFoundationParentTaskId": None,
                "assetReferenceParentTaskId": "asset-parent-one",
            }
            supervisor = local.Supervisor(root, {
                "instanceId": "unit-asset-worker", "root": str(root), "jwtSecret": "instance-signing-secret", "yimengRoot": str(writer),
                "textFoundationProductionExecution": production,
            })
            child = subprocess.Popen(["/bin/sleep", "30"])
            try:
                with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), \
                     patch.object(supervisor, "launch", return_value=child) as launch:
                    supervisor.start_asset_worker()
                argv, env, label = launch.call_args.args
                self.assertEqual(label, "asset-worker")
                self.assertEqual(argv[:6], [
                    str(writer / ".venv/bin/python"), "-B", "-m",
                    "jason.apps.studio.worker_cli", "--lane", "image",
                ])
                self.assertIn("--asset-reference-batch-only", argv)
                self.assertEqual(
                    argv[argv.index("--allowed-asset-reference-parent-task-id") + 1],
                    "asset-parent-one",
                )
                self.assertNotIn("all", argv)
                self.assertEqual(env["PROVIDER_PAID_SCOPE_PROJECT_ID"], "project-one")
                supervisor.config["textFoundationProductionExecution"] = {
                    **production, "assetReferenceParentTaskId": None,
                }
                supervisor.assetWorker = None
                with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env):
                    supervisor.start_asset_worker()
                self.assertIsNone(supervisor.assetWorker)
            finally:
                local.stop_child(child)

    def test_asset_activation_rejects_wrong_parent_scope_without_starting_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            credential_env = parent / "provider.env"
            for part in ("logs", "home", "work", "dsh", "private", "storage", "audit", "build-manifest"):
                (root / part).mkdir(parents=True, exist_ok=True)
            credential_env.write_text("DASHSCOPE_API_KEY=not-read-by-this-test\n")
            credential_env.chmod(0o600)
            manifest = [{"role": "actor", "sourceAssetSha256": "a" * 64}]
            manifest_hash = local.Supervisor._stable_json_sha256(manifest)
            payload = {
                "project_id": "project-one", "episode_id": "episode-one", "target_stage": "asset_reference_initial", "manifest": manifest,
                "source_lock_hash": "e" * 64, "call_plan_hash": manifest_hash,
            }
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute(
                    "CREATE TABLE generation_tasks (id TEXT, capability TEXT, route_key TEXT, model TEXT, local_status TEXT, request_payload_json TEXT)"
                )
                connection.execute(
                    "INSERT INTO generation_tasks VALUES (?, ?, ?, ?, ?, ?)",
                    ("parent-one", "workflow.asset_reference_batch", "pipeline.asset_reference_batch", "asset-reference-batch", "queued", json.dumps(payload)),
                )
            production = {
                "productionOnly": True, "provider": "dashscope", "projectId": "project-one",
                "episodeId": "episode-one", "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                "allowedStages": list(local.TEXT_FOUNDATION_STAGES), "credentialEnvFile": str(credential_env),
                "maxTasksPerTick": 1, "maxAttempts": 1, "allowExistingProviderPoll": True,
            }
            supervisor = local.Supervisor(root, {
                "instanceId": "unit-activation", "root": str(root), "yimengRoot": str(writer),
                "textFoundationProductionExecution": production,
            })
            request = {
                "parentTaskId": "parent-one", "projectId": "wrong-project", "episodeId": "episode-one",
                "manifestHash": manifest_hash, "callPlanHash": manifest_hash,
            }
            with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), \
                 patch.object(supervisor, "start_asset_worker") as start_worker:
                with self.assertRaisesRegex(ValueError, "范围"):
                    supervisor.activate_asset_parent(request)
            start_worker.assert_not_called()

    def test_asset_activation_is_idempotent_and_refuses_different_active_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            credential_env = parent / "provider.env"
            for part in ("logs", "home", "work", "dsh", "private", "storage", "audit", "build-manifest"):
                (root / part).mkdir(parents=True, exist_ok=True)
            credential_env.write_text("DASHSCOPE_API_KEY=not-read-by-this-test\n")
            credential_env.chmod(0o600)
            manifest = [{"role": "scene", "sourceAssetSha256": "c" * 64}]
            manifest_hash = local.Supervisor._stable_json_sha256(manifest)
            payload = {
                "project_id": "project-one", "episode_id": "episode-one", "target_stage": "asset_reference_audit", "manifest": manifest,
                "source_lock_hash": "f" * 64, "call_plan_hash": manifest_hash,
            }
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute(
                    "CREATE TABLE generation_tasks (id TEXT, capability TEXT, route_key TEXT, model TEXT, local_status TEXT, request_payload_json TEXT)"
                )
                for task_id in ("parent-one", "parent-two"):
                    connection.execute(
                        "INSERT INTO generation_tasks VALUES (?, ?, ?, ?, ?, ?)",
                        (task_id, "workflow.asset_reference_batch", "pipeline.asset_reference_audit_batch", "asset-reference-audit-batch", "queued", json.dumps(payload)),
                    )
            production = {
                "productionOnly": True, "provider": "dashscope", "projectId": "project-one",
                "episodeId": "episode-one", "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                "allowedStages": list(local.TEXT_FOUNDATION_STAGES), "credentialEnvFile": str(credential_env),
                "maxTasksPerTick": 1, "maxAttempts": 1, "allowExistingProviderPoll": True,
                "textFoundationParentTaskId": None, "assetReferenceParentTaskId": None,
            }
            config = {
                "instanceId": "unit-activation", "root": str(root), "yimengRoot": str(writer),
                "textFoundationProductionExecution": production,
            }
            supervisor = local.Supervisor(root, config)
            request = {
                "parentTaskId": "parent-one", "projectId": "project-one", "episodeId": "episode-one",
                "manifestHash": manifest_hash, "callPlanHash": manifest_hash,
            }
            with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), \
                 patch.object(local, "read_config", return_value=config), \
                 patch.object(supervisor, "start_asset_worker") as start_worker:
                first = supervisor.activate_asset_parent(request)
                second = supervisor.activate_asset_parent(request)
                with self.assertRaisesRegex(RuntimeError, "不同资产 parent"):
                    supervisor.activate_asset_parent({**request, "parentTaskId": "parent-two"})
            self.assertFalse(first["idempotent"])
            self.assertTrue(second["idempotent"])
            self.assertEqual(start_worker.call_count, 2)
            self.assertNotIn("assetActivationKey", json.dumps(first))
            saved = json.loads((root / "private/instance.json").read_text())
            saved_execution = saved["textFoundationProductionExecution"]
            self.assertIsNone(saved_execution["textFoundationParentTaskId"])
            self.assertEqual(saved_execution["assetReferenceParentTaskId"], "parent-one")
            with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env):
                self.assertEqual(
                    local.validate_text_foundation_production_config(saved_execution),
                    saved_execution,
                )

    def test_asset_activation_retry_accepts_running_and_terminal_same_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            credential_env = parent / "provider.env"
            for part in ("logs", "home", "work", "dsh", "private", "storage", "audit", "build-manifest"):
                (root / part).mkdir(parents=True, exist_ok=True)
            credential_env.write_text("DASHSCOPE_API_KEY=not-read-by-this-test\n")
            credential_env.chmod(0o600)
            manifest = [{"role": "scene", "sourceAssetSha256": "d" * 64}]
            manifest_hash = local.Supervisor._stable_json_sha256(manifest)
            payload = {
                "project_id": "project-one", "episode_id": "episode-one",
                "target_stage": "asset_reference_initial", "manifest": manifest,
                "source_lock_hash": "f" * 64, "call_plan_hash": manifest_hash,
            }
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute(
                    "CREATE TABLE generation_tasks (id TEXT, capability TEXT, route_key TEXT, model TEXT, local_status TEXT, provider_status TEXT, request_payload_json TEXT)"
                )
                connection.execute(
                    "INSERT INTO generation_tasks VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ("parent-one", "workflow.asset_reference_batch", "pipeline.asset_reference_batch", "asset-reference-batch", "queued", "QUEUED", json.dumps(payload)),
                )
            production = {
                "productionOnly": True, "provider": "dashscope", "projectId": "project-one",
                "episodeId": "episode-one", "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                "allowedStages": list(local.TEXT_FOUNDATION_STAGES), "credentialEnvFile": str(credential_env),
                "maxTasksPerTick": 1, "maxAttempts": 1, "allowExistingProviderPoll": True,
                "textFoundationParentTaskId": None, "assetReferenceParentTaskId": None,
            }
            config = {
                "instanceId": "unit-activation-retry", "root": str(root), "yimengRoot": str(writer),
                "textFoundationProductionExecution": production,
            }
            supervisor = local.Supervisor(root, config)
            request = {
                "parentTaskId": "parent-one", "projectId": "project-one", "episodeId": "episode-one",
                "manifestHash": manifest_hash, "callPlanHash": manifest_hash,
            }
            with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), \
                 patch.object(local, "read_config", return_value=config), \
                 patch.object(supervisor, "start_asset_worker") as start_worker:
                first = supervisor.activate_asset_parent(request)
                with sqlite3.connect(root / "storage/jason.db") as connection:
                    connection.execute(
                        "UPDATE generation_tasks SET local_status = 'running', provider_status = 'RUNNING' WHERE id = 'parent-one'"
                    )
                running_retry = supervisor.activate_asset_parent(request)
                with sqlite3.connect(root / "storage/jason.db") as connection:
                    connection.execute(
                        "UPDATE generation_tasks SET local_status = 'failed', provider_status = 'submission_unknown' WHERE id = 'parent-one'"
                    )
                terminal_retry = supervisor.activate_asset_parent(request)
            self.assertFalse(first["idempotent"])
            self.assertTrue(running_retry["idempotent"])
            self.assertTrue(terminal_retry["idempotent"])
            self.assertEqual(start_worker.call_count, 2)
            self.assertTrue(supervisor._asset_parent_locally_terminal(
                local._read_owner_only_json(
                    root / "private/asset-activation.json", "资产 parent 激活绑定"
                )
            ))
            self.assertFalse(supervisor._asset_parent_terminal_for_rollover(
                local._read_owner_only_json(
                    root / "private/asset-activation.json", "资产 parent 激活绑定"
                )
            ))

    def test_exited_asset_worker_is_reaped_only_after_bound_parent_terminal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "instance"
            for part in ("private", "storage"):
                (root / part).mkdir(parents=True, exist_ok=True)
            config = {
                "instanceId": "unit-terminal-reap",
                "root": str(root),
            }
            binding = {
                "schema": "qingmu.asset-parent-activation.v1",
                "instanceId": config["instanceId"],
                "parentTaskId": "parent-one",
                "projectId": "project-one",
                "episodeId": "episode-one",
                "manifestHash": "a" * 64,
                "callPlanHash": "a" * 64,
            }
            local.write_json(root / "private/asset-activation.json", binding)
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute(
                    "CREATE TABLE generation_tasks "
                    "(id TEXT, capability TEXT, local_status TEXT)"
                )
                connection.execute(
                    "INSERT INTO generation_tasks VALUES (?, ?, ?)",
                    ("parent-one", "workflow.asset_reference_batch", "succeeded"),
                )
            supervisor = local.Supervisor(root, config)
            supervisor.assetWorker = subprocess.Popen(
                ["/usr/bin/true"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            supervisor.assetWorker.wait(timeout=5)

            self.assertTrue(supervisor._reap_terminal_asset_worker())
            self.assertIsNone(supervisor.assetWorker)

            supervisor.assetWorker = subprocess.Popen(
                ["/usr/bin/false"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            supervisor.assetWorker.wait(timeout=5)
            self.assertFalse(supervisor._reap_terminal_asset_worker())
            self.assertIsNotNone(supervisor.assetWorker)

    def test_asset_activation_rolls_terminal_initial_parent_to_audit_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            credential_env = parent / "provider.env"
            for part in ("logs", "home", "work", "dsh", "private", "storage", "audit", "build-manifest"):
                (root / part).mkdir(parents=True, exist_ok=True)
            credential_env.write_text("DASHSCOPE_API_KEY=not-read-by-this-test\n")
            credential_env.chmod(0o600)
            manifest = [{"role": "actor", "sourceAssetSha256": "a" * 64}]
            manifest_hash = local.Supervisor._stable_json_sha256(manifest)
            initial = {"project_id": "project-one", "episode_id": "episode-one", "target_stage": "asset_reference_initial", "manifest": manifest, "source_lock_hash": "e" * 64, "call_plan_hash": manifest_hash}
            audit = {**initial, "target_stage": "asset_reference_audit"}
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute("CREATE TABLE generation_tasks (id TEXT, capability TEXT, route_key TEXT, model TEXT, local_status TEXT, provider_status TEXT, request_payload_json TEXT)")
                connection.execute("INSERT INTO generation_tasks VALUES (?, ?, ?, ?, ?, ?, ?)", ("initial-parent", "workflow.asset_reference_batch", "pipeline.asset_reference_batch", "asset-reference-batch", "succeeded", "SUCCEEDED", json.dumps(initial)))
                connection.execute("INSERT INTO generation_tasks VALUES (?, ?, ?, ?, ?, ?, ?)", ("audit-parent", "workflow.asset_reference_batch", "pipeline.asset_reference_audit_batch", "asset-reference-audit-batch", "queued", "QUEUED", json.dumps(audit)))
            production = {"productionOnly": True, "provider": "dashscope", "projectId": "project-one", "episodeId": "episode-one", "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY, "allowedStages": list(local.TEXT_FOUNDATION_STAGES), "credentialEnvFile": str(credential_env), "maxTasksPerTick": 1, "maxAttempts": 1, "allowExistingProviderPoll": True, "textFoundationParentTaskId": None, "assetReferenceParentTaskId": "initial-parent"}
            config = {"instanceId": "unit-rollover", "root": str(root), "yimengRoot": str(writer), "textFoundationProductionExecution": production}
            local.write_json(root / "private/asset-activation.json", {"schema": "qingmu.asset-parent-activation.v1", "instanceId": "unit-rollover", "parentTaskId": "initial-parent", "projectId": "project-one", "episodeId": "episode-one", "manifestHash": manifest_hash, "callPlanHash": manifest_hash})
            supervisor = local.Supervisor(root, config)
            request = {"parentTaskId": "audit-parent", "projectId": "project-one", "episodeId": "episode-one", "manifestHash": manifest_hash, "callPlanHash": manifest_hash}
            with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), patch.object(local, "read_config", return_value=config), patch.object(supervisor, "start_asset_worker") as start_worker:
                result = supervisor.activate_asset_parent(request)
            self.assertEqual(result["parentTaskId"], "audit-parent")
            self.assertFalse(result["idempotent"])
            self.assertEqual(start_worker.call_count, 1)

    def test_bind_project_runtime_writes_only_scoped_authority_and_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            credential_env = parent / "provider.env"
            for part in ("private", "storage", "audit", "logs", "home", "work", "dsh", "build-manifest"):
                (root / part).mkdir(parents=True, mode=0o700, exist_ok=True)
            root.chmod(0o700)
            credential_env.write_text("DASHSCOPE_API_KEY=not-read-by-this-test\n")
            credential_env.chmod(0o600)
            config = {
                "version": 1,
                "instanceId": "binding-instance",
                "root": str(root),
                "harnessRoot": str(local.HARNESS),
                "yimengRoot": str(parent / "writer"),
                "coreRoot": str(parent / "core"),
                "node": "/private/node",
                "frontendNode": "/private/node20",
                **{name: local.secrets.token_urlsafe(48) for name in local.PRIVATE_CREDENTIAL_FIELDS},
            }
            local.write_json(root / "private/instance.json", config)
            local.write_json(root / "private/login.json", {"username": local.LOCAL_USERNAME, "password": "unused"})
            local.mark_lifecycle(root, config, "clean")
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute("CREATE TABLE projects (id TEXT PRIMARY KEY, owner TEXT)")
                connection.execute("CREATE TABLE episodes (id TEXT PRIMARY KEY, project_id TEXT)")
                connection.execute("INSERT INTO projects VALUES (?, ?)", ("project-one", "owner-one"))
                connection.execute("INSERT INTO episodes VALUES (?, ?)", ("episode-one", "project-one"))
            method = {
                "version": "method.v1",
                "methodPackageSha256": "a" * 64,
                "sourceBindings": [],
            }
            credential = {
                "available": True,
                "provider": "deepseek-official",
                "model": "deepseek-v4-pro",
            }
            with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), \
                 patch.object(local, "node20_executable", return_value="/private/node20"), \
                 patch.object(local, "_probe_director_credential", return_value=credential) as probe, \
                 patch.object(local, "_probe_director_method", return_value=method):
                receipt = local.bind_project_runtime(
                    root,
                    config,
                    expected_instance_id="binding-instance",
                    project_id="project-one",
                    episode_id="episode-one",
                    max_paid_cny=local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                )
            probe.assert_called_once()
            saved = json.loads((root / "private/instance.json").read_text())
            self.assertEqual(saved["textFoundationProductionExecution"]["projectId"], "project-one")
            self.assertIsNone(saved["textFoundationProductionExecution"]["textFoundationParentTaskId"])
            self.assertIsNone(saved["textFoundationProductionExecution"]["assetReferenceParentTaskId"])
            self.assertEqual(saved["directorProductionExecution"]["episodeId"], "episode-one")
            self.assertEqual(saved["projectProductionExecution"], {
                "active": False,
                "projectId": "project-one",
                "episodeId": "episode-one",
                "maxTasksPerTick": 1,
                "maxAttempts": 1,
                "maxConcurrentDispatches": 1,
                "allowExistingProviderPoll": True,
            })
            self.assertNotIn("apiKey", json.dumps(saved))
            self.assertEqual(receipt["providerHttpRequests"], 0)
            self.assertEqual(receipt["businessDatabaseWrites"], 0)
            self.assertEqual(receipt["scope"]["ownerPresent"], True)
            self.assertTrue(Path(receipt["receipt"]).is_file())

    def test_project_production_activation_is_stopped_scoped_and_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            credential_env = parent / "provider.env"
            for part in ("private", "storage", "audit", "logs", "home", "work", "dsh", "build-manifest"):
                (root / part).mkdir(parents=True, mode=0o700, exist_ok=True)
            root.chmod(0o700)
            credential_env.write_text("DASHSCOPE_API_KEY=not-read-by-this-test\n")
            credential_env.chmod(0o600)
            text_production = {
                "productionOnly": True,
                "provider": "dashscope",
                "projectId": "project-one",
                "episodeId": "episode-one",
                "maxPaidCny": local.QINGMU_LOCAL_REMAINING_PAID_CNY,
                "allowedStages": list(local.TEXT_FOUNDATION_STAGES),
                "credentialEnvFile": str(credential_env),
                "maxTasksPerTick": 1,
                "maxAttempts": 1,
                "allowExistingProviderPoll": True,
                "textFoundationParentTaskId": None,
                "assetReferenceParentTaskId": None,
            }
            config = {
                "version": 1,
                "instanceId": "activation-instance",
                "root": str(root),
                "harnessRoot": str(local.HARNESS),
                "yimengRoot": str(parent / "writer"),
                "coreRoot": str(parent / "core"),
                "node": "/private/node",
                "frontendNode": "/private/node20",
                "textFoundationProductionExecution": text_production,
                **{name: local.secrets.token_urlsafe(48) for name in local.PRIVATE_CREDENTIAL_FIELDS},
            }
            local.write_json(root / "private/instance.json", config)
            local.mark_lifecycle(root, config, "clean")
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute("CREATE TABLE projects (id TEXT PRIMARY KEY, owner TEXT)")
                connection.execute("CREATE TABLE episodes (id TEXT PRIMARY KEY, project_id TEXT)")
                connection.execute("INSERT INTO projects VALUES (?, ?)", ("project-one", "owner-one"))
                connection.execute("INSERT INTO episodes VALUES (?, ?)", ("episode-one", "project-one"))
            with patch.object(local, "YIMENG_PROVIDER_ENV_FILE", credential_env), \
                 patch.object(local, "node20_executable", return_value="/private/node20"):
                first = local.set_project_production_activation(
                    root,
                    config,
                    expected_instance_id="activation-instance",
                    project_id="project-one",
                    episode_id="episode-one",
                    active=True,
                )
                saved = json.loads((root / "private/instance.json").read_text())
                second = local.set_project_production_activation(
                    root,
                    saved,
                    expected_instance_id="activation-instance",
                    project_id="project-one",
                    episode_id="episode-one",
                    active=True,
                )
            self.assertTrue(first["active"])
            self.assertFalse(first["idempotent"])
            self.assertTrue(second["idempotent"])
            self.assertTrue(saved["projectProductionExecution"]["active"])
            self.assertEqual(first["providerHttpRequests"], 0)
            self.assertEqual(first["businessDatabaseWrites"], 0)

    def test_frontend_uses_bound_api_host_origin_and_private_session(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            writer = parent / "writer"
            frontend = writer / "frontend"
            for path in (root / "logs", root / "home", root / "work", root / "dsh", root / "private"):
                path.mkdir(parents=True, exist_ok=True)
            (frontend / ".next").mkdir(parents=True)
            (frontend / ".next/BUILD_ID").write_text("build")
            (frontend / "node_modules/next/dist/bin").mkdir(parents=True)
            (frontend / "node_modules/next/dist/bin/next").write_text("entry")
            local.write_json(root / "private/session.json", {"token": "private-session-token"})
            config = {
                "instanceId": "unit", "root": str(root), "yimengRoot": str(writer),
                "frontendNode": "/private/node20",
            }
            supervisor = local.Supervisor(root, config, review_only=True)
            supervisor.ports = {
                "apiUrl": "http://127.0.0.1:41001",
                "hostUrl": "http://127.0.0.1:41002",
                "webUrl": "http://127.0.0.1:41003",
                "webPort": 41003,
            }
            child = subprocess.Popen(["/bin/sleep", "30"])
            try:
                with patch.object(supervisor, "launch", return_value=child) as launch, \
                     patch.object(supervisor, "wait_ready"):
                    supervisor.start_frontend()
                argv, env, label = launch.call_args.args
                self.assertEqual(argv[:2], ["/private/node20", str(frontend / "node_modules/next/dist/bin/next")])
                self.assertEqual(argv[-4:], ["-H", "127.0.0.1", "-p", "41003"])
                self.assertEqual(label, "frontend")
                self.assertEqual(env["QINGMU_LOCAL_API_URL"], supervisor.ports["apiUrl"])
                self.assertEqual(env["QINGMU_DSH_HOST_URL"], supervisor.ports["hostUrl"])
                self.assertEqual(env["QINGMU_LOCAL_PUBLIC_ORIGIN"], supervisor.ports["webUrl"])
                self.assertEqual(env["QINGMU_LOCAL_SESSION_TOKEN"], "private-session-token")
                self.assertEqual(env["QINGMU_REVIEW_ONLY"], "1")
                self.assertEqual(env["QINGMU_DSH_HOST_DISABLED"], "1")
                self.assertEqual(launch.call_args.kwargs["cwd"], frontend)
            finally:
                local.stop_child(child)

    def test_review_only_host_omits_dispatch_configuration_and_authority_if_called(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            harness = parent / "harness"
            for path in (root / "private", root / "logs", root / "work"):
                path.mkdir(parents=True, exist_ok=True)
            patch_file = harness / "packages/experimental/qingmu-web/cordis.patch.yml"
            patch_file.parent.mkdir(parents=True)
            patch_file.write_text("plugins: []\n")
            production = {
                "interactiveEnabled": True,
                "transportEnabled": True,
                "projectId": "project-one",
                "episodeId": "episode-one",
                "taskId": "task-one",
                "methodPackageVersion": "method.v1",
                "methodPackageSha256": "a" * 64,
                "credentialFile": "/private/credential-file",
            }
            supervisor = local.Supervisor(root, {
                "instanceId": "unit", "root": str(root), "coreRoot": str(parent / "core"),
                "node": "/private/node", "attestationKey": "attestation",
                "directorExecutionKey": "dispatch-authority",
                "editorialHandoffKey": "editorial-authority",
                "directorProductionExecution": production,
            }, review_only=True)
            supervisor.ports = {"apiUrl": "http://127.0.0.1:41001", "hostUrl": "http://127.0.0.1:41002", "hostPort": 41002}
            child = subprocess.Popen(["/bin/sleep", "30"])
            try:
                with patch.object(local, "HARNESS", harness), \
                     patch.object(supervisor, "launch", return_value=child) as launch, \
                     patch.object(supervisor, "wait_ready"), \
                     patch.object(local, "require_native_director_preset") as preset_check, \
                     patch.object(local, "ensure_qingmu_workspace"):
                    local.local_director_profile(root, install=True)
                    supervisor.start_host()
                _argv, env, _label = launch.call_args.args
                overlay = (root / "private/local.patch.yml").read_text()
                self.assertEqual(env["QINGMU_REVIEW_ONLY"], "1")
                self.assertNotIn("QINGMU_DIRECTOR_EXECUTION_KEY", env)
                self.assertNotIn("QINGMU_EDITORIAL_HANDOFF_KEY", env)
                self.assertNotIn("directorProductionInteractiveEnabled", overlay)
                self.assertNotIn("directorProductionTransportEnabled", overlay)
                self.assertNotIn("credentials", overlay)
                self.assertNotIn("insert:", overlay)
                preset_check.assert_called_once_with("http://127.0.0.1:41002")
            finally:
                local.stop_child(child)

    def test_review_only_run_starts_no_workers_or_host_and_marks_api_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for path in (root / "private", root / "logs", root / "work"):
                path.mkdir(parents=True, exist_ok=True)
            config = {
                "instanceId": "unit-review", "root": str(root), "controlKey": "control-key",
                "yimengRoot": str(root / "writer"), "assetActivationKey": "asset-key",
            }
            supervisor = local.Supervisor(root, config, review_only=True)
            api = subprocess.Popen(["/bin/sleep", "30"])
            frontend = subprocess.Popen(["/bin/sleep", "30"])
            try:
                def start_frontend():
                    supervisor.frontend = frontend

                with patch.object(supervisor, "launch", return_value=api) as launch, \
                     patch.object(supervisor, "wait_ready"), \
                     patch.object(supervisor, "start_worker", side_effect=AssertionError("worker must stay stopped")), \
                     patch.object(supervisor, "start_asset_worker", side_effect=AssertionError("asset worker must stay stopped")), \
                     patch.object(supervisor, "start_host", side_effect=AssertionError("host must stay stopped")), \
                     patch.object(supervisor, "start_frontend", side_effect=start_frontend), \
                     patch.object(supervisor, "status", return_value={"reviewOnly": True}), \
                     patch.object(local, "require_clean"), \
                     patch.object(local, "mark_lifecycle"), \
                     patch.object(local, "mark_build_started"), \
                     patch.object(local, "available_port", side_effect=[41001, 41002, 41003]):
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        running = pool.submit(supervisor.run)
                        result = None
                        for _ in range(100):
                            try:
                                result = local.control(root, config, "stop")
                                break
                            except (FileNotFoundError, ConnectionRefusedError):
                                time.sleep(0.01)
                        self.assertEqual(result["stopped"], True)
                        running.result(timeout=5)
                _argv, api_env, _label = launch.call_args.args
                self.assertEqual(api_env["QINGMU_REVIEW_ONLY"], "1")
                self.assertNotIn("QINGMU_ASSET_ACTIVATION_SOCKET", api_env)
                self.assertNotIn("QINGMU_ASSET_ACTIVATION_KEY", api_env)
            finally:
                local.stop_child(api)
                local.stop_child(frontend)

    def test_review_only_status_is_ready_without_workers(self):
        class Child:
            def __init__(self, pid):
                self.pid = pid

            def poll(self):
                return None

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            supervisor = local.Supervisor(root, {"instanceId": "unit"}, review_only=True)
            supervisor.ports = {"apiUrl": "http://127.0.0.1:1"}
            supervisor.api, supervisor.frontend = Child(1), Child(4)
            with patch.object(supervisor, "api_identity", return_value={"instanceId": "unit"}), \
                 patch.object(supervisor, "host_healthy", return_value=True), \
                 patch.object(supervisor, "frontend_healthy", return_value=True), \
                 patch.object(local, "build_manifest_status", return_value={"matches": True}):
                status = supervisor.status()
            self.assertTrue(status["reviewOnly"])
            self.assertTrue(status["dispatchWorkersDisabled"])
            self.assertTrue(status["hostDisabledForReview"])
            self.assertFalse(status["workerProcessAlive"])
            self.assertTrue(status["ready"])

    def test_review_only_login_restarts_frontend_without_host(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            local.write_json(root / "private/login.json", {
                "username": local.LOCAL_USERNAME, "password": "isolated-password",
            })
            supervisor = local.Supervisor(root, {
                "instanceId": "unit", "controlKey": "control", "root": str(root),
            }, review_only=True)
            supervisor.ports = {"apiUrl": "http://127.0.0.1:41001"}
            with patch.object(supervisor, "api_identity"), \
                 patch.object(local, "http", return_value={"token": "new-session"}), \
                 patch.object(supervisor, "stop_owned") as stop_owned, \
                 patch.object(supervisor, "start_host", side_effect=AssertionError("host must stay stopped")), \
                 patch.object(supervisor, "start_frontend") as start_frontend, \
                 patch.object(supervisor, "status", return_value={"reviewOnly": True}):
                result = supervisor.login()
            stop_owned.assert_called_once_with("frontend")
            start_frontend.assert_called_once_with()
            self.assertTrue(result["reviewOnly"])

    def test_start_review_only_passes_private_supervisor_flag(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "logs").mkdir()
            (root / "private").mkdir()
            child = Mock()
            child.poll.return_value = None
            with patch.object(local, "control", side_effect=[FileNotFoundError, {"reviewOnly": True}]), \
                 patch.object(local, "require_clean"), \
                 patch.object(local, "require_build_manifest_matches"), \
                 patch.object(local.subprocess, "Popen", return_value=child) as popen:
                result = local.start(root, {"instanceId": "unit"}, review_only=True)
            self.assertTrue(result["reviewOnly"])
            self.assertIn("--review-only", popen.call_args.args[0])

    def test_review_only_refuses_existing_full_instance_without_spawn_or_stop(self):
        with patch.object(local, "control", return_value={"reviewOnly": False}) as control, \
             patch.object(local.subprocess, "Popen") as popen:
            with self.assertRaisesRegex(RuntimeError, "启动模式"):
                local.start(Path('/unused'), {}, review_only=True)
            popen.assert_not_called()
            self.assertEqual(control.call_args.args[-1], 'status')
            self.assertEqual(control.call_count, 1)

    def test_review_only_requires_api_gate_attestation(self):
        root = Path('/unused')
        supervisor = local.Supervisor(root, {"instanceId": "unit", "controlKey": "key"}, review_only=True)
        supervisor.api = Mock(pid=123)
        supervisor.ports = {"apiUrl": "http://127.0.0.1:1"}
        identity = {"instanceId": "unit", "pid": 123, "root": str(root),
                    "database": str(root / 'storage/jason.db'), "storage": str(root / 'storage')}
        for value in (identity, {**identity, "reviewOnly": False}):
            with patch.object(local, "http", return_value=value):
                with self.assertRaisesRegex(ValueError, "API身份"):
                    supervisor.api_identity()
        with patch.object(local, "http", return_value={**identity, "reviewOnly": True}):
            self.assertTrue(supervisor.api_identity()['reviewOnly'])

    def test_status_keeps_api_worker_host_and_frontend_diagnostics_independent(self):
        class Child:
            def __init__(self, pid):
                self.pid = pid

            def poll(self):
                return None

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            supervisor = local.Supervisor(root, {"instanceId": "unit"})
            supervisor.ports = {"apiUrl": "http://127.0.0.1:1"}
            supervisor.api, supervisor.worker, supervisor.host, supervisor.frontend = (
                Child(1), Child(2), Child(3), Child(4)
            )
            with patch.object(supervisor, "api_identity", side_effect=ValueError("api down")), \
                 patch.object(supervisor, "host_healthy", return_value=True), \
                 patch.object(supervisor, "frontend_healthy", return_value=True):
                status = supervisor.status()
            self.assertFalse(status["apiIdentityAndStorageVerified"])
            self.assertTrue(status["workerProcessAlive"])
            self.assertTrue(status["hostListenerAndHttpVerified"])
            self.assertTrue(status["frontendListenerAndHttpVerified"])
            self.assertFalse(status["ready"])

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

    def test_backup_carries_build_manifest_and_restore_reports_new_binding_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "instance"
            root.mkdir(mode=0o700)
            for part in ("private", "storage", "dsh", "audit", "backups", "build-manifest"):
                (root / part).mkdir(parents=True, mode=0o700, exist_ok=True)
            config = {
                "root": str(root), "harnessRoot": str(local.HARNESS),
                "yimengRoot": str(parent / "writer"), "coreRoot": str(parent / "core"),
                "instanceId": "source-instance", "controlKey": "control",
                "directorExecutionKey": "director", "jwtSecret": "jwt",
                "attestationKey": "attestation", "editorialHandoffKey": "editorial",
                "assetActivationKey": "asset-activation",
                "frontendNode": "/private/node20",
            }
            login = {"username": local.LOCAL_USERNAME, "password": local.secrets.token_urlsafe(32)}
            local.write_json(root / "private/instance.json", config)
            local.write_json(root / "private/login.json", login)
            local.write_json(root / "identity.json", {"kind": "test"})
            legacy_profile = root / "dsh/profiles/qingmu/package.json"
            legacy_profile.parent.mkdir(parents=True)
            local.write_json(legacy_profile, {"dsh": {"profile": {"bundles": local.LOCAL_PROFILE_BUNDLES[:2]}}})
            local.write_json(root / "build-manifest/current.json", {
                "schema": local.BUILD_MANIFEST_SCHEMA,
                "instance": {"instanceId": "source-instance"},
            })
            local.mark_lifecycle(root, config, "clean")
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute("CREATE TABLE sample (id INTEGER)")
                connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT)")
                connection.execute(
                    "INSERT INTO users VALUES (?, ?, ?)",
                    ("local-user", local.LOCAL_USERNAME, local._hash_local_password(login["password"])),
                )
            with patch.object(local, "node20_executable", return_value="/private/node20"):
                saved = local.backup(root)
                backup_root = Path(saved["backup"])
                manifest = json.loads((backup_root / "manifest.json").read_text())
                self.assertEqual(manifest["buildManifest"]["state"], "captured")
                self.assertIn("build-manifest/current.json", manifest["sha256"])
                target = parent / "restored"
                restored = local.restore(backup_root, target)
            self.assertTrue((target / "build-manifest/current.json").is_file())
            local.local_director_profile(target)
            self.assertEqual(json.loads(legacy_profile.read_text())["dsh"]["profile"]["bundles"],
                             local.LOCAL_PROFILE_BUNDLES[:2])
            self.assertFalse(restored["buildManifest"]["matches"])
            restored_config = json.loads((target / "private/instance.json").read_text())
            restored_login = json.loads((target / "private/login.json").read_text())
            self.assertTrue(all(
                not local.secrets.compare_digest(config[name], restored_config[name])
                for name in local.PRIVATE_CREDENTIAL_FIELDS
            ))
            self.assertFalse(local.secrets.compare_digest(login["password"], restored_login["password"]))
            with sqlite3.connect(target / "storage/jason.db") as connection:
                stored = connection.execute(
                    "SELECT password_hash FROM users WHERE username = ?", (local.LOCAL_USERNAME,)
                ).fetchone()[0]
            self.assertTrue(self.password_matches(restored_login["password"], stored))
            self.assertFalse(self.password_matches(login["password"], stored))
            self.assertFalse((target / "private/session.json").exists())

    def test_backup_reports_legacy_build_evidence_when_current_identity_is_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "instance"
            root.mkdir(mode=0o700)
            for part in ("private", "storage", "dsh", "audit", "backups", "build-manifest"):
                (root / part).mkdir(parents=True, mode=0o700, exist_ok=True)
            config = {
                "root": str(root), "harnessRoot": str(local.HARNESS),
                "instanceId": "legacy-instance", "controlKey": "control",
                "frontendNode": "/private/node20",
            }
            local.write_json(root / "private/instance.json", config)
            local.write_json(root / "identity.json", {"kind": "test"})
            local.write_json(root / "build-manifest/legacy-runtime.json", {"schema": "legacy-evidence"})
            local.mark_lifecycle(root, config, "clean")
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute("CREATE TABLE sample (id INTEGER)")
            with patch.object(local, "node20_executable", return_value="/private/node20"):
                saved = local.backup(root)
            self.assertEqual(saved["buildManifest"]["state"], "unknown_missing")
            self.assertEqual(
                saved["buildManifest"]["evidence"],
                ["build-manifest/legacy-runtime.json"],
            )

    def test_orphan_uncertainty_refuses_cold_backup_and_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            config = {
                "instanceId": "orphan", "root": str(root),
                "harnessRoot": str(local.HARNESS), "controlKey": "unit",
                "frontendNode": "/private/node20",
            }
            local.write_json(root / "private/instance.json", config)
            local.mark_lifecycle(root, config, "dirty")
            child = subprocess.Popen(["/bin/sleep", "30"])
            try:
                with patch.object(local, "node20_executable", return_value="/private/node20"):
                    for operation in (lambda: local.backup(root), lambda: local.start(root, config), lambda: local.require_clean(root, config)):
                        with self.assertRaisesRegex(RuntimeError, "状态未知"):
                            operation()
                self.assertIsNone(child.poll())
                self.assertFalse((root / "backups").exists())
            finally:
                local.stop_child(child)

    def test_explicit_crash_recovery_requires_dead_recorded_processes_and_free_ports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "instance"
            for part in ("private", "storage", "audit"):
                (root / part).mkdir(parents=True, mode=0o700)
            root.chmod(0o700)
            config = {"instanceId": "crashed-instance", "root": str(root)}
            local.mark_lifecycle(root, config, "dirty")
            local.write_json(
                root / "runtime.json",
                {
                    "instanceId": config["instanceId"],
                    "supervisorPid": 900001,
                    "apiPid": 900002,
                    "workerPid": 900003,
                    "hostPid": 900004,
                    "frontendPid": 900005,
                    "apiPort": 49001,
                    "hostPort": 49002,
                    "webPort": 49003,
                },
            )
            local.write_json(
                root / "private/ports.json",
                {
                    "apiPort": 49001,
                    "hostPort": 49002,
                    "webPort": 49003,
                    "apiUrl": "http://127.0.0.1:49001",
                    "hostUrl": "http://127.0.0.1:49002",
                    "webUrl": "http://127.0.0.1:49003",
                },
            )
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute("CREATE TABLE sample (id INTEGER)")
            stale_control = socket.socket(socket.AF_UNIX)
            stale_control.bind(str(root / "control.sock"))
            stale_control.close()

            with patch.object(local, "_persisted_process_exists", return_value=False), \
                 patch.object(local, "available_port", side_effect=lambda port: port), \
                 patch.object(local, "_path_has_open_handle", return_value=False):
                result = local.recover_crashed_instance(
                    root, config, config["instanceId"]
                )

            self.assertTrue(result["recovered"])
            self.assertFalse(result["running"])
            self.assertFalse(result["signalsSent"])
            self.assertEqual(result["providerCalls"], 0)
            local.require_clean(root, config)
            runtime = json.loads((root / "runtime.json").read_text())
            self.assertFalse(runtime["ready"])
            self.assertIsNone(runtime["workerPid"])
            audit = json.loads(Path(result["audit"]).read_text())
            self.assertEqual(audit["databaseIntegrity"], "ok")
            self.assertFalse(audit["signalsSent"])
            self.assertFalse((root / "control.sock").exists())
            self.assertFalse((root / "private/crash-recovery.json").exists())

    def test_crash_recovery_refuses_live_pid_without_mutating_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "instance"
            for part in ("private", "storage", "audit"):
                (root / part).mkdir(parents=True, mode=0o700)
            root.chmod(0o700)
            config = {"instanceId": "still-live", "root": str(root)}
            local.mark_lifecycle(root, config, "dirty")
            local.write_json(
                root / "runtime.json",
                {
                    "instanceId": config["instanceId"],
                    "supervisorPid": 901001,
                    "apiPid": 901002,
                    "workerPid": 901003,
                    "hostPid": 901004,
                    "frontendPid": 901005,
                    "apiPort": 49201,
                    "hostPort": 49202,
                    "webPort": 49203,
                },
            )
            local.write_json(
                root / "private/ports.json",
                {"apiPort": 49201, "hostPort": 49202, "webPort": 49203},
            )
            with patch.object(local, "_persisted_process_exists", return_value=True):
                with self.assertRaisesRegex(RuntimeError, "历史进程标识仍存活"):
                    local.recover_crashed_instance(root, config, config["instanceId"])
            self.assertEqual(
                json.loads((root / "private/lifecycle.json").read_text())["state"],
                "dirty",
            )
            self.assertEqual(list((root / "audit").iterdir()), [])

    def test_open_handle_probe_fails_closed_on_lsof_stderr(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "jason.db"
            target.touch()
            completed = subprocess.CompletedProcess(
                args=[], returncode=1, stdout=b"", stderr=b"lsof failed"
            )
            with patch.object(local.subprocess, "run", return_value=completed):
                with self.assertRaisesRegex(RuntimeError, "打开句柄"):
                    local._path_has_open_handle(target)

    def test_crash_recovery_intent_survives_runtime_write_failure_and_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "instance"
            for part in ("private", "storage", "audit"):
                (root / part).mkdir(parents=True, mode=0o700)
            root.chmod(0o700)
            config = {"instanceId": "retry-recovery", "root": str(root)}
            pids = {
                "supervisorPid": 902001,
                "apiPid": 902002,
                "workerPid": 902003,
                "hostPid": 902004,
                "frontendPid": 902005,
            }
            ports = {"apiPort": 49301, "hostPort": 49302, "webPort": 49303}
            local.mark_lifecycle(root, config, "dirty")
            local.write_json(root / "runtime.json", {
                "instanceId": config["instanceId"], **pids, **ports,
            })
            local.write_json(root / "private/ports.json", ports)
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute("CREATE TABLE sample (id INTEGER)")

            checks = (
                patch.object(local, "_persisted_process_exists", return_value=False),
                patch.object(local, "available_port", side_effect=lambda port: port),
                patch.object(local, "_path_has_open_handle", return_value=False),
            )
            with checks[0], checks[1], checks[2], \
                 patch.object(local, "write_stopped_runtime", side_effect=RuntimeError("disk full")):
                with self.assertRaisesRegex(RuntimeError, "disk full"):
                    local.recover_crashed_instance(root, config, config["instanceId"])

            intent_path = root / "private/crash-recovery.json"
            self.assertTrue(intent_path.is_file())
            intent = json.loads(intent_path.read_text())
            self.assertEqual(intent["recordedPids"], {
                **pids,
                "assetWorkerPid": None,
            })
            self.assertEqual(
                json.loads((root / "private/lifecycle.json").read_text())["state"],
                "dirty",
            )
            local.write_json(root / "runtime.json", {
                "instanceId": config["instanceId"],
                **{name: None for name in pids},
                **ports,
                "ready": False,
            })
            checked = []
            with patch.object(
                local,
                "_persisted_process_exists",
                side_effect=lambda pid: checked.append(pid) or False,
            ), patch.object(local, "available_port", side_effect=lambda port: port), \
                 patch.object(local, "_path_has_open_handle", return_value=False):
                result = local.recover_crashed_instance(
                    root, config, config["instanceId"]
                )
            self.assertTrue(result["recovered"])
            self.assertEqual(set(checked), set(pids.values()))
            self.assertFalse(intent_path.exists())
            local.require_clean(root, config)

    def test_recovery_cleanup_failure_blocks_start_then_finalizes_before_new_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "instance"
            for part in ("private", "storage", "audit"):
                (root / part).mkdir(parents=True, mode=0o700)
            root.chmod(0o700)
            config = {"instanceId": "cleanup-recovery", "root": str(root)}
            old_pids = {
                "supervisorPid": 904001,
                "apiPid": 904002,
                "workerPid": 904003,
                "hostPid": 904004,
                "frontendPid": 904005,
            }
            ports = {"apiPort": 49401, "hostPort": 49402, "webPort": 49403}
            local.mark_lifecycle(root, config, "dirty")
            local.write_json(root / "runtime.json", {
                "instanceId": config["instanceId"], **old_pids, **ports,
            })
            local.write_json(root / "private/ports.json", ports)
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute("CREATE TABLE sample (id INTEGER)")

            with patch.object(local, "_persisted_process_exists", return_value=False), \
                 patch.object(local, "available_port", side_effect=lambda port: port), \
                 patch.object(local, "_path_has_open_handle", return_value=False), \
                 patch.object(local, "_remove_private_file", side_effect=OSError("fsync failed")):
                with self.assertRaisesRegex(OSError, "fsync failed"):
                    local.recover_crashed_instance(root, config, config["instanceId"])

            intent = root / "private/crash-recovery.json"
            self.assertTrue(intent.is_file())
            self.assertEqual(
                json.loads((root / "private/lifecycle.json").read_text())["state"],
                "clean",
            )
            with self.assertRaisesRegex(RuntimeError, "恢复提交尚未收尾"):
                local.require_clean(root, config)

            with patch.object(local, "_persisted_process_exists", return_value=False), \
                 patch.object(local, "available_port", side_effect=lambda port: port), \
                 patch.object(local, "_path_has_open_handle", return_value=False):
                result = local.recover_crashed_instance(
                    root, config, config["instanceId"]
                )
            self.assertTrue(result["commitFinalized"])
            self.assertFalse(intent.exists())
            local.require_clean(root, config)

            new_pids = {
                "supervisorPid": 905001,
                "apiPid": 905002,
                "workerPid": 905003,
                "hostPid": 905004,
                "frontendPid": 905005,
            }
            local.write_json(root / "private/process-ledger.json", {
                "schema": local.PROCESS_LEDGER_SCHEMA,
                "instanceId": config["instanceId"],
                "generation": 99,
                "recordedAt": local.utc_timestamp(),
                **new_pids,
                **ports,
            })
            local.mark_lifecycle(root, config, "dirty")
            with patch.object(
                local,
                "_persisted_process_exists",
                side_effect=lambda pid: pid == new_pids["frontendPid"],
            ):
                with self.assertRaisesRegex(RuntimeError, "历史进程标识仍存活"):
                    local.recover_crashed_instance(root, config, config["instanceId"])

    def test_crash_recovery_refuses_live_control_socket_and_occupied_port(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "instance"
            for part in ("private", "storage", "audit"):
                (root / part).mkdir(parents=True, mode=0o700)
            root.chmod(0o700)
            config = {"instanceId": "live-control", "root": str(root)}
            listeners = [socket.socket(), socket.socket(), socket.socket()]
            unix_server = socket.socket(socket.AF_UNIX)
            try:
                for listener in listeners:
                    listener.bind(("127.0.0.1", 0))
                ports = dict(zip(
                    ("apiPort", "hostPort", "webPort"),
                    (listener.getsockname()[1] for listener in listeners),
                ))
                pids = {
                    "supervisorPid": 903001,
                    "apiPid": 903002,
                    "workerPid": 903003,
                    "hostPid": 903004,
                    "frontendPid": 903005,
                }
                local.mark_lifecycle(root, config, "dirty")
                local.write_json(root / "runtime.json", {
                    "instanceId": config["instanceId"], **pids, **ports,
                })
                local.write_json(root / "private/ports.json", ports)
                with sqlite3.connect(root / "storage/jason.db") as connection:
                    connection.execute("CREATE TABLE sample (id INTEGER)")
                with patch.object(local, "_persisted_process_exists", return_value=False):
                    with self.assertRaisesRegex(RuntimeError, "端口仍有监听者"):
                        local.recover_crashed_instance(root, config, config["instanceId"])

                for listener in listeners:
                    listener.close()
                unix_server.bind(str(root / "control.sock"))
                unix_server.listen(1)
                with patch.object(local, "_persisted_process_exists", return_value=False), \
                     patch.object(local, "_path_has_open_handle", return_value=False):
                    with self.assertRaisesRegex(RuntimeError, "socket 仍可连接"):
                        local.recover_crashed_instance(root, config, config["instanceId"])
                self.assertEqual(
                    json.loads((root / "private/lifecycle.json").read_text())["state"],
                    "dirty",
                )
            finally:
                for listener in listeners:
                    listener.close()
                unix_server.close()

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
                current = json.loads(lock.read_text())
                for old_schema in (
                    "qingmu.d1-deepseek-text-pre-submit-lock.v1",
                    "qingmu.d1-deepseek-text-pre-submit-lock.v2",
                ):
                    old = dict(current)
                    old["schema"] = old_schema
                    if old_schema.endswith(".v1"):
                        old.pop("status")
                        old.pop("submitAllowed")
                    lock.write_text(json.dumps(old))
                    old_digest = local.hashlib.sha256(lock.read_bytes()).hexdigest()
                    with patch.object(local, "_writer_submit_inspection", return_value=inspection):
                        with self.assertRaisesRegex(ValueError, "锁与易梦"):
                            local.director_submit_preflight(
                                root, config, task_id="task-1", lock_pack=lock,
                                lock_sha256=old_digest,
                            )
                lock.write_text(json.dumps(current))
                digest = local.hashlib.sha256(lock.read_bytes()).hexdigest()
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
                "attestationKey": "attestation", "editorialHandoffKey": "editorial",
                "frontendNode": "/private/node20",
            }
            login = {"username": local.LOCAL_USERNAME, "password": local.secrets.token_urlsafe(32)}
            local.write_json(root / "private/instance.json", config)
            local.write_json(root / "private/login.json", login)
            local.write_json(root / "identity.json", {"kind": "test"})
            local.mark_lifecycle(root, config, "clean")
            with sqlite3.connect(root / "storage/jason.db") as connection:
                connection.execute("CREATE TABLE sample (id INTEGER)")
                connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT)")
                connection.execute(
                    "INSERT INTO users VALUES (?, ?, ?)",
                    ("local-user", local.LOCAL_USERNAME, local._hash_local_password(login["password"])),
                )
            fence = root / "audit/director-submit-once-task-1.json"
            local._write_exclusive_json(fence, {"state": "armed_no_replay"})
            with patch.object(local, "node20_executable", return_value="/private/node20"):
                saved = local.backup(root)
            manifest = json.loads((Path(saved["backup"]) / "manifest.json").read_text())
            self.assertIn("audit/director-submit-once-task-1.json", manifest["sha256"])
            restored = parent / "restored"
            with patch.object(local, "node20_executable", return_value="/private/node20"):
                local.restore(Path(saved["backup"]), restored)
            restored_config = json.loads((restored / "private/instance.json").read_text())
            self.assertGreaterEqual(len(restored_config["editorialHandoffKey"].encode()), 32)
            self.assertNotEqual(restored_config["editorialHandoffKey"], config.get("editorialHandoffKey"))
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
