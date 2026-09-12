# Reusable room responses

Status: implemented

English | [中文](2026-09-12-qingmu-bundled-room-responses.zh.md)

Three small, unmodified stereo IR recordings from Conner's MIT-licensed IR Library are pinned in Writer with provenance, hashes and original license. The working-cut read exposes their catalog without modifying any episode. Import resolves only catalog IDs, verifies the bytes, and uses the existing scoped local audio import and decode path; retries reuse the same episode asset.

The sound editor and native director import a response explicitly. Imported IRs cannot be used as standalone soundtracks. Independent audio cues retain the existing response asset/hash, wet gain and tail fields, with the existing FFmpeg convolution and dry branch. No scene-specific patch, provider generation or second sound database is added. Unknown presets, changed files and another owner's import are rejected. Importing preserves pending edit decisions and does not create a cut revision.

These recordings describe their source spaces, not measured geometry of a generated set. Technical render/decode checks establish processing, not natural dialogue listening approval.
