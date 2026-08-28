# Qingmu Yimeng read adapter

English | [中文](README.zh.md)

This private experimental Host plugin is the read-only BFF between Qingmu OS and the Yimeng API. It registers the loopback-only `/qingmu-yimeng` RPC channel and exposes `health`, `capabilityCatalog`, `costRehearsal`, `gateAControlEvidence`, `projects`, `episodes`, `script`, `elementProfile`, `referenceCandidates`, `selectedVideoReview`, `takeVersions`, `takeAcceptance`, `shotFindings`, `productionUnits`, `lsuPlanSource`, `stageSources`, and `workflow`; it exposes no mutation endpoint.

## Contract

`health` normalizes anonymous liveness and runtime identity fields. `projects` normalizes pagination, `episodes` returns a validated project episode list, `script` returns the authoritative structured episode script with its optimistic revision and a Host-verified `scriptSha256`, `elementProfile` reads an actor, scene, or prop from `/api/qingmu/projects/{projectId}/elements/{elementKind}/{targetId}`, `referenceCandidates` reads the same element's candidates from the `/reference-candidates` child route, and `workflow` requires the exact `jason.episode-workflow-projection.v1` schema and its strong top-level fields while retaining unknown JSON fields.

For a found script, Yimeng supplies the exact Python-canonical JSON text and its SHA-256 beside the parsed script. The Host hashes those exact UTF-8 bytes, parses the canonical text, recursively rejects non-finite numbers and integers outside JavaScript's safe range in both parsed projections, and deep-compares it with `script`; any hash, numeric-safety, or content mismatch fails closed. The canonical text is then removed, so the browser receives only the parsed script and verified `scriptSha256`. Legal finite floats such as Python `1e-06` remain valid. For `found: false`, the upstream canonical text and hash must both be `null`.

All three element profiles use the same evidence boundary: the Host hashes the exact `canonicalSnapshot` bytes, parses and checks safe JSON numbers, deep-compares the result with the `jason.qingmu-element-profile-subject.v1` subject, and removes `canonicalSnapshot` before returning the verified `snapshotSha256`. Runtime validation accepts exactly `actor`, `scene`, and `prop`: actor subjects bind `actorId` and `visualIdentity`, while scene and prop subjects bind `sceneId` or `propId` and `visualPrompt`. Every other kind, identifier, field, or subject-shape mismatch fails closed.

`referenceCandidates` requires `jason.qingmu-reference-asset-candidates.v1`, `targetType: element_profile`, the requested project, element kind and target ID, a non-negative profile revision, a lowercase `elementSnapshotSha256`, and literal `humanApprovalInferred: false`. Each returned candidate contains only `assetId`, `sha256`, `materializedSha256`, `bindingValid`, `projectId`, `sourceEpisodeId`, `ownerType`, `ownerId`, `role`, `localPath`, `qualityStatus`, `selectionStatus`, `isSelected`, `generationJobId`, `sourceRevisionId`, `formalConsistencyCheckId`, `formalConsistencyPassed`, `qualityProjectionSha256`, `decisionKind`, and `decisionIdentity`. The Host validates candidate project and owner binding, IDs, booleans, SHA-256 fields, and the exact `Unselected | Selected | Rejected | Stale`, `pending | passed | failed`, and `none | referenceSelection | humanReview` value sets before returning the projection.

The `workflow.director.heroFrameStoryboards` sibling projection joins one-to-one with the E5-1 canonical Shots and exact storyboard revision. It validates the selected first-frame asset binding, a bounded integer `0..10000` annotation grid, Shot-local Actor/Prop references, deterministic `subjectLayout`, `objectAnchors`, and `actionTrajectory` compilation, and every stable SHA before returning it. Expiring `browserUrl` values are deliberately excluded from `shotsSha256`; the asset ID, media SHA, and binding SHA remain covered. This is a read projection only, not a second canvas repository or revision system.

The `workflow.director.shotRelations.shots` array projects Yimeng's canonical storyboard frames without adding a Shot authority. Each Shot carries `shotId`, the sole Shot ordering field `frameNo`, `durationSec`, and derived `dialogueRhythm`; it never carries a Shot-level `order`, `sortOrder`, or `sequence`. Each element carries `currentReferenceAvailability` plus either `currentReference: null` or the uniquely selected E4-3 reference's `assetId`, `sha256`, and lineage. The adapter does not choose references or persist Shot selection state.

