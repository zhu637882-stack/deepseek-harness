# Agent Note: Qingmu relay Host drive loop

Status: implemented

English | [中文](2026-09-19-qingmu-relay-host-drive-loop.zh.md)

## Problem

The relay batch had every durable guard — ledger, single-writer lease, admission gating, budget reservation, run readback — but its only production driver was the browser: `RelayBatchPanel` called `driveRelayBatch` through the loopback RPC every 15 seconds, so closing the page stalled a running batch until someone reopened it. A batch whose value is "prepare shot N+1 while shot N generates" cannot ship as an operator capability while a page must stay open for it to advance.

## Decision

`relay-host-loop.ts` owns a Host-side drive loop. `apply()` starts it inside the existing `['connection', 'sessions', 'qingmuYimengCommand']` injection, where the Yimeng read/command ports and the agent registry already live. The loop keeps a per-session registry of open batches fed by three session events: `session/event` with type `qingmu-director-relay/state` reclassifies a session from the event's whole-state payload, `session/created` registers a session whose persisted log already carries an open batch (the Host-restart attach path), and `session/disposed` unregisters. A `setInterval` tick (`relayDriveIntervalMs`, a new validated `Config` field defaulting to 15000) drives every registered session serially.

The tick and the browser RPC share one single-flight gate per session: an in-flight drive makes the tick skip and the RPC answer `waiting/drive-in-progress`. The tick path additionally requires `mode === 'running'`, so a paused batch waits for its explicit resume path exactly as the browser panel's poll gate required; the RPC face keeps the looser contract (the panel already disables its drive button for non-running batches). Agents are resolved live per attempt — an absent agent parks the tick silently and the RPC reports `agent-unavailable` — because a Host restart detaches every session, and the panel's lease-recovery visit is the sanctioned re-attach moment; the loop never fabricates an agent without the stored preset composition. A rejected drive is logged and contained, so one broken session cannot stop the others.

## Alternatives considered

**Driving from the writer worker** was rejected: the `--disable-durable-director-orchestration` channel there is the legacy jason orchestration, a different route from the DSH relay, and paying commands must keep flowing through the Host's loopback Yimeng command facade that the runner already guards.

**Resuming agents inside the loop** (`ctx.agents.resume`) was rejected for now: a correct resume must go through apiproxy's `ensureSession` so the stored preset composition and cwd checks win; replicating that in the bridge would fork the recovery contract. After a Host restart the operator's single panel visit (lease recovery) re-attaches the session through the existing path, after which the loop runs unattended. This boundary is recorded as a known limitation.

**Driving every attached session each tick without a registry** was rejected: the registry keeps ticks O(open batches) and gives the loop an explicit lifecycle (created → open → terminal) instead of re-scanning the store.

**Reusing the browser's 15-second poll as the loop's cadence, hardcoded** was rejected per the tunables rule; the cadence is a `Config` field so a deployment can tighten or loosen it from `cordis.yml`.

## Consequences

A running batch now advances from the Host process alone: the browser page can close after creation and the batch keeps admitting, preparing, dispatching inside its authorization and collecting. The browser RPC and the tick cannot double-drive one session, and a paused batch stays paused until its explicit resume. The loop does not create agents, so the first panel visit after a Host restart remains the re-attach step (recorded in the panel's updated `agent-unavailable` notice). Terminal modes unregister their sessions, so settled-but-uncompleted batches stop consuming ticks only after completion or closure, matching the operator's explicit settlement role.

## Testing

`relay-host-loop.spec.ts` (with `driveRelayBatch` module-mocked and a real `Session` carrying a real relay ledger) covers registry classification (running/paused stay, completed/closed/null unregister), the tick gate (drives running, skips paused), the single-flight gate (concurrent RPC answers `drive-in-progress`, then the original promise settles), the RPC face's distinct `agent-unavailable` skip, the `read-port-unavailable` parking, and the interval's containment of a rejected drive with the next tick still driving. The full bridge suite passes with the production `apply()` wiring in place.

## Related

Builds on [the relay ledger](2026-09-16-qingmu-director-relay-ledger.md), the relay controller note (`implemented/qingmu-relay-controller.md`), and the browser panel note (`feature/2026-09-16-qingmu-relay-browser-panel.md`); the panel note's "no production driver" consequence is superseded by this loop, and its poll remains as a UI-level nudge rather than the batch's propulsion.
