# Agent Note: PromptIR director field mapping

Status: implemented

English | [中文](2026-09-02-qingmu-prompt-ir-director-field-mapping.zh.md)

## Problem

The PromptIR edit method exposed five editable fields but did not declare which admitted director guidance constrained each field. A single Stage E contract hash could not truthfully represent Stage D keyframe guidance or the shared D/E negative prompt.

## Decision

The `promptIrMethod` adapter now emits `qingmu.imago-prompt-ir-field-mapping.v1`. `imageGenPrompt` and `lastFrameImagePrompt` bind Stage D and its keyframe card; `videoGenPrompt` and `motionPrompt` bind Stage E and its video card; `negativePrompt` binds both in D/E order. Each entry carries the Core method hash, stage-specific contract bindings read from the exact Core stage-contract source, and provenance-verified card identities. The mapping, exact card source bindings, and five field hints are revalidated before the Host signs the projection.

The mapping belongs only to the stateless method projection. This slice does not change PromptIR bootstrap, the Yimeng command adapter, cockpit UI, persistence, Provider routing, workers, or business selection. Consumption by the business chain remains a later integration.

## Alternatives considered

**Reuse the Core Stage E hash for every field.** This mislabels Stage D guidance and cannot represent the D/E negative prompt, so each applicable stage carries its own contract binding.

**Bind cards only through free-form hints.** Hints alone do not preserve exact stage, contract, content, repository, and provenance identities, so the structured mapping and source bindings remain authoritative.

## Consequences

Missing, duplicate, reordered, misplaced, or drifted method, stage-contract, card, provenance, source-binding, or hint identities fail closed. The method remains advisory and zero-execution: Provider calls, workers, and maximum cost are zero, while database writes, project-state mutation, approval, selection, and human signoff remain unavailable.
