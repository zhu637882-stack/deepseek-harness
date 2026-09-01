# Agent Note: Close the editorial handoff package trust chain

Status: implemented

English | [中文](2026-09-01-editorial-handoff-package-trust-chain.zh.md)

## Problem

An editorial handoff package could bind its outer archive digest while leaving individual archive entries implicit, and its one-use Host capability did not carry the Writer-authenticated user identity. A login switch could therefore reach an old capability, while a native OTIO consumer had no package-level proof that every declared media byte and timeline entry matched the manifest. Storyboard scene identifiers and dialogue-media kinds also needed exact authoritative binding before export.

## Decision

Yimeng projects each shot against a canonical scene owned by the current project and rejects dangling or cross-project scene identifiers. Dialogue media must declare an `audio/*` media type; media de-duplication includes the semantic media kind.

The manifest declares the exact non-manifest ZIP entry set. Every timeline, unresolved-data, video, and dialogue-audio entry carries its path, kind, byte size, and SHA-256. After writing the deterministic ZIP_STORED archive, Yimeng independently reopens it, rejects missing, extra, and duplicate names, verifies every declared entry, and parses and round-trips the timeline through the direct native OpenTimelineIO 0.18.1 `opentimelineio.adapters.otio_json` API with the fixed 0.18.1 schema map. The HTTP response still binds the complete archive with its outer size and SHA-256.

The Host obtains the active user from Yimeng's authenticated `/api/auth/me` response and includes that server-authored identity in the private persisted capability binding. Browser query parameters contain no user identity or Writer token. A different active login receives a forbidden response without consuming the capability; the original user can recover its terminal status after Host restart.

## Alternatives considered

**Trust the browser to report its current user.** Rejected because a browser-provided identifier is a second identity source and can be forged independently of the Writer JWT.

**Rely only on the complete ZIP digest.** Rejected because the manifest would not define the native editor's exact expected inputs or reject undeclared archive members independently.

**Use the generic OpenTimelineIO adapter registry.** Rejected because ambient plugin manifests and adapter selection can change resolution. The direct native adapter is the intended interoperability contract.

## Verification

Focused Writer tests cover internal timeline and unresolved-data tampering, missing, extra, and duplicate entries, direct native adapter use under polluted plugin environment variables, scene scope, dialogue media type, and kind-aware collisions. Host tests cover Writer-authenticated user binding, login switching without capability consumption, restart recovery, and private token handling. The isolated FastAPI, built Host, and Chromium path downloads a package, parses it with the native adapter, rejects an internally tampered copy, and exercises login-switch recovery without external requests or business writes.

## Consequences

The package can be handed to an OpenTimelineIO 0.18.1 consumer with an explicit entry inventory and two-level integrity binding. Existing capabilities written before the authenticated-user field fail closed instead of being silently upgraded. Media magic validation remains a bounded container check rather than full decode, and ancestor-directory replacement remains outside this change.
