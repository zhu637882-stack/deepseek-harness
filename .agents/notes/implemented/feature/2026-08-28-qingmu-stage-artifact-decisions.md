# Agent Note: Qingmu exact Stage artifact decisions

Status: implemented

English | [中文](2026-08-28-qingmu-stage-artifact-decisions.zh.md)

## Problem

Machine-validated Stage artifact registration deliberately grants no business authority. The E5-5 checkpoint still needed an independent natural-person decision bound to the exact current record and a fail-closed answer when upstream artifacts, locks, rules, or hashes drift. That authority could not be duplicated in Harness without creating a second production state machine.

## Decision

The existing Yimeng command adapter adds `commitStageArtifactDecision` and `recoverStageArtifactDecision` to the Stage artifact route family. A decision request accepts one explicit `approve`, `reject`, or `request_changes` intent and reason, the exact current artifact-record revision/SHA, artifact revision/SHA, subject SHA, and complete exact artifact. It rejects caller-supplied method fields. The trusted Host invokes the currently loaded `stageArtifactMethod` capability, verifies the current definition, rule digest, subject and record bindings, projection SHA, and Host-only HMAC proof, then forwards one POST. It never accepts browser-supplied actor, role, natural-person identity, or session fields.

Yimeng remains the sole authority. Its authenticated transaction derives the reviewer and session, requires the configured project approver feature, proves that producer and approver are different natural people, and binds the decision to the immutable registered record. It recomputes the current approved upstream records and exact approval/lock-event SHAs. Any source, rule, dependency, lock, record, artifact, revision, or SHA drift fails closed. Only an approval with a verified dependency snapshot can make the exact artifact available and activate the lock declared by the registered Stage definition. `reject` and `request_changes` grant no availability or lock authority.

Each target's append order is protected by a hashed, contiguous `decisionOrdinal`, so database row order or clock rollback cannot resurrect an earlier approval. `probeStageArtifactAuthority` accepts the exact record and artifact, then the trusted Host internally invokes the currently loaded Method capability and carries only that fresh proof to Yimeng's read-only `/authority-probe`. Yimeng recomputes rules, dependencies, and locks under that proof and returns a compact current-authority result. Harness verifies the exact lock against the current Stage definition. The ordinary artifact GET is historical only and fails closed without fresh signed rules.

The durable decision and command receipt reuse Yimeng's existing ChangeSet, domain-outbox, and command-receipt ledgers. No table, schema migration, DAG, or second business state machine is added. Harness validates the returned authority claims but neither computes nor persists them. Plan sealing, inferred human signoff, rework execution, and Provider calls must remain false or zero.

An uncertain decision POST is never retried. Recovery uses only the original Stage coordinates, artifact-record revision/SHA, and idempotency key in one bodyless GET to `/decision-command-receipt`. Harness revalidates the original exact receipt without requiring today's HMAC key or the historical bearer session.

## Alternatives considered

**Compute dependency and lock authority in Harness.** This would turn the plugin control plane into a competing production truth and violate Yimeng ownership.

**Treat Stage artifact registration as approval.** Machine validation proves only deterministic structure and method compliance; it cannot replace an independent authenticated natural-person decision.

**Retry a decision after a lost response.** The original receipt lookup is the only safe way to determine the first command's outcome without another business write.

## Consequences

Focused adapter tests cover exact schemas, all three decisions, self-approval rejection, trusted current-Method execution, historical-proof replay rejection, canonical exponent numbers, HMAC bindings, verified dependency snapshots, exact declared-lock output, current-authority probes, fail-closed field and lineage mutations, credential reflection, and GET-only recovery. A real Cordis Loader/Connection/WebServer composition invokes the current Core compiler, sends registration, decision, and authority-probe requests to an isolated Yimeng HTTP double, proves decision and probing fail closed while the Method capability is disabled, deliberately loses the decision response, rotates the HMAC key and bearer session, and recovers the original receipt while proving that no second decision POST occurs. Yimeng service and API tests cover durable three-ledger integrity, independent natural people, protected decision ordering under clock and row-order mutation, current rules/upstream/lock authority, drift invalidation, idempotency, and read-only recovery.

This checkpoint adds no UI, LSU plan sealing, rework execution, automatic name mapping, second DAG, Provider call, formal database migration, deployment, or push.

---
