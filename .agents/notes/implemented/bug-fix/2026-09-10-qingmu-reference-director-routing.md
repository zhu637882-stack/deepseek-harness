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

The director can author generationContext to apply the film bible to one segment. It replaces the unscoped bible in production only; full research, source freshness, project style and every other current-shot execution field remain intact. A film-wide action sequence can otherwise compete with a later shot's starting state. The authoring prompts require relevant world exceptions, identities, space, materials, light and departmental decisions to survive this reconciliation. No keyword filter chooses what to omit. Legacy plans without a nonempty context retain their compilation until explicitly revised. Tests cover scoped production, complete research, dialogue and custom methods, invalid field types and unchanged legacy behavior; actual media still requires review.

The same canonical save accepts an optional starting-image description alongside full-shot `visual` direction. Both use the existing atomic planning edit and exact-request recovery; omission preserves the still. This closes the native tool gap without another PromptIR path or automatic media regeneration.

Normal assembly accepts one purpose for each bound reference and appends the exact current production design as the final text. The native model no longer needs to repeat the plan or produce a second constraint section. Purpose assembly and free authored prompt parts are mutually exclusive, while both save the existing browser-editable format. The legacy explicit director-text insertion remains available for intentional manual edits. Copying retains world exceptions, film style, shot decisions and dialogue; adjacent-shot research remains separate. Source hashes and complete-result size validation apply before persistence. Reference-purpose prose and contradictions already in the source still require semantic review; assembly cannot prove observation or generated-media quality. This keeps creative changes in the existing director-plan tools without banning particular camera moves, dialogue structures or story exceptions.

The reference editor and director assistant share one saved draft. The user retains control over unsaved browser edits, media adoption and generation. The change adds no database, generation authority or media selection.

## Testing

The runnable keyless native example snapshots the actual preset and required-tool output. The real preset/loop composition checks model-visible routing, preserves quoted dialogue during a performance edit, and verifies that each missing reference tool prevents mounted status without I/O. Existing regressions cover stale revisions, shot switches and recovery after an uncertain save. External model replies and Writer HTTP in that composition remain scripted; these checks do not establish autonomous model choice, media quality or paid generation.

The native catalog also carries recorded audio/video durations and explicit Wan 3 reference limits. Unknown duration stays unknown. The director can plan multiple voice samples within the total duration allowance; no single-speaker rule or automatic removal of required dialogue is introduced. The browser displays the same duration metadata, while authoritative byte inspection still governs preparation.

The selected-shot read deliberately omits the full film bible to keep its receipt bounded. It identifies the existing reference-draft read as the complete current film/world/asset source. Nonempty inherited-context writes require that logged source and check it again before submitting; recovering an already committed write does not demand a new source. This prevents a missing current source from being silently replaced by old session descriptions, but leaves creative contradictions for director review.

A rich saved plan can exceed the inline read limit when repeated in both the context snapshot and selected planning row. The model view omits only context fields exactly duplicated by the complete planning row or its director plan. Different values remain visible; the retained receipt and source identity remain complete. Native composition tests save and reopen a rich design through the ordinary tools under the real spill limit.

Bound-image reads return JSON and image attachments together. The receipt reader accepts that logged result, so a successful current-film read satisfies the source requirement for a subsequent director save. It still rejects additional text, errors, mismatched calls and changed source data. The shipped-loop regression verifies both successful saving with an attached image and refusing a source changed after that same read.

The manual scene editor previously displayed receipt-bound initial planning direction after the native director had saved newer shooting decisions. It now projects current creative fields by shot identity, retaining original structural text. Clean copies refresh on a committed revision; dirty or pending copies do not. An explicit current-design edit applies supplied creative fields even when restoring an original value, while legacy requests preserve their comparison behavior. Automatic storyboards use the same rich editor through their existing edit operation. Regressions cover cleared fields, custom departments, dialogue sources, native refresh, pending recovery and restored original values.
