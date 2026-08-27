# Agent Note: Qingmu read-only continuity evidence

Status: implemented

English | [中文](2026-08-27-qingmu-continuity-delta.zh.md)

## Problem

A historical continuity check may pass while the selected video, tail frame, or next first frame has changed. Showing that check as approval of the current Shot chain would erase its source boundary. Missing dimensions also cannot become failures or formal Findings.

## Decision

Yimeng owns the optional `director.continuityDelta` workflow projection. The read adapter validates its canonical adjacent Shot order, source revision, snapshot hash, current asset bindings, original audit declarations, and derived readiness. An audit SHA without its original asset ID remains historical evidence but cannot establish readiness.

`continuityMethod` accepts only project, episode, and selected Shot IDs. The Host rereads the existing configured `qingmuYimengRead` capability and passes a bounded snapshot to the stateless Core compiler. It verifies exact input and source hashes, fourteen local rule-file hashes, incoming/outgoing pairs, failure candidates, and the non-executing boundary. No new upstream configuration, project database, or HMAC grant is introduced.

The existing shared Shot selection drives the continuity panel. It separates current bindings, historical checks, missing evidence, and four recorded dimensions. Only explicit false dimensions become candidates; severity, earliest owner, and timecode remain null pending attribution. Six lock definitions and five rework rules are method templates, not project lock instances or executable tasks. Refresh, source failure, close, and Shot changes invalidate prior responses.

## Alternatives considered

**Treat the latest passing check as current approval.** The audit must match actual selected assets and the selected-video lineage. Historical success is retained without granting present readiness.

**Infer formal Findings or lock instances from method rules.** The existing source does not provide those authorities. The response explicitly reports unavailable lock instances and pending candidate attribution.

**Accept browser-supplied snapshots.** The browser supplies only three IDs. Fresh Host-side reads and raw rule hashes bind the method to current sources.

## Consequences

The panel provides traceable continuity evidence without creating a second DAG, automatically reworking assets, writing business state, calling a Provider, or approving content. Unit tests cover binding and authority failures; Chromium exercises current, historical, failed, unknown, and absent evidence through the real Host and Core against a loopback Yimeng test double. The new browser case restores its entry tab so the existing strict request-count tests remain isolated.
