# Qingmu Yimeng command adapter

English | [中文](README.zh.md)

This private experimental Host plugin exposes explicit Yimeng `episode_script` and actor, scene, and prop `element_profile` ChangeSet flows over the loopback-only `/qingmu-yimeng-command` channel. The script operations remain `proposeScript`, `previewScript`, `commitScript`, and the read-only `recoverScriptCommit`. Element operations are `proposeElementProfile`, `proposeReferenceAsset`, `previewElementProfile`, `commitElementProfile`, and the read-only `recoverElementProfileCommit`. Ordinary Take comments use `createTakeComment` and the read-only `recoverTakeComment`. Take review authority uses `createTakeReviewRecommendation`, `createTakeHumanDecision`, and their GET-only recovery operations. Technical QC uses `recordTakeTechnicalQc` and `recoverTakeTechnicalQc`. The approval lifecycle uses `transitionTakeApprovalLifecycle` and `recoverTakeApprovalLifecycleTransition`. Selected-video Findings use `recordShotFinding` and the read-only `recoverShotFinding`. Machine-validated Stage artifacts use `registerStageArtifact`, `commitStageArtifactDecision`, and the read-only `recoverStageArtifactRegistration` and `recoverStageArtifactDecision`. Complete-scope LSU plans use `sealLsuPlan`, the read-only `recoverLsuPlanSeal`, and `probeLsuPlanAuthority`.

## Command boundary

The adapter does not write a database itself. It validates browser input, obtains `YIMENG_API_TOKEN` only from the Host environment, and forwards the command to the Yimeng-owned HTTP API. Yimeng remains the authority for ownership, revision checks, durable ChangeSets, idempotent receipts, outbox events, and downstream invalidation.

A ChangeSet proposal is not a commit. The Client must display the returned preview and may commit only after an explicit user confirmation while `canCommit` is true. A commit receipt is not human creative signoff and does not authorize a paid Provider call.

Element commands use the generic `/api/qingmu/projects/{projectId}/elements/{elementKind}/{targetId}` route family. Runtime validation accepts exactly `actor`, `scene`, and `prop`; every other kind fails closed. Preview and commit validation bind the ChangeSet, subject coordinates, revisions, snapshot and payload hashes, operation, and non-authority preflight markers to the original browser request.

Every element proposal also requires the exact six-field `qingmu.imago-element-method-attestation.v1` proof. The adapter rejects extra or missing keys, non-lowercase 64-hex digests, and projection, input-snapshot, or subject hash mismatches before forwarding. This element-profile proposal path forwards the validated projection, projection hash, and proof unchanged without reading the IMAGO attestation key or signing. Returned previews and receipts must also contain exactly the seven canonical impact arrays and the matching canonical `impactSha256`; additional or missing impact fields fail closed.

`proposeReferenceAsset` accepts only a current `qingmu.imago-reference-asset-method-projection.v1` plus its dedicated attestation. The Host reads `QINGMU_IMAGO_ATTESTATION_KEY` (at least 32 UTF-8 bytes), verifies the canonical unsigned attestation with HMAC-SHA256 using a timing-safe comparison, then binds the projection, input snapshot, target, operation, candidate asset ID/SHA, revision, and Yimeng snapshot SHA. The key, projection, and attestation are never sent to Yimeng or exposed as browser signing authority. Generic preview, commit, and recovery carry the exact operation and candidate lineage only inside the Host contract while the HTTP bodies remain the existing generic bodies.

`selectReferenceAsset` records an explicit selection intent but is not human approval or signoff. `requestReferenceRegeneration` requires a non-empty `repairPrompt` and remains intent-only: accepted previews and receipts must report `providerCalls: 0`, `workerStarted: false`, and no inferred approval. Neither operation starts generation or silently chooses a candidate.

