# Agent Note: Workspace unarchiveSession seam and Qingmu director entry restore

Status: implemented

English | [中文](2026-09-17-workspace-unarchive-session.zh.md)

## Problem

Entering a Qingmu project's native director silently did nothing once the project director session had been archived. The entry flow created and selected the director session correctly, but the client projection sweep clears any current selection that belongs to the registry-global archive set, so the freshly selected director was cleared back to the New Session view within the same update. The cockpit gate (`currentSessionId === projectDirectorSessionId(projectId)`) never opened, no error surfaced, and the button looked dead. The archive set is Host-durable, so every retry hit the same sweep. Four live project director sessions were archived this way.

The wire already promised the missing half: `workspace.archiveSession` documentation stated that a future unarchive restores a session's grouping position, and the registry keeps an archived session's accounting slot precisely so a restore is lossless. No endpoint, registry method, or client face existed.

## Decision

`workspace.unarchiveSession` completes the archive capability seam, mirroring `archiveSession` at every layer.

The workspace registry method removes one id from the durable archive set. Unlike archive, it accepts any id: an unarchive cannot mistake an unknown session for a known one, so a not-archived or never-known id resolves without writing, emitting no change and therefore no `host/archived-sessions-changed` frame. The apiproxy layer gains the request/value schemas, the RPC map entry, the fetch handler route, the fetch client method, and the gateway assembly, which answers the full updated set like every other archive-set source. The client runtime mirrors it through the `IWorkspaces` contract, the manager (installing the unary echo's full set on success), and the service (throwing the Host error on failure); the fixture, both fake API clients, and the test-support double carry the same shape.

The Qingmu native director entry flow closes the product gap: in the project branch of `activate`, after the director session exists in the Host list and before `sessions.open`, a director session still present in the archived set is unarchived first. The check reads a fresh snapshot at that point, so a concurrent archive during session creation cannot slip past it. Restore precedes open, so the selection survives the projection sweep and the cockpit gate opens on the first click; a never-archived director opens directly without a restore round-trip.

## Alternatives considered

**Clearing the archived flag by editing live persisted state directly** was rejected: it bypasses the registry's durable write path, leaves other tabs' projections stale, and violates the rule that live persisted state is never hand-edited. The entry flow restores on demand through the new endpoint after deployment, so no data migration is needed.

**Exempting director sessions from the projection sweep** was rejected because the sweep's single rule — an archived current selection clears everywhere — is what keeps local echoes, remote frames, and reconnect baselines consistent. Special-casing one session kind would split that invariant.

**Unarchiving inside `sessions.open` itself** was rejected because the sessions runtime has no archive-set authority and the restore is a Host-durable mutation, not a selection concern; the cockpit entry flow is the one place that knows a director session must be visible.

**Requiring the session to be known for unarchive** was rejected because membership is the only fact that matters: removing an absent id is already the correct end state, and a not-found error would force clients to pre-read the set, adding a race without protecting anything.

## Consequences

Any client can restore an archived session through the same wire contract that archived it, with the restored session reappearing at its kept accounting slot on every grouping surface. Archived Qingmu project directors are recoverable by their entry button alone; the four already-archived live sessions need no manual repair. Archive stays a display-set operation end to end — neither direction touches the session log, the workspace account, or the session itself.

## Testing

The registry spec covers the durable round-trip, the idempotent no-op for a not-archived id (no medium write, no change event), and acceptance of a never-known id. The apiproxy workspace spec drives the endpoint over the real gateway: restore answers the empty set with exactly one changed frame, accounting stays untouched, and both the idempotent repeat and a never-known id answer the set without emitting another frame. The client service spec proves an unarchived selection survives the projection sweep and that a Host failure leaves the set untouched and rejects with the Host error. The native-director-session spec proves the entry ordering — unarchive before open for an archived director, no restore round-trip otherwise. The fetch-carrier spec carries the new fake endpoint.
