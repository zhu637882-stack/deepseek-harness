# Agent Note: Qingmu scoped material connection

Status: implemented

English | [中文](2026-09-10-qingmu-material-connection.zh.md)

## Problem

Reference-video preparation requires a DashScope key, while the local production binding also grants a historical fixed spending scope. Preparing reference files must work without enabling that production authority or sharing credentials with unrelated services.

## Decision

The owned Python composition accepts one optional native project/episode connection. It validates a private literal key and clones Settings only for the existing reference preview and temporary-material services. The project owner is captured at startup and checked with the frame scope at execution, including transactional rechecks. The API's shared Settings, Worker environment and ProviderGate retain disabled spending. This mode and production/fixture configuration are mutually exclusive; a stopped-instance command connects or disconnects it without a business write or external request.

The existing upload service owns exact bytes, key fingerprint, model, expiry, intent and unknown-outcome handling. Quote checksums include global generation availability. Fresh enqueue rejects disabled spending before any task write; existing receipts remain readable. No new table, worker, queue or model tool is added.

## Alternatives considered

**Load the production environment globally.** This would expose unrelated credentials and couple a free upload to an obsolete budget.

**Create a separate upload pipeline.** This would duplicate the existing receipt, expiry and source-verification logic.

## Consequences

Credentials remain process-local to one material capability. Configuration binds the probed key fingerprint; changed keys fail startup until an explicit reconnect. Rotation invalidates exact-key receipt reuse. Disconnect works without the project database, and repeating it recovers an interrupted audit finalization. An interrupted audit can retain its pending record; the final configuration and latest completed receipt establish the recovered state. The temporary URL is not permanent storage and its presence does not prove a model invocation. Connection tests use actual Writer routes with fake OSS, verify scope denial and unchanged shared authority, and exercise key rotation, stopped-instance connect/disconnect, missing scope and audit failures. Real paid model quality remains outside these checks.
