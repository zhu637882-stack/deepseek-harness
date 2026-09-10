"""Boot actual Writer routes with Qingmu composition in a disposable process."""
import os
import json
from pathlib import Path
import subprocess
import sys
import socket
import time
import urllib.request
import urllib.error
import pytest


@pytest.mark.parametrize("identity_key", ["lineId", "sourceLineId"])
def test_existing_http_commit_uses_dialogue_composition(tmp_path, identity_key):
    from jason import config
    writer = config.CONFIG_ROOT
    owned = Path(__file__).resolve().parent
    script = r'''
import json
from types import SimpleNamespace
import subprocess
from fastapi.testclient import TestClient
from jason.apps.studio import api_deps
from qingmu_api import compose_dialogue_service, install_dialogue_capability
compose_dialogue_service(api_deps)
from jason.apps.studio.api import app
from jason.apps.auth.auth_middleware import get_current_user
install_dialogue_capability(app)
store = api_deps.store
project = store.create_project("HTTP dialogue test", owner="fixture-owner")
series = store.create_series(project["id"], "season")
episode = store.create_episode(project["id"], series["id"], 1, "episode", "source")
line = {"lineId":"line6","line":"有人吗？","verbatimText":"有人吗？"}
store.update_episode(episode["id"], script_json=json.dumps({"scenes":[{"title":"公路","dialogues":[line]}]},ensure_ascii=False))
frame = store.create_storyboard_frame(project_id=project["id"],episode_id=episode["id"],frame_no=6,
    scene_id=None,title="呼喊",duration_sec=7,dialogue={"line":"有人吗？","dialoguePlan":[line]},
    visual_atoms={},director_plan={},image_prompt_cn="车旁",image_prompt_en="car",route_key="b5.first_frame")
revision = api_deps.production_kernel_service.snapshot_storyboard(project_id=project["id"],episode_id=episode["id"],status="Ready")
client = TestClient(app)
assert client.get("/api/qingmu/dialogue-edit/capability").status_code == 401
app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="fixture-owner")
assert client.get("/api/qingmu/dialogue-edit/capability").json()["atomicScriptAndFrames"] is True
def fixture_task(name, status):
    return api_deps.task_center.create_task(capability='video',route_key='b6.frame_regenerate',provider='local-fixture',model='fixture',
        payload={'project_id':project['id'],'episode_id':episode['id'],'frame_id':frame['id']},
        provider_task_id=name,provider_status='SUCCEEDED' if status=='downloaded' else 'RUNNING',local_status=status)
old_task = fixture_task('old-completed', 'downloaded')
def fixture_video(name, task=None):
    path = api_deps.settings.storage_path / (name + '.mp4')
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['/opt/homebrew/bin/ffmpeg','-loglevel','error','-f','lavfi','-i',
                    'color=c=black:s=64x64:r=8','-t','0.5','-c:v','libx264',str(path)], check=True)
    asset = store.create_asset(project_id=project['id'],episode_id=episode['id'],owner_type='frame',owner_id=frame['id'],
        asset_type='video',role='b6_video_candidate',local_path='storage/' + path.name,mime_type='video/mp4',
        created_by_task_id=task['id'] if task else None)
    store.create_provider_media(asset_id=asset['id'],local_path='storage/' + path.name,provider='local-fixture',media_kind='video',
        url=str(path),url_type='local_ffmpeg_derived')
    return asset
old_video = fixture_video('old-dialogue-fixture', old_task)
projection_url = f"/api/episodes/{episode['id']}/shot-scripts"
initial_projection = client.get(projection_url)
assert initial_projection.status_code == 200, initial_projection.text
assert initial_projection.json()['items'][0]['currentVideoAssetId'] == old_video['id'], initial_projection.json()
assert initial_projection.json()['items'][0]['currentVideoUrl']
assert initial_projection.json()['items'][0]['currentGenerationStatus'] == 'missing_output'
line.update(line="有人在吗？",verbatimText="有人在吗？")
base = store.get_episode(episode["id"])["script_revision"]
proposal = client.post(f"/api/qingmu/episodes/{episode['id']}/script/change-sets",json={
    "projectId":project["id"],"baseRevision":base,"script":{"scenes":[{"title":"公路","dialogues":[line]}]},
    "references":[{"schema":"qingmu.dialogue-edit-reference.v1","lineId":"line6","before":"有人吗？","after":"有人在吗？",
                   "storyboardRevisionId":revision["id"],"affectedShotIds":[frame["id"]]}]})
assert proposal.status_code == 201, proposal.text
p = proposal.json()["changeSet"]
payload = {"projectId":project["id"],"episodeId":episode["id"],"baseRevision":base,
           "idempotencyKey":"http-dialogue-exact-1","expectedPayloadSha256":p["payloadSha256"]}
url = f"/api/qingmu/change-sets/{p['id']}:commit"
result = client.post(url,json=payload)
assert result.status_code == 200, result.text
assert result.json()["changed"] is True
assert store.get_storyboard_frame(frame["id"])["dialogue"]["line"] == "有人在吗？"
repeat = client.post(url,json=payload)
assert repeat.status_code == 200 and repeat.json()["deduplicated"] is True, repeat.text
assert repeat.json()["commandReceiptId"] == result.json()["commandReceiptId"]
refreshed = client.get(projection_url)
assert refreshed.status_code == 200, refreshed.text
assert refreshed.json()['items'][0]['currentVideoUrl'] is None
assert refreshed.json()['videoSegments'][0]['videoUrl'] is None
assert refreshed.json()['segments'][0]['videoUrl'] is None
assert refreshed.json()['items'][0]['currentGenerationPublicId'] is None
assert refreshed.json()['items'][0]['currentGenerationStatus'] is None
assert refreshed.json()['items'][0]['status'] == 'planned'
assert refreshed.json()['videoSegments'][0]['status'] == 'missing'
assert refreshed.json()['aggregate']['outdatedVideoCount'] == 1
assert store.get_asset(old_video['id'])['local_path'] == old_video['local_path']
new_task = fixture_task('new-running', 'running')
running_projection = client.get(projection_url).json()
assert running_projection['items'][0]['currentGenerationPublicId'] == new_task['id'], running_projection
assert running_projection['items'][0]['currentGenerationStatus'] == 'running'
assert running_projection['items'][0]['status'] == 'generating'
assert running_projection['videoSegments'][0]['status'] == 'running'
downloaded_task = fixture_task('new-downloaded', 'downloaded')
new_video = fixture_video('new-dialogue-fixture', downloaded_task)
new_projection = client.get(projection_url).json()
assert new_projection['items'][0]['currentVideoAssetId'] == new_video['id'], new_projection
assert new_projection['items'][0]['currentVideoUrl']
assert new_projection['items'][0]['currentGenerationPublicId'] == downloaded_task['id']
assert new_projection['items'][0]['currentGenerationStatus'] == 'missing_output'
assert new_projection['videoSegments'][0]['status'] == 'missing_output'
assert api_deps.settings.allow_paid is False
print("actual HTTP routes: script+frame committed, exact retry deduplicated; fixture only, paid disabled")
'''
    script = script.replace('line = {"lineId":', 'line = {"' + identity_key + '":')
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PYTHONDONTWRITEBYTECODE": "1",
           "PYTHONPATH": os.pathsep.join((str(writer / "backend/src"), str(owned))),
           "JASON_PROJECT_ROOT": str(tmp_path), "JASON_CONFIG_ROOT": str(writer),
           "JASON_ENV_FILE": str(tmp_path / "absent.env"), "APP_ENV": "test", "ALLOW_PAID": "false",
           "APP_PUBLIC_BASE_URL": "http://testserver",
           "QINGMU_CHANGESET_ENABLED": "true", "DATABASE_URL": f"sqlite:///{tmp_path / 'http.db'}",
           "STORAGE_ROOT": str(tmp_path / "storage"), "BUILD_MANIFEST_DIR": str(tmp_path / "build"),
           "OPERATOR_AUDIT_DIR": str(tmp_path / "audit")}
    result = subprocess.run([sys.executable, "-B", "-c", script], cwd=tmp_path, env=env,
                            text=True, capture_output=True, timeout=45)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "actual HTTP routes" in result.stdout


