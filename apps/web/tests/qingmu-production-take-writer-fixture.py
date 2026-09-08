from __future__ import annotations

import argparse
import base64
import hashlib
import json
import socket
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from collections.abc import Callable
from typing import Any

import uvicorn
from fastapi import FastAPI, Response


class FixtureTaskCenter:
    """Inject a one-shot test mutation immediately before Writer's real gate."""

    def __init__(self, task_center: Any):
        self._task_center = task_center
        self.before_atomic_callback: Callable[[Any], None] | None = None
        self.reservation_idempotency_override: str | None = None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._task_center, name)

    def reserve_generation_job(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        actual_callback = kwargs.pop("atomic_reservation_callback", None)
        override = self.reservation_idempotency_override
        self.reservation_idempotency_override = None
        if override:
            kwargs["idempotency_key"] = override

        def combined_callback(conn: Any, task_id: str, request_hash: str) -> None:
            callback = self.before_atomic_callback
            self.before_atomic_callback = None
            if callback is not None:
                callback(conn)
            if callable(actual_callback):
                actual_callback(conn, task_id, request_hash)

        return self._task_center.reserve_generation_job(
            *args,
            atomic_reservation_callback=combined_callback,
            **kwargs,
        )


class FixtureVideoService:
    """Use production ``VideoService`` while making only post-queue replies lossy.

    The inherited Writer video route creates the TaskCenter reservation and executes
    ``_validate_qingmu_writer_first_frame_reservation`` itself.  This fixture never
    dispatches a worker or invokes a Provider; response loss is simulated only after
    that real queue mutation has committed.
    """

    def __init__(self, production_service: Any, tasks: Any):
        self._production_service = production_service
        self._tasks = tasks
        self.calls: list[dict[str, Any]] = []
        self.provider_calls = 0
        self.prompt_override_calls = 0
        self.lose_first_response = False
        self._response_lost = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._production_service, name)

    def _is_real(self) -> bool:
        return self._production_service._is_real()

    def _confirm_exact_human_review(self, kwargs: dict[str, Any]) -> dict[str, str]:
        """Create the real preflight/review that production VideoService requires.

        This is fixture setup, not a queue replacement: the subsequent call still
        enters ``VideoService.regenerate_frame`` and its atomic first-frame gate.
        Keeping this here makes the browser test independent from a second UI
        workflow whose only purpose would be to click a human-review fixture.
        """
        from jason.apps.studio.storyboard_human_review_service import (
            STORYBOARD_HUMAN_REVIEW_ORIGIN,
            StoryboardHumanReviewService,
            build_effective_storyboard_prompt_contract,
        )
        from jason.apps.studio.video_input_binding_contract import (
            build_video_input_frame_binding,
            provider_snapshot_effective_prompt,
        )
        from jason.providers.green_net_policy import prepare_generation_payload

        service = self._production_service
        project_id = str(kwargs["project_id"])
        episode_id = str(kwargs["episode_id"])
        frame_id = str(kwargs["frame_id"])
        requester = str(kwargs.get("requested_by_user_id") or "owner")
        frame = service.store.get_storyboard_frame(frame_id)
        input_binding = service._video_input_frame_binding(
            project_id, episode_id, frame, use_real=True
        )
        model, _selection = service._select_video_model(
            frame=frame,
            model_id=kwargs.get("model_id"),
            use_real=True,
            resolution=str(kwargs.get("resolution") or "720P"),
            input_frame_policy=input_binding["policy"],
        )
        reference_context = service._canonical_reference_context_for_frames(
            project_id=project_id,
            episode_id=episode_id,
            frames=[frame],
            supplied_context=kwargs.get("reference_context"),
        )
        compiled = service._compile_frame_prompts(
            project_id,
            frame,
            str(kwargs.get("resolution") or "720P"),
            model_id=model,
            reference_context=reference_context,
            reference_context_prevalidated=True,
        )
        requested_prompt = str(kwargs.get("prompt_override") or compiled.video_prompt).strip()
        raw_snapshot = service.payload_builder.build(
            capability="video.visual",
            model=model,
            payload={
                "prompt": requested_prompt,
                "first_frame_url": input_binding["url"],
                "duration_sec": compiled.duration,
                "resolution": compiled.resolution,
                "ratio": compiled.model_params.get("video", {}).get("ratio", "16:9"),
                "negative_prompt": compiled.negative_prompt,
                "watermark": getattr(compiled, "watermark", False),
            },
        )
        prepared, green_net_preflight = prepare_generation_payload(
            {"snapshot": raw_snapshot}, capability="video.visual", enforce_pre_submit_block=False
        )
        snapshot = prepared["snapshot"]
        effective_prompt = provider_snapshot_effective_prompt(snapshot) or requested_prompt
        review_service = StoryboardHumanReviewService(
            service.store,
            service.storage_root,
            task_center=self._tasks,
            input_frame_binding_resolver=lambda scope_project_id, scope_episode_id, current_frame: (
                service._video_input_frame_binding(
                    scope_project_id, scope_episode_id, current_frame, use_real=True
                )
            ),
        )
        canonical_frame, previous_frame = review_service._frame_scope(
            project_id=project_id, episode_id=episode_id, frame_id=frame_id
        )
        effective_contract = build_effective_storyboard_prompt_contract(
            canonical_frame,
            previous_frame=previous_frame,
            prompt_override=effective_prompt,
            prompt_authority="compiled_prompt",
            document_text_policies=review_service._document_text_policies(
                project_id=project_id, frame=canonical_frame
            ),
            reference_scope_context=review_service._reference_scope_context(
                project_id=project_id, frame=canonical_frame
            ),
        )["summary"]
        input_frame_contract = build_video_input_frame_binding(input_binding)
        prompt_sha256 = hashlib.sha256(effective_prompt.encode("utf-8")).hexdigest()
        preflight = self._tasks.create_preflight(
            capability="video.visual",
            route_key="b6.video_generation",
            provider="dashscope",
            model=model,
            dry_run=False,
            estimated_cny=0.0,
            allowed=True,
            reason="fixture_local_no_dispatch",
            payload={
                "project_id": project_id,
                "episode_id": episode_id,
                "frame_id": frame_id,
                "snapshot": snapshot,
                "resolution": compiled.resolution,
                "prompt_override_sha256": prompt_sha256,
                "effective_prompt_sha256": prompt_sha256,
                "effectiveStoryboardPromptContract": effective_contract,
                "inputFrameBinding": input_frame_contract,
                "greenNetPreflight": green_net_preflight,
                "greenNetAuthorizationEligible": False,
                "greenNetAuthorityReason": None,
            },
            requested_by_user_id=requester,
            project_id=project_id,
            episode_id=episode_id,
            target_stage="single_shot_video",
            expires_at=(datetime.now(UTC) + timedelta(minutes=10)).isoformat().replace("+00:00", "Z"),
        )
        status = review_service.frame_status(
            project_id=project_id, episode_id=episode_id, frame_id=frame_id
        )
        review_service.record_review(
            project_id=project_id,
            episode_id=episode_id,
            frame_id=frame_id,
            expected_frame_digest=status["frameDigest"],
            decision="accepted",
            authenticated_reviewer_user_id=requester,
            reviewer_origin=STORYBOARD_HUMAN_REVIEW_ORIGIN,
            note="浏览器生产队列夹具：确认当前精确编译提示词与首帧绑定。",
            idempotency_key=f"fixture-review-{preflight['id']}",
            prompt_override=effective_prompt,
            prompt_override_sha256=prompt_sha256,
            preflight_id=preflight["id"],
            preflight_payload_hash=preflight["payload_hash"],
            model=model,
            resolution=compiled.resolution,
        )
        return {"id": str(preflight["id"]), "payload_hash": str(preflight["payload_hash"])}

    def regenerate_frame(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(dict(kwargs))
        if kwargs.get("prompt_override"):
            self.prompt_override_calls += 1
        if not kwargs.get("confirmed_preflight_id"):
            try:
                confirmed = self._confirm_exact_human_review(kwargs)
            except Exception as exc:
                print(
                    f"QINGMU_WRITER_FIXTURE_REVIEW_ERROR={type(exc).__name__}:{exc}",
                    file=sys.stderr,
                    flush=True,
                )
                raise
            kwargs = {
                **kwargs,
                "confirmed_preflight_id": confirmed["id"],
                "confirmed_preflight_payload_hash": confirmed["payload_hash"],
                "require_confirmed_preflight": True,
            }
        # VideoService namespaces a confirmed preflight for its own retries.
        # The Writer bridge, however, owns the browser recovery key.  Preserve
        # that bridge key only at TaskCenter reservation time; all preflight,
        # review and VideoService validation remains production code.
        requested_key = str(
            kwargs.get("idempotency_key") or kwargs.get("candidate_request_id") or ""
        ).strip()
        if requested_key:
            self._tasks.reservation_idempotency_override = (
                f"video:regenerate:{kwargs['frame_id']}:{requested_key}"
            )
        try:
            result = self._production_service.regenerate_frame(**kwargs)
        except Exception as exc:
            print(
                f"QINGMU_WRITER_FIXTURE_QUEUE_ERROR={type(exc).__name__}:{exc}",
                file=sys.stderr,
                flush=True,
            )
            raise
        finally:
            self._tasks.reservation_idempotency_override = None
        if (
            self.lose_first_response
            and not self._response_lost
            and result.get("deduplicated") is not True
        ):
            self._response_lost = True
            raise RuntimeError("fixture_response_lost_after_queue")
        return result


class QuoteAuthority:
    def __init__(self, quote: dict[str, Any]):
        self.current = quote
        self.cost_preflight = SimpleNamespace(quote=self._video_quote)

    @staticmethod
    def _video_quote(**kwargs: Any) -> dict[str, Any]:
        shot_id = kwargs["regenerate_frame_ids"][0]
        return {
            "sourceLock": {"storyboard": "fixture"},
            "categories": [{
                "key": "video_regeneration",
                "items": [{"frameId": shot_id, "calls": 1, "estimatedCny": 0.1}],
            }],
            "authorizationCapCny": 0.2,
            "quoteBlockers": [],
            "dispatchBlockers": ["operator_paid_confirmation_required"],
        }

    def quote(self, **_kwargs: Any) -> dict[str, Any]:
        return json.loads(json.dumps(self.current))

    def validate_execution_binding(self, binding: dict[str, Any], *, actor: str | None = None) -> dict[str, Any]:
        del actor
        if self.current["promptBinding"]["executionBinding"] != binding:
            from jason.apps.studio.qingmu_changeset_service import QingmuChangeSetError
            raise QingmuChangeSetError("first_frame_execution_binding_blocked")
        return self.quote()


class PromptIrAuthority:
    def __init__(self, quote: dict[str, Any]):
        self.prompt = quote["authoritySnapshot"]["promptIr"]

    def read_prompt_ir_subject(self, **_kwargs: Any) -> dict[str, Any]:
        return {"subject": {"promptIrId": self.prompt["id"], "promptIrVersion": self.prompt["version"],
            "promptIrContentSha256": self.prompt["contentSha256"], "status": "Ready",
            "editableProjection": {"videoGenPrompt": "Ready PromptIR video prompt selected by a human."}}}


class FixtureNaturalPersonIdentity:
    @staticmethod
    def _owner_locked(_conn: Any, actor: str, project_id: str) -> list[str]:
        if actor != "owner" or project_id != "project-1":
            return []
        return ["qingmu:natural-person:fixture-person"]

    @staticmethod
    def _bindings(features: list[str]) -> list[str]:
        return [item.removeprefix("qingmu:natural-person:") for item in features]


def table_counts(store: Any) -> dict[str, int]:
    names = ("generation_tasks", "provider_preflights", "provider_authorization_reservations",
        "provider_submission_outbox", "provider_budget_events")
    with store._connect() as conn:
        return {name: int(conn.execute(f"SELECT count(*) FROM {name}").fetchone()[0]) for name in names}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--quote", required=True)
    parser.add_argument("--writer-root", required=True)
    parser.add_argument("--port", type=int)
    parser.add_argument("--reuse", action="store_true")
    args = parser.parse_args()
    root = Path(args.root)
    writer_root = Path(args.writer_root)
    sys.path.insert(0, str(writer_root / "backend/src"))

    from jason.apps.auth.auth_middleware import get_current_user, get_verified_authentication
    from jason.apps.studio import api_deps
    from jason.apps.studio.api_routes.qingmu_first_frame_selection import router as selection_router
    from jason.apps.studio.api_routes.qingmu_writer_production_bridge import router
    from jason.apps.studio.qingmu_first_frame_selection_service import QingmuFirstFrameSelectionService
    from jason.apps.studio.qingmu_human_authority_intent_service import HumanAuthorityIntentService
    from jason.apps.studio.qingmu_writer_production_bridge_service import QingmuWriterProductionBridgeService
    from jason.apps.studio.video_service import VideoService
    from jason.config import Settings
    from jason.domain.store import DramaStore
    from jason.domain.task_center import TaskCenter
    from jason.providers.dashscope_payloads import DashScopePayloadBuilder
    from jason.providers.gate import ProviderGate
    from jason.providers.registry import ProviderRegistry

    quote = json.loads(Path(args.quote).read_text())
    db_path = root / "isolated-writer-production-take.db"
    store = DramaStore(db_path, enable_qingmu_changeset=True)
    task_center = TaskCenter(db_path)
    tasks = FixtureTaskCenter(task_center)
    settings = Settings(
        app_env="fixture-production-route",
        allow_paid=False,
        max_paid_cny=0,
        database_url=f"sqlite:///{db_path}",
        storage_root=str(root / "storage"),
        dashscope_api_key="",
        app_public_base_url="https://fixture-media.invalid",
        jwt_secret="fixture-video-service-signing-key-32-bytes",
    )
    provider_gate = ProviderGate(settings)
    registry = ProviderRegistry(settings, provider_gate)
    storage_root = root / "storage"
    candidate_path = storage_root / "candidate.png"
    if not args.reuse:
        now = "2026-09-02T00:00:00+00:00"
        with store._connect() as conn:
            conn.execute("INSERT INTO projects (id,name,status,created_at,updated_at,owner) VALUES (?,?,?,?,?,?)",
                ("project-1", "Fixture", "active", now, now, "owner"))
            conn.execute("INSERT INTO series (id,project_id,title,created_at,updated_at) VALUES (?,?,?,?,?)",
                ("series-1", "project-1", "S1", now, now))
            conn.execute("INSERT INTO episodes (id,project_id,series_id,episode_no,title,source_text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                ("episode-1", "project-1", "series-1", 1, "E1", "fixture", "draft", now, now))
            conn.execute("INSERT INTO scenes (id,project_id,series_id,name,scene_type,visual_prompt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                ("scene-1", "project-1", "series-1", "Scene", "primary", "fixture", now, now))
            conn.execute("INSERT INTO storyboard_frames (id,project_id,episode_id,frame_no,scene_id,title,duration_sec,dialogue_json,visual_atoms_json,director_plan_json,image_prompt_cn,image_prompt_en,route_key,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                ("frame-1", "project-1", "episode-1", 1, "scene-1", "Shot 1", 5, "{}", "{}", json.dumps({
                    "requiredRefs": ["场景图:Scene"],
                    "shotPurpose": "Establish the scene before the human-selected first frame moves.",
                    "visualDescription": "A quiet interior with a clear opening composition.",
                    "lighting": "soft cool interior light with clear facial readability",
                }), "fixture", "fixture", "b6a.visual.i2v.first_frame", "planned", now, now))
            conn.execute(
                "INSERT INTO storyboard_revisions (id,project_id,episode_id,version,source_hash,structure_version,material_revision,status,snapshot_json,created_by_task_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                ("storyboard-revision-1", "project-1", "episode-1", 1, "a" * 64, 1, 1, "Ready", "{}", None, now),
            )
            conn.execute("UPDATE episodes SET storyboard_revision=1 WHERE id='episode-1'")
            conn.commit()
        storage_root.mkdir(parents=True, exist_ok=True)
        candidate_path.write_bytes(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAZ7FY0QAAAAASUVORK5CYII="
        ))
        digest = hashlib.sha256(candidate_path.read_bytes()).hexdigest()
        asset = store.create_asset(
            project_id="project-1", episode_id="episode-1", owner_type="frame", owner_id="frame-1",
            asset_type="image", role="first_frame_generated_candidate", local_path=candidate_path.name,
            mime_type="image/png", width=2, height=2, quality_status="passed",
        )
        store.update_asset_technical_metadata(asset["id"], sha256=digest)
        store.create_provider_media(
            asset_id=asset["id"],
            local_path=candidate_path.name,
            provider="fixture-local-no-dispatch",
            media_kind="image",
            url="https://fixture-media.invalid/first-frame.png",
            url_type="fixture_https_no_network",
        )
        store.create_consistency_check(
            project_id="project-1",
            episode_id="episode-1",
            frame_id="frame-1",
            asset_id=asset["id"],
            check_type="real_vl_consistency",
            score=1.0,
            threshold=0.7,
            passed=True,
            reasons=["__first_frame_audit_json__:" + json.dumps({
                "visible_people_count": 0,
                "expected_people": [],
                "people": [],
                "unknown_people_count": 0,
                "scene_type_match": True,
                "blur_level": "clear",
                "usable_for_video": True,
                "forbidden_text_detected": False,
                "gibberish_text_detected": False,
                "readable_non_story_text": False,
                "forbidden_locale_appearance_detected": False,
                "cinematography": {"scores": {
                    "composition": 1.0,
                    "subject_readability": 1.0,
                    "lighting_contrast": 1.0,
                    "depth": 1.0,
                    "axis_coherence": 1.0,
                    "action_readiness": 1.0,
                    "aesthetic": 1.0,
                }},
            }, sort_keys=True, separators=(",", ":"))],
            repair_prompt="",
        )
        scene_path = storage_root / "scene-reference.png"
        scene_path.write_bytes(candidate_path.read_bytes())
        scene_asset = store.create_asset(
            project_id="project-1", episode_id="episode-1", owner_type="scene", owner_id="scene-1",
            asset_type="image", role="scene_reference", local_path=scene_path.name,
            mime_type="image/png", width=2, height=2, quality_status="passed",
            selection_status="Selected",
        )
        store.update_asset_technical_metadata(scene_asset["id"], sha256=digest)
        # This fixture's scene reference predates its generated first-frame
        # candidate; preserve that real freshness relationship without sleeping.
        with store._connect() as conn:
            conn.execute(
                "UPDATE assets SET created_at=?,updated_at=? WHERE id=?",
                ("2025-01-01T00:00:00+00:00", "2025-01-01T00:00:00+00:00", scene_asset["id"]),
            )
            conn.commit()
        store.create_provider_media(
            asset_id=scene_asset["id"],
            local_path=scene_path.name,
            provider="fixture-local-no-dispatch",
            media_kind="image",
            url="https://fixture-media.invalid/scene-reference.png",
            url_type="local_public_http",
        )
        # The real video service requires an audit newer than every official
        # reference used by the frame.  Record the post-reference audit rather
        # than weakening that production freshness check in this fixture.
        store.create_consistency_check(
            project_id="project-1",
            episode_id="episode-1",
            frame_id="frame-1",
            asset_id=asset["id"],
            check_type="real_vl_consistency",
            score=1.0,
            threshold=0.7,
            passed=True,
            reasons=["__first_frame_audit_json__:" + json.dumps({
                "visible_people_count": 0,
                "expected_people": [],
                "people": [],
                "unknown_people_count": 0,
                "scene_type_match": True,
                "blur_level": "clear",
                "usable_for_video": True,
                "forbidden_text_detected": False,
                "gibberish_text_detected": False,
                "readable_non_story_text": False,
                "forbidden_locale_appearance_detected": False,
                "cinematography": {"scores": {
                    "composition": 1.0,
                    "subject_readability": 1.0,
                    "lighting_contrast": 1.0,
                    "depth": 1.0,
                    "axis_coherence": 1.0,
                    "action_readiness": 1.0,
                    "aesthetic": 1.0,
                }},
            }, sort_keys=True, separators=(",", ":"))],
            repair_prompt="",
        )

    production_video = VideoService(
        store,
        tasks,
        registry,
        storage_root,
        settings,
        payload_builder=DashScopePayloadBuilder(settings),
        provider_gate=provider_gate,
    )
    video = FixtureVideoService(production_video, tasks)
    selection = QingmuFirstFrameSelectionService(
        store, storage_root=storage_root, natural_person_identity=FixtureNaturalPersonIdentity()
    )
    service = QingmuWriterProductionBridgeService(
        store, QuoteAuthority(quote), PromptIrAuthority(quote), video, selection
    )
    api_deps.store = store
    api_deps.qingmu_first_frame_selection_service = selection
    api_deps.qingmu_human_authority_intent_service = HumanAuthorityIntentService("fixture-human-authority-" + "x" * 32)
    api_deps.qingmu_writer_production_bridge_service = service
    app = FastAPI()
    app.include_router(selection_router)
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="owner")
    app.dependency_overrides[get_verified_authentication] = lambda: SimpleNamespace(
        user=SimpleNamespace(id="owner"), issued_at=datetime.now(UTC), session_sha256="b" * 64,
        credential_source="cookie",
    )
    route_statuses: list[int] = []

    @app.middleware("http")
    async def record_production_status(request: Any, call_next: Any):
        response = await call_next(request)
        if request.url.path.endswith("/production-takes"):
            route_statuses.append(response.status_code)
        return response

    @app.get("/__fixture/state")
    def state() -> dict[str, Any]:
        with store._connect() as conn:
            rows = [dict(row) for row in conn.execute(
                "SELECT id,kernel_status,local_status,provider_status FROM generation_tasks ORDER BY created_at")]
            first_frames = {
                "assets": int(conn.execute(
                    "SELECT count(*) FROM assets WHERE owner_type='frame' AND owner_id='frame-1'"
                ).fetchone()[0]),
                "selected": int(conn.execute(
                    "SELECT count(*) FROM assets WHERE owner_type='frame' AND owner_id='frame-1' AND is_selected=1"
                ).fetchone()[0]),
                "receipts": int(conn.execute(
                    "SELECT count(*) FROM assets WHERE owner_type='frame' AND owner_id='frame-1' "
                    "AND json_extract(quality_json, '$.qingmuFirstFrameSelectionReceipt.receiptSha256') IS NOT NULL"
                ).fetchone()[0]),
            }
        return {"counts": table_counts(store), "tasks": rows, "providerCalls": video.provider_calls,
            "promptOverrideCalls": video.prompt_override_calls, "writerCalls": len(video.calls),
            "routeStatuses": route_statuses, "firstFrames": first_frames}

    @app.post("/__fixture/lose-next")
    def lose_next() -> dict[str, bool]:
        video.lose_first_response = True
        video._response_lost = False
        return {"ok": True}

    @app.post("/__fixture/drift-next-first-frame-reservation")
    def drift_next_first_frame_reservation() -> dict[str, bool]:
        """Change the persisted selected SHA inside the next queue transaction.

        The E2E uses this only to prove that the production VideoService's
        atomic reservation callback rejects a receipt/materialized-SHA drift
        before a TaskCenter reservation can commit.
        """
        def drift(conn: Any) -> None:
            conn.execute(
                "UPDATE assets SET sha256=? WHERE project_id=? AND episode_id=? "
                "AND owner_type='frame' AND owner_id=? AND is_selected=1",
                ("f" * 64, "project-1", "episode-1", "frame-1"),
            )

        tasks.before_atomic_callback = drift
        return {"ok": True}

    @app.post("/__fixture/finish-active")
    def finish_active() -> dict[str, int]:
        with store._connect() as conn:
            changed = conn.execute("UPDATE generation_tasks SET kernel_status='Failed',local_status='failed',provider_status='FAILED' WHERE kernel_status IN ('DispatchPending','Queued','Running')").rowcount
        return {"changed": int(changed)}

    @app.get("/api/media/{asset_id}")
    def candidate_media(asset_id: str) -> Response:
        with store._connect() as conn:
            row = conn.execute(
                "SELECT id,local_path,mime_type FROM assets WHERE id=? AND owner_type='frame' AND owner_id='frame-1'",
                (asset_id,),
            ).fetchone()
        if row is None:
            return Response(status_code=404)
        path = storage_root / str(row["local_path"])
        return Response(
            content=path.read_bytes(), media_type=str(row["mime_type"]),
            headers={"content-length": str(path.stat().st_size), "cache-control": "no-store"},
        )

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", args.port or 0))
    sock.listen(128)
    port = sock.getsockname()[1]
    print("QINGMU_WRITER_FIXTURE=" + json.dumps({"baseUrl": f"http://127.0.0.1:{port}", "sqlitePath": str(db_path)}), flush=True)
    uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])


if __name__ == "__main__":
    main()
