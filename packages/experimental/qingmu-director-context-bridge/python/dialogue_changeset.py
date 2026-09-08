"""Compose one dialogue projection with Writer's existing Change Set transaction.

The application injects this wrapper into its existing API service. It neither
opens another database nor patches Writer classes. Ownership, CAS, durable
receipts and exact retry handling remain in QingmuChangeSetService.
"""
from __future__ import annotations

from copy import copy, deepcopy
import hashlib
import json
import unicodedata

from jason.apps.studio.qingmu_changeset_service import QingmuChangeSetError
from jason.apps.studio.ai_semantic_mapping import normalize_dialogue_line
from jason.domain.task_center import ACTIVE_GENERATION_JOB_STATUSES
from jason.domain.store import utc_now

REFERENCE_SCHEMA = "qingmu.dialogue-edit-reference.v1"


def _spoken_text(value):
    return ''.join(char for char in unicodedata.normalize('NFKC', value)
                   if not char.isspace() and not unicodedata.category(char).startswith('P'))


def _has_old_dialogue(value, before, after):
    """Catch normalized obsolete copies, excluding the complete new utterance.

    A replacement may contain the old line (e.g. '救命' -> '快来救命').
    Do not reject that legitimate new utterance, nor search serialized JSON keys.
    """
    if isinstance(value, dict):
        return any(_has_old_dialogue(item, before, after) for item in value.values())
    if isinstance(value, list):
        return any(_has_old_dialogue(item, before, after) for item in value)
    if not isinstance(value, str):
        return False
    old, new = _spoken_text(before), _spoken_text(after)
    text = _spoken_text(value)
    # For punctuation-only edits normalization cannot distinguish old from new;
    # identified fields were rewritten above, exact obsolete copies still fail.
    if old == new:
        return before in value.replace(after, '')
    return bool(old) and old in text.replace(new, '')


def _replace_line(value, line_id, before, after):
    """Replace only identified dialogue fields; leave acting and camera data intact."""
    if isinstance(value, list):
        return [_replace_line(item, line_id, before, after) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: _replace_line(item, line_id, before, after) for key, item in value.items()}
    if value.get("lineId") == line_id:
        fields = [key for key in ("line", "verbatimText", "text") if isinstance(value.get(key), str)]
        if not fields or any(value[key] != before for key in fields):
            raise QingmuChangeSetError("dialogue_original_text_conflict")
        for key in fields:
            result[key] = after
    return result


def _line_nodes(value, line_id):
    if isinstance(value, list):
        return [node for item in value for node in _line_nodes(item, line_id)]
    if isinstance(value, dict):
        return ([value] if value.get("lineId") == line_id else []) + [
            node for item in value.values() for node in _line_nodes(item, line_id)
        ]
    return []


def _project_frame(parts, ref):
    """Update identified lines and exact quoted beat copies, never free-form prose."""
    before, after = ref["before"], ref["after"]
    updated = _replace_line(parts, ref["lineId"], before, after)
    if isinstance(updated["dialogue"], dict) and updated["dialogue"].get("line") == before:
        updated["dialogue"]["line"] = after
    for name in ("director_plan", "visual_atoms"):
        plan = updated[name]
        if not isinstance(plan, dict):
            continue
        # These three compiler inputs quote dialogue without a LineID. Only a
        # uniquely identified utterance may update their exact quoted copies.
        for collection, field in (("pacingPlan", "action"), ("innerBeatPlan", "content"), ("blockingBeats", "action")):
            for beat in plan.get(collection, []):
                if not isinstance(beat, dict) or not isinstance(beat.get(field), str):
                    continue
                for left, right in (('"', '"'), ('“', '”'), ('「', '」')):
                    beat[field] = beat[field].replace(left + before + right, left + after + right)
        old_hash = hashlib.sha256(normalize_dialogue_line(before).encode()).hexdigest()
        new_hash = hashlib.sha256(normalize_dialogue_line(after).encode()).hexdigest()
        if isinstance(plan.get("crossShotDialogueHash"), list):
            plan["crossShotDialogueHash"] = [new_hash if item == old_hash else item for item in plan["crossShotDialogueHash"]]
        cues = plan.get("dialoguePlan")
        density = plan.get("dialogueDensityContract")
        if isinstance(cues, list) and isinstance(density, dict):
            density["actualTotalChineseChars"] = sum(len(str(cue.get("verbatimText", cue.get("line", cue.get("text", "")))).strip()) for cue in cues)
    # Unknown overlays must be recompiled deliberately; silently carrying an old
    # utterance to a paid provider is never a valid successful edit.
    if _has_old_dialogue(updated, before, after):
        raise QingmuChangeSetError("dialogue_prompt_residue_requires_recompile")
    return updated