Receipt recovery performs exactly one `GET` to the Yimeng `/api/qingmu/projects/{projectId}/episodes/{episodeId}/change-sets/{changeSetId}/command-receipt` endpoint for scripts, or the corresponding generic element route for all three element profiles, with the original `Idempotency-Key` header and no body or query. The adapter accepts only the `jason.qingmu-command-receipt-recovery.v1` wrapper, revalidates every lineage field on its nested original receipt, recomputes the canonical JSON SHA-256 of that receipt before accepting the wrapper's `receiptSha256`, and never retries the commit `POST`.

## PromptIR Draft source binding

`proposePromptIr` requires `baseDraftSnapshotSha256`: the exact latest Draft subject SHA returned by the read adapter, or explicit `null` if no Draft exists. Yimeng freezes this condition in the existing ChangeSet and compares it again inside preview and the edit transaction, alongside the Ready source. A concurrent Draft edit fails closed instead of replacing newer text. Draft editing neither promotes Ready nor selects a Take.

Receipt recovery remains GET-only. The director workspace can explicitly retry the original edit command with the original idempotency key after an unknown result; the Host never retries automatically. A successful original receipt is replayed before testing today's Draft source.

## Ordinary Take comments

`createTakeComment` binds an exact current Take-subject SHA to a chosen Take, a timecode or frame anchor, the comment body, and one visible-ASCII idempotency key. It sends exactly one `POST` to `/api/qingmu/projects/{projectId}/episodes/{episodeId}/frames/{frameId}/take-comments`; the body contains exactly `expectedTakeSubjectSha256`, `takeId`, `anchor`, `body`, and `idempotencyKey`, while path IDs, actor, role, and session come from the route and Yimeng authentication. The result must preserve the intent and report `changed`, selection, technical-pass, formal-approval, episode-verification, human-signoff, Provider-call, and budget impacts as false or zero.

`recoverTakeComment` never retries the POST. It sends exactly one body-free GET to `/command-receipt`, preserving the original Take ID and subject SHA in the query and idempotency key in the header, then validates the original result or a strict `not_found`. Both operations require a Host-only Yimeng bearer token, and credential reflection into upstream JSON fails closed.

## Take Reviewer and Approver records

`createTakeReviewRecommendation` records a Reviewer recommendation, while `createTakeHumanDecision` records the independent Approver decision. Their dedicated recovery operations query only the original receipt and never repeat a POST. The Host preserves exact Take-subject and recommendation identities, but Yimeng alone authenticates actor, role, session, producer, participants, and natural-person separation. A role or session switch cannot turn the same natural person into an eligible Approver. Neither command changes technical QC, formal approval, selection, episode verification, Provider, or budget state.

## Take technical-QC record

`recordTakeTechnicalQc` validates a fresh `takeTechnicalQcMethod` and sends one assessment POST containing only the exact current subject, fixed macro and micro checks, derived issue codes, reason, and idempotency key. Yimeng rechecks receipt evidence, current selection, rules, and recorder authority. `recoverTakeTechnicalQc` performs GET-only receipt recovery with the original coordinates and key. A passing assessment remains technical evidence, not content approval, and both operations keep every adjacent authority flag false or zero.

## Take approval lifecycle transition

`transitionTakeApprovalLifecycle` validates a fresh `takeApprovalLifecycleMethod` and sends exactly one of `APPROVE`, `INVALIDATE`, `REQUEST_REWORK`, or `RESUBMIT` using the original eight-field browser intent. Approval binds the exact current selected Take, Approver decision, QC assessment, and rules SHA. Drift invalidates that approval; rework records defect classes and the existing bounded route but does not execute it; a third same-class rework requires method review; a new revision cannot inherit the old approval. `recoverTakeApprovalLifecycleTransition` performs one body-free GET using the original coordinates and idempotency key and never repeats the transition POST.

## Shot-video Findings

