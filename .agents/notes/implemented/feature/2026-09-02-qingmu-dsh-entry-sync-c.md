# Agent Note: Qingmu DSh default entry and save sync

Status: implemented

English | [中文](2026-09-02-qingmu-dsh-entry-sync-c.zh.md)

## Problem

The local DSh entry opened a generic Harness surface with the Qingmu cockpit closed. Scene planning could start from an implicit first project or episode, and a successful save inside the iframe did not tell the outer six-stage surface which exact scene and Shot to refresh and locate.

## Decision

An embedded entry is valid only when its URL supplies an exact project and episode. The cockpit opens directly on Director, and canonical hydration plus every save/recovery check retains the full project, episode, scene, Shot, storyboard, context, and method scope. Missing or mismatched scope fails closed; no collection index is an identity fallback.

Scene-planning replay remains an advisory rehearsal. Per-item adoption still passes through the existing freshness check, diff preview, explicit confirmation, receipt recovery, and authoritative reread. Manual editing follows the same save path and remains available.

After the authoritative reread and a fresh director-context rebind prove the saved scope, the iframe posts `deepseek.dsh.qingmu-scene-planning-saved.v1` to one validated loopback parent origin. The whole-value message includes a stable event ID, exact object coordinates, post-save context SHA, receipt, locate target, and either manual authority or the complete method-bound adoption proof. The outer Host can deduplicate the event, refresh its canonical projection, and locate the same scene and Shot.

A bounded non-secret `localStorage` outbox keeps only the latest notification for the exact project and episode. Reload or process restart may replay it only after the current session binding matches both its object coordinates and context SHA. Invalid storage, stale context, late results, cross-scope messages, top-level use, untrusted origins, or conflicting referrer and ancestor origins fail closed. No wildcard target origin is used.

## Alternatives considered

**Refresh only the iframe.** Rejected because the outer six-stage surface would remain stale and could point at a different Shot.

**Trust `document.referrer` alone.** Rejected because an outer referrer policy may legitimately clear it. The browser's read-only ancestor origin is accepted as a fallback, but disagreement between two available sources is rejected.

**Publish immediately after POST success.** Rejected because an unknown response must first recover its original receipt, and either outcome still needs an authoritative reread plus current context binding before it can identify the saved object.

## Consequences

Opening an exact local Qingmu entry lands on the bound Director workspace. Manual and adopted saves can refresh and locate the outer surface without inventing a second business record, while duplicate delivery and restart recovery remain safe. The message is notification-only: it grants no Provider, cost, approval, selection, Ready, release, or human-signoff authority. The production outer receiver remains owned by its separate Writer slice; Harness browser coverage uses a contract-faithful receiver to prove this boundary end to end.
