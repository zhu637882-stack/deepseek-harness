# Agent Note: Keep RC1 evidence, content review, and release signoff separate

Status: implemented

English | [中文](2026-09-01-rc1-content-review-authority.zh.md)

## Problem

A canonical evidence package proves machine facts, but it cannot express the project owner's creative judgment of the final episode. Reusing organizational release signoff for that judgment would merge three authorities and make an automated machine package look like human content acceptance.

## Decision

Writer owns one immutable episode-level final-content-decision journal. A natural-person project owner can accept the current final or return it for changes only after the decision request binds the current final asset, materialized bytes, strict verification, RC1 package, manifest, release-authority revision, and full-playback review. Acceptance additionally requires named picture, audio, and continuity checks plus a second explicit confirmation.

The RC1 package is a separate canonical evidence freeze and never inherits the existing Pre-RC package identity. Release readiness projects the content decision independently and blocks organization release signoff until the current binding is accepted. The existing production final-acceptance endpoint bridges into the same journal when RC1 exists, so it cannot create a competing acceptance authority.

The Host proxies only strict authenticated status, decision, media, and evidence contracts. Media and ZIP reads revalidate current IDs and SHA values and support byte ranges. Ambiguous writes recover the original receipt instead of submitting a second decision. The cockpit presents machine evidence, personal content review, and organization signoff as three distinct cards; automation may submit a rejection but never an acceptance.

## Alternatives considered

**Treat RC1 evidence as content acceptance.** Rejected because deterministic package integrity cannot prove creative review or natural-person intent.

**Store acceptance in Harness or browser state.** Rejected because Writer owns project identity, immutable business decisions, receipts, and release authority.

**Reuse organization release signoff as the content decision.** Rejected because organizational authorization and the project owner's episode judgment have different actors, evidence, and consequences.

## Verification

Focused Writer tests pin owner and natural-person authorization, exact source binding, full playback, named checks, idempotent recovery, release-readiness blocking, and the legacy acceptance bridge. Host and UI tests pin strict schemas, Range forwarding, one-write recovery, the three-card presentation, and the rule that automation never accepts. The isolated browser path uses actual FastAPI and a built Host without Provider calls or user-instance writes.

## Consequences

RC1 machine integrity, human episode judgment, and organizational release authorization remain independently auditable. Acceptance is recoverable and cannot silently survive source drift. This adds a deliberate human gate before release signoff and does not claim publication, organization approval, or final product completion.
