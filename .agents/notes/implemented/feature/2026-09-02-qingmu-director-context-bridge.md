# Agent Note: Qingmu director context session bridge

Status: implemented

English | [中文](2026-09-02-qingmu-director-context-bridge.zh.md)

## Problem

A DSh director session had no durable identity tying it to the Yimeng project, episode, scene, shot, and exact context snapshot that opened it. Process recovery or UI object switching could otherwise reuse an advisory proposal outside its original context.

## Decision

One private experimental package owns a whole-value, log-only session event. Its latest snapshot contains only the four Yimeng object coordinates, `contextSnapshotSha256`, and the existing command-adapter proposal freshness hashes. A pure session projection exposes that value for a future UI mount.

The bridge rereads context through an injected read-only port backed by the existing normalized `director-inference/context` path. Entering a different object or observing a new context SHA writes a complete replacement state and clears the previous proposal. Cold recovery replays the same event log before the read. An unavailable context or model capability returns an explicit non-blocking result and keeps manual work allowed.

Per-session operation generations and a binding-event compare-and-swap prevent late entry or recovery reads from overwriting a newer object. The persisted state schema also rejects any proposal whose object coordinates or context SHA differ from the active binding.

## Alternatives considered

**A second binding database or ledger.** Rejected because DSh already has a durable append-only session log and Yimeng must remain the sole business truth.

**Putting binding text into chat history.** Rejected because operational identity must not become model-visible prompt context or consume tokens.

**Creating a proposal during recovery.** Rejected because the existing proposal command also creates a replay work order. Recovery needs only the existing read-only context path and must perform zero business writes.

## Consequences

Session identity survives restart, object switches cannot inherit a proposal, and context SHA drift invalidates the old proposal automatically. The package adds no prompt store, Provider route, cost ledger, business write, approval, selection, Ready grant, or human-signoff inference. Actual cockpit mounting remains a separate slice that supplies the existing read adapter port.
