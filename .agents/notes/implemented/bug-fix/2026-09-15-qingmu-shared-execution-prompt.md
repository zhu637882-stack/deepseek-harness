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

The controlled retake exposed another input omission: batch context carried the catalog but not each shot’s current bindings. It now includes exact saved bindings so the director can inspect the version actually used before considering alternatives. The client composition test exercises a retained corrected scene reference and verifies that old execution prose is not copied into current instructions. The same trial returned a hypothetical repaired plan alongside unresolved-source warnings. Preparation now asks for diagnosis only in that situation, rather than an adoptable shots block.


Candidate observation now uses the existing queue with a blind video/audio rubric: no script, expected dialogue or director plan is sent to the observer. Writer freezes those comparison inputs separately in the task and returns them with the attributed report. This breaks answer leakage rather than adding more negative instructions. The report is observation, not acceptance; model-invented checks cannot become passes. The native director reads one exact candidate report per `reviewPage` through `qingmu_read_reference_video_candidates`, separately from ordinary comments, and compares it with the frozen request and current design. Missing comments no longer imply missing audio review. Scope/hash failures remain unavailable. The browser displays heard words and observations, while single-shot preparation now uses the same execution guidance as batch preparation. No new queue, generator, selection action or automatic approval is introduced.

The read adapter owns a browser-safe `native-video-review` projection shared with the cockpit. Only that pure subpath joins the existing bundle allowlist; the Host adapter stays excluded. Tests exercise the actual director tool composition with an empty comment feed, complete/absent/unavailable/mismatched reports, independent transcripts, uncertain judgments and GET-only recovery. Writer tests prove expected content is absent from the queued provider request but retained in immutable comparison context. Real sample review is still needed: independent observation can itself be mistaken, and neither these tests nor a report-complete state establish video quality.

A registered Take has a different asset ID from its source candidate. Writer now reads prior observations by the same shot and video SHA, retaining the original reviewed asset ID and frozen comparison intent. This recovers existing paid evidence without copying a report from another shot or different video.

The live director received the repaired report but overstated an automatically transcribed extra utterance as certain. Shared preparation and candidate-reading guidance now require attributing model observations as reported evidence; comparison with text cannot independently verify the media. Suspected extra speech remains pending playback confirmation. This changes evidence wording, not acceptance authority or generation behavior.
