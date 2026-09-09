"""Native, project-scoped material preparation without model-spending authority."""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import re
import stat


def validate_connection(config):
    """Validate metadata only; never read a key while inspecting instance state."""
    value = config.get("referenceVideoConnection")
    if value is None:
        return None
    if (
        config.get("uiMode") != "native"
        or any(config.get(name) is not None for name in (
            "directorExecutionFixture", "directorProductionExecution",
            "textFoundationProductionExecution", "projectProductionExecution",
        ))
        or not isinstance(value, dict)
        or set(value) != {"provider", "model", "projectId", "episodeId", "credentialEnvFile", "credentialFingerprint"}
        or value["provider"] != "dashscope"
        or value["model"] != "wan3.0-video"
        or any(not isinstance(value[name], str) or not re.fullmatch(
            r"[A-Za-z0-9_.:-]{1,128}", value[name]
        ) for name in ("projectId", "episodeId"))
        or not isinstance(value["credentialEnvFile"], str)
        or not Path(value["credentialEnvFile"]).is_absolute()
        or ".." in Path(value["credentialEnvFile"]).parts
        or not isinstance(value["credentialFingerprint"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", value["credentialFingerprint"])
    ):
        raise ValueError("reference_video_connection_invalid")
    return dict(value)


def read_key(filename):
    """Read only a literal DashScope key from an owner-only, bounded env file."""
    from dotenv import dotenv_values

    path = Path(filename)
    try:
        # Reject symlinks in any component, and verify the opened descriptor.
        if not path.is_absolute() or path.resolve(strict=True) != path:
            raise ValueError
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "r", encoding="utf-8") as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                    or info.st_mode & 0o077 or info.st_size > 131072):
                raise ValueError
            contents = stream.read(131073)
            if len(contents.encode("utf-8")) > 131072:
                raise ValueError
        values = dotenv_values(stream=io.StringIO(contents), interpolate=False)
        key = values.get("DASHSCOPE_API_KEY")
        if (not isinstance(key, str) or not 1 <= len(key) <= 4096 or "$" in key
                or any(ord(c) < 33 or ord(c) > 126 for c in key)):
            raise ValueError
        return key
    except (OSError, ValueError, UnicodeError):
        # Never forward dotenv contents, credential values or parser exceptions.
        raise ValueError("reference_video_connection_credential_unavailable") from None


def key_fingerprint(key):
    from jason.providers.dashscope_temporary_media import DashScopeTemporaryMediaClient

    return DashScopeTemporaryMediaClient(key).credential_fingerprint


def bound_key(connection):
    key = read_key(connection["credentialEnvFile"])
    if key_fingerprint(key) != connection["credentialFingerprint"]:
        raise ValueError("reference_video_connection_credential_changed")
    return key


def compose_reference_video_connection(deps, config):
    """Install scoped Writer services, leaving shared Settings and Worker untouched."""
    connection = validate_connection(config)
    if connection is None:
        return
    if deps.settings.allow_paid or deps.settings.max_paid_cny != 0 or deps.settings.dashscope_api_key:
        raise ValueError("reference_video_connection_runtime_conflict")
    from jason.apps.studio.qingmu_reference_video_material_service import ReferenceVideoMaterialService
    from jason.apps.studio.qingmu_reference_video_preview_service import ReferenceVideoPreviewService
    from jason.providers.dashscope_payloads import DashScopePayloadBuilder
    from jason.providers.dashscope_temporary_media import API_ROOT

    project_id, episode_id = connection["projectId"], connection["episodeId"]
    project = deps.store.get_project(project_id)
    episode = deps.store.get_episode(episode_id)
    owner = project.get("owner")
    if not owner or episode.get("project_id") != project_id:
        raise ValueError("reference_video_connection_scope_mismatch")
    settings = deps.settings.model_copy(update={
        "dashscope_api_key": bound_key(connection),
        "dashscope_base_url": API_ROOT,
        "dashscope_region": "cn-beijing",
        "dashscope_workspace_id": "",
    })

    def check(actor, project, episode):
        if actor != owner or project != project_id or episode != episode_id:
            raise PermissionError("reference_video_connection_scope_forbidden")

    class ScopedMaterials(ReferenceVideoMaterialService):
        def _draft(self, actor, project_id, frame_id, revision, request_sha, conn=None):
            if conn is None:
                self.preview._scope(actor, project_id, frame_id)
            else:
                frame = conn.execute(
                    "SELECT project_id, episode_id FROM storyboard_frames WHERE id=?", (frame_id,)
                ).fetchone()
                if frame is None:
                    raise KeyError(frame_id)
                check(actor, frame["project_id"], frame["episode_id"])
            return super()._draft(actor, project_id, frame_id, revision, request_sha, conn)

        def _source(self, actor, asset, fingerprint):
            check(actor, asset["project_id"], episode_id)
            return super()._source(actor, asset, fingerprint)

    class ScopedPreview(ReferenceVideoPreviewService):
        def _scope(self, actor, project_id, frame_id):
            frame = super()._scope(actor, project_id, frame_id)
            check(actor, project_id, frame["episode_id"])
            return frame

        def materials(self):
            return ScopedMaterials(self)

    deps.qingmu_reference_video_preview_service = ScopedPreview(
        deps.store, settings, DashScopePayloadBuilder(settings)
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe-env", required=True)
    args = parser.parse_args()
    try:
        fingerprint = key_fingerprint(read_key(args.probe_env))
    except ValueError:
        raise SystemExit("reference_video_connection_credential_unavailable") from None
    print(json.dumps({"credentialAvailable": True, "providerHttpRequests": 0,
                      "credentialFingerprint": fingerprint}))
