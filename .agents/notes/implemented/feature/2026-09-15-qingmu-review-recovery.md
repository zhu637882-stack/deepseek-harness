# Agent Note: Qingmu review recovery and asset focus

Status: implemented

English | [中文](2026-09-15-qingmu-review-recovery.zh.md)

## Problem

Long review reports collapsed the video area. Asset cards exposed all technical fields before the object identity. Returned batch videos required manual collection even though their jobs already persisted on the server. Prop guidance encouraged surroundings that could contaminate later scene references.

## Decision

The existing review workspace scrolls around a height-bounded player, and reports and asset settings use native disclosure controls. The batch component reads existing jobs on entry and polls pending jobs, registering returned candidates through the existing idempotent service. A visible synchronization state prevents actions from silently colliding with refresh. The prop method uses clean identity images and separates optional interaction demonstrations.

## Alternatives considered

A second batch store would duplicate durable provider jobs. Automatically approving or selecting returned candidates would confuse technical completion with creative acceptance. Longer negative prompts would not remove unwanted pixels already present in a reference image.

## Consequences

Existing accepted media and candidate choices remain intact. Reopening the page recovers submitted work; unsubmitted requests still require preparation and explicit submission. Focused tests cover collection failures, page reentry without resubmission, collapsed editable asset fields and review details. The native preset example pins the assembled director instructions. Actual generated continuity and whole-film sound still require a new media trial after common repairs.

The reference editor checks the saved draft while visible and when focus returns. A changed server draft replaces clean local input and clears obsolete previews; unsaved edits retain their original revision for conflict detection. Source hashes are copied from the saved request, never automatically approved. Failed review projection refreshes are retried without repeating successful candidate registration.
