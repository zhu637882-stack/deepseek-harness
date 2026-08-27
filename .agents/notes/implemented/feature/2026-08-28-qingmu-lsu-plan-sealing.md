# Agent Note: Qingmu complete-scope LSU plan sealing

Status: implemented

English | [中文](2026-08-28-qingmu-lsu-plan-sealing.zh.md)

## Problem

Production Unit bindings and independently approved C5F blueprint locks were already durable Yimeng facts, but E5-5 still lacked one exact complete-scope LSU production-plan seal. Treating individual bindings, a historical receipt, or a Harness-local snapshot as current plan authority would allow partial scope or stale rules to enter the production pipeline and would create a second business truth outside Yimeng.

## Decision

The read adapter adds `lsuPlanSource`. It accepts only project and episode coordinates plus the Host-derived current C5F lock-rule SHA, then performs one authenticated body-free GET. The exact non-empty subject contains the sorted current Production Unit bindings and the independently approved `PRODUCTION_BLUEPRINT_LOCK` lineage. Historical seals remain visible evidence, but only a complete subject and rule-generation match may be reported as current.

The Method adapter adds `lsuPlanMethod`. The trusted Host reconstructs the current Production Unit and lock rules, derives the lock-rule SHA, reads the exact Yimeng source, invokes the current Core `scripts/compile_qingmu_lsu_plan_method.py`, then reads the source and all rules again. Subject, binding, blueprint-lock, file-byte, rule-hash, or definition drift fails closed. The Host independently validates the compiler projection and signs it with the existing server-only HMAC key. The Method is stateless and grants only permission to attempt the explicit Yimeng transaction.

The command adapter adds `sealLsuPlan`, `recoverLsuPlanSeal`, and `probeLsuPlanAuthority`. A seal intent contains only the coordinates, expected current subject SHA, previous plan revision/SHA CAS pair, and one visible-ASCII idempotency key. Caller-supplied Method, actor, natural-person identity, session, approval, and lock claims are rejected. The trusted Host invokes the currently loaded Method capability, validates its complete subject, definitions, rule generations, projection SHA, and HMAC, and sends exactly one POST to Yimeng.

Yimeng remains the sole business authority. Its authenticated transaction rechecks the complete current Production Unit scope and approved C5F blueprint lock, performs CAS, and persists the result in the existing ChangeSet, domain-outbox, and command-receipt ledgers. The receipt grants only `planSealed: true`; it creates no Stage approval, lock activation, rework, Provider call, inferred human signoff, or second DAG.

An uncertain POST is never retried. Recovery uses the original subject SHA, plan CAS coordinates, and idempotency key in one bodyless GET and does not require today's Method key or historical bearer session. The current-authority probe always invokes a fresh Method before asking Yimeng whether the latest historical seal still matches today's complete subject and both rule generations. Ordinary reads and old receipts never grant current authority.

## Alternatives considered

**Seal each Production Unit independently.** That cannot prove that the full episode scope and the approved blueprint lock were sealed as one atomic plan generation.

**Store the authoritative plan in Harness.** This would duplicate Yimeng's business state and turn the plugin control plane into a competing production truth.

**Accept a historical Method or retry after a lost response.** Either choice can revive stale rules or append a second business write. Fresh compilation and receipt-only recovery preserve the original transaction boundary.

## Consequences

Focused adapter tests cover exact request and response schemas, non-empty sorted scope, canonical hashes, rule and source drift, Host HMAC bindings, CAS coordinates, once-only POST behavior, credential reflection, GET-only recovery, and fresh current-authority probing. A real Cordis Loader/Connection/WebServer composition invokes the current Core compiler, uses only an isolated Yimeng HTTP double, deliberately loses the seal response, disables and restores the Method capability, rotates the HMAC key and bearer token, recovers the original receipt without a second POST, and then performs a fresh authority probe.

This checkpoint adds no UI, Stage instance, Stage approval, lock activation, rework execution, Provider call, worker, inferred signoff, formal database migration, deployment, or push.

---
