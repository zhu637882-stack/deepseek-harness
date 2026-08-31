# Agent Note: Bind Director provider execution to a private Host identity

Status: implemented

English | [中文](2026-08-29-director-execution-host-identity.zh.md)

## Problem

The Director provider work-order API allowed a project user to reach execution mutations with the same JWT used for ordinary product actions. The preparation response also exposed the task claim, so a user could construct an acknowledgement or mark an issued request unknown. A valid provider acknowledgement then stopped at an ingesting state because the exclusive Director lane had no technical finalizer. Concurrent first issue attempts could also leave duplicate preflight audit rows even when task uniqueness held.

## Decision

Project users may issue a Director provider work order and read its public status, but they cannot prepare, complete, or mark execution unknown. Those mutations are private API routes authenticated by a domain-separated HMAC over the HTTP method, path, canonical body hash, timestamp, and nonce. The signed body carries the immutable task, context, method, pricing, provider, model, dispatch, claim, work-order, request, and payload bindings. The API fails closed when `QINGMU_DIRECTOR_EXECUTION_KEY` is absent or shorter than 32 bytes. The launcher generates that key only for a new isolated instance, writes its private configuration with mode `0600`, injects it into the API and Host processes, and rotates it on restore.

The Host is the only holder of the execution key. It obtains a private binding, prepares one exclusive dispatch, executes an injected transport with `maxRetries=0`, and submits either the provider receipt or an unknown outcome. The browser receives neither the key nor the claim token, Provider payload, or dispatch permit. Host error logging omits execution response details.

The optional DSh Director transport remains disabled unless a private Host configuration names one already-issued task and method binding. Mock configuration accepts only an exact credential-free HTTP loopback origin. The separate production-capable configuration fixes `deepseek-official`, `deepseek-v4-pro`, `https://api.deepseek.com/chat/completions`, no reasoning, no tools or files, zero adapter retries, and bounded input/output tokens; fixture and production-capable configurations are mutually exclusive. A disabled production-capable configuration can issue the immutable Yimeng task and read its private binding for a pre-submit lock without claiming a dispatch, creating a reservation or submission outbox, mounting or reading its external credential file, or invoking transport. The work order binds the actual UTF-8 prompt byte count and the conservative 16,000-token upper bound; both Writer integrity checks and the Host transport reject a prompt whose bytes exceed that bound. When enabled, the transport uses the real `ctx.llm.prepareCall()` seam and consumes the returned prepared handle with exactly one `stream()` call. Preparation captures both the resolved connection facts and credential value, so a later settings or credential-store generation cannot alter that one dispatch. The Host accepts success only when the adapter preserves stable response request id, Chat Completions completion id, native finish reason, and token/cache usage from the actual stream; every missing, drifting, or malformed fact becomes unknown without another call. This transport owns no task, reservation, outbox, or billing state.

Before dispatch, Yimeng recomputes the stored request, Provider payload, work order, context snapshot, prompt, method, pricing, and immutable preflight hashes. The Host independently recomputes the permit payload, request, and work-order hashes against the signed binding before invoking the transport. Settled and submission-unknown results are recovered from the persisted task, outbox, receipt, and cost facts even after the active route is removed; the Host binding-then-prepare sequence returns that terminal result without transport. A queued first prepare still requires an active route and fails closed when none is configured. Public issue and status normalization uses an explicit field allowlist rather than forwarding unknown upstream fields.

A fully bound advisory provider acknowledgement now atomically advances the existing generation task to `Succeeded` and settles its submission outbox. This finalizer records only technical schema and lineage completion: it does not create quality control, selection, Ready state, PromptIR, ChangeSet, release authority, or a human decision. The reservation remains associated with the request as a reserved upper bound while actual cost stays unknown pending billing reconciliation. Unknown submission state retains the reservation and cannot become terminal success or trigger an automatic retry.

First issue uses a deterministic preflight identity and creates the preflight audit, generation task, reservation, and dispatch intent in the existing transactional task path. Same-key replay recovers the existing objects; a changed payload is rejected.

## Alternatives considered

**Keep user JWT authorization and hide only the claim token.** Rejected because the same user could still invoke execution mutations or force an unknown terminal path without acting as the Host service.

**Create a Host-side task or billing ledger.** Rejected because Yimeng already owns the generation task, reservation, submission outbox, reconciliation, and receipt state. A second ledger would split recovery and charging authority.

**Retry an unknown request in the transport.** Rejected because a provider may have accepted the request before the response was lost. Retrying could duplicate work and cost.

## Verification

Focused API and service tests cover missing, short, incorrect, stale, and tampered signatures; stored task and payload tampering; user denial; same-key concurrency; receipt replay; unknown submission; route-less terminal recovery; queued route-less denial; drift checks; and single technical finalization. Host tests cover permit-to-binding integrity, one injected adapter call, `maxRetries=0`, complete-response loss, settled and unknown terminal replay without transport, and browser-safe issue/status responses. Direct adapter tests and a loopback mock Chat Completions server cover actual success metadata, strict JSON, a consumed prepared handle, transient failure, interrupted streams, invalid output, and missing receipt facts with at most one POST. An isolated launcher, FastAPI, built Host, SQLite, and Chromium path verifies issue, private DSh execution, one local mock request, Writer settlement, restart recovery after the active route is removed, and zero non-loopback requests.

## Consequences

Paid-capable Director execution remains dormant unless an isolated deployment explicitly supplies an execution key, an allowed route, an external credential path, and the Host-only DSh transport binding. A pre-submit lock alone authorizes no Provider request. Older instances without those private facts keep replay, manual editing, issue, and public status behavior, but private execution fails closed. Acknowledged advisory output no longer hangs in ingesting state; it is recoverable without a second provider call. Actual provider billing remains unknown until the existing billing reconciliation path supplies authoritative data. Activating a production route, reading a real credential, and performing a paid canary remain separate decisions.
