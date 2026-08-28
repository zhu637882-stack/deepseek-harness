# Agent Note: Qingmu offline Gate A control evidence

Status: implemented

English | [中文](2026-08-28-qingmu-gate-a-control-evidence.zh.md)

## Problem

E6-3 must prove at-most-once submission, `submission_unknown` quarantine, reconciliation, and poll/download recovery before any real Provider or production database is allowed. The proof must remain tied to the exact Yimeng implementation that produced it. Harness must make this evidence usable by a small production team without becoming a second fault-injection runner, task reconciler, workflow, or authority source.

## Decision

Yimeng owns one content-addressed `jason.qingmu-provider-gate-a-control-evidence.v1` receipt produced by its offline runner against temporary SQLite and a scripted Fake Provider with network egress disabled. The receipt records eight exact scenarios: unauthorized blocking, duplicate acknowledgement replay, payload-SHA conflict, unknown-submission quarantine, simulated reconciliation, poll recovery, download-timeout recovery, and truncated-download rejection. It binds the source files and their SHA-256 values that implement those controls.

The Qingmu read adapter adds one protected, body-free GET projection. It accepts only an empty RPC payload and independently validates the exact schema, scenario order, per-scenario assertions, source-path ordering, source hashes, environment, zero-authority counters, and RFC 8785 JCS evidence SHA. Any field or authority drift fails closed before data reaches the browser.

Generation & QC lazily renders the validated receipt as a read-only card. It separates offline pass status from unverified real paid production, shows all scenarios and required zero counters, and exposes source/evidence hashes for inspection. Its only control reloads the receipt; it cannot run fault injection, submit, reconcile, reserve, generate, approve, or infer signoff.

## Alternatives considered

**Render Yimeng JSON directly.** That would omit the independent Host boundary and allow stale or authority-bearing fields to reach the browser. The adapter instead checks the complete exact contract.

**Run fault injection from the browser.** That would duplicate a safety-critical runner and expose execution controls in the user surface. The browser only reads a previously generated, source-bound receipt.

**Expose submit or reconciliation actions beside the evidence.** That would make an offline Gate A proof appear to grant production authority. No such command exists in this slice.

## Consequences

The team can see that the bounded offline control suite passed, including zero duplicate paid submissions and zero unknown-state automatic resubmissions, while the UI continues to state that real paid production is unverified. Source drift invalidates the receipt instead of silently preserving a pass.

Adapter tests cover the valid receipt, exact protected GET, empty-payload rule, and hostile authority drift with a recomputed evidence SHA. Client tests cover all scenarios and zeroes, reload, failure, and late-response cancellation. Real Loader/Connection and Chromium coverage proves the shipped Qingmu composition sends one authenticated GET with an empty RPC payload, exposes only the reload control, has no upstream POST, and remains usable on desktop and mobile. All tests use an isolated loopback double; they do not call a real Provider.

These checks do not create or authorize a paid Provider call, formal reservation, production database or budget-ledger write, task, queue, submission, real reconciliation, deployment, release, human signoff, ProviderGate change, model-route change, push, or production claim.

## Verification boundary

This closes only E6-3 Gate A control-logic evidence in the bounded offline environment. `PASSED_CONTROL_LOGIC_ONLY` does not become a production pass. Real paid production remains `UNVERIFIED_FOR_PAID_PRODUCTION` until a later plan gate receives its own exact authorization and evidence.
