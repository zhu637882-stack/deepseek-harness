# Agent Note: Qingmu machine-validated Stage artifact registration

Status: implemented

English | [中文](2026-08-28-qingmu-stage-artifact-registration.zh.md)

## Problem

Current IMAGO V6 Stage artifacts had a validated Core/backend contract but no existing Harness Host route. Forwarding an artifact without rerunning the current compiler and binding its exact bytes would let stale rules or browser-supplied authority cross the boundary. Retrying an uncertain registration would also risk a second business write.

## Decision

The existing IMAGO method adapter adds `stageArtifactMethod`. It accepts only business coordinates and one complete V6 Stage artifact, canonicalizes an input bounded to 1 MiB, derives a separate subject SHA, and invokes the real current Core compiler. Its Stage-only canonical JSON is a fixed point under Core's Python load/dump path for every accepted finite number, including fractions, exponent boundaries, and negative zero; non-finite numbers fail closed. The Host independently reads and hashes eleven fixed Core sources before and after compilation, reconstructs the selected Stage definition, rejects rule drift or forged compiler output, and signs only the verified registration projection with the existing Host-only HMAC key.

The existing Yimeng command adapter adds `registerStageArtifact` and `recoverStageArtifactRegistration`. Registration verifies the artifact, subject, current Stage definition and version, machine-validation result, rule hashes, projection SHA, and HMAC before one POST with explicit record CAS conditions. The outbound artifact uses the same Stage canonical bytes and must fit Yimeng's string-aware 64-level physical JSON nesting limit before transport. Actor, natural-person identity, and session remain Yimeng-authenticated facts. The receipt must retain the exact artifact and authenticated producer while every availability, dependency, approval, lock, plan, signoff, rework, and Provider authority flag remains false or zero. Successful Stage responses stay intact until full receipt validation, preserving legitimate business fields named `token`; the validated value then fails closed if any key or string contains the actual bearer credential. Non-success bodies and validation failures remain redacted or static.

An uncertain POST is never retried. Recovery uses only the original project, episode, Stage, scope, subject SHA, and idempotency key in a bodyless GET. It revalidates the original durable receipt without requiring today's artifact, HMAC key, or historical session. Harness adds no database or second business state machine.

## Alternatives considered

**Forward the artifact directly to Yimeng.** This would omit the current Core validation and independent rule-byte checks required by the planned compiler boundary.

**Treat machine validation as dependency verification or approval.** Registration establishes only that the exact artifact passed deterministic Stage validation. Dependency authority and an independent review remain later explicit checkpoints.

**Retry after a lost response.** Only the original receipt lookup can determine the first command's outcome without another write.

## Consequences

Focused tests cover exact request and receipt schemas, canonical artifact identity across ordinary decimals, exponent thresholds, and negative zero, the one-megabyte limit, current rule hashes, definition-version drift, forged compiler output, HMAC binding, record CAS, producer and session binding, business-token preservation, actual-credential reflection rejection, non-authority flags, malformed receipts, cancellation, and secret redaction. A real Cordis Loader/Connection/WebServer composition invokes the current Core compiler and an isolated Yimeng HTTP double. It deliberately loses the POST response, disables the Method plugin, rotates the HMAC key and bearer session, recovers the original receipt with one GET, reenables the plugin, and proves that no second POST occurs. The same composition proves that a 70-level Stage payload accepted by the real Core compiler is rejected before the Yimeng fetch because its serialized command exceeds the route's nesting limit.

This checkpoint adds no UI, dependency-authority decision, independent Stage approval, lock activation, LSU plan sealing, rework execution, Provider call, formal database mutation, deployment, or push.
