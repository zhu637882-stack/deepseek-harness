# Agent Note: Qingmu director experience-capsule read-back

Status: proposed

## Problem

The Qingmu director agent has a write side for self-learning — `qingmu_submit_experience_capsule` ([experience-capsule-tools.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/experience-capsule-tools.ts)) lets the director queue one operational lesson (a pitfall it hit plus the concrete rule it will follow next time) into a JSON review queue at the runtime root. That half works: capsules land in `experience-capsule-queue.json`. But the loop never closes. No path promotes an approved capsule into anything a later session reads, and nothing injects approved capsules into the director's model input. A separate writer-side channel (`build_workflow_knowledge_block` in the Python pipeline) does inject curated knowledge, but it filters by workflow stage and all fourteen hand-authored capsules are tagged `video`/`asset` while every caller requests `story`/`script`/`shot` — so that filter drops all of them. Net effect verified against live code: **zero capsules reach the model.** A lesson the director records today is invisible to the director tomorrow.

## Proposal

Close the loop on the harness (Node) side with a read path that mirrors the existing write path, plus a pure merge library for the human promotion step. Three pieces:

**A new read-side/merge module** — [experience-capsule-store.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/experience-capsule-store.ts). It owns the active store next to the runtime identity (`experience-capsules-active.json`, resolved by `capsuleActiveStorePathFor(runtimeRoot)`, the same runtime-root convention the queue uses so the harness process needs no repository path). `loadActiveCapsules(storePath)` reads and validates it, returning `[]` for a missing or malformed store. `renderExperienceCapsulesBlock(capsules, limit=12)` renders the newest-first capsules as one Chinese persona block (`最近踩坑经验（人审入库，本次会话优先遵守）：` followed by `- 症状→规则` lines) or `''` when empty. `mergeApprovedCapsules(queue, active, approvedIds, stagesById)` is a pure function the operator step uses to promote approved queue entries to the front of the active store, supersede any active entry that reuses an id, and drop promoted entries from the queue.

**A scoped persona variable** — in `apply()` of [model-tools.ts](../../../../packages/experimental/qingmu-director-context-bridge/src/model-tools.ts), register `experience_capsules` through `ctx.systemPrompt.variable(...)` (adding `systemPrompt` to the plugin's `inject`). It reads the active store fresh each assembly and always resolves to a string — empty when the store is missing/empty — so the `complete:true` persona still renders. Registered in the preset scope, it shadows any global value. Reading fresh each assembly means a merge reaches the next turn without restarting the director.

**A persona placeholder** — append `{{experience_capsules}}` as the final persona paragraph in [agent.cordis.yml](../../../../packages/experimental/qingmu-web/agent-presets/qingmu-director/agent.cordis.yml). Tail position keeps the long persona prefix byte-stable between merges, so the DeepSeek prompt-cache prefix only moves when capsules actually change.

**A deploy-time seed script** — [seed_experience_capsules.py](../../../../packages/experimental/qingmu-director-context-bridge/python/seed_experience_capsules.py). Pure stdlib so it runs under the same venv the live API and worker use, with no build. It transforms the writer's curated `experience_capsules.json` into the runtime-root active store, idempotently: curated capsules sit newest-first at the front, any capsule a prior human merge already promoted survives at the tail, a malformed curated entry raises. Run it once at deploy, then restart the director. After that, the operator promotes future approved capsules with `mergeApprovedCapsules` (via a script or, later, a cockpit panel).

## Scope and blast radius

Harness read side only. The writer Python pipeline is left untouched — routing capsules there would target the wrong stage filter and add story-phase noise. No live build, deploy, or runtime-root write happens as part of this change; the code lives on branch `qingmu-self-learning-loop-20260916` for review and a safe-window deploy.

## Alternatives considered

**Fix the writer-side stage filter instead.** Rejected: the writer channel filters by workflow stage for good reason (story/script/shot phases get phase-relevant knowledge), and all current capsules are director operational-discipline lessons that apply across phases, not story knowledge. Re-tagging them onto story/script/shot phases would inject execution discipline into unrelated planning turns. The director's own persona is the correct home for lessons the director learns about its own tool discipline.

**Inject capsules straight from the write queue, skipping an active store.** Rejected: the write tool's own contract is that a capsule "reaches future sessions only after approval." Reading the raw queue would let the director inject its own unreviewed text into its own prompt — an unbounded self-write with no human gate, and no way to prune bad lessons.

**A dynamic `systemPrompt.context` contribution rather than a persona variable.** Rejected: a context snapshot is model-visible runtime state that changes turn to turn and sits outside the persona; these are stable curated rules that belong in the persona identity and should share its cache prefix. The variable placeholder also lets the deployment decide placement in the persona rather than the plugin forcing a snapshot section.

**Hardcode the capsule list in the persona YAML.** Rejected: defeats the loop. New approved lessons could never appear without a code edit and redeploy, and the write side would remain decorative.

## Acceptance criteria

- With no active store present, the director persona renders unchanged (the `{{experience_capsules}}` line interpolates to empty) and assembly does not throw.
- With a seeded active store, the rendered persona ends with the `最近踩坑经验…` block listing the approved capsules newest-first, capped at the render limit.
- A capsule promoted through `mergeApprovedCapsules` appears in the next director assembly without a process restart.
- `loadActiveCapsules` returns `[]` (not a throw) for missing, non-JSON, and schema-invalid stores; `mergeApprovedCapsules` promotes only approved ids, dedupes by id, and trims the queue. Covered by [experience-capsule-store.spec.ts](../../../../packages/experimental/qingmu-director-context-bridge/tests/experience-capsule-store.spec.ts) (8 passing tests).
- Seeding the writer's 14-capsule file produces a runtime-root store the read side loads verbatim (newest-first, `stages` preserved); re-seeding is idempotent and keeps a prior human merge. Covered by [test_seed_experience_capsules.py](../../../../packages/experimental/qingmu-director-context-bridge/python/test_seed_experience_capsules.py) (7 passing tests).

## Risks

- **The deploy-time seed is a run-once operator step.** [seed_experience_capsules.py](../../../../packages/experimental/qingmu-director-context-bridge/python/seed_experience_capsules.py) makes it a single idempotent command, but until someone runs it against the runtime root the loop renders empty and behaves exactly as today — safe, but the fix is inert without that step. Recorded here so it is not forgotten at deploy.
- **No operator UI yet.** Promotion runs through the pure `mergeApprovedCapsules` function via a script; a cockpit approval panel is deferred. Reviewers must edit/run by hand until then.
- **Prompt-cache sensitivity.** Placement is at the persona tail specifically to protect the cache prefix; moving the placeholder earlier would invalidate the cached prefix on every merge and raise cost. Any future edit must preserve tail placement.
- **Bilingual sidecar pending.** This note's `.zh.md` counterpart and `.i18n.yaml` sidecar are not yet generated; `doc-sync` will require them before merge.
