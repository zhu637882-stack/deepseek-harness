"""Imported-script dialogue changes through real Writer services in a temporary DB."""
from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from dialogue_changeset import DialogueChangeSets, REFERENCE_SCHEMA
from jason.apps.studio.episode_workflow_projection import _shot_dialogue_rhythm
from jason.apps.studio.qingmu_director_inference_service import DirectorInferenceService
from jason.apps.studio.qingmu_reference_video_draft_service import ReferenceVideoDraftService
from jason.domain.reference_video_drafts import apply_reference_video_draft_migration
from jason.domain.task_center import TaskCenter
from test_qingmu_prompt_ir_bootstrap_service import world


@pytest.mark.parametrize("tamper", [None, "successive", "receipt", "outbox", "payload", "generic_script", "frame"])
def test_imported_line_commit_refreshes_context_and_invalidates_old_reference_draft(tmp_path, monkeypatch, tamper):
    store, bootstrap, changes, scope, uploaded = world.__wrapped__(tmp_path, SimpleNamespace(param="dialogue"))
    TaskCenter(store.db_path)
    project_id, episode_id, frame_id = scope["project_id"], scope["episode_id"], scope["frame_id"]
    frame = store.get_storyboard_frame(frame_id)
    director = DirectorInferenceService(store, tmp_path / "storage", bootstrap.planning)
    context_scope = dict(actor="owner", project_id=project_id, episode_id=episode_id,
                         scene_id=frame["scene_id"], shot_id=frame_id)
    before_context = director.read(**context_scope)
    before_script = json.loads(store.get_episode(episode_id)["script_json"])
    line = before_script["scenes"][0]["dialogues"][0]
    assert "lineId" not in line
    assert _shot_dialogue_rhythm(frame)["cues"][0]["lineId"] == line["sourceLineId"]
    with store._connect() as conn:
        apply_reference_video_draft_migration(conn)
    drafts = ReferenceVideoDraftService(store)
    draft_scope = dict(actor="owner", project_id=project_id, frame_id=frame_id)
    initial = drafts.read(**draft_scope)
    asset = store.get_asset(uploaded["assetId"])
    request = {"frameId": frame_id, "bindings": [{"bindingToken": "scene", "assetId": asset["id"], "assetSha256": asset["sha256"]}],
               "promptParts": [{"bindingToken": "scene"}, {"text": f'莉娜：“{line["line"]}”'}],
               "parameters": {"duration": 8, "ratio": "16:9"}}
    saved = drafts.save(**draft_scope, expected_revision=0, expected_frame_sha=initial["frameSha256"], request=request)
    proposed = deepcopy(before_script)
    proposed["scenes"][0]["dialogues"][0]["line"] = "请问，还有人在吗？"
    ref = {"schema": REFERENCE_SCHEMA, "lineId": line["sourceLineId"], "before": line["line"],
           "after": "请问，还有人在吗？", "storyboardRevisionId": scope["storyboard_revision_id"], "affectedShotIds": [frame_id]}
    proposal = changes.propose_episode_script_change_set(
        episode_id=episode_id, base_revision=store.get_episode(episode_id)["script_revision"], script=proposed,
        actor_user_id="owner", expected_project_id=project_id, references=[ref])
    args = dict(idempotency_key="imported-line-edit", expected_payload_sha256=proposal["payloadSha256"],
                actor_user_id="owner", expected_project_id=project_id, expected_episode_id=episode_id,
                expected_base_revision=proposal["baseRevision"])
    service = DialogueChangeSets(changes)
    result = service.commit_change_set(proposal["id"], **args)
    assert result["changed"]
    assert service.commit_change_set(proposal["id"], **args)["deduplicated"]
    current = store.get_storyboard_frame(frame_id)
    assert current["dialogue"]["lines"][0]["line"] == ref["after"]
    assert current["director_plan"]["dialoguePlan"][0]["line"] == ref["after"]
    assert current["director_plan"]["scenePlanning"] == frame["director_plan"]["scenePlanning"]
    after_script = json.loads(store.get_episode(episode_id)["script_json"])
    assert after_script["sourceBinding"] == before_script["sourceBinding"]
    after_context = director.read(**context_scope)
    assert after_context["script"]["revision"] == before_context["script"]["revision"] + 1
    assert after_context["contextSnapshotSha256"] != before_context["contextSnapshotSha256"]
    assert _shot_dialogue_rhythm(current)["cues"][0]["verbatimText"] == ref["after"]
    stale = drafts.read(**draft_scope)
    assert stale["draft"] == saved["draft"]
    assert stale["frameSha256"] != saved["frameSha256"]
    with pytest.raises(ValueError, match="reference_video_frame_conflict"):
        drafts.save(**draft_scope, expected_revision=1, expected_frame_sha=saved["frameSha256"], request=request)
    revised = deepcopy(request)
    revised["promptParts"][1]["text"] = f'莉娜：“{ref["after"]}”'
    updated = drafts.save(**draft_scope, expected_revision=1, expected_frame_sha=stale["frameSha256"], request=revised)
    assert updated["draft"]["request"]["bindings"] == request["bindings"]
    assert updated["draft"]["request"]["promptParts"] == revised["promptParts"]
    with store._connect() as conn:
        assert conn.execute("SELECT count(*) FROM generation_tasks").fetchone()[0] == 0
    if tamper == "successive":
        second = deepcopy(after_script)
        second["scenes"][0]["dialogues"][0]["line"] = "请问，有人在这里吗？"
        with store._connect() as conn:
            latest = conn.execute("SELECT id FROM storyboard_revisions WHERE episode_id=? ORDER BY version DESC LIMIT 1", (episode_id,)).fetchone()
        ref = {**ref, "before": ref["after"], "after": second["scenes"][0]["dialogues"][0]["line"], "storyboardRevisionId": latest["id"]}
        next_proposal = changes.propose_episode_script_change_set(episode_id=episode_id, base_revision=2,
            script=second, actor_user_id="owner", expected_project_id=project_id, references=[ref])
        second_result = service.commit_change_set(next_proposal["id"], idempotency_key="imported-line-edit-2",
            expected_payload_sha256=next_proposal["payloadSha256"], actor_user_id="owner",
            expected_project_id=project_id, expected_episode_id=episode_id, expected_base_revision=2)
        assert second_result["changed"] and second_result["authoritativeRevision"] == 3
    if tamper in {"receipt", "outbox"}:
        with store._connect() as conn:
            table = "command_receipts" if tamper == "receipt" else "domain_outbox"
            conn.execute(f"DELETE FROM {table} WHERE change_set_id=?", (proposal["id"],))
    if tamper == "payload":
        with store._connect() as conn:
            conn.execute("UPDATE change_sets SET command_payload_sha256=? WHERE id=?", ("0" * 64, proposal["id"]))
    if tamper == "generic_script":
        unrelated = deepcopy(after_script)
        unrelated["scenes"][0]["title"] = "另一个车站"
        extra = changes.propose_episode_script_change_set(episode_id=episode_id, base_revision=2,
            script=unrelated, actor_user_id="owner", expected_project_id=project_id)
        changes.commit_change_set(extra["id"], idempotency_key="unrelated-script",
            expected_payload_sha256=extra["payloadSha256"], actor_user_id="owner",
            expected_project_id=project_id, expected_episode_id=episode_id, expected_base_revision=2)
    if tamper == "frame":
        broken = deepcopy(current["dialogue"])
        broken["lines"][0]["line"] = ref["before"]
        store.update_storyboard_frame(frame_id, dialogue=broken)
    if tamper in {"generic_script", "frame"}:
        changes._production_kernel.snapshot_storyboard(project_id=project_id, episode_id=episode_id, status="Ready")
    planning = bootstrap.planning
    state = planning.read(actor="owner", project_id=project_id, episode_id=episode_id)
    shot = {k: v for k, v in state["planning"]["shots"][0].items() if k != "id"}
    shot["title"] = "改完台词后调整镜头标题"
    planning_request = {"action": "edit", "sceneIndex": 1, "shotId": frame_id, "shot": shot,
        "expectedScriptRevision": state["scriptRevision"], "expectedScriptSha256": state["scriptSha256"],
        "expectedStoryboardRevision": state["storyboard"]["version"], "expectedStoryboardSha256": state["storyboard"]["sourceHash"]}
    with store._connect() as conn:
        before_edit = list(conn.iterdump())
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from jason.apps.auth.auth_middleware import get_current_user
    from jason.apps.studio import api_deps
    from jason.apps.studio.api_routes.qingmu_scene_planning import router
    monkeypatch.setattr(api_deps, "qingmu_scene_planning_service", planning)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="owner")
    with TestClient(app) as client:
        response = client.post(f"/api/qingmu/projects/{project_id}/episodes/{episode_id}/scene-planning/commands",
            json={"idempotencyKey": "edit-after-dialogue", "request": planning_request})
    if tamper not in {None, "successive"}:
        assert response.status_code == (500 if tamper in {"outbox", "payload"} else 409), response.text
        assert response.json()["detail"]["code"] in {"planning_shot_source_conflict", "planning_dialogue_receipt_integrity_mismatch"}
        assert response.headers["cache-control"] == "private, no-store"
        with store._connect() as conn:
            assert list(conn.iterdump()) == before_edit
    else:
        assert response.status_code == 200, response.text
        edited = response.json()
        assert edited["source"] == state["planning"]["source"]
        assert store.get_storyboard_frame(frame_id)["dialogue"]["lines"][0]["line"] == ref["after"]
        refreshed = planning.read(actor="owner", project_id=project_id, episode_id=episode_id)
        assert refreshed["planning"]["shots"][0]["title"] == shot["title"]
        assert refreshed["scriptSha256"] == state["scriptSha256"]
