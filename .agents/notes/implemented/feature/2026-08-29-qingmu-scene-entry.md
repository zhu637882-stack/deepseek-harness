# Agent Note: Source-bound first scene planning

Status: implemented

English | [中文](2026-08-29-qingmu-scene-entry.zh.md)

## Problem

A newly imported script has text scene coordinates, not database scene identities or editable storyboard frames. Users need a bounded planning entry without generated media or fabricated approval.

## Decision

The [planning workspace](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/ScenePlanningWorkspace.tsx) follows the independent [project and script creation entry](2026-08-29-qingmu-creation-entry.md). Yimeng binds one confirmed script scene's revision, complete SHA and source lines to new text entities, 1–8 real frames and the first canonical storyboard snapshot in one existing Store transaction with ChangeSet/outbox/receipt records. An Edit uses the existing kernel mutation. No schema or second business store is introduced.

Structural Ready records a planning snapshot, not creative approval. Empty references and absent PromptIR stay missing. Same-name actors in other scenes are not merged. Browser recovery retains exact commands and input; GET recovery precedes explicit retry or re-preparation. A competing first initialization loads the winner only after preserving the losing input locally and explicit confirmation.

## Alternatives considered

**A fabricated empty Ready predecessor.** It would claim a snapshot without real frames merely to satisfy Insert. The narrow first-snapshot operation instead validates and snapshots actual rows atomically.

**Automatic prompts, references or stage execution.** These require additional source and authority contracts. Planning cannot grant those permissions or manufacture missing context.

**Replacing a competing initialization.** A stale intent cannot overwrite another saved plan. The browser retains a copy; another edit requires a fresh explicit intention.

## Consequences

The [real browser path](../../../../apps/web/tests/qingmu-scene-planning.e2e.ts) uses the normal launcher and empty isolated database, creates/imports through the UI, loses an actual successful reply, edits and restarts into a fresh browser. Focused contracts cover ownership, source conflicts, atomic rollback and journal recovery. Planning remains single-scene; external director methods, PromptIR readiness, media generation and content acceptance are separate work.
