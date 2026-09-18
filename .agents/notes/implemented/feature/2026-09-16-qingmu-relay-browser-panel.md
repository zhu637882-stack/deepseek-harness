# Agent Note: Qingmu relay batch browser panel

Status: implemented

## Problem

The relay batch controller and its seven `/qingmu-director-context` endpoints shipped without any browser surface: an operator could not create a batch, watch its progress, pause it for director admission, recover a lost Host lease, or close it without hand-writing RPC calls. The durable ledger existed precisely so a page could create, observe and steer a batch, but nothing rendered it.

## Decision

`DirectorContextClientPort` gains eight optional relay methods — `readRelayBatch`, `startRelayBatch`, `admitRelayDirector`, `advanceRelayBatch`, `completeRelayBatch`, `closeRelayBatch`, `recoverRelayBatch`, `releaseRelayHostLease` — matching the interface's existing optionality pattern for Host-conditional capabilities. The cockpit `apply()` wires all eight through the `/qingmu-director-context` facade, so the production bridge always offers them.

`RelayBatchPanel` renders the batch ledger in the shooting workspace next to the episode batch panel, mounted only when the current session is the project director session. When no batch exists and the episode shot relations are loaded, a creation form builds the `RelayStart` from real projection data: shots become checkboxes taken from the relations (duration outside the 2–30 second parameter range is ineligible), each contributing its scope, label, duration and the project aspect ratio; the operator edits the batch instruction, the authorized director route (prefilled `deepseek-official`/`deepseek-v4-pro`), an optional observer route (prefilled `qingmu-vision`/`qwen3.8-flash`), the cost cap and the expiry; the candidate limit always equals the selected shot count. Creation stays disabled until the instruction is non-empty, the cap is a positive decimal, the expiry is in the future, and an explicit checkbox confirms the payment authorization. Starting a batch records the selection and authorization in the durable ledger and claims the Host lease; it never dispatches generation, so the browser's only payment-relevant act is the explicit authorization itself.

For an existing batch the panel exposes read/refresh, pause (`advanceRelayBatch`, enabled only while `running` with zero admissions, matching the controller's pause rule), lease recovery (`recoverRelayBatch`), release of a dead lease (`releaseRelayHostLease`, with a notice that distinguishes an immediate release from one still draining in-flight operations), completion, and closure with a mandatory operator-typed reason. The header shows the reserved cost summed over recorded submissions against the authorization cap, and each item shows its own reserved amount, so the permanently consumed cap stays visible next to the limit. Admitting a director is absent because a legitimate admission needs the Host's real `contextSnapshotSha256`, which the browser cannot author.

When the facade lacks relay methods — an older embedded caller or a test double — the panel renders nothing, so absence of the capability is indistinguishable from an intentionally hidden control rather than an error.

## Alternatives considered

**Exposing admit in the panel** was rejected: an admission requires Host-owned context evidence the browser cannot legitimately produce, so a UI that invites it would invite invalid ledger writes.

**Host-only batch creation** was rejected: creation is exactly the operator's authorization decision — which shots, which route, how much money, until when — and the ledger schema already validates the payload server-side, so a browser form over the existing RPC adds no new trust.

**Required (non-optional) port methods** were rejected because the interface already marks Host-conditional capabilities optional, and making relay mandatory would force every existing test double and embedded caller to stub endpoints they never use.

**Free-form shot entry (typed IDs or JSON)** was rejected because scope errors are the batch's main correctness risk; deriving scopes, durations and labels from the loaded relations projection removes the transcription step entirely.

**Polling progress inside the panel** was rejected for now; the panel refreshes on mount and on explicit operator action, keeping the first version free of timer lifecycle bugs while a batch's own Host already reports progress through the ledger.

## Consequences

An operator can now create a batch with an explicit, capped, expiring authorization from the normal shooting workspace, watch batch mode and per-shot phases, pause a running batch before admissions begin, recover a lease after a Host restart, and close or complete a batch with its reason recorded — all without touching RPC tooling. The only payment-relevant browser act is the explicit authorization recorded at creation; generation submission remains Host-driven inside that authorization. The costs: progress does not live-refresh (the operator presses 刷新状态), and the panel's periodic drive is now only a UI-level nudge — the [Host drive loop](2026-09-19-qingmu-relay-host-drive-loop.md) owns the batch's unattended propulsion.

## Testing

`relay-batch.client.spec.tsx` covers capability absence (renders nothing), the empty ledger, creation gating (disabled until instruction and explicit confirmation, zero cap rejected, unselected shots excluded with the candidate limit following the selection), the exact `RelayStart` payload built from relations, pause enablement and dispatch, closure blocked until a reason is typed (sent trimmed), completion, lease recovery with its outcome notice, dead-lease release with both the immediate and the draining notices, the reserved cost shown per item and in total against the cap (zero before any submission), and read failures surfaced as alerts. The existing cockpit and bridge suites cover the mounted integration unchanged.

## Related

Builds on [the relay ledger](2026-09-16-qingmu-director-relay-ledger.md), the [relay controller](../qingmu-relay-controller.md), and the [terminal lease release fix](../bug-fix/qingmu-relay-terminal-lease-release.md); the ledger note's observation that no page control drove a batch is now superseded for the create/observe/pause/recover/release/complete/close subset.
