# Agent Note: Complete director design in the native workbench

Status: implemented

English | [中文](2026-09-11-qingmu-complete-director-plan.zh.md)

## Problem

Editing a camera label or video draft cannot preserve a complete director design. Performance, sound, continuity and new creative fields need the same durable planning operation, with canonical dialogue identities retained.

## Decision

The native director tools read the complete planning response and patch creative fields through the existing Writer scene-planning handler. Read receipts bind the current source; identical uncertain saves recover the same operation before another write. A verified save advances the native turn's context without granting generation or adoption. Structural planning edits retain creative fields and dialogue delivery details.

## Alternatives considered

**Another design store** would split project truth. **Prompt-only edits** leave the canonical design unchanged. **A fixed list of creative fields** discards future specialist output. The existing planning operation owns persistence and concurrency.

## Consequences

Real native composition exercises full-plan saves, source changes, uncertainty and continuation through the command adapter. Writer requires the matching complete-plan API changes. Reference prose still requires reconciliation with new designs before generation; persistence and lossless transport do not establish semantic agreement, creative quality or runtime deployment.
