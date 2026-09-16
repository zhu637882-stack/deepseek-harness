# Agent Note: Qingmu relay batch browser panel

Status: implemented

## Problem

The relay batch controller and its seven `/qingmu-director-context` endpoints shipped without any browser surface: an operator watching a paid batch run could not see its progress, pause it for director admission, recover a lost Host lease, or close it without hand-writing RPC calls. The durable ledger existed precisely so a page could observe and steer a batch, but nothing rendered it.

## Decision

`DirectorContextClientPort` gains seven optional relay methods — `readRelayBatch`, `startRelayBatch`, `admitRelayDirector`, `advanceRelayBatch`, `completeRelayBatch`, `closeRelayBatch`, `recoverRelayBatch` — matching the interface's existing optionality pattern for Host-conditional capabilities. The cockpit `apply()` wires all seven through the `/qingmu-director-context` facade, so the production bridge always offers them.

`RelayBatchPanel` renders the batch ledger in the shooting workspace next to the episode batch panel, mounted only when the current session is the project director session. It deliberately exposes a subset of the lifecycle: read/refresh, pause (`advanceRelayBatch`, enabled only while `running` with zero admissions, matching the controller's pause rule), lease recovery (`recoverRelayBatch`), completion, and closure with a mandatory operator-typed reason. Starting a batch is absent because it requires the paid-authorization window and budget consent that belong to the batch-creation flow; admitting a director is absent because a legitimate admission needs the Host's real `contextSnapshotSha256`, which the browser cannot author. The panel therefore never creates payment obligations.

When the facade lacks relay methods — an older embedded caller or a test double — the panel renders nothing, so absence of the capability is indistinguishable from an intentionally hidden control rather than an error.

## Alternatives considered

**Exposing start and admit in the panel** was rejected: start creates a payment obligation and belongs to the authorized batch-creation window, and admit requires Host-owned context evidence the browser cannot legitimately produce; a UI that invites either would invite invalid ledger writes.

**Required (non-optional) port methods** were rejected because the interface already marks Host-conditional capabilities optional, and making relay mandatory would force every existing test double and embedded caller to stub endpoints they never use.

**Polling progress inside the panel** was rejected for now; the panel refreshes on mount and on explicit operator action, keeping the first version free of timer lifecycle bugs while a batch's own Host already reports progress through the ledger.

## Consequences

An operator can now watch batch mode and per-shot phases, pause a running batch before admissions begin, recover a lease after a Host restart, and close or complete a batch with its reason recorded — all without touching RPC tooling and without any path that spends money. The costs: progress does not live-refresh (the operator presses 刷新状态), and batch creation still has no browser entry point, so the full loop remains dependent on the Host-side start path.

## Testing

`relay-batch.client.spec.tsx` covers capability absence (renders nothing), the empty ledger, pause enablement and dispatch, closure blocked until a reason is typed (sent trimmed), completion, lease recovery with its outcome notice, and read failures surfaced as alerts. The existing cockpit and bridge suites cover the mounted integration unchanged.

## Related

Builds on [the relay ledger](2026-09-16-qingmu-director-relay-ledger.md), the [relay controller](../qingmu-relay-controller.md), and the [terminal lease release fix](../bug-fix/qingmu-relay-terminal-lease-release.md); the ledger note's observation that no page control drove a batch is now superseded for the observe/pause/recover/complete/close subset.
