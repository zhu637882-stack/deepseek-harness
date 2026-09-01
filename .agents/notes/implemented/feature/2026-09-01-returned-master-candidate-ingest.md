# Agent Note: Persist a returned master as an unselected candidate

Status: implemented

English | [中文](2026-09-01-returned-master-candidate-ingest.zh.md)

## Problem

A successful returned-master preflight proves bounded technical facts, but it does not persist the exact bytes in Yimeng's canonical asset chain. Retrying a browser upload after a lost response could also duplicate bytes or records unless the commit owns one stable receipt lineage.

## Decision

The UI exposes a separate explicit save action only after the bound preflight succeeds. The Host derives one commit capability from the authenticated owner plus the immutable download, import, preflight, package, source, projection, master SHA, size, and stable receipt coordinates. Writer verifies a domain-separated HMAC, current source bindings, and the materialized bytes before atomically creating one canonical asset, one receipt, one ChangeSet, and one outbox record. Bytes use a content-addressed path below the instance-private storage root.

An ambiguous response records an unknown Host state. Recovery performs only the original receipt/list GET; it never resends bytes. Concurrent clicks and a restarted Host converge on the same asset and receipt, while a changed payload, source, projection, preflight, or stored byte fails closed.

## Alternatives considered

Keeping the result only in browser storage was rejected because it would create a second asset truth and would not survive a fresh browser. Reusing the preflight spool as permanent media was rejected because temporary ownership and cleanup rules are different from canonical storage. Treating the import as selected or released was rejected because technical preflight is not a creative or publication decision.

## Verification

Focused Writer service/API tests cover owner scope, HMAC tampering, source drift, payload conflicts, file and database rollback, stored-byte tampering, and exactly-once recovery. Host and cockpit tests cover single-use capability handling, concurrent clicks, response-loss recovery without a second upload, restarted access, strict response normalization, and explicit boundary labels.

## Consequences

The saved asset is always episode-scoped, `Unselected`, quality `pending`, unapproved, and unpublished. No Provider, PromptIR, final output, Ready state, stage, release authority, or human sign-off is created. Selection, quality review, release manifest checks, and user sign-off remain later explicit operations.
