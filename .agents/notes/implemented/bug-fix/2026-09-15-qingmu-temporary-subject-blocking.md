# Agent Note: Qingmu temporary subject blocking

Status: implemented

English | [中文](2026-09-15-qingmu-temporary-subject-blocking.zh.md)

## Problem

A room-only preview cannot verify actor screen positions or crops, although the director can mistake a successful preview for that evidence.

## Decision

The existing layout preview accepts per-image `imageSubjects` in addition to fixed-object states. The Writer composes these labelled actor/prop boxes on a copy, rejects ID collisions, and uses that exact composition for saved asset images and shot first frames. The native director uses the same fields in single-shot and batch preparation.

## Alternatives considered

A room-only preview cannot establish actor screen side, foreground overlap or a head crop. Making actors permanent room objects would leak an earlier shot's cast into later compositions. Temporary subject volumes address the missing geometry without another service, editor or approval step. They carry an authored placement basis and never claim measured anatomy.

## Consequences

Loader-backed director tests pin unchanged transport of temporary boxes. Writer tests exercise real projection reversal and occlusion, scoped API preview, persisted planning, identical queued image bytes, stale-input detection and absence in a subsequent unstaged view. The preview does not verify gaze, limb articulation, performance or actual generated fidelity. Multimodal video references remain explicit; a blockout is not silently appended or substituted for identity/voice inputs.
