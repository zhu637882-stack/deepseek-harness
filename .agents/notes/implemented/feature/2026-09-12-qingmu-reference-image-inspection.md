# Agent Note: Qingmu reference image inspection

Status: implemented

English | [中文](2026-09-12-qingmu-reference-image-inspection.zh.md)

## Problem

The native director can read asset descriptions while lacking access to the actual reference pixels. Descriptions alone cannot establish visible costume, light count or prop orientation, and can preserve stale visual decisions.

## Decision

The reference tools expose one current-project image by catalog page, asset ID and SHA256. The existing read adapter validates the local signed media URL. The tool verifies source bytes and stores the image through the existing attachment service, then emits a logged image result for an image-capable director. A text-only director uses the explicitly configured visual observer through the same LLM service, keeping its main creative model. The observer receives the actual attachment; request, observations and usage are logged, and unchanged successful observations are reused. Capability admission precedes download; selection changes discard late results. The preset distinguishes observation from inference and reuses unchanged images already in context.

## Alternatives considered

Descriptions without pixels retain the original blind spot. Arbitrary URL or filesystem tools expand access beyond the bound project. Base64 text transcripts duplicate bytes and bypass the existing durable attachment mechanism. A second asset store duplicates storage and model projection.

## Consequences

Inspection requires a working attachment store and an image-capable main model or configured observer. The observer makes one bounded prepared call without automatic retries; incomplete responses are explicit failures. Its report remains attributed advice rather than the main director claiming direct visual perception. Original source hashes identify the asset; attachment references identify its normalized image. Viewing does not approve, adopt or regenerate media. Model image input uses the normal model allowance. A single view cannot prove hidden geometry, physical dimensions or full-film continuity.

## Testing

The shipped YAML preset runs through Loader, real adapters, the agent loop and local attachment storage. Its keyless snapshot contains the image result; the following model request references the same durable image. Failure cases cover wrong assets, hashes, audio entries, unsupported models, invalid media, size limits and selection changes. The text-only composition verifies actual image input to the observer, attributed text back to the main director, reuse, incomplete responses and late selection changes. Real model interpretation is verified separately from this transport evidence.
