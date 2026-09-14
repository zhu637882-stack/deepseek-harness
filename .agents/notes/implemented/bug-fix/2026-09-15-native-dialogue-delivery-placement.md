# Agent Note: Native dialogue delivery placement

Status: implemented

English | [中文](2026-09-15-native-dialogue-delivery-placement.zh.md)

## Problem

A real native scene draft put dialogue delivery on the shot root. Planning consumes the nested director plan, so adoption could lose the intended performance.

## Decision

NativeSceneDesign copies an unambiguous root dialoguePlan into directorPlan on adoption. Equal duplicates collapse; conflicting or malformed values keep the draft available for correction. The original response and source checks remain unchanged. Complete scene candidates can also recover missing terminal container brackets using the existing JSON repair dependency; no missing creative value or interior separator is synthesized.

## Alternatives considered

**Reject every misplaced plan.** An otherwise usable draft would require another model call for a deterministic format correction.

**Choose either conflicting plan.** This could silently change the authored performance, so ambiguity still requires correction.

## Consequences

Focused adoption tests cover root placement, equal duplicates, conflicts and malformed values. This small compatibility path preserves delivery text; it does not prove voice or acting quality in generated media.
