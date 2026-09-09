# Agent Note: Unified Qingmu creative workspace

English | [中文](2026-09-10-qingmu-unified-workspace.zh.md)

Status: implemented

## Problem

The five-stage application still presented unrelated forms, colors and operational panels. Project assets had no shared visual browser, and preview URLs incorrectly assumed that asset and media identifiers matched.

## Decision

Reuse the existing application frame and business components. Unify navigation, page hierarchy, project context and dark colors across the entire product. Add a project image/audio browser and put scene references first in the storyboard stage. Keep shooting media-first; progressively disclose import, returned-master and archival controls in delivery. Mobile actions remain accessible. Preview URLs use Writer's actual media identifier. A completed planning read with no matching automatic shot now settles with a useful message instead of loading forever.

## Alternatives considered

A separate canvas application would duplicate scope, persistence and generation controls. Styling only the reference editor would leave the rest of Qingmu fragmented. Both were rejected in favor of a shared product shell over the current workflows.

## Verification and limits

Focused client, read-adapter and Writer tests cover the changed behavior. A private full DSH Host with current source builds and disposable Writer SQLite data exercised all five stages, image loading, actual audio playback, three saved reference drafts, and recovery after reload. It made no paid Provider request. Production ports were not replaced. This is an integrated UI milestone, not proof of end-to-end creative acceptance or every backend capability.
