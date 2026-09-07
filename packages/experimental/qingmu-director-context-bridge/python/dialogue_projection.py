"""Keep historical dialogue videos out of the current-shot preview projection."""
from functools import wraps
from datetime import datetime
import json


def current_dialogue_media(payload, current_tasks=None):
    """Project existing shot responses without deleting historical assets.

    Writer currently uses the latest materialized candidate regardless of Stale.
    Correct only this current-preview ambiguity; never infer approval or success.
    """
    for item in payload.get('items', []):
        if item.get('currentVideoSelectionStatus') != 'Stale':
            continue
        for key in ('currentVideoUrl', 'currentVideoMediaObjectId', 'currentVideoAssetId',
                    'currentVideoSha256', 'currentVideoQualityStatus', 'currentVideoSelectionStatus',
                    'generationInputVersion'):
            item[key] = None
        item['currentVideoSelected'] = False
        item['videoOutdated'] = True
    for item in payload.get('items', []):
        if current_tasks is None or item['publicId'] not in current_tasks:
            continue
        task = current_tasks[item['publicId']]
        # No old completed/failed task may masquerade as this revision's job.
        # Conversely a task created after the commit remains fully visible.
        status = task['local_status'] if task else None
        if item.get('selectedVideoAssetId'):
            status = 'completed'
        elif status == 'downloaded':
            # Keep the original Writer ownership state until output selection.
            # A materialized candidate is not an approved/current result.
            status = 'missing_output'
        item['currentGenerationPublicId'] = task['id'] if task else None
        item['currentProviderTaskId'] = task['provider_task_id'] if task else None
        item['currentGenerationStatus'] = status
        item['status'] = ('completed' if status == 'completed' else 'failed' if status == 'failed'
                          else 'generating' if status in {'submitted', 'running', 'succeeded', 'retry_wait'} else 'planned')
        if task is None:
            item['failureReason'] = None
            item['failureAction'] = None
    by_id = {item['publicId']: item for item in payload.get('items', [])}
    for segment in payload.get('segments', []):
        members = [by_id[frame_id] for frame_id in segment.get('frameIds', []) if frame_id in by_id]
        segment['videoUrl'] = next((item['currentVideoUrl'] for item in reversed(members)
                                   if item.get('currentVideoUrl')), None)
    for video in payload.get('videoSegments', []):
        item = by_id.get(video.get('frameId'))
        if item is not None:
            video['videoUrl'] = item.get('currentVideoUrl')
            video['status'] = item.get('currentGenerationStatus') or 'missing'
    if isinstance(payload.get('aggregate'), dict):
        payload['aggregate']['outdatedVideoCount'] = sum(bool(item.get('videoOutdated')) for item in payload.get('items', []))
    return payload


def dialogue_current_tasks(store, episode_id):
    """Use the existing committed Change Set journal as the revision boundary.

    Task rows and receipts remain untouched. Unknown timestamps fail closed;
    they must never be interpreted as proof that a task is obsolete.
    """
    with store._connect() as conn:
        boundaries = {}
        for row in conn.execute("SELECT references_json, committed_at FROM change_sets "
                                "WHERE episode_id=? AND status='committed' AND target_type='episode_script' "
                                "ORDER BY committed_at DESC", (episode_id,)):
            for ref in json.loads(row['references_json']):
                if ref.get('schema') == 'qingmu.dialogue-edit-reference.v1':
                    for frame_id in ref['affectedShotIds']:
                        boundaries.setdefault(frame_id, datetime.fromisoformat(row['committed_at']))
        if not boundaries:
            return {}
        result = {frame_id: None for frame_id in boundaries}
        # Legacy tasks did not always persist source_id; inspect the same
        # project/episode request coordinates as Writer's current-shot reader.
        latest_times = {}
        for row in conn.execute("SELECT id, local_status, provider_task_id, request_payload_json, created_at "
                                "FROM generation_tasks WHERE route_key IN ('b6.frame_regenerate','b6.video_generation') "
                                "AND CASE WHEN json_valid(request_payload_json) "
                                "THEN json_extract(request_payload_json, '$.episode_id') ELSE NULL END = ?", (episode_id,)):
            request = json.loads(row['request_payload_json'])
            frame_id = request.get('frame_id')
            if frame_id not in boundaries or request.get('episode_id') != episode_id:
                continue
            created = datetime.fromisoformat(row['created_at'])
            if created > boundaries[frame_id] and created > latest_times.get(frame_id, boundaries[frame_id]):
                result[frame_id] = dict(row)
                latest_times[frame_id] = created
        return result


def install_current_dialogue_projection(app):
    """Decorate the existing authenticated route, not its source or other readers."""
    for route in app.routes:
        if getattr(route, 'path', None) != '/api/episodes/{episode_id}/shot-scripts':
            continue
        original = route.dependant.call
        if getattr(original, '_qingmu_current_dialogue_media', False):
            return

        @wraps(original)
        def projected(*args, **kwargs):
            from jason.apps.studio import api_deps
            payload = original(*args, **kwargs)  # Original authorization executes first.
            episode_id = kwargs.get('episode_id') or args[0]
            return current_dialogue_media(payload, dialogue_current_tasks(api_deps.store, episode_id))

        projected._qingmu_current_dialogue_media = True
        route.dependant.call = projected
        return
    raise RuntimeError('qingmu_shot_projection_route_missing')