def test_owned_entry_binds_instance_before_importing_writer(tmp_path):
    from jason import config
    root = tmp_path.resolve()
    private = root / "private"
    private.mkdir()
    instance = {"root": str(root), "yimengRoot": str(config.CONFIG_ROOT), "instanceId": "isolated-dialogue-api",
                "jwtSecret": "fixture-secret-not-production-0000", "attestationKey": "fixture-attestation-not-production-0000",
                "controlKey": "fixture-control"}
    (private / "instance.json").write_text(json.dumps(instance))
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PYTHONDONTWRITEBYTECODE": "1",
           "PYTHONPATH": str(config.CONFIG_ROOT / "backend/src")}
    process = subprocess.Popen([sys.executable, "-B", str(Path(__file__).with_name("qingmu_api.py")),
                                "--root", str(root), "--port", str(port)], cwd=root, env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    identity = None
    try:
        until = time.monotonic() + 15
        while process.poll() is None and time.monotonic() < until:
            try:
                request = urllib.request.Request(f"http://127.0.0.1:{port}/_qingmu/instance",
                                                 headers={"Authorization": "Bearer fixture-control"})
                with urllib.request.urlopen(request, timeout=0.5) as response:
                    identity = json.load(response)
                break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.1)
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            output, _ = process.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            output, _ = process.communicate(timeout=3)
    assert identity is not None, output
    assert identity["database"] == str(root / "storage/jason.db")
    assert identity["root"] == str(root)
