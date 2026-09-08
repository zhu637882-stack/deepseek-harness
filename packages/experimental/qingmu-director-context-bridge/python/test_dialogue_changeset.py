"""Real Writer Store/Change Set integration in disposable test databases only."""
from copy import deepcopy
import json

import pytest

from jason.domain.store import DramaStore
from jason.domain.task_center import TaskCenter
from jason.apps.studio.qingmu_changeset_service import QingmuChangeSetService, QingmuChangeSetError
from dialogue_changeset import DialogueChangeSets, REFERENCE_SCHEMA


@pytest.fixture
def runtime(tmp_path):
    store = DramaStore(tmp_path / "dialogue.db", enable_qingmu_changeset=True)
    project = store.create_project("台词事务测试", owner="owner")
    series = store.create_series(project["id"], "第一季")
    episode = store.create_episode(project["id"], series["id"], 1, "第一集", "测试资料")
    line = {"lineId": "line-6", "speakerId": "lina", "verbatimText": "有人吗？", "line": "有人吗？"}
    script = {"scenes": [{"title": "公路", "dialogues": [line]}]}
    store.update_episode(episode["id"], script_json=json.dumps(script, ensure_ascii=False))
    frames = []
    assets = []
    for number in (5, 6, 7):
        cue = {"dialoguePlan": {"cues": [line] if number == 6 else []}}
        frame = store.create_storyboard_frame(
            project_id=project["id"], episode_id=episode["id"], frame_no=number,
            scene_id=None, title=f"镜{number}", duration_sec=6,
            dialogue={"line": "有人吗？" if number == 6 else "", **cue},
            visual_atoms={"visualDescription": "白车旁", **cue},
            director_plan={"camera": "固定镜头", **cue},
            image_prompt_cn="白车旁", image_prompt_en="beside a car", route_key="b5.first_frame",
        )
        frames.append(frame)
        assets.append(store.create_asset(
            project_id=project["id"], episode_id=episode["id"], owner_type="frame", owner_id=frame["id"],
            asset_type="video", role="b6_video", local_path=f"storage/test-{number}.mp4", mime_type="video/mp4",
        ))
    base = QingmuChangeSetService(store)
    revision = base._production_kernel.snapshot_storyboard(project_id=project["id"], episode_id=episode["id"], status="Ready")
    reference = {"schema": REFERENCE_SCHEMA, "lineId": "line-6", "before": "有人吗？", "after": "有人在吗？",
                 "storyboardRevisionId": revision["id"], "affectedShotIds": [frames[1]["id"]]}
    return store, base, project, episode, script, frames, assets, reference


def propose(runtime, *, unrelated=False):
    store, base, project, episode, script, frames, assets, reference = runtime
    changed = deepcopy(script)
    changed["scenes"][0]["dialogues"][0].update(line="有人在吗？", verbatimText="有人在吗？")
    if unrelated:
        changed["scenes"][0]["title"] = "另一个场景"
    proposal = base.propose_episode_script_change_set(
        episode_id=episode["id"], base_revision=store.get_episode(episode["id"])["script_revision"],
        script=changed, actor_user_id="owner", expected_project_id=project["id"], references=[reference],
    )
    args = dict(idempotency_key="dialogue-edit-test-1", expected_payload_sha256=proposal["payloadSha256"],
                actor_user_id="owner", expected_project_id=project["id"], expected_episode_id=episode["id"],
                expected_base_revision=proposal["baseRevision"])
    return proposal, args


