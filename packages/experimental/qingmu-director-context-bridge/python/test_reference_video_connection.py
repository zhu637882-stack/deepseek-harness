"""Owned connection composition with real Writer routes, isolated files and fake OSS."""

import time
import importlib.util
import json
from pathlib import Path
import sqlite3
from types import SimpleNamespace

import pytest

from reference_video_connection import bound_key, compose_reference_video_connection, key_fingerprint, read_key, validate_connection


def connection(path, project="project", episode="episode", fingerprint="a" * 64):
    return {"uiMode": "native", "referenceVideoConnection": {
        "provider": "dashscope", "model": "wan3.0-video", "projectId": project,
        "episodeId": episode, "credentialEnvFile": str(path), "credentialFingerprint": fingerprint,
    }}


@pytest.mark.parametrize("change", [
    {"uiMode": "legacy"}, {"directorExecutionFixture": {}},
    {"directorProductionExecution": {}}, {"textFoundationProductionExecution": {}},
    {"projectProductionExecution": {}}, {"referenceVideoConnection": "invalid"},
])
def test_connection_never_combines_with_execution_authority(tmp_path, change):
    with pytest.raises(ValueError, match="connection_invalid"):
        validate_connection({**connection(tmp_path / "key.env"), **change})


@pytest.mark.parametrize("change", [
    {"provider": "another"}, {"model": "other"}, {"projectId": "../other"},
    {"episodeId": ""}, {"credentialEnvFile": "relative.env"},
    {"credentialEnvFile": "/private/../other.env"}, {"maxPaidCny": 30},
    {"apiKey": "never-inline"},
    {"credentialFingerprint": "invalid"}, {"credentialFingerprint": None},
])
def test_metadata_is_exact_and_validation_never_reads_file(tmp_path, change):
    config = connection(tmp_path / "not-present.env")
    assert validate_connection(config) == config["referenceVideoConnection"]
    config["referenceVideoConnection"].update(change)
    with pytest.raises(ValueError, match="connection_invalid"):
        validate_connection(config)


def test_key_is_literal_private_bounded_and_never_an_ambient_environment(tmp_path, monkeypatch):
    path = tmp_path.resolve() / "key.env"
    path.write_text("DASHSCOPE_API_KEY=literal-test-key\nALLOW_PAID=true\nJWT_SECRET=unrelated\n")
    path.chmod(0o600)
    monkeypatch.setenv("DASHSCOPE_API_KEY", "ambient-must-not-win")
    assert read_key(str(path)) == "literal-test-key"
    link = path.with_name("symlink.env")
    link.symlink_to(path)
    with pytest.raises(ValueError, match="credential_unavailable"):
        read_key(str(link))
    path.chmod(0o644)
    with pytest.raises(ValueError, match="credential_unavailable"):
        read_key(str(path))
    path.chmod(0o600)
    for text in ("JWT_SECRET=unrelated", "DASHSCOPE_API_KEY=${DASHSCOPE_API_KEY}", "x" * 131073):
        path.write_text(text)
        with pytest.raises(ValueError, match="credential_unavailable") as error:
            read_key(str(path))
        assert "unrelated" not in str(error.value)


def test_bound_key_rejects_private_file_rotation_before_any_http(tmp_path):
    path = tmp_path.resolve() / "key.env"
    path.write_text("DASHSCOPE_API_KEY=first-test-key\n")
    path.chmod(0o600)
    config = connection(path, fingerprint=key_fingerprint("first-test-key"))["referenceVideoConnection"]
    assert bound_key(config) == "first-test-key"
    path.write_text("DASHSCOPE_API_KEY=second-test-key\n")
    with pytest.raises(ValueError, match="credential_changed") as error:
        bound_key(config)
    assert "second-test-key" not in str(error.value)


