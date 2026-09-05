#!/usr/bin/env python3
"""Qingmu's single-user, loopback-only persistent instance launcher (macOS).

Only the supervisor holding the instance flock owns child process handles.
No command signals a persisted PID or an arbitrary listener. Credentials stay
in owner-only files; login explicitly renews the normal 24-hour API session.
"""

from __future__ import annotations

import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import sqlite3
import select
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_ROOT = Path.home() / "Library/Application Support/QingmuOS"
HARNESS = Path(__file__).resolve().parents[1]
DEEPSEEK_PRODUCTION_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_PRODUCTION_CREDENTIAL_FILE = Path(
    "/Users/a1234/.dsh/.credentials.yaml"
)
YIMENG_PROVIDER_ENV_FILE = Path("/Users/a1234/jason-drama-runtime/.env")
QINGMU_LOCAL_REMAINING_PAID_CNY = 999.709120
TEXT_FOUNDATION_STAGES = (
    "story_outline",
    "story_episode",
    "script",
    "asset_contract",
    "shot_plan",
)
BUILD_MANIFEST_SCHEMA = "qingmu.local-build-manifest.v1"
PROCESS_LEDGER_SCHEMA = "qingmu.local-process-ledger.v1"
CRASH_RECOVERY_SCHEMA = "qingmu.local-crash-recovery.v2"
OWNED_PROCESS_ROLES = ("api", "worker", "assetWorker", "host", "frontend")
BUILD_MANIFEST_ARTIFACTS = (
    "apps/cli/lib/bin.js",
    "packages/experimental/qingmu-yimeng-command-adapter/lib/index.js",
    "packages/experimental/qingmu-yimeng-read-adapter/lib/index.js",
    "packages/experimental/qingmu-imago-method-adapter/lib/index.js",
    "packages/experimental/qingmu-director-context-bridge/lib/index.js",
    "packages/experimental/client-ui-qingmu-cockpit/lib/client.js",
    "packages/experimental/qingmu-web/lib/index.js",
)
LOCAL_USERNAME = "qingmu-local"
LOCAL_PASSWORD_ITERATIONS = 600_000
PRIVATE_CREDENTIAL_FIELDS = (
    "jwtSecret",
    "attestationKey",
    "controlKey",
    "directorExecutionKey",
    "editorialHandoffKey",
    "assetActivationKey",
)
PRIVATE_FIELD_MARKERS = (
    "secret", "token", "password", "credential", "signature", "hmac",
)


def write_json(path: Path, value: dict) -> None:
    """Atomically replace one private state file without following its target."""
    temporary = path.with_name(path.name + "." + secrets.token_hex(8))
    with temporary.open("x", encoding="utf-8") as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _read_owner_only_json(path: Path, label: str) -> dict:
    """Read one private JSON object after checking ownership and mode."""
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid():
        raise ValueError(label + "必须是当前用户拥有的普通文件")
    if path.stat().st_mode & 0o077:
        raise ValueError(label + "权限必须为0600")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(label + "必须是JSON对象")
    return value


def _validate_private_credential_fields(
    config: dict, *, require_all: bool, allow_legacy_asset_activation_key: bool = False
) -> None:
    """Fail closed on unknown top-level credential fields."""
    for name in config:
        normalized = "".join(character for character in name.lower() if character.isalnum())
        if name not in PRIVATE_CREDENTIAL_FIELDS and (
            normalized.endswith("key")
            or any(marker in normalized for marker in PRIVATE_FIELD_MARKERS)
        ):
            raise ValueError("实例配置含未知私密字段；需先显式纳入轮换策略")
    required_fields = tuple(
        name for name in PRIVATE_CREDENTIAL_FIELDS
        if not (allow_legacy_asset_activation_key and name == "assetActivationKey")
    )
    if require_all and any(
        not isinstance(config.get(name), str) or not config[name]
        for name in required_fields
    ):
        raise ValueError("实例缺少完整的本机认证、签名或控制凭据")


def _new_private_credentials(config: dict) -> dict:
    _validate_private_credential_fields(config, require_all=False)
    result = dict(config)
    result.update({name: secrets.token_urlsafe(48) for name in PRIVATE_CREDENTIAL_FIELDS})
    return result


def _new_local_login() -> dict:
    return {"username": LOCAL_USERNAME, "password": secrets.token_urlsafe(32)}


def _hash_local_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("ascii"),
        LOCAL_PASSWORD_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${LOCAL_PASSWORD_ITERATIONS}${salt}${digest}"


def _stage_local_password_hash(connection: sqlite3.Connection, password: str) -> None:
    rows = connection.execute(
        "SELECT id FROM users WHERE username = ?", (LOCAL_USERNAME,)
    ).fetchall()
    if len(rows) != 1:
        raise RuntimeError("本机账号必须精确匹配一行；未修改认证数据")
    cursor = connection.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (_hash_local_password(password), rows[0][0]),
    )
    if cursor.rowcount != 1:
        raise RuntimeError("本机账号密码哈希未精确更新一行")


def read_config(root: Path) -> dict:
    if root.is_symlink() or root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
        raise ValueError("专用目录必须属于当前用户且权限为0700")
    for relative in ("private", "storage", "dsh", "home", "work", "logs", "build-manifest",
                     "private/instance.json", "private/login.json", "private/session.json",
                     "storage/jason.db", "private/lifecycle.lock", "build-manifest/current.json"):
        if (root / relative).is_symlink():
            raise ValueError("实例数据/配置路径不能是符号链接：" + relative)
    config = _read_owner_only_json(root / "private/instance.json", "实例私密配置")
    _validate_private_credential_fields(config, require_all=False)
    if config["root"] != str(root) or config["harnessRoot"] != str(HARNESS):
        raise ValueError("实例目录或 Harness 来源绑定不符；拒绝使用")
    frontend_node = config.get("frontendNode")
    if not isinstance(frontend_node, str) or not frontend_node:
        raise ValueError("旧实例缺少六阶段前端运行时绑定；请恢复到新目录，不能静默借用系统 Node")
    if node20_executable(Path(frontend_node)) != frontend_node:
        raise ValueError("六阶段前端 Node 绑定已漂移；拒绝启动")
    validate_director_production_config(config.get("directorProductionExecution"))
    project_production = validate_project_production_config(
        config.get("projectProductionExecution")
    )
    text_production = validate_text_foundation_production_config(
        config.get("textFoundationProductionExecution")
    )
    if project_production is not None and (
        text_production is None
        or project_production["projectId"] != text_production["projectId"]
        or project_production["episodeId"] != text_production["episodeId"]
    ):
        raise ValueError("项目 production 配置与易梦 Provider 范围不匹配")
    if config.get("directorExecutionFixture") is not None and config.get("directorProductionExecution") is not None:
        raise ValueError("导演 fixture 与 production 配置不能同时启用")
    return config


def safe_env(root: Path) -> dict[str, str]:
    """Do not inherit ambient Provider credentials, runtime paths or .env files."""
    return {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(root / "home"),
            "LANG": "en_US.UTF-8", "PYTHONDONTWRITEBYTECODE": "1", "DSH_HOME": str(root / "dsh")}


def backend_command(config: dict) -> list[str]:
    writer = Path(config["yimengRoot"])
    command = [str(writer / ".venv/bin/python"), "-B", str(writer / "scripts/qingmu_local_api.py"),
               "--root", config["root"]]
    if config.get("_directorProductionOverridePath"):
        command.extend(["--director-production-override", config["_directorProductionOverridePath"]])
    return command


def backend_env(root: Path, config: dict) -> dict[str, str]:
    env = {**safe_env(root), "PYTHONPATH": str(Path(config["yimengRoot"]) / "backend/src")}
    # This is intentionally not the supervisor control key and is the only
    # launch-control credential made available to the API process.
    activation_key = str(config.get("assetActivationKey") or "")
    if activation_key:
        env["QINGMU_ASSET_ACTIVATION_SOCKET"] = str(root / "private/asset-activation.sock")
        env["QINGMU_ASSET_ACTIVATION_KEY"] = activation_key
    return env


def node20_executable(explicit: Path | None = None) -> str:
    """Resolve an explicit or local Node 20 binary for the Yimeng frontend."""
    candidates: list[Path] = [explicit.expanduser()] if explicit is not None else []
    if explicit is None:
        system_node = shutil.which("node")
        if system_node:
            candidates.append(Path(system_node))
        candidates.extend(sorted((Path.home() / ".nvm/versions/node").glob("v20.*/bin/node"), reverse=True))
    for candidate in candidates:
        try:
            resolved = candidate.resolve(strict=True)
            result = subprocess.run(
                [str(resolved), "--version"],
                capture_output=True,
                text=True,
                timeout=5,
                env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if result.returncode == 0 and result.stdout.strip().startswith("v20."):
            return str(resolved)
    raise ValueError("易梦六阶段前端需要 Node 20；请用 --frontend-node 指定本机 Node 20")


def utc_timestamp(timestamp: float | None = None) -> str:
    """Render one UTC timestamp for durable local release evidence."""
    value = datetime.now(timezone.utc) if timestamp is None else datetime.fromtimestamp(timestamp, timezone.utc)
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def file_sha256(path: Path) -> str:
    """Hash one required regular build artifact."""
    if path.is_symlink() or not path.is_file():
        raise ValueError("发布产物缺失或不是普通文件：" + str(path))
    with path.open("rb") as stream:
        digest = hashlib.sha256()
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def source_identity(source: Path) -> dict:
    """Read one Git checkout identity without interpreting dirty paths."""
    source = source.resolve(strict=True)
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=source, capture_output=True, text=True, timeout=10
    )
    status = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=source,
        capture_output=True,
        timeout=15,
    )
    if head.returncode or status.returncode:
        raise ValueError("发布来源不是可核验的 Git checkout：" + str(source))
    changes = status.stdout.decode("utf-8", errors="surrogateescape").splitlines()
    return {
        "root": str(source),
        "commit": head.stdout.strip(),
        "dirty": bool(changes),
        "changeCount": len(changes),
        "workingTreeStateSha256": hashlib.sha256(status.stdout).hexdigest(),
        "changes": changes,
    }


def collect_build_manifest(root: Path, config: dict, *, review_only: bool = False) -> dict:
    """Bind clean release sources and built artifacts to one local instance."""
    writer = Path(config["yimengRoot"])
    harness = Path(config["harnessRoot"])
    core = Path(config["coreRoot"])
    sources = {
        "writer": source_identity(writer),
        "harness": source_identity(harness),
        "core": source_identity(core),
    }
    if sources["writer"]["dirty"] or sources["harness"]["dirty"]:
        raise ValueError("Writer/Harness 工作树必须干净才能记录发布身份")
    frontend_build_id = writer / "frontend/.next/BUILD_ID"
    build_id = frontend_build_id.read_text(encoding="utf-8").strip()
    if not build_id or "\n" in build_id:
        raise ValueError("易梦 frontend BUILD_ID 无效")
    artifact_relatives = () if review_only else BUILD_MANIFEST_ARTIFACTS
    artifact_paths = [harness / relative for relative in artifact_relatives]
    artifacts = {
        "frontendBuildId": {
            "path": str(frontend_build_id),
            "value": build_id,
            "sha256": file_sha256(frontend_build_id),
        },
        "host": {
            relative: {"path": str(path), "sha256": file_sha256(path)}
            for relative, path in zip(artifact_relatives, artifact_paths)
        },
    }
    latest_mtime = max(path.stat().st_mtime for path in [frontend_build_id, *artifact_paths])
    ports_path = root / "private/ports.json"
    ports = json.loads(ports_path.read_text()) if ports_path.is_file() else None
    return {
        "schema": BUILD_MANIFEST_SCHEMA,
        "instance": {
            "instanceId": config["instanceId"],
            "root": str(root),
            "dataRoot": str(root / "storage"),
            "database": str(root / "storage/jason.db"),
            "ports": ports,
        },
        "sources": sources,
        "releaseSourcesClean": True,
        "runtimeProfile": "review-only" if review_only else "full",
        "artifacts": artifacts,
        "builtAt": utc_timestamp(latest_mtime),
        "recordedAt": utc_timestamp(),
        "startedAt": None,
    }


def build_manifest_status(root: Path, config: dict, *, review_only: bool = False) -> dict:
    """Compare the recorded local release identity with source and artifact truth."""
    path = root / "build-manifest/current.json"
    if path.is_symlink() or not path.is_file():
        return {"state": "unknown_missing", "matches": False, "path": str(path), "mismatches": ["manifest"]}
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        expected = collect_build_manifest(root, config, review_only=review_only)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        return {"state": "invalid", "matches": False, "path": str(path), "mismatches": [str(exc)]}
    mismatches: list[str] = []
    if manifest.get("schema") != BUILD_MANIFEST_SCHEMA:
        mismatches.append("schema")
    for field in ("instanceId", "root", "dataRoot", "database"):
        if manifest.get("instance", {}).get(field) != expected["instance"][field]:
            mismatches.append("instance." + field)
    recorded_ports = manifest.get("instance", {}).get("ports")
    if recorded_ports is not None and recorded_ports != expected["instance"]["ports"]:
        mismatches.append("instance.ports")
    if manifest.get("sources") != expected["sources"]:
        mismatches.append("sources")
    if manifest.get("releaseSourcesClean") is not True:
        mismatches.append("releaseSourcesClean")
    if manifest.get("runtimeProfile") != expected["runtimeProfile"]:
        mismatches.append("runtimeProfile")
    if manifest.get("artifacts") != expected["artifacts"]:
        mismatches.append("artifacts")
    return {
        "state": "matches" if not mismatches else "drift",
        "matches": not mismatches,
        "path": str(path),
        "sha256": file_sha256(path),
        "writerCommit": manifest.get("sources", {}).get("writer", {}).get("commit"),
        "harnessCommit": manifest.get("sources", {}).get("harness", {}).get("commit"),
        "coreCommit": manifest.get("sources", {}).get("core", {}).get("commit"),
        "frontendBuildId": manifest.get("artifacts", {}).get("frontendBuildId", {}).get("value"),
        "builtAt": manifest.get("builtAt"),
        "startedAt": manifest.get("startedAt"),
        "mismatches": mismatches,
    }


def require_build_manifest_matches(root: Path, config: dict, *, review_only: bool = False) -> dict:
    """Fail closed unless the current release identity exactly matches disk."""
    status = build_manifest_status(root, config, review_only=review_only)
    if status["matches"] is not True:
        raise RuntimeError("本地发布身份缺失或漂移；实例保持停止，请在完整构建后运行 record-build")
    return status


def record_build_manifest(root: Path, config: dict, *, review_only: bool = False) -> dict:
    """Atomically record one stopped build and retain the preceding manifest."""
    with instance_lock(root):
        require_clean(root, config)
        manifest = collect_build_manifest(root, config, review_only=review_only)
        directory = root / "build-manifest"
        directory.mkdir(mode=0o700, exist_ok=True)
        current = directory / "current.json"
        previous = None
        if current.exists() or current.is_symlink():
            if current.is_symlink() or not current.is_file():
                raise ValueError("当前发布身份不是普通文件")
            digest = file_sha256(current)
            history = directory / "history"
            history.mkdir(mode=0o700, exist_ok=True)
            previous = history / (
                utc_timestamp().replace(":", "").replace("-", "")
                + "-" + digest[:12] + "-" + secrets.token_hex(4) + ".json"
            )
            with previous.open("xb") as stream:
                os.chmod(previous, 0o600)
                stream.write(current.read_bytes())
                stream.flush()
                os.fsync(stream.fileno())
        write_json(current, manifest)
        status = require_build_manifest_matches(root, config, review_only=review_only)
        return {"recorded": str(current), "previous": str(previous) if previous else None, **status}


def mark_build_started(root: Path, config: dict, ports: dict, *, review_only: bool = False) -> None:
    """Persist the exact successful start coordinates without changing build identity."""
    status = require_build_manifest_matches(root, config, review_only=review_only)
    path = Path(status["path"])
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["instance"]["ports"] = ports
    manifest["startedAt"] = utc_timestamp()
    write_json(path, manifest)


