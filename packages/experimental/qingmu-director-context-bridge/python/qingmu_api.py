"""Qingmu-owned API composition using Writer services and its startup validators."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
from fastapi import Depends, HTTPException, Request


def load_writer_entry(writer_root: Path):
    """Import configuration helpers without launching or mutating the old entry."""
    path = writer_root.resolve(strict=True) / "scripts/qingmu_local_api.py"
    spec = importlib.util.spec_from_file_location("qingmu_writer_startup", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("writer_startup_not_loadable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def compose_dialogue_service(deps):
    """Install the one transaction decorator before API routes capture services."""
    from dialogue_changeset import DialogueChangeSets
    from video_frame_cas import install_video_frame_cas
    from jason.apps.studio.qingmu_prompt_ir_bootstrap_service import automatic_storyboard_bootstrap_inputs
    from functools import partial
    install_video_frame_cas(deps.video_service)
    wrapped = isinstance(deps.qingmu_change_set_service, DialogueChangeSets)
    changes = deps.qingmu_change_set_service.service if wrapped else deps.qingmu_change_set_service
    changes.prompt_ir_bootstrap_input_builder = partial(
        automatic_storyboard_bootstrap_inputs, resolve_prop_names=deps.asset_service._shot_visible_prop_names)
    if wrapped:
        return
    deps.qingmu_change_set_service = DialogueChangeSets(deps.qingmu_change_set_service)


def install_dialogue_capability(app):
    """Expose installed behavior to an authenticated Host, never a write shortcut."""
    from jason.apps.auth.auth_middleware import get_current_user
    def capability(user=Depends(get_current_user)):
        return {"schema": "qingmu.dialogue-transaction-capability.v1",
                "referenceSchema": "qingmu.dialogue-edit-reference.v1",
                "atomicScriptAndFrames": True}

    app.add_api_route("/api/qingmu/dialogue-edit/capability", capability, methods=["GET"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--initialize", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--inspect-director-submit-task")
    parser.add_argument("--director-production-override", type=Path)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    config = json.loads((root / "private/instance.json").read_text())
    if config["root"] != str(root):
        raise ValueError("instance_root_mismatch")
    upstream = load_writer_entry(Path(config["yimengRoot"]))
    # Reuse the existing validated startup configuration; only application
    # composition is owned here. No provider or runtime control is relaxed.
    global inspect_director_submit_task, _text_foundation_config, _project_production_execution_config
    global _production_config, _project_runtime_environment, _DirectorProductionCatalog
    global PRODUCTION_PROVIDER, PRODUCTION_MODEL
    inspect_director_submit_task = upstream.inspect_director_submit_task
    _text_foundation_config = upstream._text_foundation_config
    _project_production_execution_config = upstream._project_production_execution_config
    _production_config = upstream._production_config
    _project_runtime_environment = upstream._project_runtime_environment
    _DirectorProductionCatalog = upstream._DirectorProductionCatalog
    PRODUCTION_PROVIDER, PRODUCTION_MODEL = upstream.PRODUCTION_PROVIDER, upstream.PRODUCTION_MODEL
    tail_audit_scope = None
    if os.environ.get("QINGMU_TAIL_AUDIT_SCOPE_JSON"):
        from jason.apps.studio.qingmu_tail_audit_scope import validate_scope, scope_sha256

        if os.environ.get("QINGMU_REVIEW_ONLY") != "1":
            raise ValueError("tail_audit_requires_review_only")
        tail_audit_scope = validate_scope(json.loads(os.environ["QINGMU_TAIL_AUDIT_SCOPE_JSON"]),
                                         instance_id=config["instanceId"])
    if args.inspect_director_submit_task:
        print(json.dumps(inspect_director_submit_task(
            root / "storage/jason.db", args.inspect_director_submit_task
        ), ensure_ascii=False))
        return
    fixture = config.get("directorExecutionFixture")
    text_production = _text_foundation_config(
        config.get("textFoundationProductionExecution")
    )
    project_production = _project_production_execution_config(
        config.get("projectProductionExecution")
    )
    production_value = config.get("directorProductionExecution")
    if args.director_production_override is not None:
        override = args.director_production_override.resolve(strict=True)
        if (
            override.parent != root / "private"
            or override.is_symlink()
            or override.stat().st_uid != os.getuid()
            or override.stat().st_mode & 0o077
        ):
            raise ValueError("director_production_override_not_private")
        production_value = json.loads(override.read_text())
        base = _production_config(config.get("directorProductionExecution"))
        expected = {**(base or {}), "transportEnabled": True}
        if production_value != expected:
            raise ValueError("director_production_override_binding_mismatch")
    production = _production_config(production_value)
    if fixture is not None and production is not None:
        raise ValueError("director_execution_modes_conflict")
    if fixture is not None and text_production is not None:
        raise ValueError("text_foundation_and_director_fixture_modes_conflict")
    if text_production is not None and production is not None and (
        text_production["projectId"] != production["projectId"]
        or text_production["episodeId"] != production["episodeId"]
    ):
        raise ValueError("production_execution_scope_mismatch")
    if project_production is not None and project_production["active"] and (
        text_production is None
        or project_production["projectId"] != text_production["projectId"]
        or project_production["episodeId"] != text_production["episodeId"]
    ):
        raise ValueError("project_production_execution_scope_mismatch")
    if text_production is not None:
        credential_env = Path(text_production["credentialEnvFile"])
        if (
            credential_env.is_symlink()
            or not credential_env.is_file()
            or credential_env.stat().st_uid != os.getuid()
            or credential_env.stat().st_mode & 0o077
        ):
            raise ValueError("text_foundation_credential_env_not_private")
    if fixture is not None:
        if (
            not isinstance(fixture, dict)
            or fixture.get("fixtureOnly") is not True
            or (
                fixture.get("provider") != "fake"
                and not (
                    fixture.get("transportMode") == "dsh-one-shot-mock"
                    and fixture.get("provider") == "deepseek-official"
                    and fixture.get("model") == "deepseek-v4-pro"
                )
            )
            or not all(str(fixture.get(key) or "").strip() for key in (
                "model", "routeKey", "projectId", "episodeId",
                "methodPackageVersion", "methodPackageSha256",
            ))
        ):
            raise ValueError("director_execution_fixture_invalid")
    # This marker only chooses the application runtime.  It cannot itself
    # authorize paid work: that remains limited to a validated text/director
    # authority above, so a forged permissive marker never opens the gate.
    project_production_active = bool(
        project_production is not None and project_production["active"]
    )
    runtime_authority = text_production or fixture or production
    os.environ.update({
        "JASON_PROJECT_ROOT": str(root),
        "JASON_CONFIG_ROOT": config["yimengRoot"],
        "JASON_ENV_FILE": (
            text_production["credentialEnvFile"]
            if text_production
            else str(root / "private/no-ambient.env")
        ),
        "DATABASE_URL": f"sqlite:///{root / 'storage/jason.db'}",
        "STORAGE_ROOT": str(root / "storage"),
        **_project_runtime_environment(project_production_active),
        "APP_HOST": "127.0.0.1",
        "JWT_SECRET": config["jwtSecret"], "JWT_EXPIRE_HOURS": "24",
        "QINGMU_IMAGO_ATTESTATION_KEY": config["attestationKey"],
        # Older instances intentionally remain fail-closed for Host execution.
        "QINGMU_DIRECTOR_EXECUTION_KEY": config.get("directorExecutionKey", ""),
        # Older instances remain fail-closed for private editorial re-verification.
        "QINGMU_EDITORIAL_HANDOFF_KEY": config.get("editorialHandoffKey", ""),
        "QINGMU_CHANGESET_ENABLED": "true",
        "PUBLIC_REGISTRATION_ENABLED": "false",
        "ALLOW_PAID": "true" if runtime_authority else "false",
        "MAX_PAID_CNY": str((runtime_authority or {}).get("maxPaidCny", 0)),
        # This isolated Qingmu database owns its own lifetime ledger.  The
        # Yimeng env file supplies Provider credentials only; an operations
        # budget window from another deployment must never leak into it.
        "PROVIDER_BUDGET_BASELINE_CNY": "0",
        "PROVIDER_BUDGET_WINDOW_ID": "",
        "PROVIDER_PAID_SCOPE_REQUIRED": "true",
        "PROVIDER_PAID_SCOPE_PROJECT_ID": str((runtime_authority or {}).get("projectId", "")),
        "PROVIDER_PAID_SCOPE_EPISODE_ID": str((runtime_authority or {}).get("episodeId", "")),
        "BUILD_MANIFEST_DIR": str(root / "build-manifest"),
        "OPERATOR_AUDIT_DIR": str(root / "audit"),
    })
    from jason.apps.studio import api_deps
    compose_dialogue_service(api_deps)
    from jason.apps.studio.api_deps import auth_service, settings, store

    if fixture:
        from jason.apps.studio import api_deps
        from jason.apps.studio.qingmu_director_inference_service import DirectorPaidRoute

        if fixture.get("transportMode") == "dsh-one-shot-mock":
            # Isolated C0 acceptance only: preserve ProviderGate/preflight/cost
            # behavior without adding DeepSeek to the repository production catalog.
            base_catalog = api_deps.provider_gate.catalog

            class _DirectorMockCatalog:
                def __getattr__(self, name):
                    return getattr(base_catalog, name)

                def load(self):
                    value = dict(base_catalog.load())
                    value["providers"] = [*value.get("providers", []), {
                        "provider_id": "deepseek-official", "enabled": True,
                    }]
                    return value

                def get_model(self, model):
                    if model != "deepseek-v4-pro":
                        return base_catalog.get_model(model)
                    value = dict(base_catalog.get_model("qwen3.7-plus-2026-05-26"))
                    value.update({"id": model, "provider_id": "deepseek-official"})
                    return value

                def estimate_cny(self, model, payload):
                    if model == "deepseek-v4-pro":
                        return base_catalog.estimate_cny("qwen3.7-plus-2026-05-26", payload)
                    return base_catalog.estimate_cny(model, payload)

            api_deps.provider_gate.catalog = _DirectorMockCatalog()

        api_deps.qingmu_director_inference_service.paid_route = DirectorPaidRoute(
            provider=str(fixture["provider"]),
            model=str(fixture["model"]),
            route_key=str(fixture["routeKey"]),
            authorization_scope_key="isolated-director-execution-fixture",
            authorization_cap_cny=float(fixture.get("maxPaidCny", 0.01)),
            method_package_version=str(fixture["methodPackageVersion"]),
            method_package_sha256=str(fixture["methodPackageSha256"]),
        )

    if production:
        from jason.apps.studio import api_deps
        from jason.apps.studio.qingmu_director_inference_service import DirectorPaidRoute

        api_deps.provider_gate.catalog = _DirectorProductionCatalog(api_deps.provider_gate.catalog)
        api_deps.qingmu_director_inference_service.paid_route = DirectorPaidRoute(
            provider=PRODUCTION_PROVIDER,
            model=PRODUCTION_MODEL,
            route_key=str(production["routeKey"]),
            authorization_scope_key="isolated-director-production-d1",
            authorization_cap_cny=0.30,
            method_package_version=str(production["methodPackageVersion"]),
            method_package_sha256=str(production["methodPackageSha256"]),
            max_input_tokens=8000,
            max_output_tokens=2000,
        )

    if settings.sqlite_path.resolve() != root / "storage/jason.db":
        raise ValueError("instance_database_mismatch")
    if args.initialize:
        credentials = json.loads((root / "private/login.json").read_text())
        user = auth_service.register(credentials["username"], "", credentials["password"])
        print(json.dumps({"userId": user.id, "username": user.username}))
        return

    import uvicorn
    from jason.apps.studio.api import app
    install_dialogue_capability(app)

    if os.environ.get("QINGMU_REVIEW_ONLY") == "1":
        from jason.apps.studio.qingmu_review_only import QingmuReviewOnlyMiddleware

        app.add_middleware(QingmuReviewOnlyMiddleware, tail_audit_scope=tail_audit_scope,
                           tail_audit_control_key=config["controlKey"] if tail_audit_scope else None)

    async def identity(request: Request) -> dict:
        import hmac
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied, f"Bearer {config['controlKey']}"):
            raise HTTPException(401, "instance_probe_unauthorized")
        return {"instanceId": config["instanceId"], "pid": os.getpid(),
                "root": str(root), "database": str(store.db_path),
                "storage": str(settings.storage_path),
                **({"reviewOnly": True} if os.environ.get("QINGMU_REVIEW_ONLY") == "1" else {}),
                **({"tailAuditScopeSha256": scope_sha256(tail_audit_scope)} if tail_audit_scope else {})}

    app.add_api_route("/_qingmu/instance", identity, methods=["GET"], include_in_schema=False)
    uvicorn.run(app, host="127.0.0.1", port=args.port, lifespan="on", access_log=False)


if __name__ == "__main__":
    main()
