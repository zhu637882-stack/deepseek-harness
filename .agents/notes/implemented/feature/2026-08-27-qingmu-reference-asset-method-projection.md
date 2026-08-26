# Agent Note: Qingmu reference-asset method projection

Status: implemented

English | [中文](2026-08-27-qingmu-reference-asset-method-projection.zh.md)

## Problem

The Qingmu asset workbench needs current IMAGO guidance before a person selects a reference asset or requests regeneration. Reusing profile-editing input or its subject-bound proof would blur profile mutation with asset operation intent, while accepting authority fields from the browser could escalate that intent into generation, approval, or selection execution.

## Decision

The private `referenceAssetMethod` Host endpoint accepts exactly `projectId`, `elementKind`, `elementId`, `profileRevision`, `snapshotSha256`, `assetId`, `assetSha256`, and `operation`. It supports actor, scene, and prop targets and only the `selectReferenceAsset` and `requestReferenceRegeneration` operations. The Host adds fixed Yimeng business authority and explicit absence of human approval and paid-provider authority before invoking `compile_qingmu_reference_asset_method.py` with canonical JSON.

The Host validates the complete reference-asset projection before returning it. The target, IMAGO method identity, ordered source bindings, operation, required Yimeng reads, legal work set, and authority fields must match the request and current bounded method. Both the work order and projection must report zero Provider calls, no Worker start, and no executed selection. Unknown projection fields fail closed.

The endpoint uses the same environment-only HMAC key and child-process key removal established by the [element method attestation decision](2026-08-26-qingmu-prop-method-attestation.md), but returns the dedicated `qingmu.imago-reference-asset-method-attestation.v1` proof. Its signature binds the projection hash, canonical input-snapshot hash, and canonical target hash. The proof does not reuse `subjectSha256`, because a reference-asset target includes both the profile version and candidate asset identity.

The existing asset workbench now reads authoritative candidates from Yimeng, calls this method for the explicit candidate and operation, and passes its projection and proof to the Host command adapter. The Host verifies the HMAC and exact snapshot, target, operation, asset ID, and asset SHA bindings before proposing the Yimeng ChangeSet, then strips both method fields from the Yimeng request. Generic preview and commit remain user-confirmed. A v3 recovery marker binds the operation and candidate ID/SHA before the commit `POST`; recovery is an explicit GET-only lookup, and marker clearance requires matching element-profile and reference-candidate rereads.

## Alternatives considered

**Reuse the element-method request and attestation unchanged.** That request describes profile editing and binds a profile subject, not a candidate asset plus operation. A dedicated request and `targetSha256` preserve the distinct meaning without adding another authority source.

**Let the browser send authority or execution flags.** Browser-controlled authority could turn guidance into approval, paid generation, Worker execution, or a completed selection. The Host constructs authority and accepts no execution fields.

**Execute selection or regeneration from this endpoint.** The IMAGO adapter is stateless method guidance, while Yimeng owns business mutation and later authenticated ChangeSets. Execution here would create a second write path and bypass the production pipeline.

## Verification

Package tests cover the exact eight-field input, all three element kinds, both operations, dedicated target-bound HMAC proof, strict projection and source validation, fail-closed authority and execution fields, and missing-key behavior. An integration case invokes the current Core compiler directly and confirms `providerCalls: 0`, `workerStarted: false`, and `selection_executed: false` without a Provider, database write, deployment, or human decision. The browser E2E uses the real Host adapters and IMAGO subprocess to cover authoritative candidate read, method, proposal, generic preview, explicit confirmation, marker-before-POST, commit, lost-response GET-only recovery, and both authoritative rereads. It also commits regeneration intent while proving zero Provider calls, no Worker start, and no automatic selection.

## Consequences

Harness can now carry the bounded reference intent through the existing loopback Host channel and Yimeng ChangeSet pipeline without starting generation or executing selection automatically. A recorded selection remains distinct from authenticated human approval or signoff, and a regeneration request remains intent-only. Actual generation, automatic selection, approvals, signoff, Provider authority, and Phase 3 completion remain separate work.
