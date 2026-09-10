# Agent Note: Qingmu reference video preview

English | [中文](2026-09-09-qingmu-reference-video-preview.zh.md)

Status: implemented

## Problem

A director cannot reliably compare reference-based video requests when media ordering and literal dialogue are mixed in one rewritable prompt.

## Decision

The existing read adapter forwards an explicit draft to Writer's read-only compiler. Stable reference tokens resolve independently for images and audio; literal text stays unchanged. The Host checks scope, ordering, compiled text and body SHA. The existing director editor owns the editable buffer and clears previews on edits. Explicit save/restore uses one draft row per shot with transactional revision and source checks. Saved-draft pricing uses the same compiled request and ProviderGate dry-run; the estimate remains distinct from account billing, budget reservation and generation.

## Alternatives considered

**Generating through LibTV only.** This leaves Qingmu dependent on a separate product's generation account and does not improve the direct model workflow the user requested.

**Rewriting numbered references in plain text.** This can alter quoted dialogue and loses the connection between an edited reference and its asset version.

## Consequences

The implementation extends existing DSH plugins, Writer, TaskCenter, ProviderGate and the dispatch outbox. An explicit single-candidate command binds the saved draft and exact quote in one transaction. Dispatch verifies sources and normalized pricing again; pre-submit failure releases local credit holds atomically. Unknown remote submission stays quarantined. Successful videos require full decoding and return as unselected candidates. Browser reload recovers server tasks and retains uncertain command IDs. Isolated integration tests cover the actual Worker/Gate/media path with only Provider HTTP and downloads stubbed; a YAML Loader test covers Host/Connection. No new paid call or production deployment was performed.

The native director reads, previews and saves this same reference draft through session-bound tools. Writer keeps revision/source conflict detection; the model cannot choose another project or shot. Compilation precedes saving, and uncertain responses require readback. The dark reference desk separates media, editable text and candidates without hiding cost confirmation or overwriting unsaved edits. Preset/agent-loop integration checks real adapters and logged output with scripted external HTTP/model responses; preset disposal removes its registrations.

The primary Director workspace now exposes the scene reference desk without a PromptIR prerequisite. Same-scene inheritance merges only saved versioned bindings, preserves each shot's text and parameters, and rejects conflicts. A three-shot browser exercise verified distinct saved requests and candidate runs over shared references with isolated Writer persistence and scripted Provider transport; this is separate from a deployed full DSH instance.

Existing external videos keep their original upload receipts. A bounded auxiliary source journal binds saved input/result/download records to exact video bytes and the current shot version. The records do not prove which request generated the video or authenticate platform execution; both verification flags remain false and registration does not change selection or approval. Source-journal damage fails source reads without invalidating the original upload receipt. Unknown outcomes recover through the original key and request digest, including historical receipts after a shot edit.
