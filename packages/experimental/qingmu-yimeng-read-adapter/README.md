# Qingmu Yimeng read adapter

English | [中文](README.zh.md)

This private experimental Host plugin is the read-only BFF between Qingmu OS and the Yimeng API. It registers the loopback-only `/qingmu-yimeng` RPC channel and exposes `health`, `projects`, `episodes`, `script`, `elementProfile`, `referenceCandidates`, `selectedVideoReview`, `shotFindings`, and `workflow`; it exposes no mutation endpoint.

## Contract

`health` normalizes anonymous liveness and runtime identity fields. `projects` normalizes pagination, `episodes` returns a validated project episode list, `script` returns the authoritative structured episode script with its optimistic revision and a Host-verified `scriptSha256`, `elementProfile` reads an actor, scene, or prop from `/api/qingmu/projects/{projectId}/elements/{elementKind}/{targetId}`, `referenceCandidates` reads the same element's candidates from the `/reference-candidates` child route, and `workflow` requires the exact `jason.episode-workflow-projection.v1` schema and its strong top-level fields while retaining unknown JSON fields.

For a found script, Yimeng supplies the exact Python-canonical JSON text and its SHA-256 beside the parsed script. The Host hashes those exact UTF-8 bytes, parses the canonical text, recursively rejects non-finite numbers and integers outside JavaScript's safe range in both parsed projections, and deep-compares it with `script`; any hash, numeric-safety, or content mismatch fails closed. The canonical text is then removed, so the browser receives only the parsed script and verified `scriptSha256`. Legal finite floats such as Python `1e-06` remain valid. For `found: false`, the upstream canonical text and hash must both be `null`.

All three element profiles use the same evidence boundary: the Host hashes the exact `canonicalSnapshot` bytes, parses and checks safe JSON numbers, deep-compares the result with the `jason.qingmu-element-profile-subject.v1` subject, and removes `canonicalSnapshot` before returning the verified `snapshotSha256`. Runtime validation accepts exactly `actor`, `scene`, and `prop`: actor subjects bind `actorId` and `visualIdentity`, while scene and prop subjects bind `sceneId` or `propId` and `visualPrompt`. Every other kind, identifier, field, or subject-shape mismatch fails closed.

`referenceCandidates` requires `jason.qingmu-reference-asset-candidates.v1`, `targetType: element_profile`, the requested project, element kind and target ID, a non-negative profile revision, a lowercase `elementSnapshotSha256`, and literal `humanApprovalInferred: false`. Each returned candidate contains only `assetId`, `sha256`, `materializedSha256`, `bindingValid`, `projectId`, `sourceEpisodeId`, `ownerType`, `ownerId`, `role`, `localPath`, `qualityStatus`, `selectionStatus`, `isSelected`, `generationJobId`, `sourceRevisionId`, `formalConsistencyCheckId`, `formalConsistencyPassed`, `qualityProjectionSha256`, `decisionKind`, and `decisionIdentity`. The Host validates candidate project and owner binding, IDs, booleans, SHA-256 fields, and the exact `Unselected | Selected | Rejected | Stale`, `pending | passed | failed`, and `none | referenceSelection | humanReview` value sets before returning the projection.

The `workflow.director.heroFrameStoryboards` sibling projection joins one-to-one with the E5-1 canonical Shots and exact storyboard revision. It validates the selected first-frame asset binding, a bounded integer `0..10000` annotation grid, Shot-local Actor/Prop references, deterministic `subjectLayout`, `objectAnchors`, and `actionTrajectory` compilation, and every stable SHA before returning it. Expiring `browserUrl` values are deliberately excluded from `shotsSha256`; the asset ID, media SHA, and binding SHA remain covered. This is a read projection only, not a second canvas repository or revision system.

