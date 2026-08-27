# Agent Note: Qingmu explicit production-unit scope bindings

Status: implemented

English | [中文](2026-08-28-qingmu-production-unit-bindings.zh.md)

## Problem

Rework preparation needs an explicit relationship between an existing Yimeng shot group and a production unit. A display frame number, a Finding, or the order of a list cannot create that relationship. An uncertain write also needs its original receipt without resubmission.

## Decision

The existing read plugin exposes Yimeng's native group sources and current or historical bindings. Canonical frame IDs remain authoritative; sparse display numbers are preserved. The method plugin rereads the selected group, compiles the current stateless IMAGO method, verifies the fixed nine rule sources and the current definition, then rereads source and rules before attesting them. Browser input contains only project, episode, and group coordinates.

The command plugin sends one explicitly requested binding with source SHA and binding-revision/SHA compare-and-swap. Yimeng owns the existing ChangeSet, outbox, and receipt transaction. Unknown POST results are not retried. Recovery is GET-only against the original group, unit, source SHA, and idempotency key; an old receipt does not require today's method signing key or original login token. Yimeng still enforces current authorization and the original actor.

These are extensions of the three existing plugins, not another runtime or ledger. Missing read capability disables method preparation. A scope binding does not seal a production plan, create an executable workset, approve a stage or content, release locks, execute rework, or call a Provider.

## Alternatives considered

**Infer units from frame numbers or Findings.** That would manufacture a production scope without an explicit native group and owner action. The existing group and its canonical frame IDs are required.

**Retry a lost POST with a new command.** That loses the original transaction boundary. The separate recovery endpoint checks only the frozen command coordinates.

**Create a parallel IMAGO project state.** The integration needs method evidence, not a second owner of business progress. IMAGO remains stateless here and Yimeng retains the binding transaction.

## Consequences

Host tests cover malformed contracts, Unicode, source and method drift, stale compare-and-swap, historical recovery, cancellation, timeouts, and bounded responses. A real Loader/Connection test uses current Core and an isolated HTTP upstream to exercise a lost write response, original receipt recovery, and read-plugin removal/restoration. The HTTP upstream is a test double, not a production database. Separate Core/Yimeng temporary-SQLite evidence covers the backend transaction.

The browser surface and the use of this binding in rework details are the next slice. No production activation, fee, human signoff, deployment, or push is implied by this Host checkpoint.
