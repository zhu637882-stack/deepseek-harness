# Agent Note: Qingmu prop method attestation

Status: implemented

English | [中文](2026-08-26-qingmu-prop-method-attestation.zh.md)

## Problem

The prop ChangeSet browser path could forward an IMAGO method projection, but Yimeng had no cryptographic proof that the projection was validated by the current Host compiler for the exact authority snapshot and subject.

## Decision

The IMAGO Host adapter reads one raw, untrimmed, environment-only `QINGMU_IMAGO_ATTESTATION_KEY` with a minimum of 32 UTF-8 bytes. After compiling canonical snapshot JSON and validating the returned projection, it signs an exact HMAC-SHA-256 envelope binding the canonical projection, input snapshot, and subject hashes. The key is removed from the compiler child environment and never enters Cordis config, browser data, logs, or errors.

The Client validates only the exact public proof shape and lowercase 64-hex fields, then forwards the projection, projection hash, and proof unchanged. The command adapter rechecks canonical projection, input, and subject bindings and rejects malformed proofs before loopback forwarding. It does not access the signing key; Yimeng remains responsible for authoritative verification and business mutation.

## Alternatives considered

- Signing in the browser was rejected because it would expose server authority and signing material to untrusted Client code.
- Forwarding an unsigned projection hash was rejected because it would not prove which trusted Host validated the bound snapshot and subject.

## Consequences

The prop method projection is now cryptographically bound across the existing Host-to-browser-to-Yimeng request contract without granting generation, selection, paid Provider, human-signoff, Core mutation, or production-state authority. The same proof now covers actor and scene through the later [element profiles and exact impact decision](2026-08-27-qingmu-element-profiles-and-impact.md). Key rotation, production rollout, and Phase 3 completion remain outside this decision.
