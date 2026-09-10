"""Native owner workspace uses one budget across projects, API and Worker."""
import importlib.util
from pathlib import Path
from unittest.mock import Mock

import pytest
from reference_video_connection import key_fingerprint, production_environment, validate_production


def config(tmp_path):
    key = tmp_path.resolve() / "key.env"
    key.write_text("DASHSCOPE_API_KEY=fixture-key\nALLOW_PAID=false\nMAX_PAID_CNY=999999\n")
    key.chmod(0o600)
    return {"uiMode": "native", "nativeProductionExecution": {
        "provider": "dashscope", "ownerId": "owner", "credentialEnvFile": str(key),
        "credentialFingerprint": key_fingerprint("fixture-key"), "maxPaidCny": 30,
        "budgetBaselineCny": 0, "budgetWindowId": "native-test",
    }}


@pytest.mark.parametrize("change", [{"maxPaidCny": -1}, {"maxPaidCny": True},
    {"maxPaidCny": float("nan")}, {"budgetBaselineCny": -1}, {"ownerId": ""},
    {"budgetWindowId": ""}, {"unknown": "extra"}])
def test_native_metadata_rejects_invalid_budget_or_owner(tmp_path, change):
    value = config(tmp_path)
    value["nativeProductionExecution"].update(change)
    with pytest.raises(ValueError):
        validate_production(value)


def test_native_environment_is_shared_explicit_and_not_project_locked(tmp_path, monkeypatch):
    value = config(tmp_path)
    monkeypatch.setenv("DASHSCOPE_API_KEY", "ambient")
    environment = production_environment(value)
    assert environment["DASHSCOPE_API_KEY"] == "fixture-key"
    assert environment["MAX_PAID_CNY"] == "30"
    assert environment["PROVIDER_BUDGET_WINDOW_ID"] == "native-test"
    assert environment["PROVIDER_PAID_SCOPE_OWNER_ID"] == "owner"
    assert environment["PROVIDER_PAID_SCOPE_PROJECT_ID"] == ""
    assert environment["ALLOW_REMOTE_DOWNLOAD"] == "true"
    assert production_environment({}) == {}
    with pytest.raises(ValueError):
        validate_production({**value, "referenceVideoConnection": {}})


def test_launcher_starts_existing_all_lane_worker_without_exposing_credentials(tmp_path, monkeypatch):
    harness = Path(__file__).resolve().parents[4]
    spec = importlib.util.spec_from_file_location("native_launcher", harness / "scripts/qingmu-local.py")
    local = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(local)
    value = {**config(tmp_path), "yimengRoot": "/writer", "jwtSecret": "test"}
    supervisor = local.Supervisor(tmp_path, value)
    launch = Mock(return_value=Mock(poll=Mock(return_value=None)))
    monkeypatch.setattr(supervisor, "launch_owned", launch)
    supervisor.start_worker()
    role, argv, environment, label = launch.call_args.args
    assert role == label == "worker"
    assert argv[2].endswith("qingmu_worker.py")
    assert argv[argv.index("--lane") + 1] == "all"
    assert "--heartbeat-only" not in argv
    assert "--allow-existing-provider-poll" in argv
    assert "DASHSCOPE_API_KEY" not in environment
    assert environment["ALLOW_PAID"] == "false"  # wrapper loads the validated authority
