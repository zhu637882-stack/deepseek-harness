"""Run the existing Writer queue with the native instance's shared connection."""
import json
import os
from pathlib import Path

from reference_video_connection import production_environment, validate_production


def main():
    root = Path(os.environ["JASON_PROJECT_ROOT"]).resolve(strict=True)
    config = json.loads((root / "private/instance.json").read_text())
    if config["root"] != str(root) or validate_production(config) is None:
        raise ValueError("native_production_worker_instance_invalid")
    os.environ.update(production_environment(config))
    os.environ["QINGMU_CREATIVE_SKILL_ROOT"] = str(Path(config["harnessRoot"]) / "packages/experimental/qingmu-web/agent-presets/qingmu-director/skills")
    from jason.apps.studio.worker_cli import main as run_worker
    run_worker()


if __name__ == "__main__":
    main()
