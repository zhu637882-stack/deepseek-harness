"""Operator promotion for the director experience-capsule loop.

The director's write tool (``experience-capsule-tools.ts``) queues one lesson at
a time into ``<runtime-root>/experience-capsule-queue.json`` (a bare JSON array).
Nothing reaches the model until a human approves it. This script is that human
step: it promotes approved queue entries into
``<runtime-root>/experience-capsules-active.json`` (the ``{capsules: [...]}``
store the read side ``experience-capsule-store.ts`` injects), then trims the
promoted entries from the queue.

It mirrors the ``mergeApprovedCapsules`` semantics the harness tests pin:
approved entries move newest-first to the front of the active store, supersede
any active entry that reuses their id, and leave the queue. Everything else in
both files is preserved. Reading fresh each assembly means a promotion reaches
the next director turn without a process restart.

Pure stdlib so it runs under the same venv the live API and worker use, with no
build. Idempotent: re-approving an already-promoted id is a no-op beyond keeping
it at the front. A malformed store fails loud instead of silently losing lessons.

Usage:
    # See what is waiting for review (ids to approve):
    python promote_experience_capsules.py --runtime-root /path/to/qingmu-native --list

    # Promote specific approved ids:
    python promote_experience_capsules.py --runtime-root /path/to/qingmu-native \\
        --approve SELF-abc --approve SELF-def --stages SELF-abc=shot,video

    # Promote every queued capsule (use only after reviewing --list):
    python promote_experience_capsules.py --runtime-root /path/to/qingmu-native --approve-all

``--runtime-root`` defaults to ``$QINGMU_RUNTIME_ROOT`` then ``$QINGMU_NATIVE_ROOT``.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

QUEUE_NAME = "experience-capsule-queue.json"
ACTIVE_STORE_NAME = "experience-capsules-active.json"


def queue_path(runtime_root: str | os.PathLike[str]) -> Path:
    """Resolve the write-side review queue next to the runtime identity."""
    return Path(runtime_root) / QUEUE_NAME


def active_store_path(runtime_root: str | os.PathLike[str]) -> Path:
    """Resolve the read-side active store next to the runtime identity."""
    return Path(runtime_root) / ACTIVE_STORE_NAME


def _capsule_list(raw: object) -> list:
    """Accept either a bare array (the queue) or a ``{capsules: [...]}`` object."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict) and isinstance(raw.get("capsules"), list):
        return raw["capsules"]
    if raw is None:
        return []
    raise ValueError("Store must be an array or an object with a capsules array.")


def _active_capsule(entry: object, where: str) -> dict:
    """Validate one promoted capsule against the read side's contract.

    The read side keeps only id/symptom/rule/stages and requires a non-empty id
    and rule; symptom may be empty. A malformed approved entry raises so a bad
    promotion fails loud instead of injecting garbage into the persona.
    """
    if not isinstance(entry, dict):
        raise ValueError(f"Capsule {where} must be an object.")
    capsule_id = entry.get("id")
    symptom = entry.get("symptom", "")
    rule = entry.get("rule")
    if not isinstance(capsule_id, str) or capsule_id.strip() == "":
        raise ValueError(f"Capsule {where} needs a non-empty string id.")
    if not isinstance(symptom, str):
        raise ValueError(f"Capsule {where} symptom must be a string.")
    if not isinstance(rule, str) or rule.strip() == "":
        raise ValueError(f"Capsule {where} needs a non-empty string rule.")
    normalized = {"id": capsule_id, "symptom": symptom, "rule": rule}
    stages = entry.get("stages")
    if stages is not None:
        if not isinstance(stages, list) or not all(isinstance(item, str) for item in stages):
            raise ValueError(f"Capsule {where} stages must be a list of strings.")
        normalized["stages"] = stages
    return normalized


def promote(
    queue: list,
    active: list,
    approved_ids: list[str],
    stages_by_id: dict[str, list[str]] | None = None,
) -> tuple[list[dict], list[dict], list[str]]:
    """Promote approved queue entries into the active store (pure).

    Ports ``mergeApprovedCapsules``: approved entries move newest-first to the
    front, supersede any active entry with the same id, and drop from the queue.
    Reviewer-assigned ``stages`` override any the queue entry already carried.
    Returns the next active store, the trimmed queue, and the promoted ids.
    """
    stages_by_id = stages_by_id or {}
    approved = set(approved_ids)
    promoted: list[dict] = []
    promoted_ids: set[str] = set()
    for index, entry in enumerate(queue):
        if not isinstance(entry, dict):
            continue
        entry_id = entry.get("id")
        if entry_id not in approved or entry_id in promoted_ids:
            continue
        capsule = _active_capsule(entry, f"in queue at index {index}")
        if entry_id in stages_by_id:
            capsule["stages"] = stages_by_id[entry_id]
        promoted.append(capsule)
        promoted_ids.add(entry_id)
    kept_active = [c for c in active if isinstance(c, dict) and c.get("id") not in promoted_ids]
    next_active = promoted + kept_active
    remaining_queue = [
        e for e in queue if not (isinstance(e, dict) and e.get("id") in promoted_ids)
    ]
    return next_active, remaining_queue, [c["id"] for c in promoted]


