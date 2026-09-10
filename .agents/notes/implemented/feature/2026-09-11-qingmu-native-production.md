# Agent Note: Qingmu native project generation

Status: implemented

English | [中文](2026-09-11-qingmu-native-production.zh.md)

## Problem

A material connection tied to one pilot project leaves newly created projects unable to generate. A heartbeat-only worker cannot finish requests submitted from the ordinary workspace.

## Decision

The native API and existing Writer worker share one explicitly configured owner, credential fingerprint and budget window. Provider preflight verifies the project owner in the instance database. Every new project shares the same cumulative allowance; creating or switching projects does not reset spending. The worker uses the existing queue, reservation, submission and result-ingestion services.

## Alternatives considered

Rebinding the runtime for each project prevents independent use of the project library. An unrestricted credential without ownership and budget checks would allow unrelated work to spend the operator's allowance. A second queue would duplicate recovery and billing.

## Consequences

Native production excludes the earlier pilot configuration modes. It changes local generation availability, not DSH model calls or creative approval. Credentials remain private; the API and worker must restart together after configuration changes. Existing receipts and task identities remain intact.

## Testing

Focused checks cover private credential validation, shared API/worker settings, ordinary worker startup, cross-project budget exhaustion and foreign-owner rejection. Real provider output recovery is verified separately from creative acceptance. The runtime film validation exercises the resulting website workflow.

New creation binds the same checksum-verified native director, writer and camera method files that DSH loads. Existing projects retain their saved method identities. The runnable keyless creation example verifies the assembled API and shared budget transcript against its snapshot.
