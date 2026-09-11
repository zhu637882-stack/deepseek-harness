# Agent Note: Route director edits through the saved reference draft

Status: implemented

English | [中文](2026-09-10-qingmu-reference-director-routing.zh.md)

## Problem

The shipped director preset described PromptIR suggestions but did not name its existing reference-draft tools. Camera or performance instructions could therefore produce a separate suggestion instead of updating the draft used by the shooting workspace. Readiness checked only six older tools and could report mounted while a reference read, preview or save tool was absent.

## Decision

For an existing-shot edit, the preset reads and saves the complete director plan, reconciles the saved reference draft and saves it through the existing Writer command. Local references can be saved before upload preparation; the exact request is previewed after preparation. The production prompt preserves line-specific delivery, pauses and subtext expressed through performance, motivated camera movement, action prerequisites and continuous sound. Content comparison is separate from matching source hashes; reference roles and story-relevant visible text remain part of that comparison. Unchanged text and references remain intact. Canonical dialogue replacements still use the script ChangeSet tools before reconciling the reference draft; reference text alone cannot prove that the script changed. A changed frame source requires rereading context and methods, not assigning a new hash to old text. Read failures do not mean that no draft exists.

Readiness includes all three reference-draft tools alongside its existing six requirements. It remains a registration check; no probe calls a model, writes a draft or establishes Provider health. PromptIR field suggestions and absent-draft bootstrap retain their existing paths.

## Alternatives considered

Adding a new editing service or automatic synchronization would duplicate the existing draft path and risk replacing unsaved browser input. This change instead routes the preset to the current read/preview/save tools and keeps explicit workspace restoration. Expanding readiness to every available tool would make unrelated optional capabilities block this workflow.

## Consequences

The reference editor and director assistant share one saved draft. The user retains control over unsaved browser edits, media adoption and generation. The change adds no database, generation authority or media selection.

## Testing

The runnable keyless native example snapshots the actual preset and required-tool output. The real preset/loop composition checks model-visible routing, preserves quoted dialogue during a performance edit, and verifies that each missing reference tool prevents mounted status without I/O. Existing regressions cover stale revisions, shot switches and recovery after an uncertain save. External model replies and Writer HTTP in that composition remain scripted; these checks do not establish autonomous model choice, media quality or paid generation.
