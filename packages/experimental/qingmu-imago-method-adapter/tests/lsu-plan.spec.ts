import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { continuityJson } from '../../qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'
import {
  LSU_PLAN_IDS, lsuPlanFeed, lsuPlanSha, lsuPlanSubject,
} from '../../qingmu-yimeng-read-adapter/tests/lsu-plan-fixture.ts'
import { createImagoMethodHandler } from '../src/index.ts'
import {
  attestLsuPlanMethod, buildLsuPlanSnapshot, LSU_PLAN_RULE_PATHS, parseLsuPlanMethodRequest,
  readLsuPlanRules, type LsuPlanRules,
} from '../src/lsu-plan.ts'
import type {
  ImagoLsuPlanMethodProjection, ImagoLsuPlanMethodResponse, ImagoLsuPlanMethodSnapshot,
} from '../src/types.ts'

const CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT
const KEY = 'lsu-plan-method-test-key-'.repeat(3)
const signal = () => new AbortController().signal

function projection(
  snapshot: ImagoLsuPlanMethodSnapshot,
  rules: LsuPlanRules,
): ImagoLsuPlanMethodProjection {
  return {
    schema: 'qingmu.imago-lsu-plan-method.v1', subject: snapshot.subject,
    subjectSnapshotSha256: snapshot.subjectSnapshotSha256, definition: rules.definition,
    ruleBindings: rules.hashes, rulesSha256: lsuPlanSha(rules.hashes),
    lockRuleBindings: rules.lockHashes, lockRulesSha256: lsuPlanSha(rules.lockHashes),
  }
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('current LSU plan Method', () => {
  it('accepts only the business coordinate pair', () => {
    expect(parseLsuPlanMethodRequest(LSU_PLAN_IDS)).toEqual(LSU_PLAN_IDS)
    for (const value of [
      { ...LSU_PLAN_IDS, lockRulesSha256: '0'.repeat(64) },
      { ...LSU_PLAN_IDS, methodProjection: {} },
      { ...LSU_PLAN_IDS, actorId: 'owner' },
      { projectId: ' plan-project', episodeId: 'plan-episode' },
    ]) expect(() => parseLsuPlanMethodRequest(value)).toThrow()
  })

  it.skipIf(!CORE_ROOT)(
    'runs the current Core compiler after two authoritative source reads and signs its exact rules',
    { timeout: 60_000 },
    async () => {
      if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
      const rules = await readLsuPlanRules(CORE_ROOT, continuityJson)
      const lockRulesSha256 = lsuPlanSha(rules.lockHashes)
      const read = vi.fn(async (request: { lockRulesSha256: string }) => ({
        ok: true as const, value: lsuPlanFeed(request.lockRulesSha256),
      }))
      const handler = createImagoMethodHandler({ coreRoot: CORE_ROOT }, {
        runCompiler: vi.fn(), readLsuPlanSource: read,
      })
      const result = await handler('lsuPlanMethod', LSU_PLAN_IDS, signal())
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoLsuPlanMethodResponse
      expect(read).toHaveBeenCalledTimes(2)
      expect(read).toHaveBeenNthCalledWith(1, { ...LSU_PLAN_IDS, lockRulesSha256 }, expect.any(AbortSignal))
      expect(read).toHaveBeenNthCalledWith(2, { ...LSU_PLAN_IDS, lockRulesSha256 }, expect.any(AbortSignal))
      expect(Object.keys(value.projection.ruleBindings).sort()).toEqual([...LSU_PLAN_RULE_PATHS].sort())
      expect(value.projection).toEqual(projection(
        buildLsuPlanSnapshot(LSU_PLAN_IDS, lsuPlanFeed(lockRulesSha256), lockRulesSha256, continuityJson),
        rules,
      ))
      const { signature, ...unsigned } = value.methodAttestation
      expect(signature).toBe(createHmac('sha256', KEY).update(continuityJson(unsigned), 'utf8').digest('hex'))
    },
  )

  it.skipIf(!CORE_ROOT)('rejects any source drift after compilation', async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    const rules = await readLsuPlanRules(CORE_ROOT, continuityJson)
    const lockRulesSha256 = lsuPlanSha(rules.lockHashes)
    const current = lsuPlanFeed(lockRulesSha256)
    const changedSubject = lsuPlanSubject()
    const productionUnits = changedSubject.productionUnits.map((unit, index) => index === 0
      ? { ...unit, bindingRevision: unit.bindingRevision + 1, bindingSha256: '6'.repeat(64) }
      : unit)
    const changed = { ...current, subject: { ...changedSubject, productionUnits } }
    changed.subjectSnapshotSha256 = lsuPlanSha(changed.subject)
    const read = vi.fn().mockResolvedValueOnce({ ok: true, value: current })
      .mockResolvedValueOnce({ ok: true, value: changed })
    const compiler = vi.fn(async (snapshot: ImagoLsuPlanMethodSnapshot) => projection(snapshot, rules))
    const handler = createImagoMethodHandler({ coreRoot: CORE_ROOT }, {
      runCompiler: vi.fn(), readLsuPlanSource: read, runLsuPlanCompiler: compiler,
    })
    expect(await handler('lsuPlanMethod', LSU_PLAN_IDS, signal())).toMatchObject({
      ok: false, error: { code: 'internal' },
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(compiler).toHaveBeenCalledOnce()
  })

  it.skipIf(!CORE_ROOT).each([
    ['subject', (raw: ImagoLsuPlanMethodProjection) => ({ ...raw, subject: { ...raw.subject, projectId: 'other' } })],
    ['definition', (raw: ImagoLsuPlanMethodProjection) => ({
      ...raw, definition: { ...raw.definition, stageApprovalAllowed: true },
    })],
    ['rule path', (raw: ImagoLsuPlanMethodProjection) => ({
      ...raw, ruleBindings: { ...raw.ruleBindings, '/tmp/untrusted': '0'.repeat(64) },
    })],
    ['lock rules', (raw: ImagoLsuPlanMethodProjection) => ({ ...raw, lockRulesSha256: '0'.repeat(64) })],
    ['extra authority', (raw: ImagoLsuPlanMethodProjection) => ({ ...raw, approved: true })],
  ] as const)('rejects forged compiler %s', async (_name, forge) => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    const rules = await readLsuPlanRules(CORE_ROOT, continuityJson)
    const lockRulesSha256 = lsuPlanSha(rules.lockHashes)
    const snapshot = buildLsuPlanSnapshot(
      LSU_PLAN_IDS, lsuPlanFeed(lockRulesSha256), lockRulesSha256, continuityJson,
    )
    expect(() => attestLsuPlanMethod(forge(projection(snapshot, rules)), snapshot, rules, continuityJson, KEY)).toThrow()
  })

  it('fails closed before compilation without a current reader or valid HMAC key', async () => {
    const compiler = vi.fn()
    const withoutReader = createImagoMethodHandler({ coreRoot: '/not-read' }, {
      runCompiler: vi.fn(), runLsuPlanCompiler: compiler,
    })
    expect(await withoutReader('lsuPlanMethod', LSU_PLAN_IDS, signal())).toMatchObject({ ok: false })
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', 'short')
    const read = vi.fn()
    const invalidKey = createImagoMethodHandler({ coreRoot: '/not-read' }, {
      runCompiler: vi.fn(), readLsuPlanSource: read, runLsuPlanCompiler: compiler,
    })
    expect(await invalidKey('lsuPlanMethod', LSU_PLAN_IDS, signal())).toMatchObject({ ok: false })
    expect(read).not.toHaveBeenCalled()
    expect(compiler).not.toHaveBeenCalled()
  })

  it.skipIf(!CORE_ROOT).each(['before', 'first-read', 'compiler', 'second-read'])(
    'discards cancellation at the %s boundary', async (when) => {
      if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
      const rules = await readLsuPlanRules(CORE_ROOT, continuityJson)
      const controller = new AbortController()
      let reads = 0
      const read = vi.fn(async (request: { lockRulesSha256: string }) => {
        reads += 1
        if (when === 'first-read' || (when === 'second-read' && reads === 2)) controller.abort()
        return { ok: true as const, value: lsuPlanFeed(request.lockRulesSha256) }
      })
      const compiler = vi.fn(async (snapshot: ImagoLsuPlanMethodSnapshot) => {
        if (when === 'compiler') controller.abort()
        return projection(snapshot, rules)
      })
      if (when === 'before') controller.abort()
      const handler = createImagoMethodHandler({ coreRoot: CORE_ROOT }, {
        runCompiler: vi.fn(), readLsuPlanSource: read, runLsuPlanCompiler: compiler,
      })
      expect(await handler('lsuPlanMethod', LSU_PLAN_IDS, controller.signal)).toMatchObject({
        ok: false, error: { code: 'cancelled' },
      })
    },
  )
})
