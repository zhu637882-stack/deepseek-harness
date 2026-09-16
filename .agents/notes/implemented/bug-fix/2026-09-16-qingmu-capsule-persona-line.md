# Agent Note: Qingmu capsule persona line

Status: implemented

English | [中文](2026-09-16-qingmu-capsule-persona-line.zh.md)

## Problem

The director persona injects the human-approved experience capsules that apply to the current session. When a project had no approved capsule, the injected text was empty, and the resulting persona ended in a blank line: the model received a trailing empty paragraph and the committed persona snapshots recorded it. A non-empty block also needed its own line, so the placeholder could not simply move inline without deciding who supplies the line break.

## Decision

`renderExperienceCapsulesBlock` owns the line break. It returns `''` when no capsule is rendered, and otherwise returns the block prefixed with a single `\n`. The preset keeps `{{experience_capsules}}` inline at the end of the last persona paragraph, so an empty store interpolates to nothing and a populated store starts a new line. The renderer adds no trailing blank line at either end.

## Alternatives considered

**Keeping the placeholder on its own persona line** was rejected because an empty store then always leaves a blank line, and the blank line is exactly what a project without approved capsules should not send.

**Stripping blank lines while rendering the persona** was rejected: the trim would apply to every preset author, hiding genuine paragraph breaks and moving the decision away from the one call site that knows whether a block exists.

**Leaving the trailing line break in the block and moving the placeholder inline** was rejected because the block would then end the paragraph with an extra break whenever a capsule existed, which is the mirror image of the reported defect.

## Consequences

Persona text for capsule-free projects matches the committed snapshots byte for byte, and each capsule block starts its own line without a trailing blank one. The rule is now carried by one function and its `@returns` contract instead of by whitespace in the preset, so a later preset edit that relocates the placeholder must keep the inline position or move the line break with it. The rendering change does not alter which capsules are selected, their order, or the line limit.
