# Agent Note: Qingmu reference image inspection

Status: implemented

English | [中文](2026-09-12-qingmu-reference-image-inspection.zh.md)

## Problem

The native director can read asset descriptions while lacking access to the actual reference pixels. Descriptions alone cannot establish visible costume, light count or prop orientation, and can preserve stale visual decisions.

## Decision

The reference tools expose one current-project image by catalog page, asset ID and SHA256. The existing read adapter validates the local signed media URL. The tool verifies source bytes and stores the image through the existing attachment service, then emits a logged image result for an image-capable director. A text-only director uses the explicitly configured visual observer through the same LLM service, keeping its main creative model. The observer receives the actual attachment; request, observations and usage are logged, and unchanged successful observations are reused. Capability admission precedes download; selection changes discard late results. The preset distinguishes observation from inference and reuses unchanged images already in context. Its observer uses a Qwen3.7 Plus snapshot through the existing pi-ai adapter and per-home provider settings; no separate transport or provider framework is introduced. A real DeepSeek vision-alias trial misidentified a parts tray and cable attachment surface, so accepting image input alone does not qualify a model for director decisions.

## Alternatives considered

Descriptions without pixels retain the original blind spot. Arbitrary URL or filesystem tools expand access beyond the bound project. Base64 text transcripts duplicate bytes and bypass the existing durable attachment mechanism. A second asset store duplicates storage and model projection.

## Consequences

Required observation events are included in the generated runtime persistence vocabulary. The replay test checks that every emitted observation event is readable by a cold session load; ordinary webpage restoration verifies the existing log after restart. Inspection requires a working attachment store and an image-capable main model or configured observer. The observer makes one bounded prepared call without automatic retries; incomplete responses are explicit failures. Its report remains attributed advice rather than the main director claiming direct visual perception. Original source hashes identify the asset; attachment references identify its normalized image. Viewing does not approve, adopt or regenerate media. Model image input uses the normal model allowance. A single view cannot prove hidden geometry, physical dimensions or full-film continuity.

## Testing

The shipped YAML preset runs through Loader, real adapters, the agent loop and local attachment storage. Its keyless snapshot contains the image result; the following model request references the same durable image. Failure cases cover wrong assets, hashes, audio entries, unsupported models, invalid media, size limits and selection changes. The text-only composition verifies actual image input to the observer, attributed text back to the main director, reuse, incomplete responses and late selection changes. Real model interpretation is verified separately from this transport evidence.

Pre-production requests now carry the current project and episode in a separate durable user-message block. The asset and scene designers read saved asset design and paginated image metadata with qingmu_read_asset_design, then reuse qingmu_view_reference_image without a shot binding. Scope comes from the single human request consumed in the tool call's turn, never from model arguments, historical chat or later queued work. Existing shot-bound reads retain their selection checks. The same media/hash/attachment/vision path serves both stages; no second asset store or generation route is added. Saved design reads do not overwrite newer unsaved user input. Viewing does not select a candidate.

An actual multi-view trial preserved room identity but nearly repeated the original camera. Asset authoring now derives the requested camera move from fixed landmarks and checks the resulting foreground, occlusion and off-camera objects before describing the new image. This is creative guidance, not a geometric guarantee or automatic acceptance of a generated view.

Adopting another design no longer clears omitted image model, prompt rewriting, framing or reference choices. Entity identity is retained only through an exact ID or unique kind/name match. Explicit resets remain possible. Native asset authoring now sees the current image model catalog; provider model names alone do not imply a separately trained camera-control capability.

Saved reference-draft reads now deliver the bound images on the requested catalog page directly to image-capable directors. Each visual input retains its binding token, asset ID, source SHA and original image design. Missing pages, stale bindings, failed media reads and attachment limits remain explicit; they do not erase the editable draft or silently choose replacements. Unbound images are not loaded. Text-only directors keep metadata and may explicitly request the configured observer; this read never calls that observer. Video metadata remains unobserved until actual frames are inspected. Historical metadata-only results remain replayable.
