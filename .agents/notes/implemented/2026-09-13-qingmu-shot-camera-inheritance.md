# Qingmu shot camera initialization

## Problem

New shot cameras started at a fixed coordinate even when the bound scene had a saved camera. Rooms with another origin could initially frame empty space. Earlier browser checks filled every camera field before previewing and therefore did not exercise the first-enable behavior.

## Change

Enabling a new shot camera explicitly copies the bound scene's saved camera into the shot draft. Authored shot cameras remain authoritative; opening the editor does not save or modify them. Scenes without a saved camera retain the existing fallback. Shared scene objects remain unchanged. Draft persistence and uncertain-save recovery use the existing scene-planning path.

## Verification

Four focused component cases cover new and authored cameras in manual and automatic planning, exact scene binding, preview inputs, save payloads, and disconnected-save recovery. Deployment verification checks first-enable values before editing any field in two existing projects. No media generation is required to verify this UI behavior; the check does not establish generated spatial continuity.