`recordShotFinding` accepts the project, episode, and frame IDs, expected subject SHA, idempotency key, eight explicit Finding fields, method projection, projection SHA, and attestation defined in [the request types](src/types.ts). It checks the canonical subject and projection digests and the HMAC-SHA256 proof using the Host's `QINGMU_IMAGO_ATTESTATION_KEY`, then validates the rules digest and the method's owner options. The key requires at least 32 UTF-8 bytes. Extra fields, invalid severity or owner, and mismatched bindings fail closed. Author text and repeated evidence references are preserved; no severity or owner is inferred.

The adapter sends exactly one `POST` to `/api/qingmu/projects/{projectId}/episodes/{episodeId}/frames/{frameId}/findings`, omitting the three path IDs from the body. It never supplies actor or session fields. Yimeng requires the explicit project reviewer feature and records an `OPEN` Finding without approval, selection changes, rework, or Provider calls. The response must preserve the submitted fields and subject, method and rules hashes; its authenticated session SHA must match the token used for that request. A failed or interrupted `POST` is never automatically retried.

`recoverShotFinding` accepts only the three IDs, original subject SHA, and idempotency key. It sends one `GET` to the same path plus `/command-receipt`, with `expectedSubjectSha256` in the query and the original `Idempotency-Key` header. It accepts only a matching `committed` result or `not_found` with `result: null`. Recovery remains authenticated by Yimeng but does not fetch the current subject or require the historical record to match today's HMAC key or bearer-token session.

## Production-unit scope bindings

`bindProductionUnit` registers an explicitly chosen unit ID against an existing native shot group. The request binds the project, episode, group, and unit IDs to the current source SHA, previous binding revision/SHA, and the signed `qingmu.imago-production-unit-method.v1` projection. Revision zero requires a null previous SHA. The Host checks the source and method digests, HMAC proof, method definition, and rules digest before sending one `POST` to `/api/qingmu/projects/{projectId}/episodes/{episodeId}/production-units/{unitId}/binding`. Actor and session fields come from Yimeng authentication, never browser input.

The receipt must match those coordinates, the next binding revision, method and rules hashes, definition, and request-session SHA. `planSealed`, `humanSignoffInferred`, and `reworkExecuted` must remain false, and `providerCalls` must remain zero. A scope binding neither seals the LSU plan nor creates a StageInstance, approval, workset, or generation task.

`recoverProductionUnitBinding` sends one `GET` to the same binding path plus `/command-receipt`, with the original group ID and source SHA in the query and the original `Idempotency-Key` header. It accepts only a matching `found: true` receipt or `found: false` with `result: null`. Recovery does not require today's source, HMAC key, or historical bearer-token session. Interrupted writes are never retried automatically; receipt corruption and lineage mismatches fail closed.

## Episode-script source-reference bindings

`bindStageSource` accepts the project and episode IDs, explicit `stageId: A1S`, current source SHA, previous binding revision/SHA, idempotency key, and the original Host-signed method projection, projection SHA, and attestation. The Host verifies the canonical source, method, rules, definition, and HMAC before sending one `POST` to `/api/qingmu/projects/{projectId}/episodes/{episodeId}/stage-sources/A1S/binding`. Its seven-field body omits the path IDs; actor and session come only from Yimeng authentication. The owner-only backend transaction checks both source and binding CAS and records a source reference without rewriting the script.

Both source-binding endpoints require an unchanged idempotency key of 8..200 visible ASCII characters (`U+0021..U+007E`) so the same key can travel in JSON and the recovery header. They never trim, encode, or rewrite that key; project and episode IDs retain their Unicode contract.

The exact `jason.qingmu-stage-source-result.v1` receipt must bind the requested source, next binding revision, method and rule hashes, definition, and request-session SHA. The Host recomputes the binding SHA and rejects any claim of artifact creation, stage approval, lock activation, plan sealing, human signoff, rework, or Provider calls. An episode-script reference does not satisfy the complete A1S output or make workset authority available.

