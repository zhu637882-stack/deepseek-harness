"""Focused launcher ownership checks; no existing service or credentials used."""
import importlib.util
import json
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("qingmu_local", Path(__file__).with_name("qingmu-local.py"))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


class OwnershipTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
