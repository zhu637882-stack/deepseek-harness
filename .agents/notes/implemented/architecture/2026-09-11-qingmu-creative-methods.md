# Agent Note: Qingmu creative methods in native sessions

Status: implemented

English | [中文](2026-09-11-qingmu-creative-methods.zh.md)

## Problem

A method name or partial template cannot carry a directing workflow. Linked sound, performance, continuity and staging references must reach the model. Upstream assumptions about speaker counts and camera moves can also contradict the project's script and director decisions.

## Decision

The Qingmu preset uses native skill discovery and loading. Its cinematic-director entry is a Qingmu-authored adaptation of the Leos six-department method, including whole-film interpretation and asset design. Open Film Skills supplies complete writing and camera specialist packages under their upstream Apache-2.0 license; the former DirectorSKILL entry and ai-visual-director remain supporting resources. No Leos source is redistributed. The scoped reader verifies manifest paths and hashes, reports pagination, and records upstream and adapted provenance separately. Imported numeric, format and platform defaults remain advisory; the script and director plan govern execution. Capability limitations require an explicit execution alternative, not silent reduction of the work.

## Alternatives considered

Injecting the entire library at startup costs context without ensuring relevant references are used. Building another skill registry duplicates DSH. Copying only selected sentences loses methods and linked dependencies.

## Consequences

The real Loader and agent-loop test verifies catalog discovery, full method and reference results in subsequent model requests, and session isolation. Resource tests cover pagination, source integrity and rejection paths. These checks establish method availability, not real-model creative execution, canonical project persistence, paid generation quality or user acceptance. [The source manifest](../../../../packages/experimental/qingmu-web/agent-presets/qingmu-director/skills/sources.json) identifies the selected source versions and excludes binary example media.

Creative settings expose current execution methods separately from immutable creation history. Reviewed V2 predecessors resolve to their declared native targets; V1 and unconfigured projects use installed native methods for new work, retaining historical references as auxiliaries. The style picker and screenplay input read the same composed visual settings as reference-video direction. Preset composition never processes authored script or director text. Shot-specific camera and light decisions remain with the director, and reference-video preview resolves episode style overrides as well as project defaults.

The scene reference desk also carries the selected shot’s exact director duration into an unsaved video draft instead of a fixed eight-second value. A saved draft takes precedence. Fractional or unsupported timings remain explicit for provider validation; the UI does not silently rewrite the director plan.
