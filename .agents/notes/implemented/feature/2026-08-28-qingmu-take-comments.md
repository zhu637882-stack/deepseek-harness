# Agent Note: Qingmu ordinary Take comments

Status: implemented

English | [中文](2026-08-28-qingmu-take-comments.zh.md)

## Problem

A small production team needs to discuss an exact Take at an exact moment without turning a comment into a Finding, a quality decision, a selection, or an approval. A comment attached only to the visible row would drift when Take versions or the current selection change, while copying comments into Harness would create a second business truth.

## Decision

Yimeng owns the ordinary-comment journal. Every comment is immutable and binds the exact Take subject SHA, Take ID, output SHA, frame lineage, and either a timecode or frame anchor. The read adapter accepts only project, episode, and frame coordinates, performs one authenticated GET, validates exact current-version subjects and SHA identities, and exposes both current and historical bindings.

The command adapter accepts one complete browser intent but sends exactly five fields in one POST body: the expected Take-subject SHA, Take ID, anchor, body, and idempotency key. Path IDs come from the URL, while actor, commenter role, and session come only from Yimeng authentication. The result must declare zero or false impact on selection, technical pass, formal approval, episode verification, human signoff, Provider calls, and budget.

Before POST, the browser stores and reads back the complete non-secret intent in `sessionStorage`. An uncertain result is resolved only by a GET receipt lookup using the original subject SHA, Take ID, and idempotency key; the POST is never retried. The form initially follows the selected Take when available, but choosing another version inside the comment panel never changes selection.

## Alternatives considered

**Reuse Findings for every comment.** Findings carry review severity, ownership, and rework semantics that ordinary collaboration must not imply.

**Attach comments to the currently selected row only.** Selection can change, so the record would lose the exact media and version lineage that gives the comment meaning.

**Retry a POST after an uncertain response.** Even with idempotency, automatic reposting hides the distinction between an unknown write and a confirmed receipt. GET-only recovery preserves that distinction.

**Store a mirrored comment journal in Harness.** A second journal would split authority and require reconciliation. Harness therefore validates and presents Yimeng's journal without persisting business truth.

## Consequences

Team members can leave precise timecode- or frame-anchored notes on any current Take and still read historical notes after versions change. Current binding is derived and verified rather than inferred by the browser. Strict schemas, Host-only credentials, exact result checks, and GET-only recovery fail closed on drift or reflection. This feature intentionally creates no Finding, playback, technical pass, approval, episode verification, human signoff, Provider action, budget mutation, or Take selection.
