# Agent Note: Local reference qualification before selection

Status: implemented

English | [中文](2026-08-31-qingmu-local-reference-qualification.zh.md)

## Problem

A local reference candidate with a saved rights knowledge record still lacked the source revision and integrity evidence required by the existing reference-selection transaction. Filling Provider formal-consistency fields would invent evidence, while selecting directly from an upload would bypass the canonical gate.

## Decision

The existing candidate service exposes one authenticated, owner-scoped qualification command. Yimeng rereads the immutable upload receipt, current materialized bytes, exact asset SHA, current element revision/snapshot, and current rights-record SHA in one Store transaction. It writes a deterministic local source revision, a `local_reference_integrity` consistency check, a versioned qualification envelope, and the existing ChangeSet/outbox/receipt records. The result remains local-only: rights are recorded but unverified, formal consistency is false, visual judgment is absent, Provider calls are zero, and the candidate stays `Unselected` and unapproved.

The cockpit presents qualification as a separate explicit action. Unknown results retain only immutable recovery coordinates and use GET-only receipt recovery. A qualified candidate may enter the existing IMAGO preview and authenticated Yimeng `selectReferenceAsset` commit, which rechecks the upload receipt, bytes, qualification identity, rights SHA, revision, and snapshot. Actor identity and other existing selection blockers remain authoritative.

## Alternatives considered

**Populate Provider formal-consistency identifiers locally.** Those identifiers would falsely claim a model or formal checker ran. Local integrity uses its own qualification kind and keeps formal consistency false.

**Select immediately after upload or rights entry.** Upload, rights knowledge, qualification, selection, and content approval are distinct decisions. Each remains visible and independently recoverable.

**Store qualification in the browser or a sidecar file.** That would create a second authority and break restart recovery. The existing Yimeng transaction ledger remains the sole mutable truth.

## Consequences

Local PNG/JPEG/WebP candidates can now become technically eligible for explicit reference selection without a Provider call. Byte, rights, revision, or snapshot drift fails closed; duplicate intent produces one check and one receipt; rollback leaves neither partial database evidence nor a selected asset. This does not verify legal rights, visual identity, formal consistency, PromptIR readiness, generation quality, or human content acceptance.