The package root exports the request and response types, including `YimengHealth`, `YimengCostRehearsalRequest`, `YimengCostRehearsalSubject`, `YimengCostRehearsalResponse`, `YimengProjectsResponse`, `YimengEpisodesResponse`, `YimengScriptResponse`, `YimengElementProfileRequest`, `YimengElementProfileResponse`, `YimengReferenceAssetCandidate`, `YimengReferenceCandidatesRequest`, `YimengReferenceCandidatesResponse`, `YimengTakeVersionStackResponse`, `YimengTakeAcceptanceResponse`, `YimengShotRelationShot`, `YimengShotDialogueCue`, `YimengShotDialogueRhythm`, `YimengShotCurrentReference`, `YimengShotCurrentReferenceLineage`, `YimengShotRelationsProjection`, `YimengHeroFrameStoryboardsProjection`, and `YimengWorkflowProjection`.

## Gate A capability catalog

`capabilityCatalog` accepts optional `modelId`, `capability`, and sorted, de-duplicated `requestedControls`, then sends one authenticated GET to Yimeng's existing model-catalog service. The Host independently recompiles every model snapshot with RFC 8785 JCS, validates its content-addressed ID, checks the exact request and catalog identities, and recomputes eligibility from the normalized request plus declared mutual-exclusion rules. One preflight SHA binds the catalog, request, item IDs, and recomputed decisions. Any byte, identity, request, field, ordering, decision, or authority drift fails closed.

The projection fixes `UNVERIFIED_FOR_PAID_PRODUCTION`, `providerCalls: 0`, `databaseWrites: 0`, and `paidGenerationAuthorized: false`. Missing real-model mutual-exclusion declarations remain explicit errors; the adapter does not invent Provider facts or reinterpret a catalog's existing paid-dispatch fields as current authorization. A dry-run eligibility result only evaluates the requested capability and control combination. It creates no task, budget reservation, database row, Provider request, routing decision, or human signoff.

## Gate A cost rehearsal

`costRehearsal` accepts one canonical frame, model, capability, sorted controls, resolution, candidate count, the complete freshly Host-validated catalog projection, and its exact catalog, request, preflight, and capability snapshot SHA-256 values. It sends one authenticated, body-free GET to Yimeng; the projection itself is never placed in the URL. Yimeng remains the sole owner of the authoritative frame duration, catalog rate, candidate limit, and read-only ProviderGate budget projection. The Host revalidates the projection's canonical bytes, independently derives eligibility, rate, and candidate limit, validates every receipt echo, recompiles the subject and full receipt with RFC 8785 JCS, and recomputes the integer micro-CNY identities and budget-window arithmetic. Candidate count must remain within the selected capability snapshot's declared output limit.

This is a proposal rehearsal, not a reservation. The formal reservation ID is `null`, formally reserved money and ledger writes are zero, actual cost is unavailable before submit, and project/episode quotas remain explicitly `NOT_CONFIGURED`; only the existing global Provider budget window is projected. Every Provider, database, ledger, task, queue, submit, poll, download, webhook, and paid-authority field must remain at its literal zero or false value or the adapter fails closed. No second budget ledger, workflow state, reservation authority, or business truth is created in Harness.

## Offline Gate A control evidence

`gateAControlEvidence` accepts only an empty request and sends one authenticated, body-free GET to Yimeng's existing `/api/qingmu/provider-gate-a/control-evidence` endpoint. The Host requires the exact eight-scenario order and assertions for unauthorized blocking, duplicate acknowledgement, payload-SHA conflict, `submission_unknown` quarantine, simulated reconciliation, poll recovery, download recovery, and truncated-download rejection. It also validates canonical relative source paths, every source SHA-256, the fixed temporary-SQLite/scripted-fake environment, and the RFC 8785 content-addressed evidence SHA.

This receipt proves only offline fault-injection control logic. External Provider calls, production-database writes, budget-ledger writes, duplicate paid submissions, unknown-state automatic resubmissions, reconciliation Provider calls, recovery resubmissions, accepted truncations, and network egress must remain literal zero or the adapter fails closed. The endpoint cannot run a scenario, reconcile a task, generate media, submit work, grant paid authority, or infer human signoff; real paid production remains `UNVERIFIED_FOR_PAID_PRODUCTION`.

## Continuity evidence

The optional `workflow.director.continuityDelta` field is `jason.qingmu-continuity-delta.v1`, bound to the exact storyboard revision and every adjacent canonical Shot in `frameNo` order. If present, its exact fields, source SHA, IDs, booleans, four ordered dimensions, current binding, and historical readiness relationships are validated; malformed evidence fails the workflow read closed. Omission preserves compatibility with older upstreams.

