# Agent Note: Qingmu persistent local instance ownership

Status: implemented

English | [中文](2026-08-29-qingmu-local-instance.zh.md)

## Problem

A temporary API fixture does not provide a persistent user installation. Ambient database defaults and stale process identifiers can target an unrelated service, while a static Host token expires independently of saved Drafts.

## Decision

The [launcher](../../../../scripts/qingmu-local.py) exclusively creates a private root and binds the normal Studio API and built CLI profile to it. The supervisor holds a lifecycle flock and the live child handles; a private Unix socket authenticates control requests. Status checks API identity/data binding and the Host listener separately from login. No persisted PID is a signal target.

Explicit login uses the canonical API and restarts only the owned Host to update its environment token. The server's ordinary expiry remains enforced. Commands are never replayed by login or start. Cold backup and restore verify database/media integrity; restore writes an absent destination only.

## Alternatives considered

**Permanent test fixture.** Rejected because fixture identities, disabled lifespan and reseeding are not user deployment semantics.

**Kill by saved PID or port.** Rejected because either can belong to another process after a crash.

**New browser authentication platform.** Deferred. The dedicated OS-user credential and explicit login command cover this single-user installation without creating another identity database or changing JWT validation.

## Consequences

The instance is loopback-only and trusts the local OS user. It does not support multi-user tenancy or automatic recovery of children orphaned by an external supervisor kill. Login briefly interrupts Host connectivity; existing receipt recovery handles unknown outcomes. An empty cockpit has no project-creation entry. The [guide](../../../../docs/cookbook/qingmu-local.md) states these limits. Focused ownership tests and the actual launcher/browser test pin process cleanup, expiry recovery and persistent Draft/receipt readback; synthetic Ready inputs remain acceptance data, not content approval.
