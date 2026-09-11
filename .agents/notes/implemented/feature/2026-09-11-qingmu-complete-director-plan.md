# Agent Note: Complete director design in the native workbench

Status: implemented

English | [中文](2026-09-11-qingmu-complete-director-plan.zh.md)

## Problem

Editing a camera label or video draft cannot preserve a complete director design. Performance, sound, continuity and new creative fields need the same durable planning operation, with canonical dialogue identities retained.

## Decision

The native director tools read the complete planning response and patch creative fields through the existing Writer scene-planning handler. Read receipts bind the current source; identical uncertain saves recover the same operation before another write. A verified save advances the native turn's context without granting generation or adoption. Structural planning edits retain creative fields and dialogue delivery details.

Reference draft saving validates the local request and current creative source without invoking provider preview. The source-bound Writer save precedes temporary media preparation, so a new local draft remains savable when provider URLs are unavailable. The native preset states this order; actual preview, quotation and generation retain their material-readiness checks. A composition regression exercises a rejected preview followed by successful save and readback, including rejection of extra model controls before any write.

Complete planning data is retained in the existing session receipt event, while the model receives the full selected-shot design and bound context without duplicate episode planning copies. This keeps ordinary multi-shot episodes below the tool-result spill limit without weakening source checks. The receipt becomes usable only after its matching successful view is logged; session replay preserves that pairing. The shipped preset regression includes the actual spill policy and an episode larger than its inline limit.

Planning serializes fractional timings and measurements with the same RFC 8785 rules as Writer. Save and recovery preserve these numbers and share the same request digest; unrelated legacy integer-only receipts retain their existing encoding. Invalid numeric inputs fail before transport with a specific diagnostic. Cross-language digest fixtures and the native preset exercise subsecond action beats.

## Alternatives considered

**Another design store** would split project truth. **Prompt-only edits** leave the canonical design unchanged. **A fixed list of creative fields** discards future specialist output. The existing planning operation owns persistence and concurrency.

## Consequences

Real native composition exercises full-plan saves, source changes, uncertainty and continuation through the command adapter. Writer requires the matching complete-plan API changes. The reference draft reader now returns current script, director and style sources separately. The director reconciles them into one authored prompt and binds its source digest; the Writer compiler only resolves reference aliases and never appends hidden creative instructions. Preview and saving an old draft remain available; quotation and dispatch reject stale creative sources. The workspace exposes the current design and explicit author reconciliation. A digest proves freshness, not semantic agreement or artistic quality; real model output and runtime deployment still require verification.
