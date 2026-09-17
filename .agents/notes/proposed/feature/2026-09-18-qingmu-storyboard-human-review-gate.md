# Agent Note: Qingmu storyboard pre-production human review gate

Status: proposed

English | [中文](2026-09-18-qingmu-storyboard-human-review-gate.zh.md)

## Problem

The Writer already owns a complete storyboard pre-production human review gate. In the writer repository (`workflow-pilot-20260909/writer`), `GET /api/episodes/{episode_id}/storyboard-human-review` returns the whole episode's review state (`backend/src/jason/apps/studio/api.py:22463`), `POST` on the same path atomically accepts the exact current frame set (`api.py:22544`), and a per-frame route exists at `api.py:22482`. Passing the gate is what clears the `storyboard_human_review_required` blocker that `_require_storyboard_human_review_gate` (`api.py:963`) enforces before later first-frame and video submission.

The Qingmu cockpit has no surface that reaches any of it. Nothing in `client-ui-qingmu-cockpit` calls those routes, and neither yimeng adapter registers a bridge for them. The live consequence is measurable rather than theoretical: `command_receipts` holds 181 rows and not one of them is a storyboard human-review receipt, so the gate has never been passed from this cockpit. An operator working in the cockpit therefore reaches a pipeline stage that cannot advance, with no control to advance it and no message naming the blocker.

## Proposal

Add the missing entry point as a read bridge, a command bridge, and one cockpit panel, following the `entity-draft-review` template already proven in this repository.

**A read bridge** — [storyboard-human-review.ts](../../../../packages/experimental/qingmu-yimeng-read-adapter/src/storyboard-human-review.ts) registers the exact Host route `/api/qingmu/storyboard-human-review/state`. It is GET-only and writes nothing. It forwards only the caller's own `jason_token=` cookie (bounded at 8192 bytes, refused if it contains CR or LF), refuses any request carrying `authorization`, and requires `isTrustedApiRequest`. Before the state reaches the browser, `validState` re-derives it from its own frame list instead of trusting the summary fields: `totalCount` must equal `items.length`, `acceptedCount` must equal the count of frames reporting `accepted`, and `accepted` must equal `items.length > 0 && acceptedCount === items.length` — the same `bool(items) and …` rule the Writer uses in `storyboard_human_review_service.py:1355`. A state that claims the gate passed while its own frames disagree is refused as 409 rather than shown as passable, so an empty frame set can never read as an accepted gate.

**A command bridge** — [storyboard-human-review.ts](../../../../packages/experimental/qingmu-yimeng-command-adapter/src/storyboard-human-review.ts) registers the exact Host route `/api/qingmu/storyboard-human-review/accept`. It additionally requires `origin === http://${host}` and rewrites the forwarded `origin` and `host` to the upstream, matching `require_human_browser_cookie_write` on the Writer side. Per-item keys are restricted to `frameId` and `expectedFrameDigest`; the Writer's item model also accepts `prompt_override`, `preflight_id`, `model` and `resolution`, which route a frame through a paid preflight authority, so refusing them here keeps this decision at `providerCalls: 0` no matter what a browser posts. A 2xx whose receipt cannot be read, or which does not confirm the reviewed frame set, is reported as 502 rather than 409: the Writer commits the whole set in one transaction, so in that case the acceptance may already be recorded and the caller must re-read the state instead of resubmitting under a fresh idempotency key and writing a duplicate review. Only a definitive sub-400 rejection becomes 409, carrying the Writer's own reason code when it reports one.

**A cockpit panel** — [StoryboardHumanReview.tsx](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/StoryboardHumanReview.tsx), rendered from [QingmuCockpit.tsx](../../../../packages/experimental/client-ui-qingmu-cockpit/src/client/QingmuCockpit.tsx) only once an episode is bound, and keyed by episode so switching episodes discards the previous decision state. The browser sends no identity field: the Host bridge authenticates the natural person's own cookie. Acceptance requires a non-empty typed note plus an explicit tick, and the control is absent entirely once the state reports accepted. On a 502 the panel keeps the idempotency key and the note so a retry is an exact replay, but drops the tick, so nothing is ever accepted implicitly. On 401 it drops the key, because both bridges reject before any transaction, and returns the operator to explicit login.

