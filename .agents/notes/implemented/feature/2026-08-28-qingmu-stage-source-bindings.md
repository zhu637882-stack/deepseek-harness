# Agent Note: Qingmu saved-script source references

Status: implemented

English | [中文](2026-08-28-qingmu-stage-source-bindings.zh.md)

## Problem

A saved Yimeng script is a business artifact, not an approved IMAGO screenplay package. Reading a method, editing an unsaved draft, or recovering an old receipt must not silently manufacture a current source registration or stage authority.

## Decision

The three existing Host plugins add source reading, current-method preparation, explicit registration, and original-receipt recovery. The source descriptor binds the project, episode, exact saved revision, and complete saved-script content hash, including edit metadata. Its descriptor hash is separate from the content hash. The method adapter accepts only coordinates, rereads the source, invokes current Core, verifies the fixed nine rule files and source-only definition, and checks source and rules again before issuing a Host-only attestation.

The existing script workspace renders this source reference beside the saved script. It requires owner capability, matching saved coordinates, and explicit confirmation. Draft text does not enter the registration. Before one POST, the client writes and reads back a ten-field non-secret recovery marker. The signed projection is forwarded unchanged with source and binding-revision/SHA compare conditions. Yimeng owns the three-ledger atomic transaction; Harness adds no database or business state machine.

An uncertain POST never retries. Explicit recovery sends the original coordinates through GET even if the current source or method is unavailable. A verified receipt conditionally removes only its matching marker, then triggers an authoritative read. The old receipt alone cannot render a current binding. Current source identity and current method-rule identity remain separate checks. Closure, scope or port changes, source changes, cancellation, and late responses invalidate superseded work.

The new operation's idempotency key is restricted to 8–200 visible ASCII characters, U+0021–U+007E. POST JSON and the recovery HTTP header carry exactly the same value; neither side trims or encodes a replacement. This restriction does not change Unicode project or episode identifiers or any other command. It closes a reproduced failure where a key could be accepted in POST but rejected by Fetch during GET recovery.

## Alternatives considered

**Reuse script editing with a no-op change.** A source reference is a separate explicit intent. It must not edit script content or imply that native script ChangeSet references are trusted method bindings.

**Treat registration as a screenplay package or approval.** The method describes professional requirements, but source registration does not produce the artifact, create a Stage instance, activate locks, seal a plan, or make a workset executable.

**Resubmit after an uncertain response.** Only the original receipt lookup can establish that original command's outcome without another write.

## Consequences

Focused Host and client tests cover exact contracts, source and rule drift, Unicode business IDs, safe integer revisions, stale compare conditions, permissions, storage failures, marker replacement, cancellation, malformed receipts, and recovery without the current method key. A real Loader/Connection test invokes current Core and uses an isolated HTTP upstream. Native Fetch tests prove both pre-send rejection of invalid keys and unchanged POST-to-GET transport of valid keys.

Real Chromium exercises explicit registration of the saved version while the editor contains an unsaved draft, a lost POST response, page reload, original GET recovery with an unavailable source, and a fresh authority read. The source-only historical panel has an assembled accessibility snapshot. Desktop and mobile checks cover the existing workspace. This browser upstream is a local HTTP test double; separate temporary-SQLite and isolated-API tests cover Yimeng transactions. These tests do not constitute a real account-switch login test or formal deployment.

No Provider call, worker, automatic rework, screenplay approval, human signoff, production database mutation, deployment, or push is part of this checkpoint.