Current SHA fields require materialized assets with IDs. Stored audit SHA declarations may survive missing audit IDs, but such incomplete evidence cannot claim historical readiness or current binding. `legacyEvidenceReady` retains Yimeng's existing historical semantics. `currentEvidenceReady` additionally requires matching current/audit asset IDs and SHAs, the selected video/tail task lineage, a selected non-stale next first frame, and no stale handoff. Unknown dimensions stay `null`. No check, selection, Finding, lock instance, or human approval is created.

## Selected video review

`selectedVideoReview` accepts only project, episode, and canonical frame IDs. It reuses Yimeng's existing `/api/frames/{frameId}/video-candidates` GET and returns metadata for the uniquely selected asset only. Root identity, selection flags, review status, decision, asset ID/SHA, revision, numeric fields, and acceptance checks must agree. Pending, stale, and invalid responses cannot carry an old review. An accepted but unselected candidate is never promoted.

The normalized response preserves original defects, notes, and zero, fractional, or null timecodes. Missing legacy content SHA and defects remain explicitly absent. Yimeng verifies current media and frame binding; the Host does not hash media bytes, and an invalid asset's stored SHA is not proof of its current file. Media URLs, asset timestamps, and costs are omitted. Existing machine-failure exceptions remain labeled records, not machine passes or independently revalidated approval authority. This read creates no Finding, lock, task, selection, or human signoff.

## Selected Take acceptance evidence

`takeAcceptance` accepts exactly `projectId`, `episodeId`, and canonical `frameId`, then sends one authenticated, body-free GET to the selected Take's `/take-versions/acceptance` route. The Host validates the RFC 8785 evidence SHA, exact current selection identity, output SHA binding, strict full-video decode receipt, frame-count-based actual average frame rate, current macro/micro QC records, and either the real Provider outbox receipt or the explicitly bounded local dry-run state. Unknown fields fail closed, so local paths, media URLs, and raw Provider responses cannot cross into the browser.

Local media and QC may pass independently of Provider verification. The response therefore keeps `UNVERIFIED_FOR_PAID_PRODUCTION`, `selectedIsApproval: false`, and `gateBCompleted: false` even when a historical Provider outbox receipt is fully verified. This read performs no Provider call, database write, selection, approval, budget mutation, or human signoff.

## Shot Finding ledger

`shotFindings` accepts exactly `projectId`, `episodeId`, and canonical `frameId`, then sends one authenticated, body-free GET to `/api/qingmu/projects/{projectId}/episodes/{episodeId}/frames/{frameId}/findings`. Yimeng owns both the current selected-video subject and the original Finding journal. The Host verifies exact fields, canonical subject SHA, positive `frameNo`, nonnegative safe-integer revisions, original eight-field payloads, `OPEN` status, reviewer identity, and unique Finding/event IDs. An absent asset version is the existing zero sentinel, not a newly assigned version.

The feed separates `currentBinding` from history; missing current media does not erase prior records. `canRecordFinding` means only the explicit project reviewer feature, not current media availability, method availability, or approval. Recording and GET receipt recovery use the separate command adapter. This read never chooses an Owner, changes severity, approves a video, or executes rework.

## Production unit bindings

`productionUnits` accepts exactly `projectId` and `episodeId` and sends one authenticated, body-free GET to `/api/qingmu/projects/{projectId}/episodes/{episodeId}/production-units`. It preserves `jason.qingmu-production-unit-feed.v1`: current group sources, the latest explicit binding for each unit, owner capability, and original text. It validates exact fields, source and binding canonical SHAs, project/episode/group identity, unique group/unit identities, positive safe-integer group and Shot numbers, ordered unique Shot members, and nonnegative storyboard revisions. Nonconsecutive Shot numbers are valid; no unit ID is derived from a group number. IDs and text use Python-compatible whitespace and Unicode code-point limits without rewriting the input.

Historical bindings remain readable when the current group is unavailable or absent. `currentBinding` must match the current source and its SHA exactly; `canBindUnit` represents only Yimeng's existing owner permission. Historical method definitions and their stored SHA fields are retained, not re-attested against the current Core rules. The feed fixes `planSealed: false`, `providerCalls: 0`, `humanSignoffInferred: false`, and `reworkExecuted: false`. This endpoint does not bind a unit, seal a plan, approve a Stage, select media, or execute rework. The root and `/types` export `YimengProductionUnitsRequest`, `YimengProductionUnitsResponse`, `YimengProductionUnitSource`, `YimengProductionUnitDefinition`, and `YimengProductionUnitBinding`.