Both bridges register through `ctx.effect(...)` in their package `index.ts` and return the `webServer.register` disposer, so teardown unregisters the exact route.

## Scope and blast radius

Harness only. No Writer change, no schema change, no migration. No live build, deploy, or runtime-root write: the code stops on branch `qingmu-self-learning-loop-20260916` for review. The panel calls no provider and mutates no budget, and the command bridge verifies that promise against the receipt (`providerCalls === 0`, `budgetMutation === false`) instead of assuming it. The read bridge reuses the existing `entity-draft-review` login route `/api/qingmu/editorial-handoff/human-session` ([editorial-handoff-download.ts:48](../../../../packages/experimental/qingmu-yimeng-read-adapter/src/editorial-handoff-download.ts)) rather than adding a second credential path.

## Alternatives considered

**Reuse the per-frame route at api.py:22482.** Rejected. Its request model carries `prompt_override`, `preflight_id`, `model` and `resolution`, so a frame accepted through it can be routed through a paid preflight authority. A gate whose purpose is to record a human creative decision should not be able to spend money as a side effect. The episode route with a two-key item shape cannot.

**Drive acceptance from the director agent.** Rejected. Which storyboard is good enough to produce is the operator's creative decision. An agent that can accept the gate removes the human from the only checkpoint that gates paid generation downstream.

**Show the blocker as text and leave the legacy page as the entry point.** Rejected. That keeps the cockpit pipeline stopping at a stage the cockpit cannot advance, which is the reported defect.

## Acceptance criteria

- `pnpm exec vitest run packages/experimental/qingmu-yimeng-read-adapter packages/experimental/qingmu-yimeng-command-adapter packages/experimental/client-ui-qingmu-cockpit` — 148 files, 2955 tests pass, 4 pre-existing skips. The 27 new tests are 9 per surface.
- The client spec asserts the load-bearing negative cases by name: a gate that already passed offers no accept control; an unknown outcome keeps one idempotency key and never accepts implicitly; a state the bridge refused is surfaced rather than shown as an empty passable gate.
- `pnpm run typecheck` exits 0.
- `oxlint` over the seven changed files exits 0. The repository-wide lint gate is red at this branch's baseline (1045 errors in files this change does not touch, concentrated in `reference-video-tools-composition.spec.ts` and `PromptIrWorkspace.tsx`); this change contributes none.
- The 29 locale keys the panel uses are exactly the 29 defined, in both languages. Three keys the first draft defined but never referenced were pruned rather than left dead.

## Risks

**The browser → Host → Writer chain is not verified end to end.** A `qingmu-storyboard-human-review.e2e.ts` in the shape of [qingmu-entity-draft-human-review.e2e.ts](../../../../apps/web/tests/qingmu-entity-draft-human-review.e2e.ts) is the right next step and is deliberately not included here: it needs a qingmu-profile client build, Playwright Chromium, and the Writer fixture venv, and the host disk had 9.1 GiB free at the time of writing, below the 10 GiB threshold this project stops heavy work at. The field names the bridges validate were instead confirmed by reading the live Writer source — `episode_status` returns `version`/`projectId`/`episodeId`/`storyboardRevision`/`frameSetDigest`/`totalCount`/`acceptedCount`/`accepted`/`blockerCode`/`items`/`providerCalls`/`budgetMutation` at `storyboard_human_review_service.py:1347`, `accept_episode_review` returns `acceptedCount`/`totalCount`/`frameSetDigest`/`items[{frameId, checkId}]`/`providerCalls`/`budgetMutation` at line 1940, and `STORYBOARD_HUMAN_REVIEW_VERSION` is `storyboard-preproduction-human-review-v1` at line 26 — but source agreement is not an executed transcript. Until the e2e runs, treat the wiring as reviewed, not proven.

**The read bridge caps one episode state at 4 MiB.** The state embeds a `frame_status` per frame, each carrying the frame's prompt, preflight findings, source summary and stored review. Live episodes hold up to 49 frames, so the bound is roughly 85 KiB per frame. An episode far larger than that fails closed as invalid rather than being truncated, which is the intended direction, but it would present as a gate that cannot be read.

**A Writer 422 is reported as 409.** Pydantic rejection of the bridge's own upstream body would surface as a definitive rejection rather than as a bridge defect. It fails closed and cannot write a duplicate review, but it would misdirect diagnosis.
