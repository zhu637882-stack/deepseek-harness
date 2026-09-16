"""Promotion transform: approved queue entries become active-store capsules."""
import json

import pytest
from promote_experience_capsules import (
    active_store_path,
    main,
    promote,
    queue_path,
)

QUEUE = [
    {"id": "SELF-01", "symptom": "绑定失效", "rule": "切镜重绑", "submittedAt": "2026-09-16T00:00:00Z"},
    {"id": "SELF-02", "symptom": "静音角色嘴动", "rule": "锁双唇闭合", "submittedAt": "2026-09-16T01:00:00Z"},
]


def test_promote_moves_approved_to_front_and_trims_queue():
    active = [{"id": "EXP-01", "symptom": "旧", "rule": "旧规则"}]
    next_active, remaining_queue, merged = promote(QUEUE, active, ["SELF-02"])
    assert merged == ["SELF-02"]
    # Promoted capsule is newest-first at the front; prior active survives after it.
    assert [c["id"] for c in next_active] == ["SELF-02", "EXP-01"]
    assert next_active[0] == {"id": "SELF-02", "symptom": "静音角色嘴动", "rule": "锁双唇闭合"}
    # Unapproved entry stays in the queue; the promoted one is dropped.
    assert [e["id"] for e in remaining_queue] == ["SELF-01"]


def test_promote_supersedes_active_entry_with_same_id():
    active = [{"id": "SELF-01", "symptom": "过时症状", "rule": "过时规则"}]
    next_active, _, merged = promote(QUEUE, active, ["SELF-01"])
    assert merged == ["SELF-01"]
    assert [c["id"] for c in next_active] == ["SELF-01"]
    assert next_active[0]["rule"] == "切镜重绑"


def test_promote_dedups_and_ignores_unknown_ids():
    next_active, remaining_queue, merged = promote(QUEUE, [], ["SELF-01", "SELF-01", "MISSING"])
    assert merged == ["SELF-01"]
    assert [c["id"] for c in next_active] == ["SELF-01"]
    assert [e["id"] for e in remaining_queue] == ["SELF-02"]


def test_promote_applies_reviewer_stages():
    next_active, _, _ = promote(QUEUE, [], ["SELF-02"], {"SELF-02": ["shot", "video"]})
    assert next_active[0]["stages"] == ["shot", "video"]


def test_promote_rejects_malformed_approved_entry():
    bad_queue = [{"id": "SELF-03", "symptom": "x", "rule": ""}]
    with pytest.raises(ValueError):
        promote(bad_queue, [], ["SELF-03"])


def test_main_promotes_and_writes_both_files(tmp_path):
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()
    (runtime_root / "experience-capsule-queue.json").write_text(json.dumps(QUEUE, ensure_ascii=False), "utf-8")

    rc = main(["--runtime-root", str(runtime_root), "--approve", "SELF-02"])
    assert rc == 0

    active = json.loads(active_store_path(runtime_root).read_text("utf-8"))
    assert [c["id"] for c in active["capsules"]] == ["SELF-02"]
    remaining = json.loads(queue_path(runtime_root).read_text("utf-8"))
    assert [e["id"] for e in remaining] == ["SELF-01"]


def test_main_approve_all_and_idempotent_reseed(tmp_path):
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()
    (runtime_root / "experience-capsule-queue.json").write_text(json.dumps(QUEUE, ensure_ascii=False), "utf-8")

    assert main(["--runtime-root", str(runtime_root), "--approve-all"]) == 0
    active = json.loads(active_store_path(runtime_root).read_text("utf-8"))
    # Queue order preserved; both promoted, queue emptied.
    assert [c["id"] for c in active["capsules"]] == ["SELF-01", "SELF-02"]
    assert json.loads(queue_path(runtime_root).read_text("utf-8")) == []

    # Re-running with an empty queue and no approvals errors loudly rather than clobbering.
    with pytest.raises(SystemExit):
        main(["--runtime-root", str(runtime_root), "--approve-all"])


def test_main_rejects_unknown_approved_id(tmp_path):
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()
    (runtime_root / "experience-capsule-queue.json").write_text(json.dumps(QUEUE, ensure_ascii=False), "utf-8")
    with pytest.raises(SystemExit):
        main(["--runtime-root", str(runtime_root), "--approve", "NOPE"])


def test_main_dry_run_writes_nothing(tmp_path):
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()
    (runtime_root / "experience-capsule-queue.json").write_text(json.dumps(QUEUE, ensure_ascii=False), "utf-8")
    assert main(["--runtime-root", str(runtime_root), "--approve", "SELF-01", "--dry-run"]) == 0
    assert not active_store_path(runtime_root).exists()
    # Queue is untouched by a dry run.
    assert json.loads(queue_path(runtime_root).read_text("utf-8")) == QUEUE
