# Agent Note: Qingmu persistent local instance ownership

Status: implemented

English | [中文](2026-08-29-qingmu-local-instance.zh.md)

## Problem

A temporary API fixture does not provide a persistent user installation. Ambient database defaults and stale process identifiers can target an unrelated service, while a static Host token expires independently of saved Drafts.

## Decision

The [launcher](../../../../scripts/qingmu-local.py) exclusively creates a private root and binds the normal Studio API, scoped text worker, built DSh Host/director profile, and built Yimeng six-stage frontend to it. The Yimeng frontend is the sole user workspace and business UI; the launcher adds only loopback hosting, a narrow API reverse proxy, and an HttpOnly session bootstrap. It does not copy Yimeng state or introduce a second cockpit. The supervisor holds a lifecycle flock and all four live child handles; a private Unix socket authenticates control requests. Status verifies API identity/data binding, worker liveness, DSh Host listener/page, and frontend listener/page separately from login. No persisted PID is a signal target.

An explicit crash-recovery command is the only path from an externally interrupted `dirty` marker to `clean`. A generation-numbered, owner-only process ledger is rewritten after every owned child replacement, including login's Host/frontend restart, so recovery does not depend on an older status snapshot. Recovery requires the exact instance identity, a free lifecycle flock, every recorded supervisor and child PID to be absent, every recorded loopback port to be unbound, an unreachable stale control socket, no open database or sidecar handles, a zero-length or absent WAL, and a successful immutable integrity check. It sends no signal and performs no Provider call. Before replacing runtime truth or removing the stale socket it durably records an idempotent recovery intent with the original PID/port facts; an interrupted recovery can therefore re-verify and resume without losing its only evidence. If the lifecycle commit succeeds but intent cleanup is interrupted, start and backup remain blocked until the same recovery command verifies its audit and stopped truth and finishes cleanup. A successful recovery records an audit receipt and stopped runtime truth, then leaves startup as a separate explicit action.

Explicit login uses the canonical API and restarts only the owned Host and frontend to update their private session environment. The server's ordinary expiry remains enforced. Commands are never replayed by login or start. Cold backup and restore verify database/media integrity; restore writes an absent destination only.

## Alternatives considered

**Permanent test fixture.** Rejected because fixture identities, disabled lifespan and reseeding are not user deployment semantics.

**Kill or adopt by saved PID or port.** Rejected because either can belong to another process after a crash. Crash recovery treats any surviving PID or listener as a reason to stop, never as an ownership claim.

**New browser authentication platform.** Deferred. The dedicated OS-user credential and explicit login command cover this single-user installation without creating another identity database or changing JWT validation.

## Consequences

The instance is loopback-only and trusts the local OS user. It does not support multi-user tenancy, signal unknown processes, or automatically recover an ambiguous crash. Login briefly interrupts Host and frontend connectivity; existing receipt recovery handles unknown outcomes. The single URL enters the real Yimeng project workspace, where the DSh director panel is part of the same interface. The [guide](../../../../docs/cookbook/qingmu-local.md) states these limits. Focused ownership tests and the actual launcher/browser test pin process cleanup, crash refusal and recovery, restart persistence, session bootstrap, and truthful project state; synthetic inputs remain acceptance data, not content approval.
