"""Imported planning survives the real atomic dialogue command and stays editable."""
from copy import deepcopy
import json
import pytest
from jason.domain.store import DramaStore
from jason.apps.studio.production_kernel_service import ProductionKernelService
from jason.apps.studio.qingmu_project_bootstrap_service import ProjectBootstrapService
from jason.apps.studio.text_import_service import TextImportService
from jason.apps.studio.qingmu_scene_planning_service import ScenePlanningService
from jason.apps.studio.qingmu_changeset_service import QingmuChangeSetService
from dialogue_changeset import DialogueChangeSets, REFERENCE_SCHEMA


def test_imported_planning_dialogue_read_edit_and_integrity(tmp_path):
    store = DramaStore(tmp_path / 'planning.db', enable_qingmu_changeset=True)
    text = '场景一：裁缝铺\n动作：母亲停针。\n林晓：雨停了。\n林岚：带上伞。'
    created = ProjectBootstrapService(store).create(actor='owner', key='planning-project', request={
        'name': '台词接续', 'style': 'realistic', 'aspectRatio': '16:9', 'mode': 'whole_series',
        'creationType': 'story_idea', 'episodeCount': 1, 'duration': '1-2', 'textInput': text, 'stylePackId': None})
    p, e = created['projectId'], created['episodeId']
    importer = TextImportService(store, tmp_path / 'storage')
    draft = importer.create_draft(project_id=p, episode_id=e, filename='script.txt', raw=text.encode(), text=text,
        encoding='utf-8', document_parser_version='builtin-text-decoder-v1', strategy='episode_marker',
        every_n_paragraphs=8, manual_boundaries=[], seed=0, base_script_revision=0)
    importer.confirm(project_id=p, episode_id=e, draft_id=draft['id'], expected_fingerprint=draft['fingerprint'],
        expected_script_revision=0, episode_index=1, actor_id='owner')
    planning = ScenePlanningService(store, ProductionKernelService(store, tmp_path / 'storage'))
    scope = dict(actor='owner', project_id=p, episode_id=e)
    state = planning.read(**scope)
    lines = state['scenes'][0]['dialogues']
    shots = [dict(title=line['character'], narrative='倾听', visual='门旁', action='抬眼', durationSec=5,
        dialogueLineIds=[line['sourceLineId']], directorPlan={'dialoguePlan': [dict(line)], 'cameraAngle': '平视'}) for line in lines]
    planning.save(**scope, key='planning-initialize', request=dict(action='initialize', sceneIndex=1,
        expectedScriptRevision=1, expectedScriptSha256=state['scriptSha256'], expectedStoryboardRevision=0,
        expectedStoryboardSha256=None, shots=shots))
    base = QingmuChangeSetService(store)
    for index, after in enumerate(('雨停了，谢谢。', '雨停了，我们走吧。')):
        before = planning.read(**scope)
        script = json.loads(store.get_episode(e)['script_json']); script.pop('editMetadata', None)
        line = script['scenes'][0]['dialogues'][0]; old = line['line']; line['line'] = after
        proposal = base.propose_episode_script_change_set(episode_id=e, base_revision=before['scriptRevision'],
            script=script, actor_user_id='owner', expected_project_id=p, references=[dict(schema=REFERENCE_SCHEMA,
                lineId=line['sourceLineId'], before=old, after=after, storyboardRevisionId=before['storyboard']['id'],
                affectedShotIds=[before['planning']['shots'][0]['id']])])
        args = dict(idempotency_key=f'planning-dialogue-{index}', expected_payload_sha256=proposal['payloadSha256'],
            actor_user_id='owner', expected_project_id=p, expected_episode_id=e, expected_base_revision=before['scriptRevision'])
        result = DialogueChangeSets(base).commit_change_set(proposal['id'], **args)
        assert DialogueChangeSets(base).commit_change_set(proposal['id'], **args)['commandReceiptId'] == result['commandReceiptId']
        current = planning.read(**scope)
        assert current['planning']['shots'][0]['directorPlan']['dialoguePlan'][0]['line'] == after
        assert current['frameRequirements'][0]['dialogue']['lines'][0]['line'] == after
        assert current['planning']['source'] == before['planning']['source']
        assert current['frameRequirements'][1] == before['frameRequirements'][1]
        shot = deepcopy(current['planning']['shots'][0]); shot_id = shot.pop('id'); shot['durationSec'] += 1
        planning.save(**scope, key=f'planning-after-dialogue-{index}', request=dict(action='edit', sceneIndex=1,
            expectedScriptRevision=current['scriptRevision'], expectedScriptSha256=current['scriptSha256'],
            expectedStoryboardRevision=current['storyboard']['version'], expectedStoryboardSha256=current['storyboard']['sourceHash'],
            shotId=shot_id, shot=shot))
        assert planning.read(**scope)['planning']['shots'][0]['durationSec'] == shot['durationSec']
    # A rewritten receipt must not unlock a changed source, even with matching frames.
    with store._connect() as conn:
        conn.execute("UPDATE change_sets SET command_payload_sha256=? WHERE id=?", ("f" * 64, proposal['id']))
    with pytest.raises(ValueError, match='planning_dialogue_receipt_integrity_mismatch'):
        planning.read(**scope)
