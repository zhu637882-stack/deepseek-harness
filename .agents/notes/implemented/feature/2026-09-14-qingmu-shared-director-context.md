# Agent Note: Shared sources for Qingmu director contexts

Status: implemented

English | [中文](2026-09-14-qingmu-shared-director-context.zh.md)

## Decision

Record shared source hashes with an authored generationContext. Track the current episode world, effective creative settings, film direction, bound room and non-scene identities; exclude other rooms, other episodes, asset camera/view jobs and media receipts. Non-scene identities remain conservative dependencies until off-screen actor and prop bindings are complete. Source freshness does not establish semantic correctness or pixel continuity.

Scene planning reads expose current, changed, untracked or not_applicable status without modifying saved shots. Known changed contexts stop new image/video preparation before charging. The complete old plan and current film source remain readable. Legacy untracked contexts remain usable and explicitly unverified; no automatic migration or asset replacement occurs. Newly initialized contexts record the source present at creation; existing contexts record reconciliation only through an explicit matching source hash. An unrelated edit or resaving an unchanged form cannot clear a changed status.

The scene planning page lists affected shots. The shooting composer prepares an editable shared-source reconciliation request; sending invokes the existing director read/save/preview tools. The director must reconcile the context, starting image, camera, blocking, action and continuity together while retaining script exceptions. The save command carries the shared source hash read with the selected shot and checks it inside the Writer transaction. Each shot retains its own dramatic time and design; this does not claim automatic whole-episode rewriting.

Existing scenes also expose whole-scene reconciliation through the native writing session. The request includes every current shot, shared assets and adjacent-scene continuity; a candidate must retain the exact scene, source hashes and ordered shot identities. Unresolved shared-source issues prevent adoption and direct correction to asset design. Adoption retains a local reviewable batch, without writing media or calling the provider again. Explicit saving uses the existing frame requirement commands with the current revision after each receipt, preserving omitted creative fields and script ownership. This is a sequence of recoverable per-frame commits, not an atomic scene replacement. Each intent is persisted before dispatch; a lost reply resumes the identical idempotent request. Source drift stops remaining saves and preserves committed progress. Retaining and abandoning a batch does not undo commits or cancel an uncertain server request. The batch itself is local to this browser; committed designs and native writing remain server-backed.

The canonical and frame-requirement projections include the persisted shot duration and complete dialogue object. Scene reconciliation and the native director read consume those same values instead of estimating timing from old action beats. Source line identities, delivery and unknown dialogue fields survive the read. Older projections remain readable; a missing dialogue field does not declare a silent shot. This exposes creative inputs without granting timing or dialogue edits to reconciliation.

## Validation

Writer tests cover source changes, image/video preparation, read-only recovery, stale saves, unrelated saves, explicit reconciliation and idempotency. A Loader-composed native-tool test proves the read hash reaches the actual save request. UI tests cover affected-shot notices, preservation and explicit sending. Runtime deployment and cross-project evidence belong to STATE.md.

Whole-scene UI tests cover manual and automatic frame saves, complete scene coverage, unresolved source issues, uncertain receipt recovery after reload and shared-source drift between commits. The real writing composer request has a keyless snapshot; backend semantics continue through the existing verified frame-save path.