def test_real_http_materials_are_scoped_without_sharing_key_or_enabling_paid(tmp_path, monkeypatch):
    from jason.apps.studio import api_deps
    from jason.config import Settings
    from jason.providers.dashscope_temporary_media import DashScopeTemporaryMediaClient
    from test_qingmu_reference_video_materials import FakeUpload, post, read, world

    w = world.__wrapped__(tmp_path, monkeypatch)
    key = tmp_path.resolve() / "key.env"
    key.write_text("DASHSCOPE_API_KEY=must-not-be-returned\nALLOW_PAID=true\nMAX_PAID_CNY=999\n")
    key.chmod(0o600)
    settings = Settings(
        _env_file=None, database_url=f"sqlite:///{w.store.db_path}", storage_root=str(w.storage),
        allow_paid=False, max_paid_cny=0, dashscope_api_key="",
        app_public_base_url="http://127.0.0.1:55839", jwt_secret="fixture-only",
    )
    deps = SimpleNamespace(store=w.store, settings=settings)
    compose_reference_video_connection(deps, connection(
        key, w.project["projectId"], w.project["episodeId"], key_fingerprint("must-not-be-returned")
    ))
    service = deps.qingmu_reference_video_preview_service
    assert settings.dashscope_api_key == ""
    assert settings.allow_paid is False and settings.max_paid_cny == 0
    assert service.settings is not settings and service.settings.allow_paid is False
    assert service.builder.settings.dashscope_base_url == "https://dashscope.aliyuncs.com"
    monkeypatch.setattr(api_deps, "qingmu_reference_video_preview_service", service)
    now = time.time()
    uploads = FakeUpload(lambda: now)
    monkeypatch.setattr(DashScopeTemporaryMediaClient, "upload", lambda _self, **args: uploads.upload(**args))
    # A fresh page/read never performs an upload or adds a database row.
    with w.store._connect() as conn:
        before = list(conn.iterdump())
    response = read(w)
    assert response.status_code == 200 and response.json()["configured"] is True
    assert not uploads.calls
    with w.store._connect() as conn:
        assert list(conn.iterdump()) == before
    for i in range(5):
        result = post(w, i)
        assert result.status_code == 200, result.text
        assert "must-not-be-returned" not in result.text
    assert len(uploads.calls) == 5
    assert post(w).json()["uploadAttempts"] == 0
    assert len(uploads.calls) == 5
    # Receipts and actual ordered request assembly use the same exact key.
    assert read(w).json()["allReady"] is True
    preview = w.client.post(w.url, json=w.request)
    assert preview.status_code == 200, preview.text
    assert [x["alias"] for x in preview.json()["referenceMapping"]] == ["图1", "图2", "图3", "音频1", "音频2"]
    assert "must-not-be-returned" not in preview.text
    # Different owner and a drifted episode are rejected at the material executor.
    args = w.args
    with pytest.raises(PermissionError):
        service.materials().prepare(**{**args, "actor": "stranger"}, asset_id=w.refs[0]["assetId"], request_id="another-request-123")
    with w.store._connect() as conn:
        conn.execute("UPDATE storyboard_frames SET episode_id='another-episode' WHERE id=?", (w.frame["id"],))
    assert read(w).status_code == 403
    assert post(w).status_code == 403
    assert len(uploads.calls) == 5


@pytest.mark.parametrize("change", [{"allow_paid": True}, {"max_paid_cny": 1}, {"dashscope_api_key": "ambient"}])
def test_composition_rejects_inherited_runtime_authority(change):
    settings = SimpleNamespace(allow_paid=False, max_paid_cny=0, dashscope_api_key="")
    settings.__dict__.update(change)
    with pytest.raises(ValueError, match="runtime_conflict"):
        compose_reference_video_connection(SimpleNamespace(settings=settings), connection("/private/key.env"))


