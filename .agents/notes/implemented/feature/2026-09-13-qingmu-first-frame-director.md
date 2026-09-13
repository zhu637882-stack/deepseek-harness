# Agent Note: Qingmu first-frame director input

Status: implemented

English | [中文](2026-09-13-qingmu-first-frame-director.zh.md)

## Problem

A shot could inherit both older world-layout proposals and its current shared scene. Native directors could reconcile video sources but could not inspect the actual first-frame image preparation.

## Decision

Expose the existing Writer shooting preview through the native command adapter and a bound director tool. The cockpit supplies an editable starting-image instruction. The primary directing method reads full current sources, saves a reconciled segment context and independent still, then inspects the actual compiled prompt. Working references retain their exact IDs, hashes and purposes. Existing source freshness, plan persistence, generation and adoption remain in their owning modules.

## Alternatives considered

Deleting world prose by keyword loses creative intent. Another compiler would diverge from the submitted request. The shared preview keeps one production path and lets the director resolve meaning.

## Consequences

Directors inspect the real input without paid image generation. Old projects keep their source and save path; edits preserve unrelated directing fields. Preparation may retain a local preview file but neither queues media nor grants approval. Semantic reconciliation and image fidelity require separate verification.

Live verification found a missing compatibility-target update after the skill body changed. The source manifest now includes reviewed prior versions and the previous release; the existing compatibility regression covers all current targets. Planning read failures appear in the shooting assistant with a read-only retry, preserving the typed request and preventing a send until recovery.

Further live checks exposed generic HTTP 409 errors hiding the image model input limit. The adapter now relays bounded, redacted validation details, and the editable instruction tells the director to reconcile repeated descriptions without truncating creative design. Shooting selection also resolves current frame-to-scene bindings across all scenes, independently of a retained planner selection.

The actual repair turn saved twice and then blocked its own preview: the binding still held the first saved context when the pre-refresh check expected the second. Before-refresh validation now accepts only the connected history of this consumed turn's successful receipts. The post-refresh check requires its latest context. Composition regressions cover two saves around a rejected image preview, a stale final refresh, and unrelated script, scene or storyboard changes.

A second project exposed another readback failure: Writer's identical imagePrompt/imagePromptCn/visual and flattened camera/blocking copies exceeded the inline result capacity. The model view now names exact duplicates through JSON-pointer aliases while retaining the full directorPlan and all conflicting values. The original host receipt is unchanged. A rich-plan regression crosses the former output limit, reopens the full design, then saves another decision without losing the starting image. Unique content beyond the remaining capacity still fails explicitly; this is lossless deduplication, not unlimited context.
