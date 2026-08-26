# Qingmu Yimeng read adapter

English | [中文](README.zh.md)

This private experimental Host plugin is the read-only BFF between Qingmu OS and the Yimeng API. It registers the loopback-only `/qingmu-yimeng` RPC channel and exposes `health`, `projects`, `episodes`, `script`, `elementProfile`, `referenceCandidates`, and `workflow`; it exposes no mutation endpoint.

## Contract

`health` normalizes anonymous liveness and runtime identity fields. `projects` normalizes pagination, `episodes` returns a validated project episode list, `script` returns the authoritative structured episode script with its optimistic revision and a Host-verified `scriptSha256`, `elementProfile` reads an actor, scene, or prop from `/api/qingmu/projects/{projectId}/elements/{elementKind}/{targetId}`, `referenceCandidates` reads the same element's candidates from the `/reference-candidates` child route, and `workflow` requires the exact `jason.episode-workflow-projection.v1` schema and its strong top-level fields while retaining unknown JSON fields.

For a found script, Yimeng supplies the exact Python-canonical JSON text and its SHA-256 beside the parsed script. The Host hashes those exact UTF-8 bytes, parses the canonical text, recursively rejects non-finite numbers and integers outside JavaScript's safe range in both parsed projections, and deep-compares it with `script`; any hash, numeric-safety, or content mismatch fails closed. The canonical text is then removed, so the browser receives only the parsed script and verified `scriptSha256`. Legal finite floats such as Python `1e-06` remain valid. For `found: false`, the upstream canonical text and hash must both be `null`.

All three element profiles use the same evidence boundary: the Host hashes the exact `canonicalSnapshot` bytes, parses and checks safe JSON numbers, deep-compares the result with the `jason.qingmu-element-profile-subject.v1` subject, and removes `canonicalSnapshot` before returning the verified `snapshotSha256`. Runtime validation accepts exactly `actor`, `scene`, and `prop`: actor subjects bind `actorId` and `visualIdentity`, while scene and prop subjects bind `sceneId` or `propId` and `visualPrompt`. Every other kind, identifier, field, or subject-shape mismatch fails closed.

`referenceCandidates` requires `jason.qingmu-reference-asset-candidates.v1`, `targetType: element_profile`, the requested project, element kind and target ID, a non-negative profile revision, a lowercase `elementSnapshotSha256`, and literal `humanApprovalInferred: false`. Each returned candidate contains only `assetId`, `sha256`, `materializedSha256`, `bindingValid`, `projectId`, `sourceEpisodeId`, `ownerType`, `ownerId`, `role`, `localPath`, `qualityStatus`, `selectionStatus`, `isSelected`, `generationJobId`, `sourceRevisionId`, `formalConsistencyCheckId`, `formalConsistencyPassed`, `qualityProjectionSha256`, `decisionKind`, and `decisionIdentity`. The Host validates candidate project and owner binding, IDs, booleans, SHA-256 fields, and the exact `Unselected | Selected | Rejected | Stale`, `pending | passed | failed`, and `none | referenceSelection | humanReview` value sets before returning the projection.

The package root exports the request and response types, including `YimengHealth`, `YimengProjectsResponse`, `YimengEpisodesResponse`, `YimengScriptResponse`, `YimengElementProfileRequest`, `YimengElementProfileResponse`, `YimengReferenceAssetCandidate`, `YimengReferenceCandidatesRequest`, `YimengReferenceCandidatesResponse`, and `YimengWorkflowProjection`.

## Security boundary

The default upstream is `http://127.0.0.1:8115`. A configured base URL must remain an HTTP or HTTPS loopback address. Protected reads take `YIMENG_API_TOKEN` from the Host environment and send it only as an `Authorization: Bearer` header; the adapter does not read `localStorage` or `JWT_SECRET`, send cookies, or return the token. Requests use `cache: no-store`, a timeout, caller cancellation, and fail-closed redirect handling. Ordinary JSON responses remain capped at 5 MiB. Only the script response is capped separately at 20 MiB so a legal command body near 5 MiB can still return the parsed script plus its escaped canonical evidence without making the read unbounded.

## Three independent authorities

- Harness execution authority does not grant permission to mutate Yimeng data.
- `budget.valid`, remaining balance, `releaseReady`, and `qualityPassed` are status facts and never paid Provider authorization.
- The adapter marks human signoff and production readiness as not inferred; only verifiable authenticated human review can supply human acceptance.

## Model Experience

### Host read projection

#### What the model sees

Nothing. The `/qingmu-yimeng` response returns only to the Client connection; the adapter registers no prompt, tool schema, tool result, or other model-visible context.

#### Token effect

Zero direct token effect because the response is returned only to the requesting Client connection.

#### KV Cache effect

Independent. Reading or cancelling a projection does not change a model request or its reusable prefix.

## Known Limitations and Deferred Work

- The adapter remains read-only and local. Script mutations use the separate private command adapter and an explicit ChangeSet preview; this channel has no write, generation, approval, or release endpoint.
- Missing Host credentials fail protected reads before any upstream request.
- The browser does not reproduce Python canonical JSON. Integrity comparisons use only the Host-verified `scriptSha256`, including for legal Python float spellings such as `1e-06`.
- A healthy response proves liveness only, while a workflow projection reports facts without authorizing production or delivery.
