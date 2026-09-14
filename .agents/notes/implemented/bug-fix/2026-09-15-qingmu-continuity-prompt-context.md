# Agent Note: Qingmu continuity context in batch preparation

Status: implemented

English | [中文](2026-09-15-qingmu-continuity-prompt-context.zh.md)

## Problem

Batch preparation supplied only missing shots to the director. Existing shots could establish a different location or character state, but were absent from that request. The request also treated saved direction as already reconciled, allowing reference purposes to contradict it.

## Decision

Batch requests include every shot with an explicit preparation flag. Existing parser rules still permit outputs only for missing drafts. Shared reference guidance reconciles visible cast, camera side and prop contents with the saved design; it does not create a second production prompt. Screenplay and asset instructions address causal scene prerequisites and independently reusable props at their source. The native persona carries the same responsibilities through its shipped composition.

## Alternatives considered

**Only add negative constraints to video text.** This leaves contradictory source actions and misleading images intact.

**Rewrite or regenerate existing shots during batch preparation.** This would expand the selected operation and replace work without creative acceptance. Existing shots remain context only.

## Consequences

The director receives more episode context and must judge source consistency. This is not a deterministic visual-quality guarantee. Collection refreshes the existing review projection while preserving individual registration failures. Component request snapshots and the real preset's keyless native-loop snapshot verify delivery of the instructions; actual creative improvement still requires reviewing newly authorized media.
