# Agent Note: Qingmu Ready-bound production Take bridge

Status: implemented

English | [中文](2026-09-02-qingmu-production-take-bridge.zh.md)

## Problem

The Director workspace could prepare and select a Ready PromptIR, but it had no continuous, authority-preserving path from that exact Shot through the current IMAGO method to the Writer's production-Take record. Letting the browser assemble PromptIR lineage, Provider routing, or ownership fields would create a second authority and make response loss, refresh, and Host restart unsafe.

## Decision

The browser sends only exact project, episode, storyboard, Shot, Take kind/ordinal, and an explicit Ready confirmation. It never sends owner, Ready, selection, approval, force, Provider, model, route, credentials, attestation material, or Writer lineage.

The Host rereads the current Ready PromptIR and first-frame quote, invokes the current PromptIR method with the five-field Ready base plus a legal no-op `videoGenPrompt` candidate, and accepts only the signed `qingmu.imago-prompt-ir-method-adapter-result.v1` projection. It verifies the projection digest and HMAC, exact D/E field order, independent stage contracts, director cards and source bindings, field hints, empty warnings, and the zero-execution boundary. Any drift fails before the Writer request.

Only then does the Host construct the Writer's exact nine-field request. One deterministic idempotency key binds project, episode, Shot, and Take ordinal. Replaying after a double click, lost response, browser refresh, or Writer service restart therefore asks Writer for the same semantic command, and the Host accepts only a fully matching server receipt. Take 1 is `initial`, Take 2 is `targeted_rework`, the UI keeps Take 3 unavailable, and a forged Take 3 intent reaches the Writer so its durable cap remains the final rejection authority.

The UI stores a bounded non-secret recovery marker before the request and a validated Writer receipt after success. A queued task is labelled queued, never generated. Production failure leaves the five-field manual Director editor available.

## Alternatives considered

**Send the full Writer request from the browser.** Rejected because stale PromptIR, quote, reference, or route data would become browser authority and sensitive control fields would cross the RPC boundary.

**Generate a random idempotency key for every click.** Rejected because response loss and restart could create another Take instead of recovering the existing server record.

**Treat the existing UI method check as sufficient.** Rejected because browser-held method output can be stale or tampered with; the Host must invoke and attest the current projection at the write boundary.

## Consequences

The workspace now provides one continuous technical path from the canonical Shot and current Ready PromptIR to at most two Writer-owned production Take records, with deterministic recovery across process boundaries. The extra Host rereads and strict method verification can block a request when any upstream authority changes; that is intentional. This slice does not call a Provider, start a worker, migrate production data, approve content, select a Take, prove generated media, or perform human signoff.