def test_launcher_connect_disconnect_probes_key_without_database_or_authority_changes(tmp_path, monkeypatch):
    from jason.config import CONFIG_ROOT
    harness = Path(__file__).resolve().parents[4]
    spec = importlib.util.spec_from_file_location("connection_launcher_test", harness / "scripts/qingmu-local.py")
    local = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(local)
    root = tmp_path.resolve() / "instance"
    root.mkdir(mode=0o700)
    for part in ("private", "storage", "dsh", "home", "work", "logs", "audit", "build-manifest"):
        (root / part).mkdir(mode=0o700)
    config = {"root": str(root), "harnessRoot": str(harness), "uiMode": "native",
              "instanceId": "connection-fixture", "yimengRoot": str(CONFIG_ROOT),
              "jwtSecret": "isolated-instance-test-secret"}
    local.write_json(root / "private/instance.json", config)
    local.mark_lifecycle(root, config, "clean")
    database = root / "storage/jason.db"
    with sqlite3.connect(database) as conn:
        conn.executescript("CREATE TABLE projects(id TEXT,owner TEXT); CREATE TABLE episodes(id TEXT,project_id TEXT);"
                           "INSERT INTO projects VALUES('project','owner'); INSERT INTO episodes VALUES('episode','project');")
    original = database.read_bytes()
    key = tmp_path.resolve() / "connection.env"
    key.write_text("DASHSCOPE_API_KEY=fixture-only-not-for-output\nALLOW_PAID=true\n")
    key.chmod(0o600)
    args = dict(expected_instance_id="connection-fixture", project_id="project", episode_id="episode")
    result = local.configure_reference_connection(root, config, **args, credential_env_file=key)
    assert result["connected"] is True and result["modelSpendingEnabled"] is False
    assert result["providerHttpRequests"] == result["businessDatabaseWrites"] == 0
    current = local.read_config(root)
    assert current == {**config, **{"referenceVideoConnection": connection(
        key, fingerprint=key_fingerprint("fixture-only-not-for-output")
    )["referenceVideoConnection"]}}
    assert result["credentialFingerprint"] == current["referenceVideoConnection"]["credentialFingerprint"]
    assert "fixture-only-not-for-output" not in json.dumps(result) + json.dumps(current)
    assert database.read_bytes() == original
    env = local.Supervisor(root, current)._worker_environment(CONFIG_ROOT, None)
    assert env["ALLOW_PAID"] == "false" and env["MAX_PAID_CNY"] == "0"
    assert env["JASON_ENV_FILE"] == str(root / "private/no-ambient.env")
    assert "DASHSCOPE_API_KEY" not in env
    with pytest.raises(ValueError, match="scope_mismatch"):
        local.configure_reference_connection(root, current, **{**args, "episode_id": "wrong"})
    # A missing DB cannot make the only official disconnect command unusable.
    database.unlink()
    # Failure to finalize the audit after committing configuration is recoverable.
    write_json = local.write_json
    def fail_completed_audit(path, value):
        if path.parent == root / "audit" and value.get("status") == "completed":
            raise OSError("fixture audit finalization failure")
        return write_json(path, value)
    monkeypatch.setattr(local, "write_json", fail_completed_audit)
    with pytest.raises(OSError, match="finalization failure"):
        local.configure_reference_connection(root, current, **args)
    assert local.read_config(root) == config
    assert any(json.loads(path.read_text())["status"] == "pending" for path in (root / "audit").iterdir())
    monkeypatch.setattr(local, "write_json", write_json)
    result = local.configure_reference_connection(root, config, **args)
    assert result["connected"] is False and result["alreadyDisconnected"] is True
    assert result["scope"]["databaseChecked"] is False and not database.exists()
    # A new connection still requires the real project/episode binding.
    with pytest.raises((ValueError, OSError, sqlite3.Error)):
        local.configure_reference_connection(root, config, **args, credential_env_file=key)
    local.mark_lifecycle(root, config, "running")
    with pytest.raises(RuntimeError, match="停止状态未知"):
        local.configure_reference_connection(root, config, **args, credential_env_file=key)


def test_metadata_loader_never_writes_source_bytecode(tmp_path, monkeypatch):
    import sys
    harness = Path(__file__).resolve().parents[4]
    spec = importlib.util.spec_from_file_location("connection_loader_test", harness / "scripts/qingmu-local.py")
    local = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(local)
    relative = Path("packages/experimental/qingmu-director-context-bridge/python/reference_video_connection.py")
    target = tmp_path / relative
    target.parent.mkdir(parents=True)
    target.write_bytes((harness / relative).read_bytes())
    monkeypatch.setattr(local, "HARNESS", tmp_path)
    monkeypatch.setattr(sys, "dont_write_bytecode", False)
    assert local.reference_connection_module().validate_connection({}) is None
    assert list(target.parent.iterdir()) == [target]