The `workflow.director.shotRelations.shots` array projects Yimeng's canonical storyboard frames without adding a Shot authority. Each Shot carries `shotId`, the sole Shot ordering field `frameNo`, `durationSec`, and derived `dialogueRhythm`; it never carries a Shot-level `order`, `sortOrder`, or `sequence`. Each element carries `currentReferenceAvailability` plus either `currentReference: null` or the uniquely selected E4-3 reference's `assetId`, `sha256`, and lineage. The adapter does not choose references or persist Shot selection state.

The package root exports the request and response types, including `YimengHealth`, `YimengProjectsResponse`, `YimengEpisodesResponse`, `YimengScriptResponse`, `YimengElementProfileRequest`, `YimengElementProfileResponse`, `YimengReferenceAssetCandidate`, `YimengReferenceCandidatesRequest`, `YimengReferenceCandidatesResponse`, `YimengShotRelationShot`, `YimengShotDialogueCue`, `YimengShotDialogueRhythm`, `YimengShotCurrentReference`, `YimengShotCurrentReferenceLineage`, `YimengShotRelationsProjection`, `YimengHeroFrameStoryboardsProjection`, and `YimengWorkflowProjection`.

## Continuity evidence

The optional `workflow.director.continuityDelta` field is `jason.qingmu-continuity-delta.v1`, bound to the exact storyboard revision and every adjacent canonical Shot in `frameNo` order. If present, its exact fields, source SHA, IDs, booleans, four ordered dimensions, current binding, and historical readiness relationships are validated; malformed evidence fails the workflow read closed. Omission preserves compatibility with older upstreams.

Current SHA fields require materialized assets with IDs. Stored audit SHA declarations may survive missing audit IDs, but such incomplete evidence cannot claim historical readiness or current binding. `legacyEvidenceReady` retains Yimeng's existing historical semantics. `currentEvidenceReady` additionally requires matching current/audit asset IDs and SHAs, the selected video/tail task lineage, a selected non-stale next first frame, and no stale handoff. Unknown dimensions stay `null`. No check, selection, Finding, lock instance, or human approval is created.

## Selected video review

`selectedVideoReview` accepts only project, episode, and canonical frame IDs. It reuses Yimeng's existing `/api/frames/{frameId}/video-candidates` GET and returns metadata for the uniquely selected asset only. Root identity, selection flags, review status, decision, asset ID/SHA, revision, numeric fields, and acceptance checks must agree. Pending, stale, and invalid responses cannot carry an old review. An accepted but unselected candidate is never promoted.

The normalized response preserves original defects, notes, and zero, fractional, or null timecodes. Missing legacy content SHA and defects remain explicitly absent. Yimeng verifies current media and frame binding; the Host does not hash media bytes, and an invalid asset's stored SHA is not proof of its current file. Media URLs, asset timestamps, and costs are omitted. Existing machine-failure exceptions remain labeled records, not machine passes or independently revalidated approval authority. This read creates no Finding, lock, task, selection, or human signoff.

## Shot Finding ledger

`shotFindings` accepts exactly `projectId`, `episodeId`, and canonical `frameId`, then sends one authenticated, body-free GET to `/api/qingmu/projects/{projectId}/episodes/{episodeId}/frames/{frameId}/findings`. Yimeng owns both the current selected-video subject and the original Finding journal. The Host verifies exact fields, canonical subject SHA, positive `frameNo`, nonnegative safe-integer revisions, original eight-field payloads, `OPEN` status, reviewer identity, and unique Finding/event IDs. An absent asset version is the existing zero sentinel, not a newly assigned version.

The feed separates `currentBinding` from history; missing current media does not erase prior records. `canRecordFinding` means only the explicit project reviewer feature, not current media availability, method availability, or approval. Recording and GET receipt recovery use the separate command adapter. This read never chooses an Owner, changes severity, approves a video, or executes rework.

## Security boundary

The same configured handler is also provided as the Host-only `qingmuYimengRead` capability. Internal consumers can reuse the existing `workflow` GET without creating another HTTP client, token configuration, or cache. Cordis removes the capability when its owning plugin unloads. This does not reinterpret business-stage completion, selected media, or unknown forwarded fields as named IMAGO Stage/LSU approval.

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
