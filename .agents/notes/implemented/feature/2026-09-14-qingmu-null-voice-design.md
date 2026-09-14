# Agent Note: Empty voice identity in native asset designs

English | [中文](2026-09-14-qingmu-null-voice-design.zh.md)

Status: implemented

A real native asset candidate used `voiceIdentity: null` for its scene and prop. The client admitted and retained those cards, but Writer's string contract rejected the entire save with HTTP 422. The failure did not change the saved project.

The shared design parser now converts explicit null voice identities to empty text. Omission remains distinct so incremental candidates retain existing voice descriptions. Other non-string values fail before card replacement. This applies to native adoption, manual import and recovered local drafts; Writer's existing canonical string contract remains unchanged.

## Validation

Four focused regression cases fail before the fix and pass after it: actor, scene and prop null values survive unmount/recovery and reach the save command as empty strings; a numeric value retains the previous cards and sends no save. The component's rendered error has a keyless inline snapshot. Current build and actual save/quote evidence are recorded in the project STATE.md.
