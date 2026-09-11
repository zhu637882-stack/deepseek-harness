# Agent Note: Qingmu project library management

Status: implemented

English | [中文](2026-09-11-qingmu-project-library-management.zh.md)

## Problem

Creators need to find and organize earlier works while starting new ones. The library did not display saved covers or expose project metadata editing.

## Decision

The existing command adapter forwards bounded project name and archive updates to Writer's owner-checked PATCH route. The library displays saved covers, filters active and archived projects, and retains a failed edit draft. Writer keeps project contents and creative settings unchanged.

## Alternatives considered

**Browser-only archives** would disappear across browsers and disagree with the project store, so archive state uses the existing project status field.

**Deleting finished projects** would destroy reusable work. Archiving only organizes the library; opening, editing and running tasks retain their existing behavior.

## Consequences

No new database or media pipeline is introduced. Covers fall back to an owner-scoped reference preview when available, then a title card. A reference preview is labeled and does not grant selection or media approval. Adapter, UI and API tests cover persistence, scope, invalid input and failed saves; archiving is not task cancellation.
