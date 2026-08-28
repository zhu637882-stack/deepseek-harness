# Agent Note: Qingmu recoverable project and script creation

Status: implemented

English | [中文](2026-08-29-qingmu-creation-entry.zh.md)

## Problem

An empty persistent Qingmu instance needs an editable script entry without triggering production. Browser double clicks and lost responses cannot create duplicate projects or overwrite a newer script.

## Decision

The [creation workspace](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/CreationWorkspace.tsx) calls only [bounded Host operations](../../../../packages/experimental/qingmu-yimeng-command-adapter/src/creation.ts). Yimeng creates the project, season, episode and actor-scoped ChangeSet/receipt/outbox rows in one existing Store transaction. The explicit project-bootstrap command represents creation, not a fabricated edit of an old object. It needs no schema change. Same-key recovery verifies the request and complete journal; same-key changed parameters fail.

Canonical TextImportService owns TXT bytes, parsing drafts, corrections and fingerprint/revision-checked script confirmation. GET recovery is read-only. An incomplete draft creation can finish its own active index only through explicit same-key retry with unchanged source and predecessor; later draft creation fences old drafts as stale. Browser storage retains unsaved input and request coordinates, never authoritative project/script state. Advanced script JSON remains an expandable existing editor.

## Alternatives considered

**Frontend-only duplicate prevention.** A disabled button cannot recover a request after process restart or response loss; durable actor-scoped receipts own creation identity.

**A new project database or generic HTTP proxy.** Both expand authority unnecessarily. Existing Yimeng transactions and six allowlisted operations retain one business owner.

**Automatic production after import.** Text confirmation concerns parsing and script persistence only; asset generation, stages and creative/media approval require separate actions.

## Consequences

Creation and import work with no Provider. Paste and UTF-8 TXT have explicit limits; DOC/DOCX are outside this entry. A fresh browser recovers canonical saved data, not unsubmitted browser-only text. Project transactions, stale-source rejection and filesystem failure recovery have focused tests. The [real browser test](../../../../apps/web/tests/qingmu-creation.e2e.ts) uses the normal local launcher, an empty independent database and response-loss injection without replacing the API. Local integration does not establish full product, media or human acceptance.
