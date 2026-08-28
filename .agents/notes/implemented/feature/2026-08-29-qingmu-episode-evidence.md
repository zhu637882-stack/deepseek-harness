# Agent Note: Qingmu episode evidence and explicit verification

Status: implemented

English | [中文](2026-08-29-qingmu-episode-evidence.zh.md)

## Problem

Take selection, technical QC, review, approval and whole-episode verification have different authority. A static panel cannot prove that the real verifier is reachable, and a stale report cannot establish current readiness. Even SQLite read-only connections can create WAL auxiliary files.

## Decision

Yimeng authenticates the existing project read scope, projects canonical records and runs its unchanged canonical verification facts in a bounded child process. Paths and store come from the running request configuration, never browser input. Only a source SHA enters the POST. The private child does not load checkout environment files or Provider credentials.

Ledger GETs do not probe. A source hash binds the database image, local media, probe sidecars, delivery profile and canonical per-frame records. Sources are checked before and after. DB/WAL files are copied consistently into temporary read snapshots; all SQLite reads, including TaskCenter, use those snapshots without migrations or business-directory writes. A changing original source is rejected. WAL commits are retained rather than ignored with immutable mode.

Harness validates and displays. Explicit verification is single-flight with a hard backend timeout; a fresh Ledger read is required before displaying a result. The UI retires old results on scope changes, refresh and errors. Canonical verification, review, QC, lifecycle and human signoff are never combined into a new approval.

## Alternatives considered

- Calling final/evidence export routes would synthesize or write evidence, violating this read-only slice.
- A browser or API double would not verify the actual authentication, SQLite, media and canonical verifier path.
- SQLite immutable mode would miss committed WAL data. Ordinary read-only mode could create WAL/SHM beside the business database.
- Inferring formal release from one `ok` would erase separate human authority.

## Verification index

- Backend: `tests/test_qingmu_episode_evidence.py`, `tests/test_verify_episode.py`, `tests/test_studio_api_modularity.py`.
- Host: `packages/experimental/qingmu-yimeng-read-adapter/tests/episode-evidence.spec.ts` and affected adapter tests.
- UI: `packages/experimental/client-ui-qingmu-cockpit/tests/episode-evidence.client.spec.tsx`.
- Real chain: `apps/web/tests/qingmu-episode-evidence.e2e.ts` starts the Yimeng writer's `scripts/qingmu_evidence_ledger_fixture.py`, then real Chromium, built Host RPC and actual FastAPI. It uses the existing local Take media fixture and synthetic JWT identity, never a verifier replacement.
- Run with `DSH_CLIENT_BUILD_PROFILE=qingmu DSH_SNAPSHOT=replay QINGMU_E75_YIMENG_ROOT=/absolute/writer/path IMAGO_OS_CORE_ROOT=/absolute/core/path pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/qingmu-episode-evidence.e2e.ts` after `pnpm run build --profile qingmu`. The writer requires its existing Python test environment and local ffprobe/ffmpeg.

## Consequences

Validation on 2026-08-29: backend E7-5/canonical verifier/route-registration tests passed 93/93 (exit 0); the read-adapter package passed 500 tests before the final empty-frame and cross-binding additions, then the changed evidence contract passed 9/9 (exit 0). UI evidence tests passed 9/9 and cockpit tests passed 27/27 (exit 0). Host/client TypeScript, Qingmu build and changed TypeScript lint passed (exit 0). Real-browser refresh and independent fresh-fixture replay each passed 1/1 (exit 0): canonical `ok=false`, `missing_final_output`, missing director execution, one frame with video coverage, stale-SHA rejection and identical whole fixture-directory bytes. No automatic verification was observed.

One bounded independent review found a P1: ledger snapshot limits had leaked into canonical TaskCenter reads. The fix uses direct read-only task access and keeps snapshot policy at the E7-5 boundary; large-DB and later-commit regressions passed. The same reviewer confirmed PASS with no unresolved P0/P1. Invalid-JWT precheck, empty episode handling and cross-feed binding checks were also verified.

The incomplete fixture still exposes an existing general workflow blocker-shape mismatch (`workflow.blockers[0].reason` is absent). The independently authenticated Ledger remains usable and tested without treating that projection as valid. Other cockpit flows and the final director-desk experience are not accepted by this test.

No Provider, paid execution, business DB/approval/signoff mutation, export, deployment or push. Temporary test identities are not real human signoff. Static director assets remain inert. This read-only slice does not prove write-after-read recovery, restart persistence, E8 handoff, or final product acceptance.
