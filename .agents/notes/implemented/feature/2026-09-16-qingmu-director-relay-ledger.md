# Agent Note: Qingmu director relay ledger and Host lease

Status: implemented

English | [中文](2026-09-16-qingmu-director-relay-ledger.zh.md)

## Problem

Shot-batch director preparation ran only while one browser page stayed open and owned its session. Closing the page, a dropped connection, or a Host restart lost in-flight work, and a second actor could act on the same session at the same time. Nothing durable recorded which shots a human had already authorized, prepared, or queued, so resuming after an interruption risked paying twice for one shot. A model-authored statement that a save succeeded could also be mistaken for authority to dispatch a paid generation.

## Decision

One required typed session event, `qingmu-director-relay/state`, carries the complete batch ledger as a whole-state snapshot. Its `start` holds the project, episode, instruction, the authorized director provider and model, an optional authorized observer route, and the ordered shot list with each shot's parameters and retake flag. `authorization` holds an explicit `paidConfirmed`, a decimal `maxCostCny`, `maxCandidates`, and `expiresAt`. Each item records its phase and the evidence gathered for it: admitted director requests, the preparation handoff, material requests, the queued command, the public run status, and the timestamps and reason.

`appendRelayState` compares an observed `revision` before accepting the next snapshot, so a stale writer cannot overwrite a newer ledger. Batch input and creation time are immutable, and `completed` and `closed` never reopen. Recorded evidence is immutable: admissions only append, a new admission for a shot that already has one requires an explicit `paused` to `running` resume inside an unexpired reservation and cannot coexist with a handoff or submission, handoff and queued command hashes never change, run identity never changes, and a succeeded or failed status never reverts. At most one submission stays unsettled, and total capped cost and candidate count stay within the reservation. These aggregate rules run on read and on append, so a ledger that a previous process wrote badly fails to load rather than respending.

Recording intent is separate from performing it. `reserveRelaySubmission` writes the exact confirmed queue command before any dispatch, and a failed attempt still consumes its cap. Every relay effect path requires `sessions.flush` to return true first, and re-checks the admission after each await.

Browser and Host cannot both drive one session. `claimHostDirectorBinding` takes the batch's shot selection only while the batch is open, and its `enter` requires `running` with an unexpired reservation; only shot scopes named in the batch are selectable. `withHostDirectorOperation` and `withHostDirectorStream` retain the lease across awaits and asynchronous iterator cleanup, `release()` during in-flight work defers removal until that work settles, and a persistence failure invalidates the lease without releasing it. A terminal batch returns the session to browser ownership, and browser `enter`, `clear`, `bindProposal`, and `recover` refuse while a batch is open.

`registerRelayExecutionGuard`, mounted by the opt-in model-tools plugin, applies these gates only while a batch reserves the session, leaving ordinary turns on their existing path. It requires the turn's single admitted request, pins the model route to the authorized director, admits an auxiliary observer call only for its logged pending tool request on the authorized observer route, refreshes the binding before each effect, and refuses working-cut saves, acoustic imports, experience-capsule submissions, and dialogue commits that touch another shot.

Handoff evidence is derived from the durable log rather than assistant text. `readReferenceHandoff` accepts one consumed admission whose fixed target matches the shot, a completed turn, and a last write in that turn of a confirmed `qingmu_save_reference_draft` carrying scope, revision, request, frame, director-source, and context hashes. `verifyReferenceHandoff` then reads the Writer context and the saved draft twice and reports drift as blocked. The loopback `/qingmu-director-context` facade exposes this as `readReferenceHandoff`.

## Alternatives considered

**One event per relay step** was rejected because budget, candidate count, and the single-active-submission rule are properties of the whole ledger, and compaction or a partial replay forces a reader to reassemble them. A whole-state snapshot makes every append validation total, at the cost of rewriting unchanged items.

**A batch table in Writer or SQLite** was rejected: the session log is this batch's only durable authority for director preparation, and a second store would need its own recovery, correlation keys, and reconciliation against the log.

**A separate Host-owned session** was rejected: preparation continues the same conversation, binding, proposals, and later human review, so a second session would duplicate context and let the two diverge on what was approved.

**Treating an assistant message that reports a save as handoff evidence** was rejected because model text is neither durable nor authoritative; log-derived evidence survives compaction and cannot be authored by the model that performs the work.

**Allowing browser turns while a batch runs**, even read-only ones that could write, was rejected in favor of one writer per session; the page observes progress instead of acting.

**Automatic resubmission after a lost queue response** was rejected: the command is recorded first and an unresolved outcome stays active, so a human resolves it rather than a retry that may pay twice. **Parallel submissions inside a batch** were rejected for the same accounting reason; see Consequences.

## Consequences

Closing a page, restarting the Host, or losing one queue response no longer loses batch state, and a resumed Host can distinguish prepared, queued, running, settled, and uncertain shots. Double payment is blocked by the pre-dispatch reservation, the immutable command hash, the unsettled-submission cap, and the cost and candidate totals. Automatic and manual work are mutually exclusive and separately auditable, and a claim of "saved" is only accepted when the log proves it.

The costs are real. Candidates generate one at a time per batch, so wall-clock speedup is bounded by the unsettled-submission rule rather than by the director. Every step rewrites the full ledger, bounded by the 100-shot limit, and these snapshots stay in the log because the event is required on read. Nothing yet creates relay state in production: no batch controller and no page control drives a batch, so the ledger, lease, guards, and handoff read are groundwork that a later change must wire to the workspace before operators can use them.

## Testing

`relay-state.spec.ts` pins the ledger against the schema directly: authorization and expiry, per-phase evidence requirements, immutability of start, admissions, handoff, command, run identity and terminal status, budget and candidate totals, resume-before-retry, and batch closure. `bridge.spec.ts` covers lease ownership, cleanup that outlives release, invalidation, terminal return to the browser, and cold JSONL recovery. `reference-video-tools-composition.spec.ts` drives relay recovery and closure through the shipped preset with real session persistence, asserting that a closed batch admits manual saves only after explicit release and that observer authorization follows the batch. `rpc.spec.ts` covers the handoff endpoint's session, scope, and drift results.
