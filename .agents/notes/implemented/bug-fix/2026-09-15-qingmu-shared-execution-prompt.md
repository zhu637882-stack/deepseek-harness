# Agent Note: Qingmu shared execution prompt

Status: implemented

English | [中文](2026-09-15-qingmu-shared-execution-prompt.zh.md)

## Problem

Batch preparation selected references and pasted the complete saved design into each video request. The successful Xiaban baseline instead had film-specific scripts authoring concise performance, timing, camera and sound. Both films used batch queueing and the same provider route; queue concurrency alone does not explain their quality difference.

## Decision

The native director authors `executionPrompt` from current design and inspected references. Single-shot tools and the batch component use the same browser-safe `assembleReferencePrompt`. Writer supplies `executionSuffix` with canonical dialogue, visual medium and screen-text scope. These become ordinary saved prompt parts; there is no separate advertising route, provider API or database. The client bundle admits only this pure subpath; the Host adapter remains excluded. The source digest includes the suffix, so unsent old drafts require current-source reconciliation. Frozen-prompt review reads the actual execution description and canonical dialogue. Scene planning preserves continuous performance in a generated segment and puts internal cuts in coverage.

This extends the [reference routing decision](2026-09-10-qingmu-reference-director-routing.md): full-source copying remains available for legacy callers and manual editing, while new automatic preparation authors execution.

## Alternatives considered

**More prohibitions on the pasted document.** They do not supply missing action timing, listener reactions or spatial transitions.

**Film-specific preparation scripts.** They can produce a good example without improving the customer's ordinary workflow.

## Consequences

The existing preparation model turn performs more creative work, without adding a generation call or customer step. Source freshness is not semantic verification: the director can still omit or misinterpret a detail, and actual media must be reviewed. Existing videos and selected takes are unchanged. Focused native-composition and batch tests cover shared assembly, canonical lines, omitted execution, source preservation and frozen review; these are not acceptance of a regenerated film.

The authoring guidance uses the existing scene preview when layout and camera are present, comparing visibility and camera-relative positions with actual reference framing. A blockout without actors cannot verify their staging. This is director preparation guidance, not a new mandatory approval gate or a promise of model compliance.
