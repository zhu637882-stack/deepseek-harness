# Agent Note: Qingmu zero-fee cost rehearsal

Status: implemented

English | [中文](2026-08-28-qingmu-cost-rehearsal.zh.md)

## Problem

E6-2 must show a small production team the estimate, proposed budget hold, and their difference before any paid operation. The preview must use the selected Shot and E6-1 capability evidence without turning Harness into a second duration, pricing, budget, reservation, or workflow authority. Gate A cannot submit work, write a formal ledger, call a Provider, or imply that paid production is authorized.

## Decision

Yimeng remains the sole owner of authoritative frame duration, model-catalog pricing, candidate limits, and the read-only ProviderGate budget projection. A protected GET binds one project, episode, canonical frame, model, capability, controls, resolution, candidate count, and the exact catalog, request, preflight, and capability snapshot SHA-256 values from E6-1. Harness also carries the complete freshly Host-validated E6-1 catalog projection across the browser-to-Host call so the Host can revalidate its canonical bytes and independently derive eligibility, price, and candidate limit before accepting the E6-2 receipt. Yimeng calculates all money in integer micro-CNY, returns an RFC 8785 JCS content-addressed receipt, and exposes only the existing global budget window. Project and episode quotas remain explicitly `NOT_CONFIGURED`.

The reservation is only a proposal. Formal reservation ID is `null`; formally reserved money, released money, database writes, and budget-ledger writes are zero. Actual cost is unavailable before submit. Provider calls, task creation, queue entry, submit, poll, download, webhook registration, and paid-generation authority are all fixed to zero or false. No persistence or second state machine is added.

The existing Qingmu read adapter independently validates exact fields, identities, E6-1 SHA bindings, eligibility, subject identity, candidate limit, integer formulas, budget arithmetic, differences, and the final JCS receipt. Any authority drift fails closed. The cockpit performs the rehearsal only after an explicit click and a fresh filtered capability preflight. It displays estimate, proposed hold, formal zero, unavailable actual cost, global budget, unconfigured quotas, blockers, and receipt SHA, with no reserve, generate, or submit control.

## Alternatives considered

**Compute cost in the browser.** Browser duration, rate, or budget state could be stale and would create an authority that Yimeng cannot audit. The browser only renders the validated receipt.

**Create a Harness reservation ledger.** That would be a second financial truth and a second recovery problem. Harness stores no reservation or budget state.

**Perform a real reservation during Gate A.** A durable hold is a formal write and requires exact Gate B authorization. E6-2 reports only what would be proposed.

## Consequences

The team can inspect a deterministic maximum estimate and whether the same amount would fit the current global budget window without spending money or creating work. The estimate-to-proposal difference is zero by contract; the estimate-to-formal-reservation difference remains the estimate because nothing has been reserved. Actual-versus-proposal and refund values remain unknown until a future authorized submit lifecycle exists.

Backend tests exercise authentication, immutable frame duration, snapshot drift, malformed declared candidate limits, one-micro and half-micro integer rounding, JSON-safe overflow, budget identities, budget blockers, and zero side effects. Adapter hostile tests change eligibility, rate, candidate limit, dependent estimate/reservation/difference fields, or budget arithmetic and then recompute the final JCS SHA; the Host still rejects them against the canonical E6-1 catalog or budget identities. Client tests cover explicit interaction, absent Shot, exact-catalog errors, and a deferred older-frame request that resolves after a newer receipt but cannot replace it. Real Loader/Connection and Chromium coverage uses an isolated loopback Yimeng double to prove two authenticated GETs after the click, no upstream POST, the shipped Qingmu overlay, desktop/mobile rendering, and keyless ARIA output. The double is not a production database or Provider.

These checks do not create or authorize a real reservation, paid Provider call, formal database write, task, queue, submit, poll, download, webhook, deployment, release, human signoff, ProviderGate change, model-route change, or push.

## Verification boundary

This closes only the bounded-local E6-2 zero-fee rehearsal. Production status remains `UNVERIFIED_FOR_PAID_PRODUCTION`. A future formal reservation must enter the plan's Gate B with exact authorization and evidence; it cannot inherit authority from this receipt.