def _load_json(path: Path) -> object:
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")


def _parse_stages(pairs: list[str] | None) -> dict[str, list[str]]:
    """Parse ``id=phase1,phase2`` pairs into a per-id stage map."""
    result: dict[str, list[str]] = {}
    for pair in pairs or []:
        if "=" not in pair:
            raise ValueError(f"--stages expects id=phase1,phase2, got {pair!r}.")
        capsule_id, _, phases = pair.partition("=")
        capsule_id = capsule_id.strip()
        stages = [phase.strip() for phase in phases.split(",") if phase.strip()]
        if capsule_id == "":
            raise ValueError(f"--stages needs a capsule id before '=', got {pair!r}.")
        result[capsule_id] = stages
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Promote approved director experience capsules into the active store.")
    parser.add_argument("--runtime-root", default=os.environ.get("QINGMU_RUNTIME_ROOT") or os.environ.get("QINGMU_NATIVE_ROOT"),
                        help="Runtime identity root; defaults to $QINGMU_RUNTIME_ROOT then $QINGMU_NATIVE_ROOT.")
    parser.add_argument("--approve", action="append", default=[], metavar="ID",
                        help="Approve this queued capsule id (repeatable).")
    parser.add_argument("--approve-all", action="store_true",
                        help="Approve every queued capsule (review with --list first).")
    parser.add_argument("--stages", action="append", default=[], metavar="ID=PHASES",
                        help="Assign workflow phases to a promoted id, e.g. SELF-abc=shot,video (repeatable).")
    parser.add_argument("--list", action="store_true",
                        help="Print the queued capsules awaiting review and exit.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would be promoted without writing either file.")
    args = parser.parse_args(argv)
    if not args.runtime_root:
        parser.error("--runtime-root is required (or set QINGMU_RUNTIME_ROOT / QINGMU_NATIVE_ROOT).")

    queue_file = queue_path(args.runtime_root)
    active_file = active_store_path(args.runtime_root)
    queue = _capsule_list(_load_json(queue_file))
    active = _capsule_list(_load_json(active_file))

    if args.list:
        if not queue:
            print(f"Queue is empty: {queue_file}")
            return 0
        print(f"{len(queue)} capsule(s) awaiting review in {queue_file}:")
        for entry in queue:
            if isinstance(entry, dict):
                print(f"  {entry.get('id')}: {entry.get('symptom', '')} -> {entry.get('rule', '')}")
        return 0

    if args.approve_all:
        approved_ids = [e["id"] for e in queue if isinstance(e, dict) and isinstance(e.get("id"), str)]
    else:
        approved_ids = list(args.approve)
    if not approved_ids:
        parser.error("Nothing to promote: pass --approve <id> (repeatable) or --approve-all, or use --list.")

    queued_ids = {e["id"] for e in queue if isinstance(e, dict) and isinstance(e.get("id"), str)}
    unknown = [i for i in approved_ids if i not in queued_ids]
    if unknown:
        parser.error(f"Approved id(s) not in the queue: {', '.join(unknown)}. Use --list to see valid ids.")

    stages_by_id = _parse_stages(args.stages)
    next_active, remaining_queue, merged = promote(queue, active, approved_ids, stages_by_id)

    if args.dry_run:
        print(f"[dry-run] would promote {len(merged)} capsule(s): {', '.join(merged)}")
        print(f"[dry-run] active store would hold {len(next_active)}; queue would drop to {len(remaining_queue)}")
        return 0

    _write_json(active_file, {"capsules": next_active})
    _write_json(queue_file, remaining_queue)
    print(f"Promoted {len(merged)} capsule(s): {', '.join(merged)}")
    print(f"Active store now holds {len(next_active)} -> {active_file}")
    print(f"Queue trimmed to {len(remaining_queue)} -> {queue_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
