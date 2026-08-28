# Agent Note: Qingmu capability snapshot preflight

Status: implemented

English | [中文](2026-08-28-qingmu-capability-snapshot-preflight.zh.md)

## Problem

The generation workspace needs one inspectable account of model inputs, outputs, geometry, consistency controls, mutual exclusions, cost declarations, and runtime scope before any production request is possible. Harness must not hard-code vendor capability truth or create a second catalog, and an undeclared mutual-exclusion policy must not be interpreted as permission.

## Decision

Yimeng remains the only owner of model-catalog truth. Its read-only capability projection converts the selected catalog profile into immutable RFC 8785 JCS snapshots with content-addressed SHA-256 identities. It may evaluate explicitly supplied model, capability, and control requirements without dispatching work. Missing declarations remain visible declaration errors, and every result is marked `UNVERIFIED_FOR_PAID_PRODUCTION`; the projection reports zero Provider calls, zero database writes, and no paid-generation authority.

The existing Qingmu Yimeng read adapter adds one protected loopback endpoint. It independently recompiles normalized snapshots with RFC 8785, rejects non-canonical bytes even when their hashes are recomputed, and recalculates eligibility from the echoed dry-run request and normalized declarations. It also verifies one preflight SHA binding the catalog, request, item IDs, and decisions before returning typed data to the browser. It does not copy model facts into Harness or IMAGO.

The existing production cockpit displays this projection at the start of Generation & QC. It exposes catalog profile and SHA, one card per model, declaration gaps, mutual-exclusion rules, snapshot SHA, runtime scope, cost declarations, and a zero-authority receipt. The only control is a read refresh. The surface cannot reserve, submit, select, approve, sign off, or change routing.

## Alternatives considered

**Hard-code model facts in the browser.** This would drift from Yimeng and turn Harness into a second business truth. The browser renders only the validated Yimeng projection.

**Store another catalog in Harness or IMAGO.** That would introduce a second ownership surface and an avoidable reconciliation problem. IMAGO methods may consume a frozen snapshot later, but neither layer owns the source declaration.

**Treat missing mutual exclusions as unrestricted capability.** Absence is not evidence of compatibility. The projection keeps the model unverified and displays the missing declaration.

## Consequences

Backend tests use a temporary catalog to prove deterministic cross-runtime snapshot identities, an explicit conflicting-control rejection, a real FastAPI authentication boundary, malformed-declaration rejection, and zero side effects. They also prove that the current undeclared production catalog remains incomplete instead of receiving invented rules. Adapter tests reject recomputed non-canonical bytes, forged eligibility with a matching forged preflight hash, request drift, authority drift, identity drift, malformed controls, and non-loopback access.

Client tests cover display, refresh, adapter rejection, cancellation, and cockpit integration. A real Loader/Connection and Chromium composition uses an isolated loopback Yimeng double to prove the shipped Qingmu overlay, authenticated GET-only request, visible mutual-exclusion rule, version hash, desktop/mobile layout, and keyless ARIA snapshot. The double is not a production Provider or database.

These checks do not authorize paid generation, validate a live provider account, change ProviderGate or model routing, approve content, deploy production, or push a branch.

## Verification closure

The repository-owned generator now records all 309 current explicit Yimeng backend routes. The external Qingmu Harness routes use exact method-and-path entries rather than a namespace wildcard, and metadata overrides fail closed on unknown fields or missing backend routes. Both normal and complete registry checks pass; the focused Yimeng suite passes 24 tests, the full frontend contract suite passes 309 tests, and the frozen dependency lock remains current. Independent review reports PASS with P0 through P3 all zero.

This closes only the bounded-local E6-1 capability-catalog slice. E6-2 estimation, reservation, and difference handling remain separate work; no queue, submit, poll, download, webhook, live Provider, fee, production database, or load-bearing routing change is implied.
