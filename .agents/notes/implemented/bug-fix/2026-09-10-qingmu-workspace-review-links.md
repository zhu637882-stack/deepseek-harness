# Agent Note: Qingmu visual asset checks and review navigation

Status: implemented

English | [中文](2026-09-10-qingmu-workspace-review-links.zh.md)

## Problem

Private references need visible images for character and scene comparison. A delivery blocker is actionable only when the user can identify the affected shot and return to its review workspace.

## Decision

Asset cards reuse the authenticated preview hook within the viewport margin. At most two private thumbnails read concurrently, and leaving the area cancels reads and releases full images. Public images and explicit audio previews do not occupy these slots. Failed reads preserve the placeholder and existing detail retry. Compact delivery rows show the reported blocker count and prioritize choosing a missing video before later handoff checks; an explicit button selects that shot for viewing through the existing navigation guard.

## Alternatives considered

**Public media URLs or a new thumbnail service.** Existing scoped preview reads cover this small image library without new storage or endpoints.

**Another delivery issue dashboard.** Existing per-shot rows already contain the authoritative blocker list, so they carry the navigation action directly.

## Consequences

Previewing or navigating cannot adopt a video, approve content or invoke generation. Original media and Writer data remain unchanged. Source registration for imported videos remains separate work.

## Testing

Client tests cover lazy private reads, detail retry, exact-shot navigation and unchanged selection. Runtime checks inspect actual project images and navigation from delivery to shooting at desktop and mobile widths. These checks establish UI behavior, not creative acceptance.
