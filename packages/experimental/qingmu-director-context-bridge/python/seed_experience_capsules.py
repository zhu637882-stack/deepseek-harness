"""Deploy-time seed for the director experience-capsule active store.

The harness read side (``experience-capsule-store.ts``) injects the approved
capsules it finds in ``<runtime-root>/experience-capsules-active.json`` into the
director persona. This one-shot script builds that active store from the curated
``experience_capsules.json`` the writer ships, preserving any capsules a later
human merge already promoted. It is pure stdlib so it runs under the same venv
the live API and worker use, with no build or extra dependency.

Idempotent: re-running refreshes the curated baseline at the front (newest-first,
in source order) and keeps existing active entries whose id the curated set does
not cover. A malformed curated entry raises so a bad deploy file fails loud
instead of silently seeding fewer lessons.

Usage:
    python seed_experience_capsules.py \\
        --source <writer>/config/director_domain_specs/experience_capsules.json \\
        --runtime-root /path/to/qingmu-native

``--runtime-root`` defaults to ``$QINGMU_RUNTIME_ROOT`` then ``$QINGMU_NATIVE_ROOT``.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

ACTIVE_STORE_NAME = "experience-capsules-active.json"


def active_store_path(runtime_root: str | os.PathLike[str]) -> Path:
    """Resolve the active-store path next to the runtime identity and its queue."""
    return Path(runtime_root) / ACTIVE_STORE_NAME


def _normalize_capsule(entry: object, where: str) -> dict:
    """Validate one capsule and return only the fields the read side consumes."""
    if not isinstance(entry, dict):
        raise ValueError(f"Curated capsule {where} must be an object.")
    capsule_id = entry.get("id")
    symptom = entry.get("symptom")
    rule = entry.get("rule")
    if not isinstance(capsule_id, str) or capsule_id.strip() == "":
        raise ValueError(f"Curated capsule {where} needs a non-empty string id.")
    if not isinstance(symptom, str):
        raise ValueError(f"Curated capsule {where} needs a string symptom.")
    if not isinstance(rule, str) or rule.strip() == "":
        raise ValueError(f"Curated capsule {where} needs a non-empty string rule.")
    normalized = {"id": capsule_id, "symptom": symptom, "rule": rule}
    stages = entry.get("stages")
    if stages is not None:
        if not isinstance(stages, list) or not all(isinstance(item, str) for item in stages):
            raise ValueError(f"Curated capsule {where} stages must be a list of strings.")
        normalized["stages"] = stages
    return normalized


def _capsule_list(raw: object) -> list:
    """Accept either the full ``{capsules: [...]}`` object or a bare array."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict) and isinstance(raw.get("capsules"), list):
        return raw["capsules"]
    raise ValueError("Curated source must be an array or an object with a capsules array.")


def build_active_store(curated: object, existing: object) -> list[dict]:
    """Merge curated capsules (newest-first, in source order) ahead of any extra
    existing active capsules whose id the curated set does not cover.

    Malformed curated entries raise; a missing or malformed existing store
    contributes nothing (the normal first-seed case).
    """
    seeded = []
    seen: set[str] = set()
    for index, entry in enumerate(_capsule_list(curated)):
        capsule = _normalize_capsule(entry, f"at index {index}")
        if capsule["id"] in seen:
            raise ValueError(f"Curated source lists capsule id {capsule['id']!r} more than once.")
        seen.add(capsule["id"])
        seeded.append(capsule)
    extras = []
    try:
        for entry in _capsule_list(existing):
            if isinstance(entry, dict) and isinstance(entry.get("id"), str) and entry["id"] not in seen:
                extras.append(_normalize_capsule(entry, f"in existing store (id {entry.get('id')!r})"))
                seen.add(entry["id"])
    except ValueError:
        # A missing or malformed active store before/around a merge is the empty case.
        extras = []
    return seeded + extras


def _load_json(path: Path) -> object:
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def seed(source_path: Path, runtime_root: str | os.PathLike[str]) -> tuple[Path, int]:
    """Write the merged active store and return its path and capsule count."""
    curated = _load_json(source_path)
    if curated is None:
        raise ValueError(f"Curated source not found or not valid JSON: {source_path}")
    store_path = active_store_path(runtime_root)
    active = build_active_store(curated, _load_json(store_path))
    store_path.parent.mkdir(parents=True, exist_ok=True)
    store_path.write_text(json.dumps({"capsules": active}, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return store_path, len(active)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed the director experience-capsule active store.")
    parser.add_argument("--source", required=True, help="Path to the curated experience_capsules.json.")
    parser.add_argument("--runtime-root", default=os.environ.get("QINGMU_RUNTIME_ROOT") or os.environ.get("QINGMU_NATIVE_ROOT"),
                        help="Runtime identity root; defaults to $QINGMU_RUNTIME_ROOT then $QINGMU_NATIVE_ROOT.")
    args = parser.parse_args(argv)
    if not args.runtime_root:
        parser.error("--runtime-root is required (or set QINGMU_RUNTIME_ROOT / QINGMU_NATIVE_ROOT).")
    store_path, count = seed(Path(args.source), args.runtime_root)
    print(f"Seeded {count} capsules -> {store_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
