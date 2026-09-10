# Agent Note: Qingmu creative methods in native sessions

Status: implemented

English | [中文](2026-09-11-qingmu-creative-methods.zh.md)

## Problem

A method name or partial template cannot carry a directing workflow. Linked sound, performance, continuity and staging references must reach the model. Upstream assumptions about speaker counts and camera moves can also contradict the project's script and director decisions.

## Decision

The Qingmu preset uses native skill discovery and loading with packaged cinematic-director and ai-visual-director sources. Its scoped resource reader verifies manifest paths and hashes, reports pagination, and records upstream and adapted provenance separately. Qingmu adaptations preserve creative methods while removing fixed speaker, action, movement and dialogue-length rules from active instructions and checklists. Historical examples and model estimates remain advisory. The script and director plan govern creative execution; capability limitations require an explicit execution alternative, not silent reduction of the work.

## Alternatives considered

Injecting the entire library at startup costs context without ensuring relevant references are used. Building another skill registry duplicates DSH. Copying only selected sentences loses methods and linked dependencies.

## Consequences

The real Loader and agent-loop test verifies catalog discovery, full method and reference results in subsequent model requests, and session isolation. Resource tests cover pagination, source integrity and rejection paths. These checks establish method availability, not real-model creative execution, canonical project persistence, paid generation quality or user acceptance. [The source manifest](../../../../packages/experimental/qingmu-web/agent-presets/qingmu-director/skills/sources.json) identifies the selected source versions and excludes binary example media.