## Current LSU plan source

`lsuPlanSource` accepts exactly `projectId`, `episodeId`, and the Host-derived current C5F lock-rule SHA. It sends one authenticated, body-free GET to `/api/qingmu/projects/{projectId}/episodes/{episodeId}/lsu-plan/source`. The exact non-empty subject contains only sorted current Production Unit bindings and the independently approved `PRODUCTION_BLUEPRINT_LOCK` lineage. The Host validates unique unit and group IDs, positive binding and artifact-record revisions, canonical SHAs, exact coordinates, and the requested lock-rule generation before a Method compiler may use it.

The latest durable seal remains historical evidence. `latestSealSourceCurrent` may be true only when that seal's complete subject, subject SHA, and lock-rule SHA match today's source; unavailable current scope does not erase the old receipt. `canSealPlan` reports Yimeng's existing permission only. This read performs no seal, Stage approval, lock activation, rework, Provider call, or signoff, and it does not turn a historical receipt into current authority.

## Episode-script source references

`stageSources` accepts exactly `projectId` and `episodeId` and sends one authenticated, body-free GET to `/api/qingmu/projects/{projectId}/episodes/{episodeId}/stage-sources`. It validates `jason.qingmu-stage-source-feed.v1`, the fixed `A1S` coordinate, the seven-field `episode_script` source descriptor, canonical subject and binding hashes, binding revision, original receipt IDs, and the non-approval flags. Yimeng computes `contentSha256` from the complete stored script JSON, including metadata; this endpoint carries no script text and does not reproduce that content hash in the Host.

`latestBinding` retains the original source-reference receipt even when the script is missing or changed. `currentBinding` may only be that latest receipt with an exact match to the current source and subject SHA; an older matching record cannot replace it. `canBind` reports existing owner permission independently of source availability. A source reference is not a `SCREENPLAY_PACKAGE`, a completed stage, an approved artifact, a lock, or workset authority. The root and `/types` export `YimengStageSourcesRequest`, `YimengStageSourcesResponse`, `YimengStageSource`, `YimengStageSourceDefinition`, `YimengStageSourceBinding`, and `YimengStageSourceResult`.

## Security boundary

The same configured handler is also provided as the Host-only `qingmuYimengRead` capability. Internal consumers can reuse the existing `workflow`, `productionUnits`, `lsuPlanSource`, and `stageSources` GETs without creating another HTTP client, token configuration, or cache. Cordis removes the capability when its owning plugin unloads. This does not reinterpret business-stage completion, selected media, or unknown forwarded fields as named IMAGO Stage/LSU approval.

The default upstream is `http://127.0.0.1:8115`. A configured base URL must remain an HTTP or HTTPS loopback address. Protected reads take `YIMENG_API_TOKEN` from the Host environment and send it only as an `Authorization: Bearer` header; the adapter does not read `localStorage` or `JWT_SECRET`, send cookies, or return the token. Requests use `cache: no-store`, a timeout, caller cancellation, and fail-closed redirect handling. Ordinary JSON responses remain capped at 5 MiB. Only the script response is capped separately at 20 MiB so a legal command body near 5 MiB can still return the parsed script plus its escaped canonical evidence without making the read unbounded.

## Three independent authorities

- Harness execution authority does not grant permission to mutate Yimeng data.
- `budget.valid`, remaining balance, `releaseReady`, and `qualityPassed` are status facts and never paid Provider authorization.
- The adapter marks human signoff and production readiness as not inferred; only verifiable authenticated human review can supply human acceptance.

## Model Experience

### Host read projection

#### What the model sees

Nothing. The `/qingmu-yimeng` response returns to the Client connection, and `qingmuYimengRead` serves internal Host consumers; the adapter registers no prompt, tool schema, tool result, or other model-visible context.

#### Token effect

Zero direct token effect because read results remain outside model context.

#### KV Cache effect

Independent. Reading or cancelling a projection does not change a model request or its reusable prefix.

## Known Limitations and Deferred Work

- The adapter remains read-only and local. Script mutations use the separate private command adapter and an explicit ChangeSet preview; this channel has no write, generation, approval, or release endpoint.
- Missing Host credentials fail protected reads before any upstream request.
- Script integrity comparisons in the browser use the Host-verified `scriptSha256`, without reproducing Python float spellings such as `1e-06`. Finding coordinates contain only safe integers and use the separately bounded canonical subject contract.
- A healthy response proves liveness only, while a workflow projection reports facts without authorizing production or delivery.
