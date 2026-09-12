# Agent Note: Qingmu candidate sound and picture review

Status: implemented

English | [中文](2026-09-12-qingmu-candidate-audio-review.zh.md)

## Problem

A playable candidate does not prove dialogue delivery or continuous environmental sound, and frame-only inspection cannot hear the original track.

## Decision

The shooting workspace sends explicit review requests through the existing Writer queue and budget. The native review model receives the original video and verified generation-bound prompt once, avoiding competing current or still-image instructions. In the absence of a bound prompt it receives the saved design. Candidate review records time-based observations before comparisons; missing, out-of-range or unlinked visual evidence remains uncertain. The raw provider report remains intact. GET restores saved evidence without submitting, including older reports. A changed method permits an explicit new review without automatically scheduling it. Evidence links seek only the verified candidate and pause playback. Sound categories remain distinct from visible mouth movement; neither establishes video selection.

## Alternatives considered

**Automatic adoption after model review.** Model evidence cannot decide the user's creative acceptance.

**Polling with submission requests.** A changed design could cause an unintended new paid request. Polling uses GET instead.

## Consequences

The existing queue retains cost and recovery ownership. Native audio inference adds a paid request and can be uncertain; it does not establish human approval or cross-shot continuity. Focused transport and rendered UI tests cover explicit submission, read-only recovery, scope rejection and unknown evidence. The running application validates the complete route separately.