class DialogueChangeSets:
    """Application-scoped decorator; ordinary edits keep their original behavior."""

    def __init__(self, service):
        self.service = service

    def __getattr__(self, name):
        return getattr(self.service, name)

    def commit_change_set(self, change_set_id, **kwargs):
        return self._commit("commit_change_set", change_set_id, kwargs)

    def commit_episode_script_change_set(self, change_set_id, **kwargs):
        return self._commit("commit_episode_script_change_set", change_set_id, kwargs)

    def _commit(self, method, change_set_id, kwargs):
        # The executor reloads and validates this row under its original owner
        # transaction. This read only selects the application implementation.
        with self.service.store._connect() as conn:
            row = self.service._load_change_set_locked(conn, change_set_id)
            references = json.loads(row["references_json"])
        candidates = [ref for ref in references if ref.get("schema") == REFERENCE_SCHEMA]
        if not candidates:
            return getattr(self.service, method)(change_set_id, **kwargs)
        if len(candidates) != 1:
            raise QingmuChangeSetError("dialogue_reference_ambiguous")
        projected = copy(self.service)
        projected.store = _DialogueStore(self.service, change_set_id, deepcopy(candidates[0]))
        return getattr(projected, method)(change_set_id, **kwargs)


class _DialogueStore:
    """Per-command store view used only within the original commit transaction."""

    def __init__(self, service, change_set_id, reference):
        self.service = service
        self.base = service.store
        self.change_set_id = change_set_id
        self.reference = reference

    def __getattr__(self, name):
        return getattr(self.base, name)

    def update_episode_script(self, episode_id, *, script, expected_revision):
        ref = self.reference
        required = {"schema", "lineId", "before", "after", "storyboardRevisionId", "affectedShotIds"}
        if set(ref) != required or any(
            not isinstance(ref.get(key), str) or not ref[key].strip()
            for key in ("lineId", "before", "after", "storyboardRevisionId")
        ) or ref["before"] == ref["after"] or len(ref["after"]) > 2000 or "\0" in ref["after"]:
            raise QingmuChangeSetError("dialogue_reference_invalid")
        expected_ids = ref["affectedShotIds"]
        if not isinstance(expected_ids, list) or not expected_ids or any(
            not isinstance(item, str) or not item for item in expected_ids
        ) or len(set(expected_ids)) != len(expected_ids):
            raise QingmuChangeSetError("dialogue_affected_shots_invalid")
        with self.base._connect() as conn:
            stored = self.service._load_change_set_locked(conn, self.change_set_id)
            if ref not in json.loads(stored["references_json"]):
                raise QingmuChangeSetError("dialogue_reference_changed")
            original = json.loads(stored["base_snapshot_json"])
            source_lines = [line for scene in original.get("scenes", [])
                            for line in scene.get("dialogues", []) if line.get("lineId") == ref["lineId"]]
            if len(source_lines) != 1:
                raise QingmuChangeSetError("dialogue_line_identity_invalid")
            if any(line.get("lineId") != ref["lineId"] and any(line.get(key) == ref["before"] for key in ("line", "verbatimText", "text"))
                   for scene in original.get("scenes", []) for line in scene.get("dialogues", [])):
                raise QingmuChangeSetError("dialogue_quoted_copy_ambiguous")
            expected_script = _replace_line(original, ref["lineId"], ref["before"], ref["after"])
            requested = dict(script)
            requested.pop("editMetadata", None)
            if requested != expected_script:
                raise QingmuChangeSetError("dialogue_edit_contains_unrelated_changes")
            current = conn.execute(
                "SELECT id FROM storyboard_revisions WHERE episode_id = ? ORDER BY version DESC LIMIT 1",
                (episode_id,),
            ).fetchone()
            if current is None or current["id"] != ref["storyboardRevisionId"]:
                raise QingmuChangeSetError("dialogue_storyboard_changed")
            frames = [dict(row) for row in conn.execute(
                "SELECT * FROM storyboard_frames WHERE episode_id = ? ORDER BY frame_no, id", (episode_id,)
            )]
            patches = {}
            for frame in frames:
                parts = {name: json.loads(frame[column] or "{}") for name, column in (
                    ("dialogue", "dialogue_json"), ("director_plan", "director_plan_json"),
                    ("visual_atoms", "visual_atoms_json"),
                )}
                if not _line_nodes(parts, ref["lineId"]):
                    continue
                updated = _project_frame(parts, ref)
                if any(_has_old_dialogue(str(frame.get(key) or ""), ref["before"], ref["after"])
                       for key in ("image_prompt_cn", "image_prompt_en")):
                    raise QingmuChangeSetError("dialogue_prompt_residue_requires_recompile")
                if frame["status"] in {"generating", "queued", "running", "quality_pending"}:
                    raise QingmuChangeSetError("dialogue_frame_task_pending")
                patches[frame["id"]] = updated
            if set(patches) != set(expected_ids):
                raise QingmuChangeSetError("dialogue_affected_shots_changed")
            # A runtime task may be queued before a frame's display status updates.
            if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='generation_tasks'").fetchone():
                shot_marks = ','.join('?' for _ in patches)
                status_marks = ','.join('?' for _ in ACTIVE_GENERATION_JOB_STATUSES)
                active = conn.execute(
                    f"SELECT 1 FROM generation_tasks WHERE source_type='StoryboardFrame' "
                    f"AND source_id IN ({shot_marks}) AND kernel_status IN ({status_marks}) LIMIT 1",
                    (*patches, *ACTIVE_GENERATION_JOB_STATUSES),
                ).fetchone()
                if active:
                    raise QingmuChangeSetError("dialogue_frame_task_pending")
            saved, changed = self.base.update_episode_script(
                episode_id, script=script, expected_revision=expected_revision,
            )
            if not changed:
                raise QingmuChangeSetError("dialogue_change_missing")
            for frame_id, patch in patches.items():
                self.base.update_storyboard_frame(frame_id, **patch, status="planned")
                # Old videos contain the old spoken words. Retain the files and
                # review history, but do not represent them as the current result.
                conn.execute(
                    "UPDATE assets SET selection_status='Stale', is_selected=0, updated_at=?, "
                    "role=CASE WHEN role='b6_video' THEN 'b6_video_candidate' "
                    "WHEN role='b6_video_local_repair_candidate' THEN 'b6_video_local_repair_history' ELSE role END "
                    "WHERE episode_id=? AND owner_type='frame' AND owner_id=? "
                    "AND (asset_type='video' OR (asset_type='audio' "
                    "AND role IN ('b6_dialogue_audio','b6_dialogue_audio_candidate')))", (utc_now(), episode_id, frame_id),
                )
                conn.execute("UPDATE prompt_irs SET status='Stale' WHERE frame_id=?", (frame_id,))
            self.service._production_kernel.snapshot_storyboard(
                project_id=str(stored["project_id"]), episode_id=episode_id, status="Ready",
            )
        return saved, changed