def initialize(
    root: Path,
    writer: Path,
    core: Path | None = None,
    frontend_node: Path | None = None,
) -> dict:
    """Exclusive new-root initialization. Existing directories are never adopted."""
    if root.exists() or root.is_symlink():
        raise FileExistsError(root)
    writer = writer.resolve(strict=True)
    if not (writer / "scripts/qingmu_local_api.py").is_file():
        raise ValueError("易梦来源缺少 qingmu_local_api.py")
    if not (writer / "frontend/package.json").is_file():
        raise ValueError("易梦来源缺少六阶段前端")
    if core is not None and not (core / "pipeline/imago-os-current.json").is_file():
        raise ValueError("Core 来源缺少当前机器入口")
    root.mkdir(mode=0o700, parents=False, exist_ok=False)
    for part in ("private", "storage", "logs", "home", "dsh/profiles/qingmu", "work", "audit", "backups",
                 "build-manifest"):
        (root / part).mkdir(mode=0o700, parents=True, exist_ok=True)
    config = {"version": 1, "instanceId": secrets.token_hex(16), "root": str(root),
              "harnessRoot": str(HARNESS), "yimengRoot": str(writer), "coreRoot": str(core.resolve(strict=True)) if core else None,
              "node": shutil.which("node"), "jwtSecret": secrets.token_urlsafe(48),
              "frontendNode": node20_executable(frontend_node),
              "attestationKey": secrets.token_urlsafe(48), "controlKey": secrets.token_urlsafe(48),
              "directorExecutionKey": secrets.token_urlsafe(48),
              "editorialHandoffKey": secrets.token_urlsafe(48),
              "assetActivationKey": secrets.token_urlsafe(48)}
    write_json(root / "private/instance.json", config)
    write_json(root / "private/login.json", _new_local_login())
    write_json(root / "dsh/profiles/qingmu/package.json", {
        "name": "qingmu-local-profile", "private": True,
        "dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]}}})
    # The private overlay uses built package URLs, preserving the actual bundle roster.
    # Profile resolution needs the browser modules and Host bridge named by the
    # bundle overlay. Server adapters use file URLs so an instance cannot fall
    # back to an unrelated globally installed package.
    for name in ("client-ui-brand-qingmu", "qingmu-director-context-bridge",
                 "client-ui-qingmu-cockpit"):
        link = root / "dsh/profiles/node_modules/@deepseek-ai" / ("dsh-experimental-" + name)
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(HARNESS / "packages/experimental" / name, target_is_directory=True)
    result = subprocess.run([*backend_command(config), "--initialize"], env=backend_env(root, config),
                            cwd=root / "work", capture_output=True, text=True, timeout=45)
    if result.returncode:
        (root / "logs/initialization.log").write_text(result.stderr)
        raise RuntimeError("初始化失败；目录保留以供诊断，未覆盖重试。见 logs/initialization.log")
    identity = json.loads(result.stdout.strip().splitlines()[-1])
    write_json(root / "identity.json", {**identity, "kind": "device-local-user", "humanSignoff": False})
    mark_lifecycle(root, config, "clean")
    if core is not None:
        record_build_manifest(root, config)
    return {"initialized": True, "root": str(root), "identity": identity,
            "message": "独立空库已创建，未创建或批准项目。使用 start 启动，然后 login 更新会话。"}


def http(url: str, *, token: str | None = None, payload: dict | None = None) -> dict:
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = "Bearer " + token
    request = urllib.request.Request(url, headers=headers,
        data=None if payload is None else json.dumps(payload).encode())
    # Explicitly bypass ambient HTTP_PROXY even on loopback.
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=3) as response:
        return json.load(response)


def host_rpc(host_url: str, method: str, payload: dict) -> dict:
    """Call one loopback Host RPC and verify its correlated success envelope."""
    rpc_id = "qingmu-launcher-" + secrets.token_hex(12)
    response = http(
        host_url + "/api/" + method,
        payload={"type": "client-request", "rpcId": rpc_id, "method": method, "payload": payload},
    )
    if response.get("type") != "server-response" or response.get("rpcId") != rpc_id:
        raise RuntimeError("青木 Host RPC 响应身份不匹配")
    result = response.get("result")
    if not isinstance(result, dict) or result.get("ok") is not True or not isinstance(result.get("value"), dict):
        code = result.get("error", {}).get("code") if isinstance(result, dict) else None
        raise RuntimeError("青木 Host RPC 失败" + ("：" + str(code) if code else ""))
    return result["value"]


def ensure_qingmu_workspace(root: Path, host_url: str, *, timeout: float = 10.0) -> dict:
    """Idempotently register the work directory once the Host API composition is ready."""
    expected = str((root / "work").resolve(strict=True))
    deadline = time.monotonic() + timeout
    while True:
        try:
            value = host_rpc(host_url, "workspace.create", {"path": expected})
            break
        except urllib.error.HTTPError as exc:
            # The static shell can answer before apiProxy finishes composing.
            # Only that exact transient 404 is retryable; business failures and
            # trust-fence errors stay fail-closed.
            if exc.code != 404 or time.monotonic() >= deadline:
                raise RuntimeError("青木 Host workspace 注册入口不可用") from exc
            time.sleep(0.05)
    workspace = value.get("workspace")
    if not isinstance(workspace, dict) or workspace.get("path") != expected:
        raise RuntimeError("青木 Host workspace 绑定不符；拒绝启动")
    return workspace


def control(root: Path, config: dict, operation: str) -> dict:
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(45)
        client.connect(str(root / "control.sock"))
        client.sendall(json.dumps({"key": config["controlKey"], "op": operation}).encode() + b"\n")
        data = b""
        while not data.endswith(b"\n"):
            part = client.recv(65536)
            if not part or len(data) > 1_000_000:
                raise RuntimeError("实例控制响应不完整")
            data += part
    result = json.loads(data)
    if result.get("error"):
        raise RuntimeError(result["error"])
    if result.get("instanceId") != config["instanceId"]:
        raise RuntimeError("实例控制身份不匹配")
    return result


@contextlib.contextmanager
def instance_lock(root: Path):
    with (root / "private/lifecycle.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("实例正在运行或启动中；未操作任何 PID") from exc
        yield


def available_port(preferred: int = 0) -> int:
    with socket.socket() as probe:
        # Match the actual servers: allow our closed connection's TIME_WAIT,
        # while an existing listener still makes bind fail (no SO_REUSEPORT).
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("127.0.0.1", preferred))
        return probe.getsockname()[1]


def require_http_loopback_origin(value: str) -> str:
    """Validate the isolated C0 mock origin before any Host process starts."""
    try:
        parsed = urllib.parse.urlparse(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise RuntimeError("director DSh mock endpoint must be HTTP loopback") from exc
    if (
        parsed.scheme != "http"
        or hostname not in {"127.0.0.1", "::1"}
        or port is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("director DSh mock endpoint must be HTTP loopback")
    return value.rstrip("/")


def validate_director_production_config(value: object) -> dict | None:
    """Validate the private D1 production route without reading its credential."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("导演 production 配置无效")
    required = {
        "productionOnly", "provider", "model", "baseUrl", "endpoint", "routeKey",
        "projectId", "episodeId", "methodPackageVersion", "methodPackageSha256",
        "maxPaidCny", "maxInputTokens", "maxOutputTokens", "thinking", "images",
        "files", "tools", "credentialFile", "transportEnabled", "interactiveEnabled",
    }
    if set(value) - (required | {"taskId"}) or not required.issubset(value):
        raise ValueError("导演 production 配置无效")
    if (
        value["productionOnly"] is not True
        or value["provider"] != "deepseek-official"
        or value["model"] != "deepseek-v4-pro"
        or value["baseUrl"] != DEEPSEEK_PRODUCTION_BASE_URL
        or value["endpoint"] != "/chat/completions"
        or value["maxPaidCny"] != 0.30
        or value["maxInputTokens"] != 8000
        or value["maxOutputTokens"] != 2000
        or value["thinking"] != "disabled"
        or any(value[name] is not False for name in ("images", "files", "tools"))
        or value["credentialFile"] != str(DEEPSEEK_PRODUCTION_CREDENTIAL_FILE)
        or not isinstance(value["transportEnabled"], bool)
        or not isinstance(value["interactiveEnabled"], bool)
        or (value["transportEnabled"] and value["interactiveEnabled"])
        or not all(isinstance(value.get(name), str) and value[name].strip() for name in (
            "routeKey", "projectId", "episodeId", "methodPackageVersion", "methodPackageSha256"
        ))
        or (value["transportEnabled"] and not str(value.get("taskId") or "").strip())
    ):
        raise ValueError("导演 production 配置无效")
    return value


def validate_text_foundation_production_config(value: object) -> dict | None:
    """Validate the one-instance Yimeng text worker authority.

    The value contains only scope and a credential-file reference.  Provider
    credentials remain in the owner-only Yimeng environment file and are never
    copied into the Qingmu instance JSON.
    """
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("易梦文本 production 配置无效")
    required = {
        "productionOnly",
        "provider",
        "projectId",
        "episodeId",
        "maxPaidCny",
        "allowedStages",
        "credentialEnvFile",
        "maxTasksPerTick",
        "maxAttempts",
        "allowExistingProviderPoll",
    }
    optional_lineage_fields = {
        "textFoundationParentTaskId",
        "assetReferenceParentTaskId",
    }
    keys = set(value)
    if keys - (required | optional_lineage_fields) or not required.issubset(keys):
        raise ValueError("易梦文本 production 配置无效")
    if (
        value["productionOnly"] is not True
        or value["provider"] != "dashscope"
        or not all(
            isinstance(value.get(name), str) and value[name].strip()
            for name in ("projectId", "episodeId")
        )
        or value["maxPaidCny"] != QINGMU_LOCAL_REMAINING_PAID_CNY
        or value["allowedStages"] != list(TEXT_FOUNDATION_STAGES)
        or value["credentialEnvFile"] != str(YIMENG_PROVIDER_ENV_FILE)
        or value["maxTasksPerTick"] != 1
        or value["maxAttempts"] != 1
        or value["allowExistingProviderPoll"] is not True
        or any(
            item is not None and (not isinstance(item, str) or not item.strip())
            for item in (
                value.get("textFoundationParentTaskId"),
                value.get("assetReferenceParentTaskId"),
            )
        )
    ):
        raise ValueError("易梦文本 production 配置无效")
    return value


def validate_project_production_config(value: object) -> dict | None:
    """Validate explicit authority for the full scoped production Worker."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("项目 production 配置无效")
    required = {
        "active",
        "projectId",
        "episodeId",
        "maxTasksPerTick",
        "maxAttempts",
        "maxConcurrentDispatches",
        "allowExistingProviderPoll",
    }
    if set(value) != required or (
        not isinstance(value["active"], bool)
        or not all(
            isinstance(value.get(name), str) and value[name].strip()
            for name in ("projectId", "episodeId")
        )
        or any(
            not isinstance(value[name], int)
            or isinstance(value[name], bool)
            or value[name] != 1
            for name in (
                "maxTasksPerTick",
                "maxAttempts",
                "maxConcurrentDispatches",
            )
        )
        or value["allowExistingProviderPoll"] is not True
    ):
        raise ValueError("项目 production 配置无效")
    return value


def mark_lifecycle(root: Path, config: dict, state: str) -> None:
    write_json(root / "private/lifecycle.json", {"instanceId": config["instanceId"], "state": state})


def write_stopped_runtime(root: Path, config: dict) -> None:
    """Persist listener/process truth after owned children are confirmed stopped."""
    previous_path = root / "runtime.json"
    ports_path = root / "private/ports.json"
    try:
        previous = json.loads(previous_path.read_text()) if previous_path.is_file() else {}
    except (OSError, ValueError):
        previous = {}
    try:
        ports = json.loads(ports_path.read_text()) if ports_path.is_file() else {}
    except (OSError, ValueError):
        ports = {}
    coordinates = {
        key: ports.get(key, previous.get(key))
        for key in ("apiPort", "hostPort", "webPort", "apiUrl", "hostUrl", "webUrl", "entryUrl")
        if ports.get(key, previous.get(key)) is not None
    }
    write_json(
        previous_path,
        {
            "instanceId": config["instanceId"],
            "root": str(root),
            "supervisorPid": None,
            "apiPid": None,
            "workerPid": None,
            "assetWorkerPid": None,
            "hostPid": None,
            "frontendPid": None,
            **coordinates,
            "apiProcessAlive": False,
            "workerProcessAlive": False,
            "assetWorkerProcessAlive": False,
            "hostProcessAlive": False,
            "frontendProcessAlive": False,
            "apiIdentityAndStorageVerified": False,
            "hostListenerAndHttpVerified": False,
            "frontendListenerAndHttpVerified": False,
            "ready": False,
            "session": "实例已停止；数据保留，重新启动后再验证会话",
        },
    )


def require_clean(root: Path, config: dict) -> None:
    marker = root / "private/lifecycle.json"
    value = json.loads(marker.read_text()) if marker.is_file() and not marker.is_symlink() else {}
    if value != {"instanceId": config["instanceId"], "state": "clean"}:
        raise RuntimeError("实例停止状态未知：监督进程可能异常退出。拒绝启动/冷备；未操作历史PID。请先人工核对本实例进程，勿删除运行标记")
    recovery = root / "private/crash-recovery.json"
    if recovery.exists() or recovery.is_symlink():
        raise RuntimeError("崩溃恢复提交尚未收尾；拒绝启动/冷备。请用同一实例ID再次运行 recover-crash")


def _persisted_process_exists(pid: object) -> bool:
    """Return whether one diagnostic PID still names any live process."""
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 1:
        raise ValueError("崩溃恢复缺少有效的历史进程标识")
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _path_has_open_handle(path: Path) -> bool:
    """Check one exact instance file without treating lsof output as ownership."""
    if not path.exists():
        return False
    result = subprocess.run(
        ["/usr/sbin/lsof", "-Fn", "--", str(path)],
        capture_output=True,
        timeout=10,
        env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin"},
    )
    if result.returncode == 0:
        return bool(result.stdout.strip())
    if (
        result.returncode == 1
        and not result.stdout.strip()
        and not result.stderr.strip()
    ):
        return False
    raise RuntimeError("无法核对实例数据库打开句柄；保持崩溃锁定")


def _validate_recorded_pids(value: dict, *, allow_empty_children: bool) -> dict:
    fields = (
        "supervisorPid",
        "apiPid",
        "workerPid",
        "assetWorkerPid",
        "hostPid",
        "frontendPid",
    )
    recorded = {name: value.get(name) for name in fields}
    for name, pid in recorded.items():
        if name == "assetWorkerPid" and pid is None:
            continue
        if allow_empty_children and name != "supervisorPid" and pid is None:
            continue
        if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 1:
            raise RuntimeError("崩溃恢复缺少有效的历史进程标识")
    return recorded


def _validate_recorded_ports(value: dict) -> dict:
    fields = ("apiPort", "hostPort", "webPort")
    recorded = {name: value.get(name) for name in fields}
    if any(
        not isinstance(port, int)
        or isinstance(port, bool)
        or port <= 0
        or port > 65535
        for port in recorded.values()
    ) or len(set(recorded.values())) != len(recorded):
        raise RuntimeError("历史端口记录不完整或漂移；保持崩溃锁定")
    return recorded


def _verify_crash_recovery_facts(
    root: Path,
    recorded_pids: dict,
    recorded_ports: dict,
) -> str:
    if any(
        _persisted_process_exists(pid)
        for pid in recorded_pids.values()
        if pid is not None
    ):
        raise RuntimeError("历史进程标识仍存活；保持崩溃锁定且不发送信号")
    try:
        for port in recorded_ports.values():
            available_port(port)
    except OSError as exc:
        raise RuntimeError("历史端口仍有监听者；保持崩溃锁定且不接管") from exc

    control_path = root / "control.sock"
    if control_path.exists() or control_path.is_symlink():
        if control_path.is_symlink() or not control_path.is_socket():
            raise RuntimeError("实例控制路径类型异常；保持崩溃锁定")
        with socket.socket(socket.AF_UNIX) as probe:
            probe.settimeout(1)
            try:
                probe.connect(str(control_path))
            except (FileNotFoundError, ConnectionRefusedError):
                pass
            except OSError as exc:
                raise RuntimeError("无法证明实例控制 socket 已失效；保持崩溃锁定") from exc
            else:
                raise RuntimeError("实例控制 socket 仍可连接；保持崩溃锁定")

    database = root / "storage/jason.db"
    database_paths = (
        database,
        database.with_name(database.name + "-wal"),
        database.with_name(database.name + "-shm"),
    )
    if any(_path_has_open_handle(path) for path in database_paths):
        raise RuntimeError("实例数据库仍有打开句柄；保持崩溃锁定")
    integrity = cold_integrity(database)
    if integrity != "ok":
        raise RuntimeError("实例数据库完整性检查失败；保持崩溃锁定")
    return integrity


def _read_crash_recovery_intent(
    root: Path,
    expected_instance_id: str,
    expected_ports: dict,
) -> tuple[dict, dict, dict, Path]:
    recovery = _read_owner_only_json(
        root / "private/crash-recovery.json", "崩溃恢复意图"
    )
    if (
        recovery.get("schema") != CRASH_RECOVERY_SCHEMA
        or recovery.get("instanceId") != expected_instance_id
        or recovery.get("state") != "verified"
        or recovery.get("recordedPorts") != expected_ports
        or recovery.get("ledgerSource") not in {
            "process-ledger", "legacy-runtime"
        }
        or (
            recovery.get("ledgerSource") == "process-ledger"
            and (
                not isinstance(recovery.get("ledgerGeneration"), int)
                or isinstance(recovery.get("ledgerGeneration"), bool)
                or recovery["ledgerGeneration"] < 1
            )
        )
        or (
            recovery.get("ledgerSource") == "legacy-runtime"
            and recovery.get("ledgerGeneration") is not None
        )
        or recovery.get("databaseIntegrity") != "ok"
        or recovery.get("signalsSent") is not False
        or recovery.get("providerCalls") != 0
        or not isinstance(recovery.get("verifiedAt"), str)
        or not recovery["verifiedAt"]
        or not isinstance(recovery.get("audit"), str)
        or not recovery["audit"]
    ):
        raise RuntimeError("崩溃恢复意图无效；保持崩溃锁定")
    recorded_pids = _validate_recorded_pids(
        recovery.get("recordedPids") or {}, allow_empty_children=True
    )
    recorded_ports = recovery["recordedPorts"]
    audit_path = Path(recovery["audit"])
    if audit_path.parent != root / "audit" or audit_path.suffix != ".json":
        raise RuntimeError("崩溃恢复审计路径越界；保持崩溃锁定")
    return recovery, recorded_pids, recorded_ports, audit_path


def _crash_recovery_audit(
    expected_instance_id: str,
    recovery: dict,
    recorded_pids: dict,
    recorded_ports: dict,
    integrity: str,
) -> dict:
    return {
        "schema": CRASH_RECOVERY_SCHEMA,
        "instanceId": expected_instance_id,
        "ledgerSource": recovery.get("ledgerSource"),
        "ledgerGeneration": recovery.get("ledgerGeneration"),
        "recordedPids": recorded_pids,
        "recordedPorts": recorded_ports,
        "databaseIntegrity": integrity,
        "signalsSent": False,
        "providerCalls": 0,
        "recoveredAt": recovery.get("verifiedAt"),
    }


def recover_crashed_instance(root: Path, config: dict, expected_instance_id: str) -> dict:
    """Confirm a fully dead recorded process set before clearing one dirty marker."""
    if expected_instance_id != config["instanceId"]:
        raise ValueError("崩溃恢复实例身份不匹配")
    with instance_lock(root):
        lifecycle = _read_owner_only_json(
            root / "private/lifecycle.json", "实例生命周期标记"
        )
        recovery_path = root / "private/crash-recovery.json"
        ports = _read_owner_only_json(root / "private/ports.json", "实例端口记录")
        expected_ports = _validate_recorded_ports(ports)
        if lifecycle == {"instanceId": expected_instance_id, "state": "clean"}:
            if not (recovery_path.exists() or recovery_path.is_symlink()):
                raise RuntimeError("实例不是可恢复的崩溃锁定状态；未修改")
            recovery, recorded_pids, recorded_ports, audit_path = (
                _read_crash_recovery_intent(
                    root, expected_instance_id, expected_ports
                )
            )
            integrity = _verify_crash_recovery_facts(
                root, recorded_pids, recorded_ports
            )
            runtime = _read_owner_only_json(
                root / "runtime.json", "实例停止运行状态"
            )
            if (
                runtime.get("instanceId") != expected_instance_id
                or runtime.get("ready") is not False
                or any(
                    runtime.get(name) is not None
                    for name in (
                        "supervisorPid", "apiPid", "workerPid",
                        "hostPid", "frontendPid",
                    )
                )
                or root.joinpath("control.sock").exists()
                or root.joinpath("control.sock").is_symlink()
            ):
                raise RuntimeError("崩溃恢复提交状态不完整；拒绝启动并保留恢复意图")
            audit = _crash_recovery_audit(
                expected_instance_id,
                recovery,
                recorded_pids,
                recorded_ports,
                integrity,
            )
            if _read_owner_only_json(audit_path, "崩溃恢复审计") != audit:
                raise RuntimeError("崩溃恢复审计漂移；拒绝启动并保留恢复意图")
            _remove_private_file(recovery_path)
            return {
                "instanceId": expected_instance_id,
                "recovered": True,
                "commitFinalized": True,
                "running": False,
                "databaseIntegrity": integrity,
                "signalsSent": False,
                "providerCalls": 0,
                "audit": str(audit_path),
                "message": "已完成中断后的崩溃恢复提交；实例保持停止，可显式 start。",
            }
        if lifecycle != {"instanceId": expected_instance_id, "state": "dirty"}:
            raise RuntimeError("实例不是可恢复的崩溃锁定状态；未修改")
        if recovery_path.exists() or recovery_path.is_symlink():
            recovery, recorded_pids, recorded_ports, audit_path = (
                _read_crash_recovery_intent(
                    root, expected_instance_id, expected_ports
                )
            )
        else:
            ledger_path = root / "private/process-ledger.json"
            if ledger_path.exists() or ledger_path.is_symlink():
                ledger = _read_owner_only_json(ledger_path, "实例进程账本")
                if (
                    ledger.get("schema") != PROCESS_LEDGER_SCHEMA
                    or ledger.get("instanceId") != expected_instance_id
                    or not isinstance(ledger.get("generation"), int)
                    or isinstance(ledger.get("generation"), bool)
                    or ledger["generation"] < 1
                ):
                    raise RuntimeError("实例进程账本无效；保持崩溃锁定")
                recorded_pids = _validate_recorded_pids(
                    ledger, allow_empty_children=True
                )
                recorded_ports = _validate_recorded_ports(ledger)
                ledger_source = "process-ledger"
                ledger_generation = ledger["generation"]
            else:
                runtime = _read_owner_only_json(
                    root / "runtime.json", "实例历史运行状态"
                )
                if runtime.get("instanceId") != expected_instance_id:
                    raise RuntimeError("历史运行状态与实例身份不符；保持崩溃锁定")
                recorded_pids = _validate_recorded_pids(
                    runtime, allow_empty_children=False
                )
                recorded_ports = _validate_recorded_ports(runtime)
                ledger_source = "legacy-runtime"
                ledger_generation = None
            if recorded_ports != expected_ports:
                raise RuntimeError("历史端口记录不完整或漂移；保持崩溃锁定")
            integrity = _verify_crash_recovery_facts(
                root, recorded_pids, recorded_ports
            )
            verified_at = utc_timestamp()
            audit_path = root / "audit" / (
                "crash-recovery-"
                + verified_at.replace(":", "").replace("-", "")
                + "-"
                + secrets.token_hex(4)
                + ".json"
            )
            recovery = {
                "schema": CRASH_RECOVERY_SCHEMA,
                "instanceId": expected_instance_id,
                "state": "verified",
                "ledgerSource": ledger_source,
                "ledgerGeneration": ledger_generation,
                "recordedPids": recorded_pids,
                "recordedPorts": recorded_ports,
                "databaseIntegrity": integrity,
                "signalsSent": False,
                "providerCalls": 0,
                "verifiedAt": verified_at,
                "audit": str(audit_path),
            }
            write_json(recovery_path, recovery)

        integrity = _verify_crash_recovery_facts(
            root, recorded_pids, recorded_ports
        )
        audit = _crash_recovery_audit(
            expected_instance_id,
            recovery,
            recorded_pids,
            recorded_ports,
            integrity,
        )
        if audit_path.exists() or audit_path.is_symlink():
            if _read_owner_only_json(audit_path, "崩溃恢复审计") != audit:
                raise RuntimeError("崩溃恢复审计漂移；保持崩溃锁定")
        else:
            write_json(audit_path, audit)

        # The durable intent above retains the original PID/port evidence if
        # either mutation fails. A repeated command re-verifies those facts and
        # resumes without trusting an already-replaced runtime.json.
        write_stopped_runtime(root, config)
        control_path = root / "control.sock"
        if control_path.exists() or control_path.is_symlink():
            control_path.unlink()
            _fsync_directory(control_path.parent)
        mark_lifecycle(root, config, "clean")
        _remove_private_file(recovery_path)
        return {
            "instanceId": expected_instance_id,
            "recovered": True,
            "running": False,
            "databaseIntegrity": "ok",
            "signalsSent": False,
            "providerCalls": 0,
            "audit": str(audit_path),
            "message": "已确认历史进程消失、端口空闲和数据库完整；实例保持停止，可显式 start。",
        }


def stop_child(child: subprocess.Popen | None) -> None:
    """Only a live Popen owned by this supervisor is a signal target."""
    if child is None or child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)


class Supervisor:
    def __init__(self, root: Path, config: dict, *, review_only: bool = False):
        self.root, self.config = root, config
        # Review startup deliberately owns only the read/review surface.  It
        # must not inherit an enabled project, asset, or Director dispatch
        # lane from the instance configuration.
        self.review_only = review_only
        self.api: subprocess.Popen | None = None
        self.worker: subprocess.Popen | None = None
        self._text_worker_heartbeat_only = False
        self._project_production_active = False
        self.assetWorker: subprocess.Popen | None = None
        self.host: subprocess.Popen | None = None
        self.frontend: subprocess.Popen | None = None
        self.stopping = False
        self.ports: dict = {}
        self.logs: list = []
        self.process_ledger_active = False

    def launch(
        self,
        argv: list[str],
        env: dict,
        label: str,
        *,
        cwd: Path | None = None,
    ) -> subprocess.Popen:
        log = (self.root / "logs" / (label + ".log")).open("ab")
        self.logs.append(log)
        return subprocess.Popen(argv, cwd=cwd or self.root / "work", env=env, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=log)

    def _persist_process_ledger(self) -> dict:
        path = self.root / "private/process-ledger.json"
        generation = 1
        if path.exists() or path.is_symlink():
            previous = _read_owner_only_json(path, "实例进程账本")
            if (
                previous.get("schema") != PROCESS_LEDGER_SCHEMA
                or previous.get("instanceId") != self.config["instanceId"]
                or not isinstance(previous.get("generation"), int)
                or isinstance(previous.get("generation"), bool)
                or previous["generation"] < 1
            ):
                raise RuntimeError("实例进程账本无效；拒绝继续启动")
            generation = previous["generation"] + 1
        ports = _validate_recorded_ports(self.ports)
        value = {
            "schema": PROCESS_LEDGER_SCHEMA,
            "instanceId": self.config["instanceId"],
            "generation": generation,
            "recordedAt": utc_timestamp(),
            "supervisorPid": os.getpid(),
            **{
                role + "Pid": getattr(self, role).pid
                if getattr(self, role) is not None
                else None
                for role in OWNED_PROCESS_ROLES
            },
            **ports,
        }
        write_json(path, value)
        return value

    def _persist_process_ledger_if_active(self) -> None:
        if self.process_ledger_active:
            self._persist_process_ledger()

    def launch_owned(
        self,
        role: str,
        argv: list[str],
        env: dict,
        label: str,
        *,
        cwd: Path | None = None,
    ) -> subprocess.Popen:
        if role not in OWNED_PROCESS_ROLES:
            raise ValueError("未知的实例子进程角色")
        child = self.launch(argv, env, label, cwd=cwd)
        setattr(self, role, child)
        try:
            self._persist_process_ledger_if_active()
        except Exception:
            stop_child(child)
            setattr(self, role, None)
            raise
        return child

    def stop_owned(self, role: str) -> None:
        if role not in OWNED_PROCESS_ROLES:
            raise ValueError("未知的实例子进程角色")
        stop_child(getattr(self, role))
        setattr(self, role, None)
        self._persist_process_ledger_if_active()

    def wait_ready(self, child: subprocess.Popen, probe) -> None:
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError("子进程退出；查看本实例 logs（未停止其他进程）")
            try:
                if probe():
                    return
            except (OSError, ValueError):
                pass
            time.sleep(0.15)
        raise RuntimeError("启动超时；查看本实例 logs")

    def api_identity(self) -> dict:
        value = http(self.ports["apiUrl"] + "/_qingmu/instance", token=self.config["controlKey"])
        expected = {"instanceId": self.config["instanceId"], "pid": self.api.pid,
                    "root": str(self.root), "database": str(self.root / "storage/jason.db"),
                    "storage": str(self.root / "storage")}
        if self.review_only:
            expected["reviewOnly"] = True
        if value != expected:
            raise ValueError("API身份/数据目录绑定不符")
        return value

    def host_healthy(self) -> bool:
        # The child identity is Popen-owned. Check the listening PID as well as HTTP.
        result = subprocess.run(["/usr/sbin/lsof", "-nP", "-a", "-p", str(self.host.pid),
                                 "-iTCP:" + str(self.ports["hostPort"]), "-sTCP:LISTEN", "-Fn"],
                                capture_output=True, text=True, timeout=3)
        if f"n127.0.0.1:{self.ports['hostPort']}" not in result.stdout:
            return False
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(self.ports["hostUrl"], timeout=3) as response:
            return response.status == 200 and b"__DSH_BOOT__" in response.read(2_000_000)

    def frontend_healthy(self) -> bool:
        """Verify the owned Next process, listener and Qingmu-branded entry."""
        result = subprocess.run(["/usr/sbin/lsof", "-nP", "-a", "-p", str(self.frontend.pid),
                                 "-iTCP:" + str(self.ports["webPort"]), "-sTCP:LISTEN", "-Fn"],
                                capture_output=True, text=True, timeout=3)
        if f"n127.0.0.1:{self.ports['webPort']}" not in result.stdout:
            return False
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
            self.ports["webUrl"] + "/login", timeout=3
        ) as response:
            body = response.read(2_000_000)
            return response.status == 200 and "青木 OS".encode() in body

    def start_host(self) -> None:
        overlay = (HARNESS / "packages/experimental/qingmu-web/cordis.patch.yml").read_text()
        # Browser seats retain manifest names so the ordinary modules plugin
        # discovers their dsh.client declarations through the profile symlinks.
        for name in ("qingmu-yimeng-read-adapter", "qingmu-imago-method-adapter", "qingmu-yimeng-command-adapter"):
            overlay = overlay.replace(f"name: '@deepseek-ai/dsh-experimental-{name}'",
                "name: " + json.dumps((HARNESS / "packages/experimental" / name / "lib/index.js").as_uri()))
        for adapter in ("read", "command"):
            overlay += f"\n- id: qingmu-yimeng-{adapter}-adapter\n  config:\n    baseUrl: {json.dumps(self.ports['apiUrl'])}\n"
            if adapter == "command" and not self.review_only:
                fixture = self.config.get("directorExecutionFixture") or {}
                if fixture.get("taskId"):
                    if fixture.get("transportMode") == "dsh-one-shot-mock":
                        mock_base_url = require_http_loopback_origin(str(fixture.get("mockBaseUrl") or ""))
                        overlay += (
                            "    directorDshTransportEnabled: true\n"
                            "    directorDshTaskId: " + json.dumps(fixture["taskId"]) + "\n"
                            "    directorDshMethodVersion: " + json.dumps(fixture["methodPackageVersion"]) + "\n"
                            "    directorDshMethodSha256: " + json.dumps(fixture["methodPackageSha256"]) + "\n"
                            "    directorDshMockBaseUrl: " + json.dumps(mock_base_url) + "\n"
                        )
                    else:
                        overlay += (
                            "    directorFixtureTaskId: " + json.dumps(fixture["taskId"]) + "\n"
                            "    directorFixtureMethodVersion: " + json.dumps(fixture["methodPackageVersion"]) + "\n"
                            "    directorFixtureMethodSha256: " + json.dumps(fixture["methodPackageSha256"]) + "\n"
                            "    directorFixtureResultJson: "
                            + json.dumps(json.dumps(fixture["transportResult"], ensure_ascii=False, separators=(",", ":")))
                            + "\n"
                        )
                production = self.config.get("directorProductionExecution") or {}
                if production.get("interactiveEnabled"):
                    overlay += (
                        "    directorProductionInteractiveEnabled: true\n"
                        "    directorProductionProjectId: " + json.dumps(production["projectId"]) + "\n"
                        "    directorProductionEpisodeId: " + json.dumps(production["episodeId"]) + "\n"
                        "    directorProductionMethodVersion: "
                        + json.dumps(production["methodPackageVersion"]) + "\n"
                        "    directorProductionMethodSha256: "
                        + json.dumps(production["methodPackageSha256"]) + "\n"
                    )
                    mock_base_url = self.config.get("_directorSubmitMockBaseUrl")
                    if mock_base_url:
                        overlay += "    directorDshMockBaseUrl: " + json.dumps(mock_base_url) + "\n"
                if production.get("transportEnabled"):
                    mock_base_url = self.config.get("_directorSubmitMockBaseUrl")
                    overlay += (
                        ("    directorDshTransportEnabled: true\n" if mock_base_url else
                         "    directorProductionTransportEnabled: true\n")
                        + ("    directorDshTaskId: " if mock_base_url else
                           "    directorProductionTaskId: ") + json.dumps(production["taskId"]) + "\n"
                        + ("    directorDshMethodVersion: " if mock_base_url else
                           "    directorProductionMethodVersion: ")
                        + json.dumps(production["methodPackageVersion"]) + "\n"
                        + ("    directorDshMethodSha256: " if mock_base_url else
                           "    directorProductionMethodSha256: ")
                        + json.dumps(production["methodPackageSha256"]) + "\n"
                    )
                    if mock_base_url:
                        overlay += "    directorDshMockBaseUrl: " + json.dumps(mock_base_url) + "\n"
        fixture = self.config.get("directorExecutionFixture") or {}
        if not self.review_only and fixture.get("transportMode") == "dsh-one-shot-mock":
            mock_base_url = require_http_loopback_origin(str(fixture.get("mockBaseUrl") or ""))
            overlay += (
                "\n- id: llm-deepseek\n  config:\n"
                "    baseURL: " + json.dumps(mock_base_url) + "\n"
                "    apiKeyEnv: QINGMU_C0_DEEPSEEK_KEY\n"
                "    thinking: disabled\n"
                "    reasoningEffort: off\n"
                "    retryPolicy:\n      mode: normal\n      maxRetries: 0\n"
            )
        production = self.config.get("directorProductionExecution") or {}
        if not self.review_only and (production.get("transportEnabled") or production.get("interactiveEnabled")):
            mock_base_url = self.config.get("_directorSubmitMockBaseUrl")
            if mock_base_url:
                overlay += (
                    "\n- id: llm-deepseek\n  config:\n"
                    "    baseURL: " + json.dumps(mock_base_url) + "\n"
                    "    apiKeyEnv: QINGMU_D1_LOCAL_MOCK_KEY\n"
                    "    thinking: disabled\n"
                    "    reasoningEffort: off\n"
                    "    maxTokens: 2000\n"
                    "    retryPolicy:\n      mode: normal\n      maxRetries: 0\n"
                )
            else:
                overlay += (
                    "\n- id: credentials\n  config:\n"
                    "    path: " + json.dumps(production["credentialFile"]) + "\n"
                    "    watch: false\n"
                    "\n- id: llm-deepseek\n  config:\n"
                    "    baseURL: " + json.dumps(DEEPSEEK_PRODUCTION_BASE_URL) + "\n"
                    "    thinking: disabled\n"
                    "    reasoningEffort: off\n"
                    "    maxTokens: 2000\n"
                    "    retryPolicy:\n      mode: normal\n      maxRetries: 0\n"
                )
        overlay += "\n- id: qingmu-imago-method-adapter\n  config:\n    coreRoot: " + json.dumps(self.config["coreRoot"]) + "\n"
        overlay_path = self.root / "private/local.patch.yml"
        overlay_path.write_text(overlay)
        env = safe_env(self.root)
        env["QINGMU_IMAGO_ATTESTATION_KEY"] = self.config["attestationKey"]
        if self.review_only:
            # The API and DSh host each receive an explicit fail-closed marker.
            # Do not expose the Director dispatch or editorial authority keys
            # to a process that only serves existing review material.
            env["QINGMU_REVIEW_ONLY"] = "1"
        # No compatibility fallback: pre-B instances without this field keep
        # Director paid execution disabled until restored into a new root.
        if not self.review_only and self.config.get("directorExecutionKey"):
            env["QINGMU_DIRECTOR_EXECUTION_KEY"] = self.config["directorExecutionKey"]
        if not self.review_only and self.config.get("editorialHandoffKey"):
            env["QINGMU_EDITORIAL_HANDOFF_KEY"] = self.config["editorialHandoffKey"]
        if not self.review_only and self.config.get("_directorSubmitMockBaseUrl"):
            env["QINGMU_D1_LOCAL_MOCK_KEY"] = "isolated-local-mock-only"
        session = self.root / "private/session.json"
        if session.exists():
            env["YIMENG_API_TOKEN"] = json.loads(session.read_text())["token"]
        self.host = self.launch_owned(
            "host",
            [self.config["node"], str(HARNESS / "apps/cli/lib/bin.js"),
             "--profile", "qingmu", "--patch", str(overlay_path), "--host", "127.0.0.1",
             "--port", str(self.ports["hostPort"]), "--no-open"],
            env,
            "host",
        )
        self.wait_ready(self.host, self.host_healthy)
        # Register the instance-owned directory through the same durable Host
        # contract used by the UI. The client startup policy can then create
        # and select one real DSh Session; restart reuses this workspace.
        ensure_qingmu_workspace(self.root, self.ports["hostUrl"])

    def start_frontend(self) -> None:
        writer = Path(self.config["yimengRoot"])
        frontend = writer / "frontend"
        next_entry = frontend / "node_modules/next/dist/bin/next"
        if not (frontend / ".next/BUILD_ID").is_file() or not next_entry.is_file():
            raise RuntimeError("易梦六阶段前端尚未构建；请先在绑定的 frontend 目录运行 npm run build")
        env = safe_env(self.root)
        env.update({
            "QINGMU_LOCAL_API_URL": self.ports["apiUrl"],
            "QINGMU_DSH_HOST_URL": self.ports["hostUrl"],
            "QINGMU_LOCAL_PUBLIC_ORIGIN": self.ports["webUrl"],
        })
        if self.review_only:
            env["QINGMU_REVIEW_ONLY"] = "1"
            env["QINGMU_DSH_HOST_DISABLED"] = "1"
        session = self.root / "private/session.json"
        if session.exists():
            env["QINGMU_LOCAL_SESSION_TOKEN"] = json.loads(session.read_text())["token"]
        self.frontend = self.launch_owned(
            "frontend",
            [self.config["frontendNode"], str(next_entry), "start", "-H", "127.0.0.1",
             "-p", str(self.ports["webPort"])],
            env,
            "frontend",
            cwd=frontend,
        )
        self.wait_ready(self.frontend, self.frontend_healthy)

    def _worker_environment(
        self,
        writer: Path,
        production: dict | None,
        *,
        project_production_active: bool = False,
    ) -> dict:
        """Bind Worker media verification to the same instance secret as the API.

        Provider credentials may come from the scoped env file, but its JWT
        secret and ambient shell secrets cannot replace the instance identity.
        """
        environment = {
            **safe_env(self.root),
            "PYTHONPATH": str(writer / "backend/src"),
            "JASON_PROJECT_ROOT": str(self.root),
            "JASON_CONFIG_ROOT": str(writer),
            "JASON_ENV_FILE": (
                production["credentialEnvFile"]
                if production
                else str(self.root / "private/no-ambient.env")
            ),
            "DATABASE_URL": f"sqlite:///{self.root / 'storage/jason.db'}",
            "STORAGE_ROOT": str(self.root / "storage"),
            "JWT_SECRET": self.config["jwtSecret"],
            "APP_ENV": "production" if project_production_active else "development",
            "APP_HOST": "127.0.0.1",
            "QINGMU_CHANGESET_ENABLED": "true",
            "PUBLIC_REGISTRATION_ENABLED": "false",
            "ALLOW_PAID": "true" if production else "false",
            "MAX_PAID_CNY": str(production["maxPaidCny"] if production else 0),
            "PROVIDER_BUDGET_BASELINE_CNY": "0",
            "PROVIDER_BUDGET_WINDOW_ID": "",
            "PROVIDER_PAID_SCOPE_REQUIRED": "true",
            "PROVIDER_PAID_SCOPE_PROJECT_ID": production["projectId"] if production else "",
            "PROVIDER_PAID_SCOPE_EPISODE_ID": production["episodeId"] if production else "",
            "BUILD_MANIFEST_DIR": str(self.root / "build-manifest"),
            "OPERATOR_AUDIT_DIR": str(self.root / "audit"),
        }
        if project_production_active:
            environment["WORKER_CREATIVE_FRESHNESS_ENFORCE"] = "false"
        return environment

    def start_worker(self) -> None:
        """Start an explicitly scoped production Worker or the safe text mode.

        The ordinary API wrapper applies its environment inside its own Python
        process.  A separately spawned Worker therefore needs the same explicit
        database/storage binding, rather than inheriting a developer shell or
        the API process environment.  A project/episode scope alone is never
        Provider authority: this Worker receives one currently confirmed parent
        id.  A missing id leaves the process in no-credential heartbeat mode.
        """
        writer = Path(self.config["yimengRoot"])
        production = validate_text_foundation_production_config(
            self.config.get("textFoundationProductionExecution")
        )
        project_production = validate_project_production_config(
            self.config.get("projectProductionExecution")
        )
        self._project_production_active = bool(
            project_production and project_production["active"]
        )
        if self._project_production_active:
            if production is None or (
                project_production["projectId"] != production["projectId"]
                or project_production["episodeId"] != production["episodeId"]
            ):
                raise RuntimeError("项目 production 激活范围与 Provider 配置不匹配")
            _private_regular_file(Path(production["credentialEnvFile"]))
            self._text_worker_heartbeat_only = False
            env = self._worker_environment(
                writer,
                production,
                project_production_active=True,
            )
            command = [
                str(writer / ".venv/bin/python"),
                "-B",
                "-m",
                "jason.apps.studio.worker_cli",
                "--lane",
                "all",
                "--max-tasks",
                str(project_production["maxTasksPerTick"]),
                "--max-attempts",
                str(project_production["maxAttempts"]),
                "--max-concurrent-dispatches",
                str(project_production["maxConcurrentDispatches"]),
                "--allow-existing-provider-poll",
                "--allowed-project-id",
                project_production["projectId"],
                "--allowed-episode-id",
                project_production["episodeId"],
                "--disable-durable-director-orchestration",
            ]
            self.worker = self.launch_owned("worker", command, env, "worker")
            if self.worker.poll() is not None:
                raise RuntimeError("本机项目生产 Worker 启动即退出；查看本实例 logs/worker.log")
            return
        parent_id = str((production or {}).get("textFoundationParentTaskId") or "").strip()
        # The bound id remains in the instance configuration as audit evidence.
        # A completed, exact parent has no remaining text work, so its Worker
        # must run without credentials rather than exit normally and tear down
        # the unrelated API/Host/frontend processes.
        active_production = (
            production
            if parent_id and not self._text_parent_terminal_for_heartbeat(production)
            else None
        )
        self._text_worker_heartbeat_only = active_production is None
        env = self._worker_environment(writer, active_production)
        command = [
            str(writer / ".venv/bin/python"),
            "-B",
            "-m",
            "jason.apps.studio.worker_cli",
            "--lane",
            "text",
        ]
        if active_production:
            _private_regular_file(Path(production["credentialEnvFile"]))
            command.extend([
                "--max-tasks",
                str(production["maxTasksPerTick"]),
                "--max-attempts",
                str(production["maxAttempts"]),
                "--allow-existing-provider-poll",
                "--allowed-parent-task-id",
                parent_id,
                "--allowed-project-id",
                production["projectId"],
                "--allowed-episode-id",
                production["episodeId"],
            ])
            for stage in production["allowedStages"]:
                command.extend(["--allowed-foundation-stage", stage])
        else:
            command.extend(["--heartbeat-only", "--max-tasks", "0"])
        command.append("--disable-durable-director-orchestration")
        self.worker = self.launch_owned(
            "worker",
            command,
            env,
            "worker",
        )
        if self.worker.poll() is not None:
            raise RuntimeError("本机文本 Worker 启动即退出；查看本实例 logs/worker.log")

    def _text_parent_terminal_for_heartbeat(self, production: dict) -> bool:
        """Return whether the one bound text parent may safely lose credentials.

        This is an exact-id lookup, never a scope scan.  Any unreadable row,
        unknown provider outcome, malformed request, or scope drift keeps the
        normal bounded Worker path so the supervisor fails closed.
        """
        parent_id = str(production.get("textFoundationParentTaskId") or "").strip()
        if not parent_id:
            return False
        try:
            with sqlite3.connect(self.root / "storage/jason.db") as connection:
                row = connection.execute(
                    "SELECT capability, local_status, provider_status, request_payload_json "
                    "FROM generation_tasks WHERE id = ?",
                    (parent_id,),
                ).fetchone()
        except sqlite3.OperationalError:
            return False
        if row is None or row[0] != "workflow.text_foundation":
            return False
        try:
            payload = json.loads(row[3])
        except (TypeError, ValueError):
            return False
        return (
            str(row[1] or "").strip().lower()
            in {"succeeded", "failed", "blocked", "cancelled", "canceled"}
            and str(row[2] or "").strip().lower()
            not in {"unknown", "submission_unknown"}
            and str(payload.get("project_id") or "") == production["projectId"]
            and str(payload.get("episode_id") or "") == production["episodeId"]
            and str(payload.get("target_stage") or "") in production["allowedStages"]
        )

    def _reap_terminal_text_worker(self) -> bool:
        """Replace one normally exited exact-parent text Worker with heartbeat only."""
        if self._project_production_active:
            return False
        child = self.worker
        return_code = None if child is None else child.poll()
        if (
            child is None
            or return_code is None
            or return_code != 0
            or self._text_worker_heartbeat_only
        ):
            return False
        production = validate_text_foundation_production_config(
            self.config.get("textFoundationProductionExecution")
        )
        if production is None or not self._text_parent_terminal_for_heartbeat(production):
            return False
        self.stop_owned("worker")
        self.start_worker()
        return True

    @staticmethod
    def _stable_json_sha256(value: object) -> str:
        return hashlib.sha256(
            json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

    def _asset_activation_binding_path(self) -> Path:
        return self.root / "private/asset-activation.json"

    def _validate_asset_parent_activation(
        self,
        request: dict,
        *,
        allowed_local_statuses: frozenset[str] = frozenset({"queued"}),
    ) -> dict:
        """Validate one API-requested parent against this instance database.

        The supervisor owns this check because the API must never receive the
        control key or a Provider credential.  A parent is usable only while
        its immutable request payload still agrees with the activation call.
        """
        production = validate_text_foundation_production_config(
            self.config.get("textFoundationProductionExecution")
        )
        if production is None:
            raise ValueError("本机未绑定文本/资产运行范围")
        task_id = str(request.get("parentTaskId") or "").strip()
        project_id = str(request.get("projectId") or "").strip()
        episode_id = str(request.get("episodeId") or "").strip()
        manifest_hash = str(request.get("manifestHash") or "").strip()
        call_plan_hash = str(request.get("callPlanHash") or "").strip()
        if (
            not task_id
            or len(manifest_hash) != 64
            or len(call_plan_hash) != 64
            or any(item != item.lower() or any(c not in "0123456789abcdef" for c in item)
                   for item in (manifest_hash, call_plan_hash))
            or project_id != production["projectId"]
            or episode_id != production["episodeId"]
        ):
            raise ValueError("资产 parent 激活范围或哈希无效")
        database = self.root / "storage/jason.db"
        with sqlite3.connect(database) as connection:
            row = connection.execute(
                "SELECT capability, route_key, model, local_status, request_payload_json "
                "FROM generation_tasks WHERE id = ?",
                (task_id,),
            ).fetchone()
        if (
            row is None
            or row[0] != "workflow.asset_reference_batch"
            or str(row[3] or "").strip().lower() not in allowed_local_statuses
        ):
            raise ValueError("资产 parent 不存在、能力不符或状态不可激活")
        try:
            payload = json.loads(row[4])
            manifest = payload["manifest"]
        except (TypeError, ValueError, KeyError) as exc:
            raise ValueError("资产 parent 请求载荷无效") from exc
        target_stage = str(payload.get("target_stage") or "")
        expected_route_model = {
            "asset_reference_initial": (
                "pipeline.asset_reference_batch", "asset-reference-batch"
            ),
            "asset_reference_audit": (
                "pipeline.asset_reference_audit_batch", "asset-reference-audit-batch"
            ),
        }.get(target_stage)
        if (
            expected_route_model is None
            or (row[1], row[2]) != expected_route_model
            or not isinstance(manifest, list)
            or str(payload.get("project_id") or "") != project_id
            or str(payload.get("episode_id") or "") != episode_id
            or str(payload.get("call_plan_hash") or "") != call_plan_hash
            or call_plan_hash != manifest_hash
            or self._stable_json_sha256(manifest) != manifest_hash
        ):
            raise ValueError("资产 parent 清单或调用计划已漂移")
        return {
            "schema": "qingmu.asset-parent-activation.v1",
            "instanceId": self.config["instanceId"],
            "parentTaskId": task_id,
            "projectId": project_id,
            "episodeId": episode_id,
            "manifestHash": manifest_hash,
            "callPlanHash": call_plan_hash,
        }

    def _read_asset_activation_binding(self) -> dict | None:
        path = self._asset_activation_binding_path()
        if not path.exists():
            return None
        binding = _read_owner_only_json(path, "资产 parent 激活绑定")
        if (
            binding.get("schema") != "qingmu.asset-parent-activation.v1"
            or binding.get("instanceId") != self.config["instanceId"]
        ):
            raise RuntimeError("资产 parent 激活绑定无效")
        return binding

    def _asset_parent_terminal_for_rollover(self, binding: dict) -> bool:
        """Return whether one persisted parent can no longer dispatch work."""
        with sqlite3.connect(self.root / "storage/jason.db") as connection:
            try:
                row = connection.execute(
                    "SELECT capability, local_status, provider_status, request_payload_json "
                    "FROM generation_tasks WHERE id = ?",
                    (binding["parentTaskId"],),
                ).fetchone()
            except sqlite3.OperationalError:
                return False
        if row is None or row[0] != "workflow.asset_reference_batch":
            return False
        try:
            payload = json.loads(row[3])
        except (TypeError, ValueError):
            return False
        return (
            str(row[1]).lower() in {"succeeded", "failed", "blocked", "cancelled"}
            and str(row[2] or "").lower() not in {"unknown", "submission_unknown"}
            and str(payload.get("project_id") or "") == binding["projectId"]
            and str(payload.get("episode_id") or "") == binding["episodeId"]
        )

    def _asset_parent_locally_terminal(self, binding: dict) -> bool:
        """Return whether the bound parent needs no Worker, including unknown outcomes."""
        try:
            with sqlite3.connect(self.root / "storage/jason.db") as connection:
                row = connection.execute(
                    "SELECT capability, local_status FROM generation_tasks WHERE id = ?",
                    (binding["parentTaskId"],),
                ).fetchone()
        except (KeyError, sqlite3.OperationalError):
            return False
        return bool(
            row is not None
            and row[0] == "workflow.asset_reference_batch"
            and str(row[1] or "").strip().lower()
            in {"succeeded", "failed", "blocked", "cancelled", "canceled"}
        )

    def _reap_terminal_asset_worker(self) -> bool:
        """Forget an exited exact-parent Worker only after its parent is terminal."""
        child = self.assetWorker
        return_code = None if child is None else child.poll()
        if child is None or return_code is None or return_code != 0:
            return False
        binding = self._read_asset_activation_binding()
        if binding is None or not self._asset_parent_locally_terminal(binding):
            return False
        self.stop_owned("assetWorker")
        return True

    def activate_asset_parent(self, request: dict) -> dict:
        """Persist and run precisely one confirmed asset-reference parent."""
        existing = self._read_asset_activation_binding()
        same_parent = bool(
            existing is not None
            and existing.get("parentTaskId") == str(request.get("parentTaskId") or "").strip()
        )
        allowed_statuses = (
            frozenset({"queued", "running", "succeeded", "failed", "blocked", "cancelled", "canceled"})
            if same_parent
            else frozenset({"queued"})
        )
        expected = self._validate_asset_parent_activation(
            request, allowed_local_statuses=allowed_statuses
        )
        if existing is not None and existing["parentTaskId"] != expected["parentTaskId"]:
            if not self._asset_parent_terminal_for_rollover(existing):
                raise RuntimeError("已有不同资产 parent 尚未终态；拒绝替换")
            if self.assetWorker is not None and self.assetWorker.poll() is None:
                self.stop_owned("assetWorker")
        if existing is not None and existing != expected:
            if existing["parentTaskId"] == expected["parentTaskId"]:
                raise RuntimeError("已有资产 parent 激活绑定与当前清单不符")
        if same_parent and self._asset_parent_locally_terminal(existing):
            return {
                "instanceId": self.config["instanceId"],
                "parentTaskId": expected["parentTaskId"],
                "activated": True,
                "idempotent": True,
            }
        if existing is None or existing["parentTaskId"] != expected["parentTaskId"]:
            write_json(self._asset_activation_binding_path(), expected)
            execution = dict(self.config.get("textFoundationProductionExecution") or {})
            # Older local instances predate independent lineage fields.  Keep
            # both names canonical while allowing either workflow to run alone.
            execution.setdefault("textFoundationParentTaskId", None)
            execution["assetReferenceParentTaskId"] = expected["parentTaskId"]
            updated = dict(self.config)
            updated["textFoundationProductionExecution"] = execution
            write_json(self.root / "private/instance.json", updated)
            self.config = read_config(self.root)
        if self.assetWorker is None or self.assetWorker.poll() is not None:
            self.start_asset_worker()
        return {
            "instanceId": self.config["instanceId"],
            "parentTaskId": expected["parentTaskId"],
            "activated": True,
            "idempotent": existing is not None and existing["parentTaskId"] == expected["parentTaskId"],
        }

    def start_asset_worker(self) -> None:
        """Start only the exact bound asset-reference parent; never scan a scope."""
        project_production = validate_project_production_config(
            self.config.get("projectProductionExecution")
        )
        if project_production is not None and project_production["active"]:
            self.assetWorker = None
            return
        writer = Path(self.config["yimengRoot"])
        production = validate_text_foundation_production_config(
            self.config.get("textFoundationProductionExecution")
        )
        parent_id = str((production or {}).get("assetReferenceParentTaskId") or "").strip()
        if not parent_id:
            self.assetWorker = None
            return
        binding = self._read_asset_activation_binding()
        if binding is None and self.config.get("assetActivationKey"):
            raise RuntimeError("资产 Worker 缺少精确 parent 激活绑定")
        if binding is not None:
            if binding.get("parentTaskId") != parent_id:
                raise RuntimeError("资产 Worker parent 激活绑定不匹配")
            if self._asset_parent_locally_terminal(binding):
                self.assetWorker = None
                return
            self._validate_asset_parent_activation(
                binding, allowed_local_statuses=frozenset({"queued", "running"})
            )
        _private_regular_file(Path(production["credentialEnvFile"]))
        command = [
            str(writer / ".venv/bin/python"), "-B", "-m",
            "jason.apps.studio.worker_cli", "--lane", "image",
            "--asset-reference-batch-only",
            "--allowed-asset-reference-parent-task-id", parent_id,
            "--max-tasks", str(production["maxTasksPerTick"]),
            "--max-attempts", str(production["maxAttempts"]),
            "--allow-existing-provider-poll",
            "--allowed-project-id", production["projectId"],
            "--allowed-episode-id", production["episodeId"],
            "--disable-durable-director-orchestration",
        ]
        self.assetWorker = self.launch_owned(
            "assetWorker", command, self._worker_environment(writer, production), "asset-worker"
        )
        if self.assetWorker.poll() is not None:
            raise RuntimeError("本机资产 Worker 启动即退出；查看本实例 logs/asset-worker.log")

    def status(self) -> dict:
        api_alive = self.api is not None and self.api.poll() is None
        worker_alive = self.worker is not None and self.worker.poll() is None
        if self.review_only:
            asset_worker_required = False
        else:
            binding = self._read_asset_activation_binding()
            project_production = validate_project_production_config(
                self.config.get("projectProductionExecution")
            )
            full_worker_owns_asset_lane = bool(
                project_production is not None and project_production["active"]
            )
            asset_worker_required = (
                not full_worker_owns_asset_lane
                and bool(binding)
                and not self._asset_parent_locally_terminal(binding)
            )
        asset_worker_alive = self.assetWorker is not None and self.assetWorker.poll() is None
        host_alive = self.host is not None and self.host.poll() is None
        frontend_alive = self.frontend is not None and self.frontend.poll() is None
        api_verified = host_verified = frontend_verified = False
        try:
            api_verified = api_alive and bool(self.api_identity())
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
        if not self.review_only:
            try:
                host_verified = host_alive and self.host_healthy()
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
        try:
            frontend_verified = frontend_alive and self.frontend_healthy()
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
        session = "未登录：运行 login"
        try:
            token = json.loads((self.root / "private/session.json").read_text())["token"]
            identity = http(self.ports["apiUrl"] + "/api/auth/me", token=token)
            session = "已登录：" + identity["username"]
        except (OSError, ValueError):
            session = "会话缺失或过期：运行 login，然后重新打开 entryUrl；不会自动重发命令"
        manifest = build_manifest_status(self.root, self.config, review_only=self.review_only)
        return {"instanceId": self.config["instanceId"], "root": str(self.root),
                "supervisorPid": os.getpid(), "apiPid": self.api.pid if self.api else None,
                "workerPid": self.worker.pid if self.worker else None,
                "assetWorkerPid": self.assetWorker.pid if self.assetWorker else None,
                "hostPid": self.host.pid if self.host else None, **self.ports,
                "frontendPid": self.frontend.pid if self.frontend else None,
                "apiProcessAlive": api_alive, "workerProcessAlive": worker_alive,
                "assetWorkerProcessAlive": asset_worker_alive,
                "hostProcessAlive": host_alive,
                "hostDisabledForReview": self.review_only,
                "frontendProcessAlive": frontend_alive,
                "apiIdentityAndStorageVerified": api_verified, "hostListenerAndHttpVerified": host_verified,
                "frontendListenerAndHttpVerified": frontend_verified,
                "reviewOnly": self.review_only,
                "dispatchWorkersDisabled": self.review_only,
                "buildManifest": manifest,
                "buildManifestMatches": manifest["matches"],
                "ready": bool(
                    api_verified and (self.review_only or (worker_alive and (not asset_worker_required or asset_worker_alive)))
                    and (self.review_only or host_verified) and frontend_verified and manifest["matches"]
                ),
                "session": session}

    def login(self) -> dict:
        self.api_identity()
        credentials = json.loads((self.root / "private/login.json").read_text())
        try:
            result = http(self.ports["apiUrl"] + "/api/auth/login", payload=credentials)
        except urllib.error.HTTPError as exc:
            raise RuntimeError("登录失败；凭据未改变，Draft 与回执仍保留") from exc
        write_json(self.root / "private/session.json", {"token": result["token"]})
        # Explicit login restarts only our Host and frontend to refresh their environment token.
        # It never replays an interrupted command; the existing receipt UI recovers it.
        self.stop_owned("frontend")
        if not self.review_only:
            self.stop_owned("host")
            self.start_host()
        self.start_frontend()
        status = self.status()
        write_json(self.root / "runtime.json", status)
        return {**status, "message": "会话已更新。请重新打开 entryUrl；未知提交结果请先恢复原回执，不要新建命令。"}

    def run(self) -> None:
        with instance_lock(self.root):
            require_clean(self.root, self.config)
            control_path = self.root / "control.sock"
            activation_path = self.root / "private/asset-activation.sock"
            # The lock proves no live supervisor owns this exact socket.
            if control_path.exists() or control_path.is_symlink():
                control_path.unlink()
            if activation_path.exists() or activation_path.is_symlink():
                activation_path.unlink()
            with socket.socket(socket.AF_UNIX) as server, socket.socket(socket.AF_UNIX) as activation_server:
                server.bind(str(control_path))
                os.chmod(control_path, 0o600)
                server.listen(4)
                server.settimeout(0.5)
                if not self.review_only:
                    activation_server.bind(str(activation_path))
                    os.chmod(activation_path, 0o600)
                    activation_server.listen(2)
                    activation_server.settimeout(0.5)
                try:
                    # A free flock does not prove orphaned children have exited.
                    # Persist before any spawn; only owned Popen waits clear it.
                    mark_lifecycle(self.root, self.config, "dirty")
                    persisted = self.root / "private/ports.json"
                    preferred = json.loads(persisted.read_text()) if persisted.exists() else {}
                    # Preserve browser origin across restarts. Occupied ports fail closed.
                    api_port = available_port(preferred.get("apiPort", 0))
                    host_port = available_port(preferred.get("hostPort", 0))
                    web_port = available_port(preferred.get("webPort", 0))
                    while len({api_port, host_port, web_port}) != 3:
                        host_port, web_port = available_port(), available_port()
                    self.ports = {"apiPort": api_port, "hostPort": host_port, "webPort": web_port,
                                  "apiUrl": f"http://127.0.0.1:{api_port}",
                                  "hostUrl": f"http://127.0.0.1:{host_port}",
                                  "webUrl": f"http://127.0.0.1:{web_port}",
                                  "entryUrl": f"http://127.0.0.1:{web_port}/qingmu-runtime/local-session"}
                    write_json(persisted, self.ports)
                    self.process_ledger_active = True
                    self._persist_process_ledger()
                    mark_build_started(self.root, self.config, self.ports, review_only=self.review_only)
                    api_env = backend_env(self.root, self.config)
                    if self.review_only:
                        # No activation control path is handed to an API that
                        # is intentionally incapable of starting any worker.
                        api_env["QINGMU_REVIEW_ONLY"] = "1"
                        api_env.pop("QINGMU_ASSET_ACTIVATION_SOCKET", None)
                        api_env.pop("QINGMU_ASSET_ACTIVATION_KEY", None)
                    self.api = self.launch_owned(
                        "api",
                        [*backend_command(self.config), "--port", str(api_port)],
                        api_env,
                        "api",
                    )
                    self.wait_ready(self.api, self.api_identity)
                    if not self.review_only:
                        self.start_worker()
                        self.start_asset_worker()
                        self.start_host()
                    self.start_frontend()
                    write_json(self.root / "runtime.json", self.status())
                    while not self.stopping:
                        if not self.review_only:
                            self._reap_terminal_text_worker()
                            self._reap_terminal_asset_worker()
                        if any(
                            getattr(self, role) is None or getattr(self, role).poll() is not None
                            for role in (("api", "frontend") if self.review_only else ("api", "worker", "host", "frontend"))
                        ) or (not self.review_only and self.assetWorker is not None and self.assetWorker.poll() is not None):
                            raise RuntimeError("本实例子进程退出，正在清理其余自有子进程")
                        listeners = (server,) if self.review_only else (server, activation_server)
                        readable, _, _ = select.select(listeners, (), (), 0.5)
                        if not readable:
                            continue
                        listener = readable[0]
                        client, _ = listener.accept()
                        with client:
                            client.settimeout(3)
                            try:
                                data = b""
                                while not data.endswith(b"\n"):
                                    part = client.recv(4096)
                                    if not part or len(data) > 8192:
                                        raise ValueError("控制请求不完整")
                                    data += part
                                request = json.loads(data)
                                if listener is activation_server:
                                    if self.review_only:
                                        raise ValueError("审片模式禁止资产 Worker 激活")
                                    activation_key = str(self.config.get("assetActivationKey") or "")
                                    if not activation_key or not secrets.compare_digest(
                                        str(request.get("key", "")), activation_key
                                    ):
                                        raise ValueError("资产激活身份不符")
                                    if request.get("op") != "activate_asset_parent":
                                        raise ValueError("未知资产激活操作")
                                    result = {"ok": True, **self.activate_asset_parent(request)}
                                elif not secrets.compare_digest(str(request.get("key", "")), self.config["controlKey"]):
                                    raise ValueError("控制身份不符")
                                elif request["op"] == "login":
                                    result = self.login()
                                elif request["op"] == "stop":
                                    self.stopping = True
                                    self.stop_owned("frontend")
                                    self.stop_owned("host")
                                    self.stop_owned("assetWorker")
                                    self.stop_owned("worker")
                                    self.stop_owned("api")
                                    result = {"stopped": True, "instanceId": self.config["instanceId"], "dataPreserved": True}
                                elif request["op"] == "status":
                                    result = self.status()
                                else:
                                    raise ValueError("未知控制操作")
                            except Exception as exc:
                                result = {
                                    "ok": False,
                                    "error": str(exc),
                                    "instanceId": self.config["instanceId"],
                                }
                            try:
                                client.sendall(json.dumps(result, ensure_ascii=False).encode() + b"\n")
                            except OSError:
                                pass
                finally:
                    try:
                        for role in reversed(OWNED_PROCESS_ROLES):
                            stop_child(getattr(self, role))
                            setattr(self, role, None)
                        self._persist_process_ledger_if_active()
                        write_stopped_runtime(self.root, self.config)
                        mark_lifecycle(self.root, self.config, "clean")
                        control_path.unlink(missing_ok=True)
                        activation_path.unlink(missing_ok=True)
                    finally:
                        for log in self.logs:
                            log.close()


def start(
    root: Path,
    config: dict,
    *,
    return_owned_supervisor: bool = False,
    review_only: bool = False,
) -> dict | tuple[dict, subprocess.Popen]:
    try:
        existing = control(root, config, "status")
        if existing.get("reviewOnly", False) is not review_only:
            raise RuntimeError("已运行实例不是请求的启动模式；未停止或替换既有进程")
        if return_owned_supervisor:
            raise RuntimeError("轮换要求停止实例；检测到既有运行实例")
        return existing
    except (FileNotFoundError, ConnectionRefusedError):
        pass
    with instance_lock(root):
        require_clean(root, config)
        require_build_manifest_matches(root, config, review_only=review_only)
    log = (root / "logs/supervisor.log").open("ab")
    with log:
        command = [sys.executable, str(Path(__file__).resolve()), "_supervise", "--root", str(root)]
        if review_only:
            command.append("--review-only")
        child = subprocess.Popen(command,
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, env=safe_env(root))
    try:
        deadline = time.monotonic() + 75
        while time.monotonic() < deadline:
            try:
                result = control(root, config, "status")
                return (result, child) if return_owned_supervisor else result
            except (FileNotFoundError, ConnectionRefusedError):
                if child.poll() is not None:
                    raise RuntimeError("启动失败，见 logs/supervisor.log；未操作未知进程")
                time.sleep(0.15)
        raise RuntimeError("启动尚未确认；运行 status 检查，不自动重复启动")
    except Exception:
        if return_owned_supervisor:
            # Rotation owns this exact Popen.  If start cannot return it to the
            # caller, it must discharge that ownership before propagating.
            stop_child(child)
        raise


def _remove_private_file(path: Path) -> None:
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file():
            raise ValueError("私密状态路径必须是普通文件")
        path.unlink()
        _fsync_directory(path.parent)


def _rotate_private_state(
    root: Path,
    expected_instance_id: str,
    *,
    failure_stage: str | None = None,
) -> dict:
    """Rotate private files and one auth row while the instance is stopped.

    The returned context is private to this process and must never be printed.
    """
    marker = root / "private/credential-rotation.in-progress.json"
    database = root / "storage/jason.db"
    with instance_lock(root):
        require_clean(root, read_config(root))
        if marker.exists() or marker.is_symlink():
            raise RuntimeError("存在未完成的凭据轮换标记；实例保持停止，请先人工核验")
        old_config = _read_owner_only_json(root / "private/instance.json", "实例私密配置")
        _validate_private_credential_fields(
            old_config, require_all=True, allow_legacy_asset_activation_key=True
        )
        if old_config.get("instanceId") != expected_instance_id:
            raise ValueError("实例身份不匹配；未轮换任何凭据")
        old_login = _read_owner_only_json(root / "private/login.json", "本机登录凭据")
        if set(old_login) != {"username", "password"} or old_login.get("username") != LOCAL_USERNAME \
                or not isinstance(old_login.get("password"), str) or not old_login["password"]:
            raise ValueError("本机登录凭据合同无效")
        session_path = root / "private/session.json"
        old_session = (
            _read_owner_only_json(session_path, "本机会话")
            if session_path.exists() or session_path.is_symlink()
            else None
        )
        if old_session is not None and (
            set(old_session) != {"token"}
            or not isinstance(old_session.get("token"), str)
            or not old_session["token"]
        ):
            raise ValueError("本机会话合同无效")
        if database.is_symlink() or not database.is_file() or database.stat().st_uid != os.getuid():
            raise ValueError("本机认证数据库必须是当前用户拥有的普通文件")

        new_config = _new_private_credentials(old_config)
        new_login = _new_local_login()
        write_json(marker, {
            "schema": "qingmu.private-credential-rotation-marker.v1",
            "instanceId": expected_instance_id,
            "startedAt": utc_timestamp(),
            "state": "in_progress_stopped",
        })
        connection = sqlite3.connect(database, timeout=5, isolation_level=None)
        committed = False
        try:
            connection.execute("BEGIN IMMEDIATE")
            _stage_local_password_hash(connection, new_login["password"])
            write_json(root / "private/instance.json", new_config)
            if failure_stage == "after_config":
                raise RuntimeError("injected rotation failure")
            write_json(root / "private/login.json", new_login)
            if failure_stage == "after_login":
                raise RuntimeError("injected rotation failure")
            _remove_private_file(session_path)
            if failure_stage == "after_session":
                raise RuntimeError("injected rotation failure")
            connection.commit()
            committed = True
        except Exception as exc:
            if not committed:
                connection.rollback()
                try:
                    write_json(root / "private/instance.json", old_config)
                    write_json(root / "private/login.json", old_login)
                    if old_session is not None:
                        write_json(session_path, old_session)
                    else:
                        _remove_private_file(session_path)
                    _remove_private_file(marker)
                except Exception as rollback_exc:
                    raise RuntimeError("凭据轮换失败且回滚一致性未能确认；实例保持停止") from rollback_exc
                raise RuntimeError("凭据轮换失败；已恢复原一致状态，实例保持停止") from exc
            raise
        finally:
            connection.close()
        _remove_private_file(marker)

        changed = {
            name: name not in old_config or not secrets.compare_digest(old_config[name], new_config[name])
            for name in PRIVATE_CREDENTIAL_FIELDS
        }
        return {
            "oldConfig": old_config,
            "oldLogin": old_login,
            "oldSession": old_session,
            "newConfig": new_config,
            "changed": changed,
        }


def _expect_http_unauthorized(
    url: str,
    *,
    token: str | None = None,
    payload: dict | None = None,
) -> bool:
    try:
        http(url, token=token, payload=payload)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            return True
        raise RuntimeError("旧凭据失效核验返回非预期状态") from exc
    raise RuntimeError("旧凭据仍可用；实例将停止")


def _stop_rotated_instance(
    root: Path,
    config: dict,
    owned_supervisor: subprocess.Popen | None,
) -> None:
    control_stopped = False
    try:
        control(root, config, "stop")
        control_stopped = True
    except (FileNotFoundError, ConnectionRefusedError, RuntimeError):
        pass
    if owned_supervisor is not None and owned_supervisor.poll() is None:
        if control_stopped:
            try:
                owned_supervisor.wait(timeout=10)
            except subprocess.TimeoutExpired:
                stop_child(owned_supervisor)
        else:
            # This is the exact supervisor Popen created by this rotation
            # process, never a persisted PID or an unrelated listener.
            stop_child(owned_supervisor)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            with instance_lock(root):
                require_clean(root, config)
            return
        except RuntimeError:
            time.sleep(0.05)
    raise RuntimeError("轮换验证失败且实例停止未确认；禁止继续或自动重启")


def rotate_private_credentials(root: Path, expected_instance_id: str) -> dict:
    """Rotate, rebind, start, invalidate old auth, and log in with new auth."""
    context = _rotate_private_state(root, expected_instance_id)
    config = context["newConfig"]
    old_login = context["oldLogin"]
    old_session = context["oldSession"]
    owned_supervisor: subprocess.Popen | None = None
    try:
        manifest = record_build_manifest(root, config)
        runtime, owned_supervisor = start(root, config, return_owned_supervisor=True)
        api_url = runtime.get("apiUrl")
        if not isinstance(api_url, str) or not api_url.startswith("http://127.0.0.1:"):
            raise RuntimeError("轮换后 API loopback 身份缺失")
        old_password_invalid = _expect_http_unauthorized(
            api_url + "/api/auth/login",
            payload={"username": LOCAL_USERNAME, "password": old_login["password"]},
        )
        old_session_invalid = None
        if old_session is not None:
            old_session_invalid = _expect_http_unauthorized(
                api_url + "/api/auth/me", token=old_session["token"]
            )
        logged_in = control(root, config, "login")
        if (
            logged_in.get("instanceId") != expected_instance_id
            or logged_in.get("ready") is not True
            or logged_in.get("buildManifestMatches") is not True
            or logged_in.get("session") != "已登录：" + LOCAL_USERNAME
        ):
            raise RuntimeError("轮换后新凭据登录或运行身份核验失败")
    except Exception:
        _stop_rotated_instance(root, config, owned_supervisor)
        raise

    receipt = {
        "schema": "qingmu.private-credential-rotation-receipt.v1",
        "instanceId": expected_instance_id,
        "rotatedAt": utc_timestamp(),
        "credentialCategories": list(PRIVATE_CREDENTIAL_FIELDS) + ["localLoginPassword", "session"],
        "credentialFieldsChanged": context["changed"],
        "allCredentialFieldsChanged": all(context["changed"].values()),
        "loginPasswordChanged": True,
        "oldPasswordInvalid": old_password_invalid,
        "oldSessionWasPresent": old_session is not None,
        "oldSessionInvalid": old_session_invalid,
        "newLoginVerified": True,
        "privateFileModes": {
            name: format((root / "private" / name).stat().st_mode & 0o777, "04o")
            for name in ("instance.json", "login.json", "session.json")
        },
        "databaseAuthRowsChanged": 1,
        "businessRowsChangedByRotation": 0,
        "providerHttpRequests": 0,
        "paidCny": 0,
        "buildManifest": {
            "matches": manifest["matches"],
            "harnessCommit": manifest["harnessCommit"],
        },
        "ready": True,
    }
    receipt_path = root / "audit" / (
        "private-credential-rotation-"
        + utc_timestamp().replace(":", "").replace("-", "")
        + "-" + secrets.token_hex(4) + ".json"
    )
    write_json(receipt_path, receipt)
    return {**receipt, "receipt": str(receipt_path)}


def backup(root: Path) -> dict:
    """Cold, non-overwriting backup with SQLite integrity and media hashes."""
    with instance_lock(root):
        require_clean(root, read_config(root))
        target = root / "backups" / (time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(4))
        target.mkdir(mode=0o700)
        for name in ("storage", "private", "dsh", "audit", "build-manifest", "identity.json"):
            source = root / name
            if source.is_dir():
                shutil.copytree(source, target / name, symlinks=True)
            elif source.exists():
                shutil.copy2(source, target / name)
        integrity = cold_integrity(target / "storage/jason.db")
        if integrity != "ok":
            raise RuntimeError("备份数据库完整性检查失败")
        hashes = {
            str(file.relative_to(target)): hashlib.sha256(file.read_bytes()).hexdigest()
            for directory in (target / "storage", target / "audit", target / "build-manifest")
            if directory.is_dir()
            for file in directory.rglob("*")
            if file.is_file()
        }
        current_manifest = target / "build-manifest/current.json"
        build_evidence = sorted(
            str(file.relative_to(target))
            for file in (target / "build-manifest").rglob("*")
            if file.is_file() and file != current_manifest
        ) if (target / "build-manifest").is_dir() else []
        build_identity = {
            "state": "captured" if current_manifest.is_file() else "unknown_missing",
            "path": "build-manifest/current.json",
            "sha256": file_sha256(current_manifest) if current_manifest.is_file() else None,
            "evidence": build_evidence,
        }
        write_json(target / "manifest.json", {
            "root": str(root), "integrity": integrity, "sha256": hashes,
            "buildManifest": build_identity,
        })
        return {"backup": str(target), "integrity": integrity, "files": len(hashes),
                "overwritten": False, "buildManifest": build_identity}


def cold_integrity(database: Path) -> str:
    # A confirmed cold snapshot must not require an uncheckpointed WAL. immutable
    # avoids creating SHM/WAL during validation (including on macOS SQLite VFS).
    wal = database.with_name(database.name + "-wal")
    if not database.is_file() or (wal.exists() and wal.stat().st_size):
        raise ValueError("冷备数据库缺失或仍有未收敛WAL；拒绝恢复/通过")
    with sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        return db.execute("PRAGMA integrity_check").fetchone()[0]


DIRECTOR_PRODUCTION_CONFIRMATION = "QINGMU_D1_ONE_PROVIDER_POST_MAX_CNY_0_30"
DIRECTOR_LOCK_FIELDS = (
    "taskId", "workOrderSha256", "contextSnapshotSha256", "promptSha256",
    "outputContractSha256", "requestSha256", "payloadSha256", "provider", "model", "routeKey",
    "inputPolicy", "methodPackageSha256", "pricingSnapshotSha256", "dispatchKey",
    "dispatchEpoch", "claimToken", "claimEpoch", "exclusiveExecutionLane",
)


def _private_regular_file(path: Path, *, owner_only: bool = True) -> Path:
    path = path.expanduser().absolute()
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid():
        raise ValueError("导演提交文件必须是当前用户拥有的普通文件")
    if owner_only and path.stat().st_mode & 0o077:
        raise ValueError("导演提交私密文件权限必须为0600")
    return path


def _writer_submit_inspection(root: Path, config: dict, task_id: str) -> dict:
    result = subprocess.run(
        [*backend_command(config), "--inspect-director-submit-task", task_id],
        cwd=root / "work",
        env=backend_env(root, config),
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode:
        raise RuntimeError("易梦只读提交核验失败")
    try:
        value = json.loads(result.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as exc:
        raise RuntimeError("易梦只读提交核验响应无效") from exc
    if value.get("schema") != "jason.qingmu-director-submit-inspection.v1":
        raise RuntimeError("易梦只读提交核验合同无效")
    return value


def _probe_director_credential(root: Path, config: dict, credential_file: Path) -> dict:
    credential_file = _private_regular_file(credential_file)
    result = subprocess.run(
        [config["node"], str(HARNESS / "scripts/qingmu-director-credential-probe.mjs"),
         str(credential_file), DEEPSEEK_PRODUCTION_BASE_URL],
        cwd=HARNESS,
        env=safe_env(root),
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode:
        stage = "unknown"
        try:
            reported = json.loads(result.stderr.strip())
            if reported.get("stage") in {
                "credentials", "llm-runtime", "deepseek-adapter", "prepare-call", "binding"
            }:
                stage = reported["stage"]
        except json.JSONDecodeError:
            pass
        raise RuntimeError(f"DeepSeek 导演凭据不可用（{stage}）；未发起 Provider 请求")
    try:
        value = json.loads(result.stdout.strip())
    except json.JSONDecodeError as exc:
        raise RuntimeError("DeepSeek 导演凭据核验响应无效") from exc
    if value != {
        "available": True,
        "provider": "deepseek-official",
        "model": "deepseek-v4-pro",
        "baseUrl": DEEPSEEK_PRODUCTION_BASE_URL,
        "maxRetries": 0,
        "transportConsumed": False,
    }:
        raise RuntimeError("DeepSeek 导演凭据绑定不符；未发起 Provider 请求")
    return value


def _probe_director_method(root: Path, config: dict) -> dict:
    result = subprocess.run(
        [config["node"], str(HARNESS / "scripts/qingmu-director-method-probe.mjs"),
         config["coreRoot"]],
        cwd=HARNESS,
        env=safe_env(root),
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode:
        raise RuntimeError("IMAGO 导演方法当前物化失败；未发起 Provider 请求")
    try:
        value = json.loads(result.stdout.strip())
    except json.JSONDecodeError as exc:
        raise RuntimeError("IMAGO 导演方法当前物化响应无效") from exc
    if (
        set(value) != {"version", "methodPackageSha256", "sourceBindings"}
        or not isinstance(value["version"], str)
        or not isinstance(value["methodPackageSha256"], str)
        or len(value["methodPackageSha256"]) != 64
        or not isinstance(value["sourceBindings"], list)
    ):
        raise RuntimeError("IMAGO 导演方法当前物化合同无效")
    return value


def _inspect_project_episode_binding(
    database: Path,
    *,
    project_id: str,
    episode_id: str,
) -> dict:
    """Verify one exact project/episode pair without mutating the database."""
    database = _private_regular_file(database, owner_only=False).resolve(strict=True)
    # The instance is required to be cleanly stopped before binding.  Open the
    # confirmed cold database as immutable so macOS SQLite does not try to
    # coordinate WAL/SHM files for this read-only inspection (notably under an
    # ``Application Support`` path).
    uri = database.as_uri() + "?mode=ro&immutable=1"
    with sqlite3.connect(uri, uri=True) as connection:
        connection.execute("PRAGMA query_only = ON")
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("青木实例数据库完整性检查失败")
        row = connection.execute(
            """
            SELECT p.id, p.owner, e.id
            FROM projects AS p
            JOIN episodes AS e ON e.project_id = p.id
            WHERE p.id = ? AND e.id = ?
            """,
            (project_id, episode_id),
        ).fetchall()
    if len(row) != 1 or not str(row[0][1] or "").strip():
        raise ValueError("项目与剧集绑定不匹配；未修改运行配置")
    return {
        "projectId": str(row[0][0]),
        "episodeId": str(row[0][2]),
        "ownerPresent": True,
    }


def bind_project_runtime(
    root: Path,
    config: dict,
    *,
    expected_instance_id: str,
    project_id: str,
    episode_id: str,
    max_paid_cny: float,
    text_foundation_parent_task_id: str | None = None,
    asset_reference_parent_task_id: str | None = None,
) -> dict:
    """Bind the stopped local instance to one Yimeng + DSh production scope.

    This operation validates both credential locations without revealing or
    copying their values.  It performs no Provider HTTP request and no business
    database write.
    """
    if (
        config.get("instanceId") != expected_instance_id
        or not project_id.strip()
        or not episode_id.strip()
        or max_paid_cny != QINGMU_LOCAL_REMAINING_PAID_CNY
        or any(
            item is not None and not item.strip()
            for item in (text_foundation_parent_task_id, asset_reference_parent_task_id)
        )
    ):
        raise ValueError("本机运行绑定参数不匹配；未修改配置")
    with instance_lock(root):
        require_clean(root, config)
        current = read_config(root)
        if current.get("instanceId") != expected_instance_id:
            raise ValueError("实例身份已漂移；未修改配置")
        if current.get("directorExecutionFixture") is not None:
            raise ValueError("导演 fixture 仍启用；未修改 production 配置")
        scope = _inspect_project_episode_binding(
            root / "storage/jason.db",
            project_id=project_id,
            episode_id=episode_id,
        )
        _private_regular_file(YIMENG_PROVIDER_ENV_FILE)
        credential = _probe_director_credential(
            root,
            current,
            DEEPSEEK_PRODUCTION_CREDENTIAL_FILE,
        )
        method = _probe_director_method(root, current)
        text_execution = {
            "productionOnly": True,
            "provider": "dashscope",
            "projectId": project_id,
            "episodeId": episode_id,
            "maxPaidCny": QINGMU_LOCAL_REMAINING_PAID_CNY,
            "allowedStages": list(TEXT_FOUNDATION_STAGES),
            "credentialEnvFile": str(YIMENG_PROVIDER_ENV_FILE),
            "maxTasksPerTick": 1,
            "maxAttempts": 1,
            "allowExistingProviderPoll": True,
            "textFoundationParentTaskId": text_foundation_parent_task_id or None,
            "assetReferenceParentTaskId": asset_reference_parent_task_id or None,
        }
        director_execution = {
            "productionOnly": True,
            "provider": "deepseek-official",
            "model": "deepseek-v4-pro",
            "baseUrl": DEEPSEEK_PRODUCTION_BASE_URL,
            "endpoint": "/chat/completions",
            "routeKey": "qingmu.director.text.proposal.production",
            "projectId": project_id,
            "episodeId": episode_id,
            "methodPackageVersion": method["version"],
            "methodPackageSha256": method["methodPackageSha256"],
            "maxPaidCny": 0.30,
            "maxInputTokens": 8000,
            "maxOutputTokens": 2000,
            "thinking": "disabled",
            "images": False,
            "files": False,
            "tools": False,
            "credentialFile": str(DEEPSEEK_PRODUCTION_CREDENTIAL_FILE),
            "transportEnabled": False,
            "interactiveEnabled": True,
        }
        project_execution = {
            "active": False,
            "projectId": project_id,
            "episodeId": episode_id,
            "maxTasksPerTick": 1,
            "maxAttempts": 1,
            "maxConcurrentDispatches": 1,
            "allowExistingProviderPoll": True,
        }
        validate_text_foundation_production_config(text_execution)
        validate_director_production_config(director_execution)
        validate_project_production_config(project_execution)
        updated = dict(current)
        updated["textFoundationProductionExecution"] = text_execution
        updated["directorProductionExecution"] = director_execution
        updated["projectProductionExecution"] = project_execution
        write_json(root / "private/instance.json", updated)
        validated = read_config(root)
        if (
            validated.get("textFoundationProductionExecution") != text_execution
            or validated.get("directorProductionExecution") != director_execution
            or validated.get("projectProductionExecution") != project_execution
        ):
            raise RuntimeError("本机运行绑定写后核验失败")
        receipt = {
            "schema": "qingmu.local-project-runtime-binding.v1",
            "instanceId": expected_instance_id,
            "boundAt": utc_timestamp(),
            "scope": scope,
            "textFoundation": {
                "provider": "dashscope",
                "allowedStages": list(TEXT_FOUNDATION_STAGES),
                "maxPaidCny": QINGMU_LOCAL_REMAINING_PAID_CNY,
                "maxTasksPerTick": 1,
                "maxAttempts": 1,
                "parentTaskId": text_foundation_parent_task_id or None,
                "credentialAvailable": True,
            },
            "assetReference": {
                "parentTaskId": asset_reference_parent_task_id or None,
                "automaticScopeScan": False,
            },
            "projectProduction": {
                "active": False,
                "maxTasksPerTick": 1,
                "maxAttempts": 1,
                "maxConcurrentDispatches": 1,
                "allowExistingProviderPoll": True,
            },
            "director": {
                "provider": credential["provider"],
                "model": credential["model"],
                "methodPackageVersion": method["version"],
                "methodPackageSha256": method["methodPackageSha256"],
                "interactiveEnabled": True,
                "transportEnabled": False,
                "maxPaidCnyPerProposal": 0.30,
                "credentialAvailable": credential["available"],
            },
            "providerHttpRequests": 0,
            "paidCny": 0,
            "businessDatabaseWrites": 0,
        }
        receipt_path = root / "audit" / (
            "project-runtime-binding-"
            + utc_timestamp().replace(":", "").replace("-", "")
            + "-" + secrets.token_hex(4) + ".json"
        )
        write_json(receipt_path, receipt)
    return {**receipt, "receipt": str(receipt_path)}


def set_project_production_activation(
    root: Path,
    config: dict,
    *,
    expected_instance_id: str,
    project_id: str,
    episode_id: str,
    active: bool,
) -> dict:
    """Enable or disable one stopped instance's exact production Worker scope."""
    if (
        config.get("instanceId") != expected_instance_id
        or not project_id.strip()
        or not episode_id.strip()
    ):
        raise ValueError("项目 production 激活参数不匹配；未修改配置")
    with instance_lock(root):
        require_clean(root, config)
        current = read_config(root)
        if current.get("instanceId") != expected_instance_id:
            raise ValueError("实例身份已漂移；未修改配置")
        text_execution = validate_text_foundation_production_config(
            current.get("textFoundationProductionExecution")
        )
        if text_execution is None or (
            text_execution["projectId"] != project_id
            or text_execution["episodeId"] != episode_id
        ):
            raise ValueError("项目 production 激活范围与 Provider 配置不匹配")
        _inspect_project_episode_binding(
            root / "storage/jason.db",
            project_id=project_id,
            episode_id=episode_id,
        )
        _private_regular_file(Path(text_execution["credentialEnvFile"]))
        target = {
            "active": active,
            "projectId": project_id,
            "episodeId": episode_id,
            "maxTasksPerTick": 1,
            "maxAttempts": 1,
            "maxConcurrentDispatches": 1,
            "allowExistingProviderPoll": True,
        }
        validate_project_production_config(target)
        previous = validate_project_production_config(
            current.get("projectProductionExecution")
        )
        if previous != target:
            updated = dict(current)
            updated["projectProductionExecution"] = target
            write_json(root / "private/instance.json", updated)
            validated = read_config(root)
            if validated.get("projectProductionExecution") != target:
                raise RuntimeError("项目 production 激活写后核验失败")
        receipt = {
            "schema": "qingmu.local-project-production-activation.v1",
            "instanceId": expected_instance_id,
            "recordedAt": utc_timestamp(),
            "projectId": project_id,
            "episodeId": episode_id,
            "active": active,
            "idempotent": previous == target,
            "workerLane": "all" if active else "heartbeat_or_bound_text",
            "maxTasksPerTick": 1,
            "maxAttempts": 1,
            "maxConcurrentDispatches": 1,
            "allowExistingProviderPoll": True,
            "providerHttpRequests": 0,
            "businessDatabaseWrites": 0,
        }
        receipt_path = root / "audit" / (
            "project-production-"
            + ("activated-" if active else "deactivated-")
            + utc_timestamp().replace(":", "").replace("-", "")
            + "-" + secrets.token_hex(4) + ".json"
        )
        write_json(receipt_path, receipt)
    return {**receipt, "receipt": str(receipt_path)}


def director_submit_preflight(
    root: Path,
    config: dict,
    *,
    task_id: str,
    lock_pack: Path,
    lock_sha256: str,
    credential_file: Path | None = None,
) -> dict:
    """Fail closed before any dispatch mutation or Provider transport exists."""
    if len(lock_sha256) != 64 or any(character not in "0123456789abcdef" for character in lock_sha256):
        raise ValueError("导演提交锁 SHA-256 无效")
    lock_pack = _private_regular_file(lock_pack, owner_only=False)
    if hashlib.sha256(lock_pack.read_bytes()).hexdigest() != lock_sha256:
        raise ValueError("导演提交锁路径或 SHA-256 不匹配")
    production = validate_director_production_config(config.get("directorProductionExecution"))
    if production is None or production["transportEnabled"] is not False:
        raise ValueError("导演 production 配置必须存在且保持默认禁用")
    if production.get("taskId") != task_id:
        raise ValueError("导演提交任务与私密配置不匹配")
    inspection = _writer_submit_inspection(root, config, task_id)
    locked_pack = json.loads(lock_pack.read_text())
    private_lock = _private_regular_file(root / "private/d1-pre-submit-lock.json")
    locked = json.loads(private_lock.read_text())
    expected_route = {
        "provider": production["provider"],
        "model": production["model"],
        "baseUrl": production["baseUrl"],
        "endpoint": production["endpoint"],
        "maxInputTokens": production["maxInputTokens"],
        "maxOutputTokens": production["maxOutputTokens"],
        "thinking": production["thinking"],
        "images": production["images"],
        "files": production["files"],
        "tools": production["tools"],
        "maxAttempts": 1,
        "maxRetries": 0,
        "credentialFileMetadataOnly": production["credentialFile"],
        "transportEnabled": False,
    }
    expected_pricing = locked_pack.get("pricing", {})
    if (
        locked_pack.get("schema") != "qingmu.d1-deepseek-text-pre-submit-lock.v4"
        or locked_pack.get("status") != "active"
        or locked_pack.get("submitAllowed") is not True
        or locked_pack.get("canary") != {
            "root": str(root),
            "instanceId": config["instanceId"],
            "database": str(root / "storage/jason.db"),
            "isolatedSyntheticProject": True,
            "humanContentSignoff": False,
        }
        or locked_pack.get("scope") != {
            "projectId": inspection.get("projectId"),
            "episodeId": inspection.get("episodeId"),
            "sceneId": inspection.get("sceneId"),
            "shotId": inspection.get("shotId"),
        }
        or locked_pack.get("sourceSnapshots") != inspection.get("sourceSnapshots")
        or locked_pack.get("methodPackage") != {
            "version": inspection.get("methodPackageVersion"),
            "sha256": inspection.get("methodPackageSha256"),
        }
        or locked_pack.get("workOrder", {}).get("taskId") != task_id
        or locked_pack.get("workOrder", {}).get("routeKey") != inspection.get("routeKey")
        or locked_pack.get("workOrder", {}).get("workOrderSha256") != inspection.get("workOrderSha256")
        or locked_pack.get("workOrder", {}).get("promptSha256") != inspection.get("promptSha256")
        or locked_pack.get("workOrder", {}).get("outputContractSha256")
        != inspection.get("outputContractSha256")
        or locked_pack.get("workOrder", {}).get("inputSha256") != inspection.get("contextSnapshotSha256")
        or locked_pack.get("workOrder", {}).get("inputPolicy") != inspection.get("inputPolicy")
        or locked_pack.get("workOrder", {}).get("requestSha256") != inspection.get("requestSha256")
        or locked_pack.get("workOrder", {}).get("payloadSha256") != inspection.get("payloadSha256")
        or locked_pack.get("workOrder", {}).get("pricingSnapshotSha256")
        != inspection.get("pricingSnapshotSha256")
        or locked_pack.get("workOrder", {}).get("dispatchEpoch") != inspection.get("dispatchEpoch")
        or locked_pack.get("workOrder", {}).get("privateBindingSha256")
        != hashlib.sha256(private_lock.read_bytes()).hexdigest()
        or locked_pack.get("productionRoute") != expected_route
        or set(expected_pricing) != {
            "snapshotDate", "currency", "inputCacheMissCnyPerMillion",
            "outputCnyPerMillion", "reservedUpperBoundCny",
            "estimatedReservationCny", "actualCostCny",
        }
        or expected_pricing.get("currency") != "CNY"
        or expected_pricing.get("reservedUpperBoundCny") != production["maxPaidCny"]
        or not isinstance(expected_pricing.get("estimatedReservationCny"), (int, float))
        or not isinstance(inspection.get("estimatedCny"), (int, float))
        or abs(expected_pricing["estimatedReservationCny"] - inspection["estimatedCny"]) > 1e-12
        or expected_pricing.get("actualCostCny") is not None
        or locked_pack.get("persistedCounts") != inspection.get("counts")
        or locked != {field: inspection.get(field) for field in DIRECTOR_LOCK_FIELDS}
    ):
        raise ValueError("导演提交锁与易梦持久事实不匹配")
    if (
        inspection.get("provider") != production["provider"]
        or inspection.get("model") != production["model"]
        or inspection.get("routeKey") != production["routeKey"]
        or inspection.get("projectId") != production["projectId"]
        or inspection.get("episodeId") != production["episodeId"]
        or inspection.get("methodPackageVersion") != production["methodPackageVersion"]
        or inspection.get("methodPackageSha256") != production["methodPackageSha256"]
        or inspection.get("inputPolicy") != {
            "unit": "utf8_bytes_upper_bound",
            "promptUtf8Bytes": inspection.get("inputPolicy", {}).get("promptUtf8Bytes"),
            "maxInputTokens": production["maxInputTokens"],
        }
        or inspection.get("maxAttempts") != 1
        or inspection.get("localStatus") != "dispatch_pending"
        or inspection.get("providerStatus") != "PENDING_DISPATCH"
        or inspection.get("kernelStatus") != "DispatchPending"
        or inspection.get("dispatchEpoch") != 0
        or inspection.get("dispatchKey") != ""
        or inspection.get("claimToken") != ""
        or inspection.get("preflightAllowed") is not True
        or inspection.get("preflightDryRun") is not False
        or inspection.get("estimatedCny", 1) > production["maxPaidCny"]
        or inspection.get("authorizationCapCny") != production["maxPaidCny"]
        or inspection.get("counts", {}).get("generation_tasks") != 1
        or inspection.get("counts", {}).get("provider_preflights") != 1
        or inspection.get("counts", {}).get("provider_authorization_reservations") != 0
        or inspection.get("counts", {}).get("provider_submission_outbox") != 0
    ):
        raise ValueError("导演提交任务状态、来源或费用绑定不满足单次提交前置条件")
    audit_path = root / "audit" / f"director-submit-once-{task_id}.json"
    if audit_path.exists() or audit_path.is_symlink():
        raise ValueError("导演任务已有提交尝试记录；拒绝再次执行")
    materialized_method = _probe_director_method(root, config)
    if (
        materialized_method["version"] != inspection["methodPackageVersion"]
        or materialized_method["methodPackageSha256"] != inspection["methodPackageSha256"]
    ):
        raise ValueError("IMAGO 导演方法当前物化已漂移；拒绝提交")
    credential = credential_file or Path(production["credentialFile"])
    availability = _probe_director_credential(root, config, credential)
    return {
        "schema": "qingmu.director-submit-once-preflight.v1",
        "ready": True,
        "root": str(root),
        "taskId": task_id,
        "lockSha256": lock_sha256,
        "provider": production["provider"],
        "model": production["model"],
        "routeKey": production["routeKey"],
        "estimatedCny": inspection["estimatedCny"],
        "maxPaidCny": production["maxPaidCny"],
        "dispatchEpoch": 0,
        "reservationCount": 0,
        "outboxCount": 0,
        "credentialAvailable": availability["available"],
        "transportConsumed": False,
        "providerHttpRequests": 0,
    }


def _write_exclusive_json(path: Path, value: dict) -> None:
    with path.open("x", encoding="utf-8") as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def _runtime_director_state(database: Path, task_id: str) -> dict:
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        task = connection.execute(
            "SELECT local_status, provider_status, kernel_status, dispatch_epoch, provider_task_id "
            "FROM generation_tasks WHERE id = ?", (task_id,)
        ).fetchone()
        outbox = connection.execute(
            "SELECT state, terminal_outcome FROM provider_submission_outbox "
            "WHERE generation_task_id = ? ORDER BY created_at", (task_id,)
        ).fetchall()
    if task is None:
        raise RuntimeError("导演提交任务在执行期间消失")
    return {**dict(task), "outbox": [dict(row) for row in outbox]}


def execute_director_submit_once(
    root: Path,
    config: dict,
    preflight: dict,
    *,
    mock_base_url: str | None = None,
) -> dict:
    """Arm one durable attempt before booting the only Host allowed to submit it."""
    task_id = preflight["taskId"]
    audit_path = root / "audit" / f"director-submit-once-{task_id}.json"
    production = {**config["directorProductionExecution"], "transportEnabled": True}
    override_path = root / "private" / f"director-submit-once-{task_id}.json"
    armed = {
        "schema": "qingmu.director-submit-once-audit.v1",
        "taskId": task_id,
        "lockSha256": preflight["lockSha256"],
        "provider": preflight["provider"],
        "model": preflight["model"],
        "routeKey": preflight["routeKey"],
        "maxPaidCny": preflight["maxPaidCny"],
        "state": "armed_no_replay",
        "mockOnly": bool(mock_base_url),
    }
    _write_exclusive_json(audit_path, armed)
    _write_exclusive_json(override_path, production)
    runtime_config: dict[str, Any] = {
        **config,
        "directorProductionExecution": production,
        "_directorProductionOverridePath": str(override_path),
    }
    if mock_base_url:
        runtime_config["_directorSubmitMockBaseUrl"] = require_http_loopback_origin(mock_base_url)
    supervisor = Supervisor(root, runtime_config)
    final: dict = {}
    try:
        mark_lifecycle(root, config, "dirty")
        api_port, host_port = available_port(), available_port()
        while host_port == api_port:
            host_port = available_port()
        supervisor.ports = {
            "apiPort": api_port,
            "hostPort": host_port,
            "webPort": host_port,
            "apiUrl": f"http://127.0.0.1:{api_port}",
            "hostUrl": f"http://127.0.0.1:{host_port}",
            "webUrl": f"http://127.0.0.1:{host_port}",
        }
        supervisor.api = supervisor.launch(
            [*backend_command(runtime_config), "--port", str(api_port)],
            backend_env(root, runtime_config),
            "director-submit-api",
        )
        supervisor.wait_ready(supervisor.api, supervisor.api_identity)
        supervisor.start_host()
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            final = _runtime_director_state(root / "storage/jason.db", task_id)
            outbox_states = {item["state"] for item in final["outbox"]}
            if final["kernel_status"] == "Succeeded" or outbox_states & {"unknown", "settled"}:
                break
            if supervisor.api.poll() is not None or supervisor.host.poll() is not None:
                raise RuntimeError("导演提交子进程提前退出；原尝试已锁定，禁止重发")
            time.sleep(0.1)
        else:
            raise RuntimeError("导演提交终态未知；原尝试已锁定，禁止重发")
        result = {
            "taskId": task_id,
            "state": "settled" if final["kernel_status"] == "Succeeded" else "submission_unknown",
            "dispatchEpoch": final["dispatch_epoch"],
            "providerTaskRecorded": bool(final["provider_task_id"]),
            "transportMode": "local_mock" if mock_base_url else "production_once",
            "automaticRetry": False,
        }
        write_json(audit_path, {**armed, **result})
        return result
    except Exception:
        write_json(audit_path, {**armed, "state": "execution_unknown_no_replay"})
        raise
    finally:
        stop_child(supervisor.host)
        stop_child(supervisor.api)
        write_stopped_runtime(root, config)
        mark_lifecycle(root, config, "clean")
        for log in supervisor.logs:
            log.close()
        override_path.unlink(missing_ok=True)
        (root / "private/local.patch.yml").unlink(missing_ok=True)


def restore(source: Path, target: Path) -> dict:
    """Restore into an absent directory, never over an active or existing instance."""
    source = source.resolve(strict=True)
    manifest = json.loads((source / "manifest.json").read_text())
    config = _read_owner_only_json(source / "private/instance.json", "备份实例私密配置")
    _validate_private_credential_fields(config, require_all=False)
    if config["root"] != manifest["root"] or config["harnessRoot"] != str(HARNESS):
        raise ValueError("备份来源绑定不符")
    actual_files = {
        str(file.relative_to(source))
        for directory in (source / "storage", source / "audit", source / "build-manifest")
        if directory.is_dir()
        for file in directory.rglob("*")
        if file.is_file()
    }
    if set(manifest["sha256"]) != actual_files or "storage/jason.db" not in actual_files:
        raise ValueError("备份SHA清单必须覆盖全部storage文件与数据库")
    for relative, digest in manifest["sha256"].items():
        file = source / relative
        if (
            not file.is_file()
            or not any(file.resolve().is_relative_to(source / directory)
                       for directory in ("storage", "audit", "build-manifest"))
        ):
            raise ValueError("备份媒体路径无效")
        if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError("备份SHA不符；未创建恢复目录")
    if cold_integrity(source / "storage/jason.db") != "ok":
        raise ValueError("备份数据库完整性不符")
    source_login = _read_owner_only_json(source / "private/login.json", "备份本机登录凭据")
    if set(source_login) != {"username", "password"} or source_login.get("username") != LOCAL_USERNAME:
        raise ValueError("备份本机登录凭据合同无效")
    target.mkdir(mode=0o700, parents=False, exist_ok=False)
    try:
        for name in ("storage", "private", "dsh"):
            shutil.copytree(source / name, target / name, symlinks=True)
        if (source / "audit").is_dir():
            shutil.copytree(source / "audit", target / "audit", symlinks=True)
        else:
            (target / "audit").mkdir(mode=0o700)
        if (source / "build-manifest").is_dir():
            shutil.copytree(source / "build-manifest", target / "build-manifest", symlinks=True)
        else:
            (target / "build-manifest").mkdir(mode=0o700)
        shutil.copy2(source / "identity.json", target / "identity.json")
        for name in ("logs", "home", "work", "backups"):
            (target / name).mkdir(mode=0o700)
        config = _new_private_credentials(config)
        config.update(root=str(target), instanceId=secrets.token_hex(16))
        login = _new_local_login()
        with sqlite3.connect(target / "storage/jason.db") as connection:
            connection.execute("BEGIN IMMEDIATE")
            _stage_local_password_hash(connection, login["password"])
            write_json(target / "private/instance.json", config)
            write_json(target / "private/login.json", login)
            connection.commit()
        mark_lifecycle(target, config, "clean")
        for name in ("session.json", "ports.json", "local.patch.yml", "credential-rotation.in-progress.json"):
            _remove_private_file(target / "private" / name)
        read_config(target)
    except Exception:
        shutil.rmtree(target)
        raise
    return {"restored": str(target), "integrity": "ok", "overwritten": False,
            "privateCredentialsRekeyed": list(PRIVATE_CREDENTIAL_FIELDS),
            "localLoginRekeyed": True, "restoredSession": False,
            "buildManifest": build_manifest_status(target, config),
            "message": "恢复到新目录；原实例未改动。先运行 record-build 绑定新实例身份，再 start 和 login。"}


def main() -> None:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["init", "record-build", "start", "status", "stop", "login", "backup", "restore",
                                            "rotate-private-credentials", "bind-project-runtime",
                                            "activate-project-production", "deactivate-project-production",
                                            "recover-crash", "director-submit-once", "_supervise"])
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--yimeng-root", type=Path)
    parser.add_argument("--core-root", type=Path)
    parser.add_argument("--frontend-node", type=Path)
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--task-id")
    parser.add_argument("--lock-pack", type=Path)
    parser.add_argument("--lock-sha256")
    parser.add_argument("--execute-production-once")
    parser.add_argument("--instance-id")
    parser.add_argument("--project-id")
    parser.add_argument("--episode-id")
    parser.add_argument("--max-paid-cny", type=float)
    parser.add_argument("--text-foundation-parent-task-id")
    parser.add_argument("--asset-reference-parent-task-id")
    parser.add_argument("--review-only", action="store_true")
    args = parser.parse_args()
    # Do not resolve an existing root symlink into an unrelated target.
    root = args.root.expanduser().absolute()
    try:
        if args.command == "restore":
            if args.backup is None:
                raise ValueError("restore 必须明确 --backup，并用 --root 指定不存在的新目录")
            result = restore(args.backup, root)
        elif args.command == "init":
            if args.yimeng_root is None or args.core_root is None:
                raise ValueError("init 必须明确 --yimeng-root 和 --core-root")
            result = initialize(root, args.yimeng_root, args.core_root, args.frontend_node)
        else:
            config = read_config(root)
            if args.command == "_supervise":
                supervisor = Supervisor(root, config, review_only=args.review_only)
                signal.signal(signal.SIGTERM, lambda *_: setattr(supervisor, "stopping", True))
                signal.signal(signal.SIGINT, lambda *_: setattr(supervisor, "stopping", True))
                supervisor.run()
                return
            if args.command == "record-build":
                result = record_build_manifest(root, config, review_only=args.review_only)
            elif args.command == "rotate-private-credentials":
                if not args.instance_id:
                    raise ValueError("rotate-private-credentials 必须明确 --instance-id")
                result = rotate_private_credentials(root, args.instance_id)
            elif args.command == "bind-project-runtime":
                if (
                    not args.instance_id
                    or not args.project_id
                    or not args.episode_id
                    or args.max_paid_cny is None
                ):
                    raise ValueError(
                        "bind-project-runtime 必须明确 instance-id、project-id、episode-id 与 max-paid-cny"
                    )
                result = bind_project_runtime(
                    root,
                    config,
                    expected_instance_id=args.instance_id,
                    project_id=args.project_id,
                    episode_id=args.episode_id,
                    max_paid_cny=args.max_paid_cny,
                    text_foundation_parent_task_id=args.text_foundation_parent_task_id,
                    asset_reference_parent_task_id=args.asset_reference_parent_task_id,
                )
            elif args.command in {
                "activate-project-production",
                "deactivate-project-production",
            }:
                if not args.instance_id or not args.project_id or not args.episode_id:
                    raise ValueError(
                        args.command + " 必须明确 instance-id、project-id 与 episode-id"
                    )
                result = set_project_production_activation(
                    root,
                    config,
                    expected_instance_id=args.instance_id,
                    project_id=args.project_id,
                    episode_id=args.episode_id,
                    active=args.command == "activate-project-production",
                )
            elif args.command == "recover-crash":
                if not args.instance_id:
                    raise ValueError("recover-crash 必须明确 --instance-id")
                result = recover_crashed_instance(root, config, args.instance_id)
            elif args.command == "director-submit-once":
                if not args.task_id or args.lock_pack is None or not args.lock_sha256:
                    raise ValueError("director-submit-once 必须明确 task-id、lock-pack 与 lock-sha256")
                production_requested = args.execute_production_once is not None
                if production_requested and args.execute_production_once != DIRECTOR_PRODUCTION_CONFIRMATION:
                    raise ValueError("production 单次提交确认值不匹配")
                with instance_lock(root):
                    require_clean(root, config)
                    result = director_submit_preflight(
                        root,
                        config,
                        task_id=args.task_id,
                        lock_pack=args.lock_pack.expanduser().absolute(),
                        lock_sha256=args.lock_sha256,
                    )
                    if production_requested:
                        result = execute_director_submit_once(
                            root,
                            config,
                            result,
                        )
            elif args.command == "start":
                result = start(root, config, review_only=args.review_only)
            elif args.command == "backup":
                result = backup(root)
            else:
                try:
                    result = control(root, config, args.command)
                    if args.command == "stop":
                        deadline = time.monotonic() + 5
                        while True:
                            try:
                                with instance_lock(root):
                                    require_clean(root, config)
                                break
                            except RuntimeError:
                                if time.monotonic() >= deadline:
                                    raise
                                time.sleep(0.05)
                except (FileNotFoundError, ConnectionRefusedError):
                    # A stale runtime.json is diagnostic only, never a kill target.
                    with instance_lock(root):
                        require_clean(root, config)
                        manifest = build_manifest_status(root, config)
                        result = {"running": False, "root": str(root), "dataPreserved": True,
                                  "buildManifest": manifest, "buildManifestMatches": manifest["matches"],
                                  "message": "未运行；未根据历史PID停止任何进程"}
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
