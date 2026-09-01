# Agent Note: Freeze canonical evidence packages exactly once

Status: implemented

English | [中文](2026-09-01-canonical-evidence-package-freeze.zh.md)

## Problem

The editorial return path had a technically checked master candidate but no owner action that could freeze the canonical machine-evidence package. Rebuilding a package in the Host or browser would create a second evidence authority, while an ambiguous response could otherwise duplicate a package or authority advance.

## Decision

Yimeng owns preview, commit, recovery, and status. Preview binds current release-readiness facts, returned-master technical QC, source identities, and build identity. Confirm uses one request digest and persistent idempotency key. A process lock plus the existing ChangeSet, outbox, receipt, and evidence-authority records make package materialization and authority advancement exactly once across duplicate clicks, concurrent processes, crashes, and response loss.

The implementation calls the canonical `EvidencePackageService`; it does not construct a Harness package. Canonical retrieval revalidates the manifest and every byte. Existing Writer-owned `qingmu/...` media paths are accepted only when they resolve to an existing file below the configured storage root; absolute, traversal, arbitrary-prefix, missing, or altered material remains rejected.

The Host exposes only strict loopback status, preview, and confirm contracts. It recomputes the canonical request SHA and, after an ambiguous response, reads the original receipt rather than submitting another build. The cockpit shows machine blockers before enabling explicit confirmation and keeps human delivery signoff plus the release checklist separate and open.

## Alternatives considered

**Build the package in Harness.** Rejected because it would duplicate Writer's canonical manifest, storage, evidence-authority, and receipt semantics.

**Retry confirm after an ambiguous response.** Rejected because a network outcome cannot prove whether package materialization or authority advancement committed; recovery must read the original idempotent receipt.

## Verification

Focused Writer tests cover real canonical readiness, canonical package construction, byte tampering, blocker projection, duplicate and concurrent intent, response-loss recovery, crash recovery after authority advancement, and request drift. Host and UI tests cover strict schemas, blocker display, explicit confirmation, late-response safety, and original-receipt recovery. An isolated real FastAPI and built Host browser path demonstrates the honest blocker state without Provider or user-instance writes.

## Consequences

A machine-ready editorial return can produce one recoverable canonical evidence package and one authority revision. The freeze is not content approval, release authorization, publication, or final human signoff; those remain explicit later gates.