`recoverStageSourceBinding` sends one `GET` to that binding path plus `/command-receipt`, with the original `expectedSubjectSha256` query and `Idempotency-Key` header. It validates the original `jason.qingmu-stage-source-recovery.v1` wrapper and nested `receipt`; a missing or wrong-scope receipt remains an upstream 404, not a successful `found` wrapper. Recovery needs neither the current source nor today's HMAC key or original bearer-token session. Interrupted writes are never automatically retried. A changed session or attestation is not the same original POST intent; use receipt recovery instead.

## Immutable Stage artifact registrations

`registerStageArtifact` accepts the project, episode, Stage, and scope coordinates, one exact V6 artifact, artifact-record revision/SHA compare conditions, a visible-ASCII idempotency key, and the current Host-signed `qingmu.imago-stage-artifact-method.v1` projection. The Host independently binds the artifact SHA and revision to the subject, validates the current Stage definition and its version, machine-validation result, rule digest, and HMAC proof, and rejects every approval or execution grant. It serializes the artifact through the same Stage-only Python-compatible finite-number fixed point and rejects physical JSON nesting above Yimeng's 64-level route limit before transport. It then sends one `POST` to `/api/qingmu/projects/{projectId}/episodes/{episodeId}/stage-artifacts/{stageId}/{scopeInstance}`. Path IDs, actor, natural-person identity, and session are never accepted from browser fields in the POST body; Yimeng authentication and its transaction remain authoritative for those identities.

The exact receipt binds the immutable artifact, next record revision, method and rule hashes, authenticated producer identity and request-session SHA. The Host recomputes the record SHA and requires `stageArtifactRegistered: true` while `stageArtifactAvailable`, dependency authority, Stage approval, lock activation, plan sealing, human signoff, rework, and Provider calls remain false or zero. Registration therefore does not satisfy dependencies, approve a Stage, activate a lock, seal an LSU plan, or start production work.

`recoverStageArtifactRegistration` accepts only the original coordinates, subject SHA, and idempotency key. It sends one bodyless `GET` to the same path plus `/command-receipt`, preserving the key in the `Idempotency-Key` header and the subject SHA in the query. It accepts only the exact `jason.qingmu-stage-artifact-recovery.v1` wrapper and revalidates the nested original receipt. Recovery deliberately needs neither today's artifact nor the current HMAC key or historical bearer-token session. An uncertain registration POST is never retried.

## Independent exact Stage artifact decisions

`commitStageArtifactDecision` accepts one explicit `approve`, `reject`, or `request_changes` intent and reason, bound to the exact current artifact-record revision/SHA, artifact revision/SHA, subject SHA, and the complete exact artifact. The caller cannot supply a method projection, projection SHA, or attestation. The trusted Host invokes the currently loaded `stageArtifactMethod` capability for that artifact, revalidates its projection, rule digest, definition, subject binding, and HMAC proof, then sends one POST to the same Stage artifact path plus `/decisions`. It never accepts actor, natural-person identity, role, or session fields from the caller. Yimeng authentication derives those facts, enforces that producer and approver are different natural people, recomputes current upstream and lock authority, and owns the only durable decision journal.

The result must bind the exact artifact record, method and rules, authenticated approver and session, producer identity, and Yimeng-computed dependency snapshot. An approval is accepted only with a verified snapshot; any source, rule, record, artifact, revision, SHA, or lock-event drift fails closed in Yimeng. `reject` and `request_changes` never make an artifact available. A valid approval may activate only the lock declared by the registered Stage definition. Every result must keep plan sealing, inferred human signoff, rework execution, and Provider calls false or zero. Harness validates these claims but never computes or stores dependency authority and adds no second DAG or state machine.

`recoverStageArtifactDecision` accepts only the original Stage coordinates, artifact-record revision/SHA, and idempotency key. It sends one bodyless `GET` to `/decision-command-receipt`, preserving the record coordinates in the query and the key in the header, and revalidates the original exact receipt. Recovery needs neither today's HMAC key nor the historical bearer session and never resubmits an uncertain decision POST.

