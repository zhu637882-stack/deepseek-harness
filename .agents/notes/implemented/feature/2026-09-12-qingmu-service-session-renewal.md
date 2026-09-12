# Agent Note: Qingmu native service session renewal

Status: implemented

English | [中文](2026-09-12-qingmu-service-session-renewal.zh.md)

## Problem

An expired local API token prevents project reads and saves. Restarting Host to load a renewed token interrupts native Director sessions and makes ordinary recovery depend on terminal access.

## Decision

The native launcher renews the dedicated account through the existing login API at startup and before expiry, verifying the instance and authenticated user before atomic publication. Both adapters share a per-operation reader for the owner-only session file. Native login preserves Host; legacy frontend login retains its cookie and process refresh. The [launcher guide](../../../../docs/cookbook/qingmu-local.md) owns timing and recovery details.

## Alternatives considered

**Restart on expiry** interrupts active sessions. **Long-lived tokens** defer expiry without fixing recovery. **Replay after a 401** risks repeating a command whose outcome is unknown; authentication is separate from receipt recovery.

## Consequences

The supervisor owns renewal without an additional daemon or browser token. Failed login backs off while preserving drafts, receipts and processes. Missing or unsafe session files never select stale environment credentials. The mechanism restores service authentication only; human-review identity and paid-command authorization remain separate. A removed or invalid saved credential still requires repairing that credential.

## Testing

Lifecycle tests cover expiry, startup, backoff, wrong identity, preservation and legacy behavior. A Loader composition replaces the private file while the same read/write handlers remain mounted, then verifies authenticated preview and save, rejection without replay, and missing-file failure without fallback. The existing preview snapshot remains unchanged.
