# Agent Note: Qingmu imported dialogue continuity

Status: implemented

English | [中文](2026-09-10-qingmu-imported-dialogue.zh.md)

## Problem

Confirmed script imports identify dialogue with `sourceLineId`. Losing that identity in shot projections prevents precise native edits. A successful dialogue edit also changes the script hash, so equality with the immutable planning origin cannot by itself authorize subsequent structural edits.

## Decision

Writer, the read adapter and the IMAGO method compiler share an explicit linked-but-untimed cue. The existing native dialogue command accepts one unambiguous script identity, updates script and frame copies atomically, and invalidates dependent media and prompts. Native continuation verifies the authoritative new source before rebinding. Reference drafts retain their prior source and require an explicit revision.

Scene planning retains its initial source receipt. It admits a later script only after replaying a contiguous, exact dialogue-only ChangeSet chain, validating each stored payload, command receipt and outbox, and checking current frame copies. Current script revision and hash remain the command's concurrency preconditions. Corrupt receipt data returns a structured integrity error; unrelated script changes remain conflicts.

## Alternatives considered

**Invent timed cues for imported lines.** Text identity does not establish when speech occurs.

**Replace the planning origin with the latest script hash.** This erases provenance and could admit unrelated screenplay replacement.

**Add another dialogue store or recovery queue.** Existing ChangeSets, receipts, snapshots and native session events already own those responsibilities.

## Consequences

The related Writer, Harness and Core consumers must ship together. Duplicate or conflicting identities remain explicit errors. The change preserves source metadata and reference order, without approving media or enabling Provider requests.

## Testing

The runnable keyless native example records actual imported-line reads and previews through the shipped preset. Real temporary Writer services cover repeated edits, response recovery, frame propagation, stale-reference rejection, manual planning continuation and corrupt receipt rejection through HTTP, with no generation tasks. Separate adapter/compiler tests verify identity preservation and reject invented timing. These checks establish workflow behavior, not model quality or human creative acceptance.
