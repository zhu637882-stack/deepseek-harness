# Agent Note: Native Qingmu screenplay writing

Status: implemented

English | [中文](2026-09-11-qingmu-native-writing.zh.md)

## Problem

The Story workspace accepted scripts but did not let the operator ask the native director to write one. A separate chat did not return its screenplay to the project editor.

## Decision

Use the existing DSH session, prompt and history APIs with the shipped director preset. Pass current project settings and source text explicitly. Store one non-secret session coordinate per project episode in the browser. Read only completed assistant text; adopting its fenced screenplay fills the existing editor before parsing and saving.

## Alternatives considered

A second model client would duplicate credentials and skill loading. Binding screenplay creation to an existing shot would prevent writing a new project. Writing directly into the saved script would discard the operator's review and edits.

## Consequences

Native writing uses the configured model and its existing billing. Refreshing or reading history does not submit another turn. An uncertain admission stays recoverable through its original session. Project switching does not reuse another project's draft. Model output still needs creative review and editing.

## Testing

Focused browser checks cover adoption, completed text extraction, hidden reasoning exclusion, failed turns, isolation and unknown-admission protection. The runnable `model-tools-keyless.ts --story` example uses the shipped preset and actual agent loop, replaces only the external model, reads the writer method, and projects the resulting screenplay through the same UI parser. Its transcript has a regression snapshot. Real model quality and the full film are separate runtime checks.

Scene design shares this unbound writing channel and keeps a separate session per scene. It reads saved assets and effective film settings before requesting complete Leos direction. Adoption validates source and dialogue coverage, while the scene-planning save binds identities and preserves department fields for video compilation. The keyless `model-tools-keyless.ts --scene` example exercises the shipped director and camera methods through the native loop; its completed structured output has a transcript snapshot.
