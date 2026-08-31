#!/usr/bin/env python3
"""Qingmu's single-user, loopback-only persistent instance launcher (macOS).

Only the supervisor holding the instance flock owns child process handles.
No command signals a persisted PID or an arbitrary listener. Credentials stay
in owner-only files; login explicitly renews the normal 24-hour API session.
"""

from __future__ import annotations

import argparse
import contextlib
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
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_ROOT = Path.home() / "Library/Application Support/QingmuOS"
HARNESS = Path(__file__).resolve().parents[1]
DEEPSEEK_PRODUCTION_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_PRODUCTION_CREDENTIAL_FILE = Path(
    "/Users/a1234/Library/Application Support/QingmuOS/dsh/.credentials.yaml"
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


def read_config(root: Path) -> dict:
    if root.is_symlink() or root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
        raise ValueError("专用目录必须属于当前用户且权限为0700")
    for relative in ("private", "storage", "dsh", "home", "work", "logs", "private/instance.json",
                     "private/login.json", "private/session.json", "storage/jason.db", "private/lifecycle.lock"):
        if (root / relative).is_symlink():
            raise ValueError("实例数据/配置路径不能是符号链接：" + relative)
    config = json.loads((root / "private/instance.json").read_text())
    if config["root"] != str(root) or config["harnessRoot"] != str(HARNESS):
        raise ValueError("实例目录或 Harness 来源绑定不符；拒绝使用")
    validate_director_production_config(config.get("directorProductionExecution"))
    if config.get("directorExecutionFixture") is not None and config.get("directorProductionExecution") is not None:
        raise ValueError("导演 fixture 与 production 配置不能同时启用")
    return config


def safe_env(root: Path) -> dict[str, str]:
    """Do not inherit ambient Provider credentials, runtime paths or .env files."""
    return {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(root / "home"),
            "LANG": "en_US.UTF-8", "PYTHONDONTWRITEBYTECODE": "1", "DSH_HOME": str(root / "dsh")}


def backend_command(config: dict) -> list[str]:
    writer = Path(config["yimengRoot"])
    return [str(writer / ".venv/bin/python"), "-B", str(writer / "scripts/qingmu_local_api.py"),
            "--root", config["root"]]


def backend_env(root: Path, config: dict) -> dict[str, str]:
    return {**safe_env(root), "PYTHONPATH": str(Path(config["yimengRoot"]) / "backend/src")}


def initialize(root: Path, writer: Path, core: Path | None = None) -> dict:
    """Exclusive new-root initialization. Existing directories are never adopted."""
    writer = writer.resolve(strict=True)
    if not (writer / "scripts/qingmu_local_api.py").is_file():
        raise ValueError("易梦来源缺少 qingmu_local_api.py")
    if core is not None and not (core / "pipeline/imago-os-current.json").is_file():
        raise ValueError("Core 来源缺少当前机器入口")
    root.mkdir(mode=0o700, parents=False, exist_ok=False)
    for part in ("private", "storage", "logs", "home", "dsh/profiles/qingmu", "work", "audit", "backups"):
        (root / part).mkdir(mode=0o700, parents=True, exist_ok=True)
    config = {"version": 1, "instanceId": secrets.token_hex(16), "root": str(root),
              "harnessRoot": str(HARNESS), "yimengRoot": str(writer), "coreRoot": str(core.resolve(strict=True)) if core else None,
              "node": shutil.which("node"), "jwtSecret": secrets.token_urlsafe(48),
              "attestationKey": secrets.token_urlsafe(48), "controlKey": secrets.token_urlsafe(48),
              "directorExecutionKey": secrets.token_urlsafe(48)}
    write_json(root / "private/instance.json", config)
    write_json(root / "private/login.json", {"username": "qingmu-local", "password": secrets.token_urlsafe(32)})
    write_json(root / "dsh/profiles/qingmu/package.json", {
        "name": "qingmu-local-profile", "private": True,
        "dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]}}})
    # The private overlay uses built package URLs, preserving the actual bundle roster.
    # Client-module package resolution also needs the two ordinary manifest names.
    for name in ("client-ui-brand-qingmu", "client-ui-qingmu-cockpit"):
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
    """Validate the private C1 production route without reading its credential."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("导演 production 配置无效")
    required = {
        "productionOnly", "provider", "model", "baseUrl", "endpoint", "routeKey",
        "projectId", "episodeId", "methodPackageVersion", "methodPackageSha256",
        "maxPaidCny", "maxInputTokens", "maxOutputTokens", "thinking", "images",
        "files", "tools", "credentialFile", "transportEnabled",
    }
    if set(value) - (required | {"taskId"}) or not required.issubset(value):
        raise ValueError("导演 production 配置无效")
    if (
        value["productionOnly"] is not True
        or value["provider"] != "deepseek-official"
        or value["model"] != "deepseek-v4-pro"
        or value["baseUrl"] != DEEPSEEK_PRODUCTION_BASE_URL
        or value["endpoint"] != "/chat/completions"
        or value["maxPaidCny"] != 0.16
        or value["maxInputTokens"] != 16000
        or value["maxOutputTokens"] != 512
        or value["thinking"] != "disabled"
        or any(value[name] is not False for name in ("images", "files", "tools"))
        or value["credentialFile"] != str(DEEPSEEK_PRODUCTION_CREDENTIAL_FILE)
        or not isinstance(value["transportEnabled"], bool)
        or not all(isinstance(value.get(name), str) and value[name].strip() for name in (
            "routeKey", "projectId", "episodeId", "methodPackageVersion", "methodPackageSha256"
        ))
        or (value["transportEnabled"] and not str(value.get("taskId") or "").strip())
    ):
        raise ValueError("导演 production 配置无效")
    return value


def mark_lifecycle(root: Path, config: dict, state: str) -> None:
    write_json(root / "private/lifecycle.json", {"instanceId": config["instanceId"], "state": state})


def require_clean(root: Path, config: dict) -> None:
    marker = root / "private/lifecycle.json"
    value = json.loads(marker.read_text()) if marker.is_file() and not marker.is_symlink() else {}
    if value != {"instanceId": config["instanceId"], "state": "clean"}:
        raise RuntimeError("实例停止状态未知：监督进程可能异常退出。拒绝启动/冷备；未操作历史PID。请先人工核对本实例进程，勿删除运行标记")


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
    def __init__(self, root: Path, config: dict):
        self.root, self.config = root, config
        self.api: subprocess.Popen | None = None
        self.host: subprocess.Popen | None = None
        self.stopping = False
        self.ports: dict = {}
        self.logs: list = []

    def launch(self, argv: list[str], env: dict, label: str) -> subprocess.Popen:
        log = (self.root / "logs" / (label + ".log")).open("ab")
        self.logs.append(log)
        return subprocess.Popen(argv, cwd=self.root / "work", env=env, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=log)

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
        if value != expected:
            raise ValueError("API身份/数据目录绑定不符")
        return value

    def host_healthy(self) -> bool:
        # The child identity is Popen-owned. Check the listening PID as well as HTTP.
        result = subprocess.run(["/usr/sbin/lsof", "-nP", "-a", "-p", str(self.host.pid),
                                 "-iTCP:" + str(self.ports["webPort"]), "-sTCP:LISTEN", "-Fn"],
                                capture_output=True, text=True, timeout=3)
        if f"n127.0.0.1:{self.ports['webPort']}" not in result.stdout:
            return False
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(self.ports["webUrl"], timeout=3) as response:
            return response.status == 200 and b"__DSH_BOOT__" in response.read(2_000_000)

    def start_host(self) -> None:
        overlay = (HARNESS / "packages/experimental/qingmu-web/cordis.patch.yml").read_text()
        # Browser seats retain manifest names so the ordinary modules plugin
        # discovers their dsh.client declarations through the profile symlinks.
        for name in ("qingmu-yimeng-read-adapter", "qingmu-imago-method-adapter", "qingmu-yimeng-command-adapter"):
            overlay = overlay.replace(f"name: '@deepseek-ai/dsh-experimental-{name}'",
                "name: " + json.dumps((HARNESS / "packages/experimental" / name / "lib/index.js").as_uri()))
        for adapter in ("read", "command"):
            overlay += f"\n- id: qingmu-yimeng-{adapter}-adapter\n  config:\n    baseUrl: {json.dumps(self.ports['apiUrl'])}\n"
            if adapter == "command":
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
                if production.get("transportEnabled"):
                    overlay += (
                        "    directorProductionTransportEnabled: true\n"
                        "    directorProductionTaskId: " + json.dumps(production["taskId"]) + "\n"
                        "    directorProductionMethodVersion: " + json.dumps(production["methodPackageVersion"]) + "\n"
                        "    directorProductionMethodSha256: " + json.dumps(production["methodPackageSha256"]) + "\n"
                    )
        fixture = self.config.get("directorExecutionFixture") or {}
        if fixture.get("transportMode") == "dsh-one-shot-mock":
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
        if production.get("transportEnabled"):
            overlay += (
                "\n- id: credentials\n  config:\n"
                "    path: " + json.dumps(production["credentialFile"]) + "\n"
                "    watch: false\n"
                "\n- id: llm-deepseek\n  config:\n"
                "    baseURL: " + json.dumps(DEEPSEEK_PRODUCTION_BASE_URL) + "\n"
                "    thinking: disabled\n"
                "    reasoningEffort: off\n"
                "    maxTokens: 512\n"
                "    retryPolicy:\n      mode: normal\n      maxRetries: 0\n"
            )
        overlay += "\n- id: qingmu-imago-method-adapter\n  config:\n    coreRoot: " + json.dumps(self.config["coreRoot"]) + "\n"
        overlay_path = self.root / "private/local.patch.yml"
        overlay_path.write_text(overlay)
        env = safe_env(self.root)
        env["QINGMU_IMAGO_ATTESTATION_KEY"] = self.config["attestationKey"]
        # No compatibility fallback: pre-B instances without this field keep
        # Director paid execution disabled until restored into a new root.
        if self.config.get("directorExecutionKey"):
            env["QINGMU_DIRECTOR_EXECUTION_KEY"] = self.config["directorExecutionKey"]
        session = self.root / "private/session.json"
        if session.exists():
            env["YIMENG_API_TOKEN"] = json.loads(session.read_text())["token"]
        self.host = self.launch([self.config["node"], str(HARNESS / "apps/cli/lib/bin.js"),
            "--profile", "qingmu", "--patch", str(overlay_path), "--host", "127.0.0.1",
            "--port", str(self.ports["webPort"]), "--no-open"], env, "host")
        self.wait_ready(self.host, self.host_healthy)

    def status(self) -> dict:
        api_alive = self.api is not None and self.api.poll() is None
        host_alive = self.host is not None and self.host.poll() is None
        api_verified = host_verified = False
        try:
            api_verified = api_alive and bool(self.api_identity())
            host_verified = host_alive and self.host_healthy()
        except (OSError, ValueError):
            pass
        session = "未登录：运行 login"
        try:
            token = json.loads((self.root / "private/session.json").read_text())["token"]
            identity = http(self.ports["apiUrl"] + "/api/auth/me", token=token)
            session = "已登录：" + identity["username"]
        except (OSError, ValueError):
            session = "会话缺失或过期：运行 login，然后刷新页面；不会自动重发命令"
        return {"instanceId": self.config["instanceId"], "root": str(self.root),
                "supervisorPid": os.getpid(), "apiPid": self.api.pid if self.api else None,
                "hostPid": self.host.pid if self.host else None, **self.ports,
                "apiProcessAlive": api_alive, "hostProcessAlive": host_alive,
                "apiIdentityAndStorageVerified": api_verified, "hostListenerAndHttpVerified": host_verified,
                "ready": bool(api_verified and host_verified), "session": session}

    def login(self) -> dict:
        self.api_identity()
        credentials = json.loads((self.root / "private/login.json").read_text())
        try:
            result = http(self.ports["apiUrl"] + "/api/auth/login", payload=credentials)
        except urllib.error.HTTPError as exc:
            raise RuntimeError("登录失败；凭据未改变，Draft 与回执仍保留") from exc
        write_json(self.root / "private/session.json", {"token": result["token"]})
        # Explicit login restarts only our Host to refresh its environment token.
        # It never replays an interrupted command; the existing receipt UI recovers it.
        stop_child(self.host)
        self.start_host()
        return {**self.status(), "message": "会话已更新。刷新页面；未知提交结果请先恢复原回执，不要新建命令。"}

    def run(self) -> None:
        with instance_lock(self.root):
            require_clean(self.root, self.config)
            control_path = self.root / "control.sock"
            # The lock proves no live supervisor owns this exact socket.
            if control_path.exists() or control_path.is_symlink():
                control_path.unlink()
            with socket.socket(socket.AF_UNIX) as server:
                server.bind(str(control_path))
                os.chmod(control_path, 0o600)
                server.listen(4)
                server.settimeout(0.5)
                try:
                    # A free flock does not prove orphaned children have exited.
                    # Persist before any spawn; only owned Popen waits clear it.
                    mark_lifecycle(self.root, self.config, "dirty")
                    persisted = self.root / "private/ports.json"
                    preferred = json.loads(persisted.read_text()) if persisted.exists() else {}
                    # Preserve browser origin across restarts. Occupied ports fail closed.
                    api_port = available_port(preferred.get("apiPort", 0))
                    web_port = available_port(preferred.get("webPort", 0))
                    while web_port == api_port:
                        web_port = available_port()
                    self.ports = {"apiPort": api_port, "webPort": web_port,
                                  "apiUrl": f"http://127.0.0.1:{api_port}", "webUrl": f"http://127.0.0.1:{web_port}"}
                    write_json(persisted, self.ports)
                    self.api = self.launch([*backend_command(self.config), "--port", str(api_port)],
                                           backend_env(self.root, self.config), "api")
                    self.wait_ready(self.api, self.api_identity)
                    self.start_host()
                    write_json(self.root / "runtime.json", self.status())
                    while not self.stopping:
                        if self.api.poll() is not None or self.host.poll() is not None:
                            raise RuntimeError("本实例子进程退出，正在清理其余自有子进程")
                        try:
                            client, _ = server.accept()
                        except socket.timeout:
                            continue
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
                                if not secrets.compare_digest(str(request.get("key", "")), self.config["controlKey"]):
                                    raise ValueError("控制身份不符")
                                if request["op"] == "login":
                                    result = self.login()
                                elif request["op"] == "stop":
                                    self.stopping = True
                                    stop_child(self.host)
                                    stop_child(self.api)
                                    result = {"stopped": True, "instanceId": self.config["instanceId"], "dataPreserved": True}
                                elif request["op"] == "status":
                                    result = self.status()
                                else:
                                    raise ValueError("未知控制操作")
                            except Exception as exc:
                                result = {"error": str(exc), "instanceId": self.config["instanceId"]}
                            try:
                                client.sendall(json.dumps(result, ensure_ascii=False).encode() + b"\n")
                            except OSError:
                                pass
                finally:
                    stop_child(self.host)
                    stop_child(self.api)
                    mark_lifecycle(self.root, self.config, "clean")
                    control_path.unlink(missing_ok=True)
                    for log in self.logs:
                        log.close()


def start(root: Path, config: dict) -> dict:
    try:
        return control(root, config, "status")
    except (FileNotFoundError, ConnectionRefusedError):
        pass
    with instance_lock(root):
        require_clean(root, config)
    log = (root / "logs/supervisor.log").open("ab")
    with log:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "_supervise", "--root", str(root)],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, env=safe_env(root))
    deadline = time.monotonic() + 75
    while time.monotonic() < deadline:
        try:
            return control(root, config, "status")
        except (FileNotFoundError, ConnectionRefusedError):
            if child.poll() is not None:
                raise RuntimeError("启动失败，见 logs/supervisor.log；未操作未知进程")
            time.sleep(0.15)
    raise RuntimeError("启动尚未确认；运行 status 检查，不自动重复启动")


def backup(root: Path) -> dict:
    """Cold, non-overwriting backup with SQLite integrity and media hashes."""
    with instance_lock(root):
        require_clean(root, read_config(root))
        target = root / "backups" / (time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(4))
        target.mkdir(mode=0o700)
        for name in ("storage", "private", "dsh", "identity.json"):
            source = root / name
            if source.is_dir():
                shutil.copytree(source, target / name, symlinks=True)
            elif source.exists():
                shutil.copy2(source, target / name)
        integrity = cold_integrity(target / "storage/jason.db")
        if integrity != "ok":
            raise RuntimeError("备份数据库完整性检查失败")
        hashes = {str(file.relative_to(target)): hashlib.sha256(file.read_bytes()).hexdigest()
                  for file in (target / "storage").rglob("*") if file.is_file()}
        write_json(target / "manifest.json", {"root": str(root), "integrity": integrity, "sha256": hashes})
        return {"backup": str(target), "integrity": integrity, "files": len(hashes), "overwritten": False}


def cold_integrity(database: Path) -> str:
    # A confirmed cold snapshot must not require an uncheckpointed WAL. immutable
    # avoids creating SHM/WAL during validation (including on macOS SQLite VFS).
    wal = database.with_name(database.name + "-wal")
    if not database.is_file() or (wal.exists() and wal.stat().st_size):
        raise ValueError("冷备数据库缺失或仍有未收敛WAL；拒绝恢复/通过")
    with sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        return db.execute("PRAGMA integrity_check").fetchone()[0]


def restore(source: Path, target: Path) -> dict:
    """Restore into an absent directory, never over an active or existing instance."""
    source = source.resolve(strict=True)
    manifest = json.loads((source / "manifest.json").read_text())
    config = json.loads((source / "private/instance.json").read_text())
    if config["root"] != manifest["root"] or config["harnessRoot"] != str(HARNESS):
        raise ValueError("备份来源绑定不符")
    actual_files = {str(file.relative_to(source)) for file in (source / "storage").rglob("*") if file.is_file()}
    if set(manifest["sha256"]) != actual_files or "storage/jason.db" not in actual_files:
        raise ValueError("备份SHA清单必须覆盖全部storage文件与数据库")
    for relative, digest in manifest["sha256"].items():
        file = source / relative
        if not file.resolve().is_relative_to(source / "storage") or not file.is_file():
            raise ValueError("备份媒体路径无效")
        if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError("备份SHA不符；未创建恢复目录")
    if cold_integrity(source / "storage/jason.db") != "ok":
        raise ValueError("备份数据库完整性不符")
    target.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name in ("storage", "private", "dsh"):
        shutil.copytree(source / name, target / name, symlinks=True)
    shutil.copy2(source / "identity.json", target / "identity.json")
    for name in ("logs", "home", "work", "backups", "audit"):
        (target / name).mkdir(mode=0o700)
    config.update(
        root=str(target),
        instanceId=secrets.token_hex(16),
        controlKey=secrets.token_urlsafe(48),
        directorExecutionKey=secrets.token_urlsafe(48),
    )
    write_json(target / "private/instance.json", config)
    mark_lifecycle(target, config, "clean")
    for name in ("session.json", "ports.json", "local.patch.yml"):
        (target / "private" / name).unlink(missing_ok=True)
    read_config(target)
    return {"restored": str(target), "integrity": "ok", "overwritten": False,
            "message": "恢复到新目录；原实例未改动。启动后重新 login。"}


def main() -> None:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["init", "start", "status", "stop", "login", "backup", "restore", "_supervise"])
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--yimeng-root", type=Path)
    parser.add_argument("--core-root", type=Path)
    parser.add_argument("--backup", type=Path)
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
            result = initialize(root, args.yimeng_root, args.core_root)
        else:
            config = read_config(root)
            if args.command == "_supervise":
                supervisor = Supervisor(root, config)
                signal.signal(signal.SIGTERM, lambda *_: setattr(supervisor, "stopping", True))
                signal.signal(signal.SIGINT, lambda *_: setattr(supervisor, "stopping", True))
                supervisor.run()
                return
            if args.command == "start":
                result = start(root, config)
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
                        result = {"running": False, "root": str(root), "dataPreserved": True,
                                  "message": "未运行；未根据历史PID停止任何进程"}
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
