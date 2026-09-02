from __future__ import annotations

import argparse
import importlib.util
import json
import socket
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import uvicorn
from fastapi import FastAPI


def load_test_seam(writer_root: Path):
    path = writer_root / "tests/test_qingmu_writer_production_bridge.py"
    spec = importlib.util.spec_from_file_location("qingmu_writer_bridge_fixture_source", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("writer test seam cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.QueueOnlyVideoService


class QuoteAuthority:
    def __init__(self, quote: dict[str, Any]):
        self.current = quote

    def quote(self, **_kwargs: Any) -> dict[str, Any]:
        return json.loads(json.dumps(self.current))

    def validate_execution_binding(self, binding: dict[str, Any], *, actor: str | None = None) -> dict[str, Any]:
        del actor
        if self.current["promptBinding"]["executionBinding"] != binding:
            from jason.apps.studio.qingmu_changeset_service import QingmuChangeSetError
            raise QingmuChangeSetError("first_frame_execution_binding_blocked")
        return self.quote()


class PromptIrAuthority:
    def __init__(self, quote: dict[str, Any]):
        self.prompt = quote["authoritySnapshot"]["promptIr"]

    def read_prompt_ir_subject(self, **_kwargs: Any) -> dict[str, Any]:
        return {"subject": {"promptIrId": self.prompt["id"], "promptIrVersion": self.prompt["version"],
            "promptIrContentSha256": self.prompt["contentSha256"], "status": "Ready",
            "editableProjection": {"videoGenPrompt": "Ready PromptIR video prompt selected by a human."}}}


def table_counts(store: Any) -> dict[str, int]:
    names = ("generation_tasks", "provider_preflights", "provider_authorization_reservations",
        "provider_submission_outbox", "provider_budget_events")
    with store._connect() as conn:
        return {name: int(conn.execute(f"SELECT count(*) FROM {name}").fetchone()[0]) for name in names}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--quote", required=True)
    parser.add_argument("--writer-root", required=True)
    parser.add_argument("--port", type=int)
    parser.add_argument("--reuse", action="store_true")
    args = parser.parse_args()
    root = Path(args.root)
    writer_root = Path(args.writer_root)
    sys.path.insert(0, str(writer_root / "backend/src"))

    from jason.apps.auth.auth_middleware import get_current_user
    from jason.apps.studio import api_deps
    from jason.apps.studio.api_routes.qingmu_writer_production_bridge import router
    from jason.apps.studio.qingmu_writer_production_bridge_service import QingmuWriterProductionBridgeService
    from jason.config import Settings
    from jason.domain.store import DramaStore
    from jason.domain.task_center import TaskCenter
    from jason.providers.gate import ProviderGate

    quote = json.loads(Path(args.quote).read_text())
    db_path = root / "isolated-writer-production-take.db"
    store = DramaStore(db_path, enable_qingmu_changeset=True)
    tasks = TaskCenter(db_path)
    ProviderGate(Settings(app_env="test", allow_paid=False, max_paid_cny=0,
        database_url=f"sqlite:///{db_path}", storage_root=str(root / "storage"), dashscope_api_key=""))
    if not args.reuse:
        now = "2026-09-02T00:00:00+00:00"
        with store._connect() as conn:
            conn.execute("INSERT INTO projects (id,name,status,created_at,updated_at,owner) VALUES (?,?,?,?,?,?)",
                ("project-1", "Fixture", "active", now, now, "owner"))
            conn.execute("INSERT INTO series (id,project_id,title,created_at,updated_at) VALUES (?,?,?,?,?)",
                ("series-1", "project-1", "S1", now, now))
            conn.execute("INSERT INTO episodes (id,project_id,series_id,episode_no,title,source_text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                ("episode-1", "project-1", "series-1", 1, "E1", "fixture", "draft", now, now))
            conn.execute("INSERT INTO scenes (id,project_id,series_id,name,scene_type,visual_prompt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                ("scene-1", "project-1", "series-1", "Scene", "primary", "fixture", now, now))
            conn.execute("INSERT INTO storyboard_frames (id,project_id,episode_id,frame_no,scene_id,title,duration_sec,dialogue_json,visual_atoms_json,director_plan_json,image_prompt_cn,image_prompt_en,route_key,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                ("frame-1", "project-1", "episode-1", 1, "scene-1", "Shot 1", 5, "{}", "{}", "{}", "fixture", "fixture", "b6a.visual.i2v.first_frame", "planned", now, now))

    QueueOnlyVideoService = load_test_seam(writer_root)
    video = QueueOnlyVideoService(tasks)
    service = QingmuWriterProductionBridgeService(store, QuoteAuthority(quote), PromptIrAuthority(quote), video)
    api_deps.store = store
    api_deps.qingmu_writer_production_bridge_service = service
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="owner")
    route_statuses: list[int] = []

    @app.middleware("http")
    async def record_production_status(request: Any, call_next: Any):
        response = await call_next(request)
        if request.url.path.endswith("/production-takes"):
            route_statuses.append(response.status_code)
        return response

    @app.get("/__fixture/state")
    def state() -> dict[str, Any]:
        with store._connect() as conn:
            rows = [dict(row) for row in conn.execute(
                "SELECT id,kernel_status,local_status,provider_status FROM generation_tasks ORDER BY created_at")]
        return {"counts": table_counts(store), "tasks": rows, "providerCalls": video.provider_calls,
            "promptOverrideCalls": video.prompt_override_calls, "writerCalls": len(video.calls),
            "routeStatuses": route_statuses}

    @app.post("/__fixture/lose-next")
    def lose_next() -> dict[str, bool]:
        video.lose_first_response = True
        video._response_lost = False
        return {"ok": True}

    @app.post("/__fixture/finish-active")
    def finish_active() -> dict[str, int]:
        with store._connect() as conn:
            changed = conn.execute("UPDATE generation_tasks SET kernel_status='Failed',local_status='failed',provider_status='FAILED' WHERE kernel_status IN ('DispatchPending','Queued','Running')").rowcount
        return {"changed": int(changed)}

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", args.port or 0))
    sock.listen(128)
    port = sock.getsockname()[1]
    print("QINGMU_WRITER_FIXTURE=" + json.dumps({"baseUrl": f"http://127.0.0.1:{port}", "sqlitePath": str(db_path)}), flush=True)
    uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])


if __name__ == "__main__":
    main()
