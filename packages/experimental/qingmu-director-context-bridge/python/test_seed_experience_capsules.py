"""Seed transform: curated capsules become the active store the read side loads."""
import json

import pytest
from seed_experience_capsules import active_store_path, build_active_store, seed

CURATED = {
    "version": "experience-capsules-v1",
    "capsules": [
        {"id": "EXP-016", "stages": ["video"], "symptom": "无声角色嘴唇微动", "rule": "静音锁双唇闭合"},
        {"id": "EXP-001", "stages": ["asset"], "symptom": "服装沿用临时来源", "rule": "交付三件套区分矩阵"},
    ],
}


def test_build_keeps_curated_order_and_only_read_fields():
    active = build_active_store(CURATED, None)
    assert [c["id"] for c in active] == ["EXP-016", "EXP-001"]
    assert active[0] == {"id": "EXP-016", "stages": ["video"], "symptom": "无声角色嘴唇微动", "rule": "静音锁双唇闭合"}


def test_build_preserves_merged_extras_after_curated():
    existing = {"capsules": [
        {"id": "SELF-01", "symptom": "绑定失效", "rule": "切镜重绑"},
        {"id": "EXP-016", "symptom": "旧文案", "rule": "旧规则"},
    ]}
    active = build_active_store(CURATED, existing)
    # Curated wins for a shared id and stays first; the human-merged extra survives at the tail.
    assert [c["id"] for c in active] == ["EXP-016", "EXP-001", "SELF-01"]
    assert active[0]["rule"] == "静音锁双唇闭合"


def test_build_tolerates_missing_or_malformed_existing_store():
    assert [c["id"] for c in build_active_store(CURATED, None)] == ["EXP-016", "EXP-001"]
    assert [c["id"] for c in build_active_store(CURATED, {"garbage": True})] == ["EXP-016", "EXP-001"]


def test_build_rejects_malformed_curated_entry():
    with pytest.raises(ValueError):
        build_active_store({"capsules": [{"id": "", "symptom": "x", "rule": "y"}]}, None)
    with pytest.raises(ValueError):
        build_active_store({"capsules": [{"id": "EXP-1", "symptom": "x", "rule": ""}]}, None)


def test_build_rejects_duplicate_curated_ids():
    with pytest.raises(ValueError):
        build_active_store({"capsules": [
            {"id": "EXP-1", "symptom": "a", "rule": "b"},
            {"id": "EXP-1", "symptom": "c", "rule": "d"},
        ]}, None)


def test_seed_writes_store_at_runtime_root_and_is_idempotent(tmp_path):
    source = tmp_path / "experience_capsules.json"
    source.write_text(json.dumps(CURATED, ensure_ascii=False), "utf-8")
    runtime_root = tmp_path / "runtime"

    store_path, count = seed(source, runtime_root)
    assert store_path == active_store_path(runtime_root)
    assert count == 2
    written = json.loads(store_path.read_text("utf-8"))
    assert [c["id"] for c in written["capsules"]] == ["EXP-016", "EXP-001"]

    # Re-running with the same source is a no-op on content.
    again_path, again_count = seed(source, runtime_root)
    assert again_count == 2
    assert json.loads(again_path.read_text("utf-8")) == written


def test_seed_preserves_a_prior_merge_on_reseed(tmp_path):
    source = tmp_path / "experience_capsules.json"
    source.write_text(json.dumps(CURATED, ensure_ascii=False), "utf-8")
    runtime_root = tmp_path / "runtime"
    store_path = active_store_path(runtime_root)
    store_path.parent.mkdir(parents=True)
    store_path.write_text(json.dumps({"capsules": [
        {"id": "SELF-09", "symptom": "人审入库的教训", "rule": "下次这样做"},
    ]}, ensure_ascii=False), "utf-8")

    _, count = seed(source, runtime_root)
    assert count == 3
    ids = [c["id"] for c in json.loads(store_path.read_text("utf-8"))["capsules"]]
    assert ids == ["EXP-016", "EXP-001", "SELF-09"]
