# Agent Note: Qingmu project library management

Status: implemented

English | [中文](2026-09-11-qingmu-project-library-management.zh.md)

## Problem

Creators need to find and organize earlier works while starting new ones. The library did not display saved covers or expose project metadata editing.

## Decision

The existing command adapter forwards bounded project name and archive updates to Writer's owner-checked PATCH route. The library displays saved covers, filters active and archived projects, and retains a failed edit draft. Writer keeps project contents and creative settings unchanged.

The copy action creates an independent creative project from a current source snapshot. Writer reassigns entity and frame identities, rebuilds planning origins, and retains current script, design and media selections. Media bytes retain their original provenance; copied media bindings make previews and references available without downloading again. Private images and voice uploads remain private: reads resolve the validated copy receipts and verify the original upload bytes, including for a copy of a copy. One Store transaction commits the project and copy receipt together; browser persistence and receipt replay recover the same operation after an ambiguous response. Replay also restores missing media bindings from an earlier copy when source and copied bytes still match. Editing, generation jobs and review history remain in the source project.

## Alternatives considered

**Browser-only archives** would disappear across browsers and disagree with the project store, so archive state uses the existing project status field.

**Deleting finished projects** would destroy reusable work. Archiving only organizes the library; opening, editing and running tasks retain their existing behavior.

## Consequences

No new database or media pipeline is introduced. Covers fall back to an owner-scoped reference preview when available, then a title card. A reference preview is labeled and does not grant selection or media approval. Adapter, UI and API tests cover persistence, scope, invalid input and failed saves; archiving is not task cancellation.
