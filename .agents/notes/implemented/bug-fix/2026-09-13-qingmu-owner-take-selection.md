# Agent Note: Qingmu owner Take selection

Status: implemented

English | [中文](2026-09-13-qingmu-owner-take-selection.zh.md)

## Problem

An authenticated project owner could generate and edit video but could not choose a working Take without a verified natural-person binding. This blocked ordinary creation even though selection did not grant formal approval.

## Decision

Writer permits the project owner to choose a working Take without claiming a natural-person identity. Receipts preserve a missing identity as null; existing recorded identities remain valid and malformed claimed identities are rejected. The Host verifies the authenticated actor, browser session, source, candidate and idempotent receipt. Formal review and approval retain their separate identity requirements.

## Alternatives considered

**Inventing an identity or approval** would create false evidence. **Retaining the selection restriction** would keep the owner unable to finish an ordinary editing workflow.

## Consequences

Selection is available without an extra identity enrollment step. It does not approve content, change quality or spend budget. Existing receipts remain readable; owner-only access, stale-source rejection and original-receipt recovery still apply.
