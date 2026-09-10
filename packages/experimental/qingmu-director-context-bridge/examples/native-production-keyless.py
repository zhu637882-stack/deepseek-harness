"""Run the shipped creation router and budget gate against an isolated database.

Usage: Writer .venv/bin/python this-file.py /path/to/writer
No worker or HTTP provider client is started. Output is compared with a snapshot.
"""
import json
import os
from pathlib import Path
import sys
import tempfile

HARNESS = Path(__file__).resolve().parents[4]
WRITER = Path(sys.argv[1]).resolve(strict=True)
sys.path[:0] = [str(WRITER / "backend/src"), str(Path(__file__).resolve().parents[1] / "python")]


def run(root):
    os.environ.update({"JASON_PROJECT_ROOT": str(root), "JASON_CONFIG_ROOT": str(WRITER),
        "JASON_ENV_FILE": str(root / "absent.env"), "DATABASE_URL": f"sqlite:///{root / 'state.db'}",
        "STORAGE_ROOT": str(root / "storage"), "JWT_SECRET": "keyless-example-jwt-secret-with-32-characters",
        "QINGMU_CHANGESET_ENABLED": "true", "ALLOW_PAID": "false",
        "QINGMU_CREATIVE_SKILL_ROOT": str(HARNESS / "packages/experimental/qingmu-web/agent-presets/qingmu-director/skills")})
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from jason.apps.studio import api_deps
    from jason.apps.studio.api_routes.qingmu_creation import router
    from jason.apps.auth import auth_middleware
    from jason.config import Settings
    from jason.providers.gate import ProviderGate
    from reference_video_connection import key_fingerprint, production_environment

    auth = api_deps.auth_service
    owner = auth.register("keyless_creator", "13900000001", "Local-example-only!")
    auth_middleware._get_auth_service = lambda: auth
    key = root / "credential.env"
    key.write_text("DASHSCOPE_API_KEY=nonfunctional-keyless-example\n")
    key.chmod(0o600)
    config = {"uiMode": "native", "nativeProductionExecution": {
        "provider": "dashscope", "ownerId": owner.id, "credentialEnvFile": str(key),
        "credentialFingerprint": key_fingerprint("nonfunctional-keyless-example"),
        "maxPaidCny": 1, "budgetBaselineCny": 0, "budgetWindowId": "keyless-example"}}
    os.environ.update(production_environment(config))
    gate = ProviderGate(Settings())
    app = FastAPI()
    app.include_router(router)
    headers = {"Authorization": "Bearer " + auth._issue_token(owner.id)}
    with TestClient(app) as client:
        methods = client.get("/api/qingmu/creation-options", headers=headers).json()
        ids = [item["id"] for item in methods["directorSkills"] if item["available"]]
        projects = []
        for index in (1, 2):
            response = client.post("/api/qingmu/project-initializations", headers=headers, json={
                "name": f"Keyless project {index}", "style": "realistic", "aspectRatio": "16:9",
                "mode": "whole_series", "creationType": "story_idea", "episodeCount": 1,
                "duration": "120秒", "textInput": "两人在门口重逢。", "textVersion": "creation-text-v1",
                "stylePackId": "sp_urban_emotion_realistic", "directorSkillIds": ids,
                "idempotencyKey": f"keyless-project-{index}"})
            assert response.status_code == 200, response.text
            projects.append(response.json())
        contract = client.get(f"/api/qingmu/projects/{projects[1]['projectId']}/creative-contract", headers=headers).json()
        args = dict(capability="video.visual", route_key="b6.reference_video", provider="dashscope",
                    model="wan3.0-video", dry_run=False)
        payload = {"project_id": projects[1]["projectId"], "duration": 1,
                   "snapshot": {"body": {"model": "wan3.0-video", "input": {"prompt": "A door opens."},
                                            "parameters": {"duration": 1, "size": "1280*720"}}}}
        before = gate.preflight(**args, payload=payload)
        assert before.allowed, before
        assert gate.reserve_once(1, "first-project-spend")
        after = gate.preflight(**args, payload=payload)
        stranger = gate.preflight(**args, payload={**payload, "project_id": "missing-project"})
        return {"projectsCreated": len(projects), "selectableDirectorMethods": ids,
            "savedMethods": {name: [item["id"] for item in contract["contract"]["methods"][name]]
                             for name in ("writingSkills", "directorSkills", "cameraSkills")},
            "secondProjectInitiallyAllowed": before.allowed, "sharedBudgetAfterSpend": after.reason,
            "unknownProjectDenied": stranger.reason, "providerRequests": 0}


with tempfile.TemporaryDirectory(prefix="qingmu-keyless-") as directory:
    result = run(Path(directory).resolve())
    expected = json.loads(Path(__file__).with_suffix(".expected.json").read_text())
    assert result == expected, result
    print(json.dumps(result, ensure_ascii=False, indent=2))