`probeStageArtifactAuthority` is the read-only current-authority path. It accepts the exact artifact-record revision/SHA, artifact revision/SHA, subject SHA, and complete exact artifact. The trusted Host internally invokes the currently loaded `stageArtifactMethod` capability and forwards its fresh proof in one POST to `/authority-probe`, without caller identity or idempotency fields. Caller-supplied historical method fields are rejected before that capability runs. The compact result is accepted only when Yimeng's recomputed dependency snapshot, current decision, rules SHA, availability, approval, and the exact lock declared by the current Stage definition agree. The ordinary artifact `GET` remains a historical feed and deliberately grants no current authority without this fresh proof. Rule or lineage drift therefore returns a valid fail-closed probe with no current approval instead of resurrecting an old decision.

## Exact complete-scope LSU plan sealing

`sealLsuPlan` accepts only project/episode coordinates, the expected current subject SHA, the previous plan revision/SHA CAS pair, and one visible-ASCII idempotency key. The caller cannot supply a Method, actor, natural-person identity, session, approval, or lock claim. The Host invokes the currently loaded `lsuPlanMethod`, verifies its complete subject, definition, rule generations, projection SHA, and HMAC, then forwards one POST to `/lsu-plan/seals`. Yimeng alone authenticates the owner, rechecks the exact current Production Unit bindings and approved C5F blueprint lock, performs CAS, and persists the seal in its existing three ledgers.

The receipt binds the next revision, complete subject, Method and rule SHAs, authenticated owner/session, event, and ChangeSet. It grants only `planSealed: true`; Stage approval, lock activation, Provider calls, inferred signoff, and rework remain false or zero. An uncertain POST is never retried. `recoverLsuPlanSeal` uses the original subject SHA, plan CAS coordinates, and idempotency key in one bodyless GET, without requiring today's Method key or historical bearer session. `probeLsuPlanAuthority` always recomputes a fresh Method and asks Yimeng whether the latest historical seal still matches today's complete subject and both rule generations; ordinary source reads and old receipts do not grant current authority.

## Security boundary

The upstream must be loopback HTTP(S). The adapter never returns the Host bearer credential, sends no cookies, rejects redirects, bounds payload size and request time, and normalizes non-success responses without reflecting their bodies. Successful Stage registration and recovery responses remain intact until their complete business schema is validated, so legitimate receipt fields named `token` are not deleted by generic secret redaction. After validation, any key or string containing the actual current bearer credential fails closed with a static error. Contract failures still return only static safe errors. The browser receives only validated command data and durable receipt identifiers.

The same complete-schema validation and post-validation credential-reflection check apply to Stage decision results, recovered decision receipts, and authority probes.

## Model Experience

### Host command bridge

#### What the model sees

Nothing. Commands are initiated by the authenticated browser UI and returned to the same Client connection over `/qingmu-yimeng-command`. This package registers no model tool or prompt context.

#### Token effect

Zero direct model-token effect.

#### KV Cache effect

Independent. Command requests do not modify a model request or reusable prefix.

## Known Limitations and Deferred Work

- This local adapter is not an Internet-facing gateway.
- It implements the `episode_script` plus actor, scene, and prop `element_profile` ChangeSet vertical slices, including explicit reference selection and regeneration-request intents, records selected-video Findings, and registers production-unit scope, episode-script source references, machine-validated Stage artifacts, and complete-scope LSU plan seals. It also carries exact independent Stage decisions, read-only receipt recovery, and fresh signed current-authority probes, while Yimeng alone computes and persists dependency, lock, and current plan authority. Actual generation and automatic creative approval remain outside these operations; registration, approval, or plan sealing alone does not complete the production workflow.
- It does not start an outbox dispatcher or transport events across processes.
- ChangeSet proposal conflicts require a fresh authoritative read and a new explicit proposal.
- Receipt recovery depends on Yimeng retaining the original command receipt; mismatches fail closed. A missing Finding receipt returns `not_found` without resubmitting the write.
