# Qingmu Yimeng command adapter

English | [中文](README.zh.md)

This private experimental Host plugin exposes explicit Yimeng `episode_script` and actor, scene, and prop `element_profile` ChangeSet flows over the loopback-only `/qingmu-yimeng-command` channel. The script operations remain `proposeScript`, `previewScript`, `commitScript`, and the read-only `recoverScriptCommit`. Element operations are `proposeElementProfile`, `proposeReferenceAsset`, `previewElementProfile`, `commitElementProfile`, and the read-only `recoverElementProfileCommit`.

## Command boundary

The adapter does not write a database itself. It validates browser input, obtains `YIMENG_API_TOKEN` only from the Host environment, and forwards the command to the Yimeng-owned HTTP API. Yimeng remains the authority for ownership, revision checks, durable ChangeSets, idempotent receipts, outbox events, and downstream invalidation.

A proposal is not a commit. The Client must display the returned preview and may commit only after an explicit user confirmation while `canCommit` is true. A commit receipt is not human creative signoff and does not authorize a paid Provider call.

Element commands use the generic `/api/qingmu/projects/{projectId}/elements/{elementKind}/{targetId}` route family. Runtime validation accepts exactly `actor`, `scene`, and `prop`; every other kind fails closed. Preview and commit validation bind the ChangeSet, subject coordinates, revisions, snapshot and payload hashes, operation, and non-authority preflight markers to the original browser request.

Every element proposal also requires the exact six-field `qingmu.imago-element-method-attestation.v1` proof. The adapter rejects extra or missing keys, non-lowercase 64-hex digests, and projection, input-snapshot, or subject hash mismatches before forwarding. It forwards the validated projection, projection hash, and proof unchanged; it never reads the IMAGO attestation key or signs in the browser/command path. Returned previews and receipts must also contain exactly the seven canonical impact arrays and the matching canonical `impactSha256`; additional or missing impact fields fail closed.

`proposeReferenceAsset` accepts only a current `qingmu.imago-reference-asset-method-projection.v1` plus its dedicated attestation. The Host reads `QINGMU_IMAGO_ATTESTATION_KEY` (at least 32 UTF-8 bytes), verifies the canonical unsigned attestation with HMAC-SHA256 using a timing-safe comparison, then binds the projection, input snapshot, target, operation, candidate asset ID/SHA, revision, and Yimeng snapshot SHA. The key, projection, and attestation are never sent to Yimeng or exposed as browser signing authority. Generic preview, commit, and recovery carry the exact operation and candidate lineage only inside the Host contract while the HTTP bodies remain the existing generic bodies.

`selectReferenceAsset` records an explicit selection intent but is not human approval or signoff. `requestReferenceRegeneration` requires a non-empty `repairPrompt` and remains intent-only: accepted previews and receipts must report `providerCalls: 0`, `workerStarted: false`, and no inferred approval. Neither operation starts generation or silently chooses a candidate.

Receipt recovery performs exactly one `GET` to the Yimeng `/api/qingmu/projects/{projectId}/episodes/{episodeId}/change-sets/{changeSetId}/command-receipt` endpoint for scripts, or the corresponding generic element route for all three element profiles, with the original `Idempotency-Key` header and no body or query. The adapter accepts only the `jason.qingmu-command-receipt-recovery.v1` wrapper, revalidates every lineage field on its nested original receipt, recomputes the canonical JSON SHA-256 of that receipt before accepting the wrapper's `receiptSha256`, and never retries the commit `POST`.

## Security boundary

The upstream must be loopback HTTP(S). The adapter never returns the Host token, sends no cookies, rejects redirects, bounds payload size and request time, and normalizes upstream errors without reflecting response bodies. The browser receives only validated ChangeSet data and durable receipt identifiers.

## Model Experience

### Host command bridge

#### What the model sees

Nothing. Commands are initiated by the authenticated browser UI and returned to the same Client connection over `/qingmu-yimeng-command`. This package registers no model tool or prompt context.

#### Token effect

Zero direct model-token effect.

#### KV Cache effect

Independent. ChangeSet requests do not modify a model request or reusable prefix.

## Known Limitations and Deferred Work

- This local adapter is not an Internet-facing gateway.
- It implements the `episode_script` plus actor, scene, and prop `element_profile` ChangeSet vertical slices, including explicit reference selection and regeneration-request intents. PromptIR, actual generation, comments, approval, signoff, and creative review decisions remain outside this adapter, so this does not declare Phase 3 complete.
- It does not start an outbox dispatcher or transport events across processes.
- Conflict recovery requires a fresh authoritative read and a new explicit proposal.
- Receipt recovery depends on Yimeng retaining the original command receipt; a missing or mismatched receipt fails closed.
