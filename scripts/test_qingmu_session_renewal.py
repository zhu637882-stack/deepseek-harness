"""Native service-session lifecycle, with no production credentials or paid calls."""
import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("qingmu_local_session", Path(__file__).with_name("qingmu-local.py"))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


def token(expiry):
    body = base64.urlsafe_b64encode(json.dumps({"exp": expiry}).encode()).decode().rstrip("=")
    return "header." + body + ".signature"


class NativeSessionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "private").mkdir()
        self.session_file = self.root / "private/session.json"
        local.write_json(self.root / "private/login.json", {"username": local.LOCAL_USERNAME, "password": "fixture-password"})
        self.supervisor = local.Supervisor(self.root, {"uiMode": "native", "instanceId": "test"})
        self.supervisor.ports = {"apiUrl": "http://127.0.0.1:12345"}
        self.supervisor.api_identity = Mock()

    def test_native_login_preserves_running_host_and_confirms_user_before_publish(self):
        old_host = object()
        self.supervisor.host = old_host
        local.write_json(self.session_file, {"token": "old"})
        with patch.object(local, "http", side_effect=[{"token": token(9000)}, {"username": local.LOCAL_USERNAME}]) as http, \
             patch.object(self.supervisor, "status", return_value={"ready": True}), \
             patch.object(self.supervisor, "stop_owned") as stop, \
             patch.object(self.supervisor, "start_host") as start:
            result = self.supervisor.login()
        self.assertIs(self.supervisor.host, old_host)
        stop.assert_not_called()
        start.assert_not_called()
        self.assertIn("可继续使用", result["message"])
        self.assertEqual([c.args[0].rsplit("/", 1)[-1] for c in http.call_args_list], ["login", "me"])
        self.assertEqual(json.loads(self.session_file.read_text())["token"], token(9000))
        self.assertEqual(self.session_file.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(token(9000), json.dumps(result))

    def test_fresh_session_is_not_reauthenticated_on_each_tick(self):
        local.write_json(self.session_file, {"token": token(5000)})
        with patch.object(local.time, "time", return_value=1000), \
             patch.object(local.time, "monotonic", return_value=10), \
             patch.object(self.supervisor, "renew_service_session") as renew:
            self.supervisor.maintain_native_session()
            self.supervisor.maintain_native_session()
        renew.assert_not_called()
        self.assertEqual(self.supervisor.session_next_poll, 40)

    def test_expiring_missing_and_malformed_sessions_trigger_only_normal_authentication(self):
        for content in [None, {"token": token(1299)}, {"token": "broken"}, {"token": token(float("inf"))}]:
            with self.subTest(content=content):
                self.session_file.unlink(missing_ok=True)
                if content is not None:
                    local.write_json(self.session_file, content)
                self.supervisor.session_next_poll = 0
                with patch.object(local.time, "time", return_value=1000), \
                     patch.object(self.supervisor, "renew_service_session") as renew:
                    self.supervisor.maintain_native_session()
                renew.assert_called_once_with()

    def test_startup_authenticates_even_if_saved_expiry_looks_fresh(self):
        local.write_json(self.session_file, {"token": token(9999999999)})
        with patch.object(self.supervisor, "renew_service_session") as renew:
            self.supervisor.maintain_native_session(startup=True)
        renew.assert_called_once_with()

    def test_auth_failures_preserve_token_and_back_off_without_stopping_host(self):
        local.write_json(self.session_file, {"token": token(0)})
        before = self.session_file.read_bytes()
        failure = urllib.error.HTTPError("http://127.0.0.1:12345", 401, "private-error", {}, None)
        with patch.object(local, "http", side_effect=failure) as http, \
             patch.object(local.time, "monotonic", return_value=100), \
             patch.object(self.supervisor, "stop_owned") as stop, \
             patch.object(local.sys, "stderr") as stderr:
            self.supervisor.maintain_native_session()
            self.supervisor.maintain_native_session()
        self.assertEqual(http.call_count, 1)
        self.assertEqual(self.session_file.read_bytes(), before)
        self.assertEqual(self.supervisor.session_next_poll, 400)
        self.assertNotIn("private-error", str(stderr.write.call_args_list))
        stop.assert_not_called()

    def test_wrong_api_identity_does_not_receive_the_saved_password(self):
        self.supervisor.api_identity.side_effect = RuntimeError("wrong instance")
        with patch.object(local, "http") as http:
            with self.assertRaisesRegex(RuntimeError, "wrong instance"):
                self.supervisor.renew_service_session()
        http.assert_not_called()

    def test_wrong_service_user_and_invalid_response_do_not_replace_existing_session(self):
        local.write_json(self.session_file, {"token": "old"})
        for responses in [[{"token": "new"}, {"username": "other"}], [{"token": "bad token"}]]:
            with self.subTest(responses=responses), patch.object(local, "http", side_effect=responses):
                with self.assertRaisesRegex(RuntimeError, "登录失败"):
                    self.supervisor.renew_service_session()
            self.assertEqual(json.loads(self.session_file.read_text())["token"], "old")

    def test_legacy_mode_has_no_background_service_login(self):
        supervisor = local.Supervisor(self.root, {})
        with patch.object(supervisor, "renew_service_session") as renew:
            supervisor.maintain_native_session(startup=True)
            supervisor.maintain_native_session()
        renew.assert_not_called()


if __name__ == "__main__":
    unittest.main()