def rows(store, table):
    with store._connect() as conn:
        return [dict(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY id")]


def test_atomic_script_frame_edit_and_exact_retry(runtime):
    store, base, project, episode, script, frames, assets, reference = runtime
    proposal, args = propose(runtime)
    before_frames = rows(store, "storyboard_frames")
    before_assets = rows(store, "assets")
    service = DialogueChangeSets(base)
    result = service.commit_change_set(proposal["id"], **args)
    assert result["changed"] and not result["deduplicated"]
    assert json.loads(store.get_episode(episode["id"])["script_json"])["scenes"][0]["dialogues"][0]["line"] == "有人在吗？"
    updated = store.get_storyboard_frame(frames[1]["id"])
    for field in ("dialogue", "director_plan", "visual_atoms"):
        assert updated[field]["dialoguePlan"]["cues"][0]["verbatimText"] == "有人在吗？"
    unchanged = {frames[0]["id"], frames[2]["id"]}
    assert [row for row in rows(store, "storyboard_frames") if row["id"] in unchanged] == [row for row in before_frames if row["id"] in unchanged]
    assert [row for row in rows(store, "assets") if row["owner_id"] in unchanged] == [row for row in before_assets if row["owner_id"] in unchanged]
    assert next(row for row in rows(store, "assets") if row["owner_id"] == frames[1]["id"])["selection_status"] == "Stale"
    after = {table: rows(store, table) for table in ("episodes", "storyboard_frames", "assets", "storyboard_revisions", "command_receipts")}
    retried = service.commit_change_set(proposal["id"], **args)
    assert retried == {**result, "deduplicated": True}
    assert after == {table: rows(store, table) for table in after}


def test_failure_after_script_update_rolls_back_script_frames_and_receipt(runtime, monkeypatch):
    store, base, *_ = runtime
    proposal, args = propose(runtime)
    before = {table: rows(store, table) for table in ("episodes", "storyboard_frames", "assets", "command_receipts", "change_sets")}
    def fail(*args, **kwargs):
        raise RuntimeError("snapshot interrupted")
    monkeypatch.setattr(base._production_kernel, "snapshot_storyboard", fail)
    with pytest.raises(RuntimeError, match="snapshot interrupted"):
        DialogueChangeSets(base).commit_change_set(proposal["id"], **args)
    assert before == {table: rows(store, table) for table in before}


def test_rejects_disguised_unrelated_script_edit(runtime):
    store, base, *_ = runtime
    proposal, args = propose(runtime, unrelated=True)
    before = rows(store, "episodes")
    with pytest.raises(QingmuChangeSetError, match="dialogue_edit_contains_unrelated_changes"):
        DialogueChangeSets(base).commit_change_set(proposal["id"], **args)
    assert rows(store, "episodes") == before


def test_rejects_frame_edit_after_preview(runtime):
    store, base, project, episode, script, frames, *_ = runtime
    proposal, args = propose(runtime)
    base._production_kernel.update_storyboard_frame(frames[1]["id"], image_prompt_cn="新机位")
    before = rows(store, "episodes")
    with pytest.raises(QingmuChangeSetError, match="dialogue_storyboard_changed"):
        DialogueChangeSets(base).commit_change_set(proposal["id"], **args)
    assert rows(store, "episodes") == before


def test_rejects_other_owner(runtime):
    store, base, *_ = runtime
    proposal, args = propose(runtime)
    with pytest.raises(QingmuChangeSetError, match="change_set_forbidden"):
        DialogueChangeSets(base).commit_change_set(proposal["id"], **{**args, "actor_user_id": "other"})
    assert rows(store, "command_receipts") == []


@pytest.mark.parametrize("status,blocked", [("Running", True), ("QualityPending", True), ("Succeeded", False)])
def test_task_status_uses_scoped_kernel_identity(runtime, status, blocked):
    store, base, project, episode, script, frames, *_ = runtime
    TaskCenter(store.db_path)
    # This disposable DB fixture deliberately includes an unrelated malformed
    # legacy request, which cannot interfere with the selected shot.
    with store._connect() as conn:
        for task_id, source_id, state in (("task-6", frames[1]["id"], status), ("other", "other-frame", "Running")):
            conn.execute("INSERT INTO generation_tasks (id,capability,route_key,provider,model,request_hash,request_payload_json,local_status,created_at,updated_at,source_type,source_id,kernel_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                         (task_id, "video", "test", "test", "test", task_id, "malformed-json", "downloaded", "now", "now", "StoryboardFrame", source_id, state))
    proposal, args = propose(runtime)
    if blocked:
        with pytest.raises(QingmuChangeSetError, match="dialogue_frame_task_pending"):
            DialogueChangeSets(base).commit_change_set(proposal["id"], **args)
        assert rows(store, "command_receipts") == []
    else:
        assert DialogueChangeSets(base).commit_change_set(proposal["id"], **args)["changed"]


def test_old_video_and_dialogue_audio_cannot_remain_current(runtime):
    store, base, project, episode, script, frames, assets, *_ = runtime
    selected = frames[1]["id"]
    store.update_storyboard_frame(selected, status="completed")
    audio = {}
    for role in ("b6_dialogue_audio", "b6_dialogue_audio_candidate", "environment_audio"):
        audio[role] = store.create_asset(project_id=project["id"], episode_id=episode["id"], owner_type="frame",
            owner_id=selected, asset_type="audio", role=role, local_path=f"storage/{role}.wav", mime_type="audio/wav")
    with store._connect() as conn:
        conn.execute("UPDATE assets SET is_selected=1, selection_status='Selected'")
    before_environment = next(row for row in rows(store, "assets") if row["id"] == audio["environment_audio"]["id"])
    proposal, args = propose(runtime)
    DialogueChangeSets(base).commit_change_set(proposal["id"], **args)
    assert store.get_storyboard_frame(selected)["status"] == "planned"
    current_assets = rows(store, "assets")
    for asset_id in (assets[1]["id"], audio["b6_dialogue_audio"]["id"], audio["b6_dialogue_audio_candidate"]["id"]):
        asset = next(row for row in current_assets if row["id"] == asset_id)
        assert asset["is_selected"] == 0 and asset["selection_status"] == "Stale"
        assert asset["role"] != "b6_video"
    assert next(row for row in current_assets if row["id"] == before_environment["id"]) == before_environment


def test_updates_quoted_beat_copies_and_all_line_aliases():
    from dialogue_changeset import _project_frame
    line = {"lineId": "line-6", "line": "有人吗？", "text": "有人吗？", "verbatimText": "有人吗？"}
    plan = {"dialoguePlan": [line], "pacingPlan": [{"action": '莉娜呼喊"有人吗？"，然后倾听'}],
            "innerBeatPlan": [{"content": "莉娜呼喊“有人吗？”"}], "blockingBeats": [{"action": "呼喊「有人吗？」"}],
            "dialogueDensityContract": {"actualTotalChineseChars": 4}}
    original = {"dialogue": {"line": "有人吗？", "dialoguePlan": [line]}, "director_plan": plan, "visual_atoms": plan}
    updated = _project_frame(original, {"lineId": "line-6", "before": "有人吗？", "after": "有人在吗？"})
    assert "有人吗？" not in json.dumps(updated, ensure_ascii=False)
    assert updated["director_plan"]["dialoguePlan"][0]["text"] == "有人在吗？"
    assert updated["director_plan"]["dialogueDensityContract"]["actualTotalChineseChars"] == 5
    assert original["director_plan"]["dialoguePlan"][0]["line"] == "有人吗？"


@pytest.mark.parametrize('old', ['有人吗？', '有人吗', '有 人 吗 ?'])
def test_unidentified_old_prompt_cannot_reach_commit(runtime, old):
    store, base, project, episode, script, frames, assets, reference = runtime
    base._production_kernel.update_storyboard_frame(frames[1]["id"], image_prompt_cn="莉娜说" + old)
    with store._connect() as conn:
        reference["storyboardRevisionId"] = conn.execute("SELECT id FROM storyboard_revisions ORDER BY version DESC LIMIT 1").fetchone()["id"]
    proposal, args = propose(runtime)
    before = rows(store, "episodes")
    with pytest.raises(QingmuChangeSetError, match="dialogue_prompt_residue_requires_recompile"):
        DialogueChangeSets(base).commit_change_set(proposal["id"], **args)
    assert rows(store, "episodes") == before


def test_replacement_containing_original_is_not_false_residue():
    from dialogue_changeset import _has_old_dialogue
    assert not _has_old_dialogue('她说“快来救命！”', '救命！', '快来救命！')
    assert _has_old_dialogue('她说“快来救命！”然后喊“救 命”', '救命！', '快来救命！')


def test_old_local_repair_is_retained_as_history(runtime):
    store, base, project, episode, script, frames, *_ = runtime
    asset = store.create_asset(project_id=project['id'], episode_id=episode['id'], owner_type='frame',
        owner_id=frames[1]['id'], asset_type='video', role='b6_video_local_repair_candidate',
        local_path='storage/old-local-repair.mp4', mime_type='video/mp4')
    proposal, args = propose(runtime)
    DialogueChangeSets(base).commit_change_set(proposal['id'], **args)
    saved = store.get_asset(asset['id'])
    assert saved['role'] == 'b6_video_local_repair_history'
    assert saved['selection_status'] == 'Stale' and saved['local_path'] == asset['local_path']
