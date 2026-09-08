"""Test-only HTTP fixture: real Writer services over disposable synthetic data.

No production configuration, database copy, Provider route, or credentials are used.
The parent owns the temporary cwd and process lifetime. Authentication, mounted
business routes and persistence are Writer code over synthetic test identities.
"""
import json
import os
from pathlib import Path
import socket
import sys


root = Path.cwd().resolve()
writer = Path(os.environ["QINGMU_WRITER_TEST_ROOT"]).resolve(strict=True)
assert root.name.startswith("qingmu-connected-") and root != writer
os.environ.update({
    "DATABASE_URL": f"sqlite:///{root}/bootstrap.db",
    "STORAGE_ROOT": str(root / "storage"),
    "APP_ENV": "test", "ALLOW_PAID": "false", "MAX_PAID_CNY": "0",
    "PROVIDER_BUDGET_BASELINE_CNY": "0", "PROVIDER_BUDGET_WINDOW_ID": "",
    "PROVIDER_PAID_SCOPE_PROJECT_ID": "", "PROVIDER_PAID_SCOPE_EPISODE_ID": "",
    "PROVIDER_PAID_SCOPE_REQUIRED": "false", "ALLOW_REMOTE_DOWNLOAD": "false",
    "DASHSCOPE_API_KEY": "", "OPENAI_API_KEY": "", "LOCAL_ASR_COMMAND_JSON": "",
    "APP_PUBLIC_BASE_URL": "http://127.0.0.1:8000",
    "PROVIDER_MEDIA_PUBLIC_URL_VERIFIED": "false", "NATIVE_VIDEO_QA_ENABLED": "false",
    "FIRST_FRAME_IDENTITY_POC_ALLOW_PAID": "false", "FIRST_FRAME_MULTI_ACTOR_USE_WAN": "false",
    "BUILD_MANIFEST_DIR": str(root / "no-release-manifest"),
    "QINGMU_CHANGESET_ENABLED": "true", "JWT_SECRET": "connected-fixture-secret-at-least-32-bytes",
    "PUBLIC_REGISTRATION_ENABLED": "true", "COMPANY_WORKSPACE_ENABLED": "false",
})
sys.path[:0] = [str(writer / "backend/src"), str(writer / "tests")]

def local_only(event, arguments):
    if event == "socket.connect":
        address = arguments[1]
        if isinstance(address, tuple) and address[0] not in ("127.0.0.1", "::1"):
            raise RuntimeError("fixture outbound network forbidden")


sys.addaudithook(local_only)
from jason.config import Settings, get_settings
Settings.model_config["env_file"] = None
get_settings.cache_clear()
from fastapi import FastAPI
import uvicorn
from test_qingmu_prompt_ir_bootstrap_service import world, KEY
from jason.apps.auth import auth_middleware
from jason.apps.auth.auth_service import AuthService
from jason.apps.studio import api_deps
from jason.apps.studio.api_routes.qingmu_prompt_ir_bootstrap import router as bootstrap_router
from jason.apps.studio.api_routes.qingmu_director_inference import router as director_router
from jason.apps.studio.qingmu_director_inference_service import DirectorInferenceService

store, bootstrap, changes, scope, _asset = world.__wrapped__(root)
api_deps.store = store
api_deps.qingmu_prompt_ir_bootstrap_service = bootstrap
api_deps.qingmu_change_set_service = changes
api_deps.qingmu_director_inference_service = DirectorInferenceService(
    store, root / "storage", bootstrap.planning,
)
state = bootstrap.read(**scope)
native_scope = {
    "projectId": scope["project_id"], "episodeId": scope["episode_id"],
    "sceneId": state["context"]["frame"]["sceneId"], "shotId": scope["frame_id"],
}
app = FastAPI()
app.include_router(bootstrap_router)
# Only mount the real read route; no paid work-order or generation endpoint exists.
app.router.routes.extend(route for route in director_router.routes if route.path.endswith("/context"))
if os.environ.get("QINGMU_CONNECTED_FULL_HOST") == "1":
    from jason.apps.studio import api
    from jason.apps.studio.api_routes.qingmu_scene_planning import router as planning_router
    # Keep the real read endpoints, without the production lifespan or dispatch routes.
    read_names = {"health", "list_projects", "list_episodes", "episode_workflow_projection", "get_qingmu_prompt_ir_subject"}
    app.router.routes.extend(route for route in api.app.routes
                             if getattr(getattr(route, "endpoint", None), "__name__", "") in read_names)
    app.router.routes.extend(route for route in planning_router.routes if route.methods == {"GET"})
auth = AuthService(store, jwt_secret=api_deps.settings.jwt_secret)
registered = auth.register("connected-fixture", "13800000018", "fixture-password")
with store._connect() as conn:
    conn.execute("UPDATE users SET id=? WHERE id=?", ("owner", registered.id))
auth_middleware._auth_service = None
_user, token = auth.login("connected-fixture", "fixture-password")


@app.get("/fixture/inspection")
def inspect():
    """Independent persisted-world assertion, never a fake business result."""
    with store._connect() as conn:
        counts = {table: conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                  for table in ("prompt_irs", "generation_tasks", "provider_submission_outbox")}
        return {"counts": counts, "integrity": conn.execute("PRAGMA quick_check").fetchone()[0]}


sock = socket.socket()
sock.bind(("127.0.0.1", 0))
sock.listen(128)
print(json.dumps({"fixtureReady": True, "baseUrl": f"http://127.0.0.1:{sock.getsockname()[1]}",
                  "scope": native_scope, "storyboardRevisionId": scope["storyboard_revision_id"],
                  "attestationKey": KEY, "token": token}), flush=True)
uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False)).run(sockets=[sock])
