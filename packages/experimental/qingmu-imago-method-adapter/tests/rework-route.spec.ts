import { createHmac } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { continuityJson } from '../../qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'
import {
  REWORK_ROUTE_IDS, reworkRouteFeed, reworkRouteRequest, reworkRouteSha, reworkRouteSubject,
} from '../../qingmu-yimeng-read-adapter/tests/rework-route-fixture.ts'
import { createImagoMethodHandler } from '../src/index.ts'
import {
  attestReworkRouteMethod, bindReworkRouteRules, buildReworkRouteSnapshot,
  parseReworkRouteMethodRequest, readReworkRouteRuleSources, REWORK_ROUTE_RULE_PATHS,
  type ReworkRouteRules,
} from '../src/rework-route.ts'
import type {
  ImagoReworkRouteMethodProjection, ImagoReworkRouteMethodResponse, ImagoReworkRouteMethodSnapshot,
} from '../src/types.ts'

const CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT
const KEY = 'rework-route-method-test-key-'.repeat(3)
const signal = () => new AbortController().signal
const temporaryRoots: string[] = []

function projection(
  snapshot: ImagoReworkRouteMethodSnapshot, rules: ReworkRouteRules,
): ImagoReworkRouteMethodProjection {
  return {
    schema: 'qingmu.imago-bounded-rework-route-method.v1', subject: snapshot.subject,
    subjectSnapshotSha256: snapshot.subjectSnapshotSha256, definition: rules.definition,
    routeInstruction: rules.routeInstruction, ruleBindings: rules.hashes,
    rulesSha256: reworkRouteSha(rules.hashes), lockRuleBindings: rules.lockHashes,
    lockRulesSha256: reworkRouteSha(rules.lockHashes),
  }
}

async function copyRuleCore(sourceRoot: string): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), 'qingmu-rework-route-core-'))
  temporaryRoots.push(target)
  for (const path of REWORK_ROUTE_RULE_PATHS) {
    const destination = join(target, path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, await readFile(join(sourceRoot, path)))
  }
  return target
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('current bounded rework route Method', () => {
  it('accepts only the four business coordinates', () => {
    expect(parseReworkRouteMethodRequest(REWORK_ROUTE_IDS)).toEqual(REWORK_ROUTE_IDS)
    for (const value of [
      { ...REWORK_ROUTE_IDS, routeRulesSha256: '0'.repeat(64) },
      { ...REWORK_ROUTE_IDS, methodProjection: {} },
      { ...REWORK_ROUTE_IDS, executeRework: true },
      { ...REWORK_ROUTE_IDS, projectId: ' route-project' },
    ]) expect(() => parseReworkRouteMethodRequest(value)).toThrow()
  })

  it.skipIf(!CORE_ROOT)(
    'runs the current Core compiler after two SHA-bound source reads and signs the exact route',
    { timeout: 60_000 },
    async () => {
      if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
      const sources = await readReworkRouteRuleSources(CORE_ROOT, continuityJson)
      const request = reworkRouteRequest(
        sources.routeRulesSha256, sources.planRulesSha256, sources.lockRulesSha256,
      )
      const feed = reworkRouteFeed(request)
      const read = vi.fn(async () => ({ ok: true as const, value: feed }))
      const handler = createImagoMethodHandler({ coreRoot: CORE_ROOT }, {
        runCompiler: vi.fn(), readReworkRouteSource: read,
      })
      const result = await handler('reworkRouteMethod', REWORK_ROUTE_IDS, signal())
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoReworkRouteMethodResponse
      expect(read).toHaveBeenCalledTimes(2)
      expect(read).toHaveBeenNthCalledWith(1, request, expect.any(AbortSignal))
      expect(read).toHaveBeenNthCalledWith(2, request, expect.any(AbortSignal))
      const snapshot = buildReworkRouteSnapshot(REWORK_ROUTE_IDS, feed, request, continuityJson)
      const rules = bindReworkRouteRules(sources, snapshot.subject)
      expect(Object.keys(value.projection.ruleBindings).sort()).toEqual([...REWORK_ROUTE_RULE_PATHS].sort())
      expect(value.projection).toEqual(projection(snapshot, rules))
      const { signature, ...unsigned } = value.methodAttestation
      expect(signature).toBe(createHmac('sha256', KEY).update(continuityJson(unsigned), 'utf8').digest('hex'))
      expect(value.projection).toMatchObject({
        definition: {
          findingClosureAllowed: false, taskCreationAllowed: false, selectionChangeAllowed: false,
          stageDecisionChangeAllowed: false, lockInvalidationAllowed: false, reworkExecutionAllowed: false,
          providerCalls: 0,
        },
      })
    },
  )

  it.skipIf(!CORE_ROOT)('rejects source drift after compilation', async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    const sources = await readReworkRouteRuleSources(CORE_ROOT, continuityJson)
    const request = reworkRouteRequest(
      sources.routeRulesSha256, sources.planRulesSha256, sources.lockRulesSha256,
    )
    const current = reworkRouteFeed(request)
    const changedSubject = reworkRouteSubject(request.planRulesSha256, request.lockRulesSha256)
    const changedFinding = { ...changedSubject.finding, suggestion: '改变后的返修建议' }
    const changed = { ...current, subject: { ...changedSubject, finding: changedFinding } }
    changed.subjectSnapshotSha256 = reworkRouteSha(changed.subject)
    const read = vi.fn().mockResolvedValueOnce({ ok: true, value: current })
      .mockResolvedValueOnce({ ok: true, value: changed })
    const compiler = vi.fn(async (snapshot: ImagoReworkRouteMethodSnapshot) => projection(
      snapshot, bindReworkRouteRules(sources, snapshot.subject),
    ))
    const handler = createImagoMethodHandler({ coreRoot: CORE_ROOT }, {
      runCompiler: vi.fn(), readReworkRouteSource: read, runReworkRouteCompiler: compiler,
    })
    expect(await handler('reworkRouteMethod', REWORK_ROUTE_IDS, signal())).toMatchObject({
      ok: false, error: { code: 'internal' },
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(compiler).toHaveBeenCalledOnce()
  })

  it.skipIf(!CORE_ROOT)('rejects current Core rule drift after compilation', async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    const coreRoot = await copyRuleCore(CORE_ROOT)
    const sources = await readReworkRouteRuleSources(coreRoot, continuityJson)
    const request = reworkRouteRequest(
      sources.routeRulesSha256, sources.planRulesSha256, sources.lockRulesSha256,
    )
    const read = vi.fn(async () => ({ ok: true as const, value: reworkRouteFeed(request) }))
    const compiler = vi.fn(async (snapshot: ImagoReworkRouteMethodSnapshot) => {
      await appendFile(join(coreRoot, 'docs/qingmu-os/report-source.md'), '\n')
      return projection(snapshot, bindReworkRouteRules(sources, snapshot.subject))
    })
    const handler = createImagoMethodHandler({ coreRoot }, {
      runCompiler: vi.fn(), readReworkRouteSource: read, runReworkRouteCompiler: compiler,
    })
    expect(await handler('reworkRouteMethod', REWORK_ROUTE_IDS, signal())).toMatchObject({
      ok: false, error: { code: 'internal' },
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(compiler).toHaveBeenCalledOnce()
  })

  it.skipIf(!CORE_ROOT).each([
    ['subject', (raw: ImagoReworkRouteMethodProjection) => ({
      ...raw, subject: { ...raw.subject, projectId: 'other-project' },
    })],
    ['route execution', (raw: ImagoReworkRouteMethodProjection) => ({
      ...raw, definition: { ...raw.definition, reworkExecutionAllowed: true },
    })],
    ['owner', (raw: ImagoReworkRouteMethodProjection) => ({
      ...raw, routeInstruction: { ...raw.routeInstruction, earliestOwner: 'A0' },
    })],
    ['rule path', (raw: ImagoReworkRouteMethodProjection) => ({
      ...raw, ruleBindings: { ...raw.ruleBindings, '/tmp/untrusted': '0'.repeat(64) },
    })],
    ['extra authority', (raw: ImagoReworkRouteMethodProjection) => ({ ...raw, approved: true })],
  ] as const)('rejects forged compiler %s', async (_name, forge) => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    const sources = await readReworkRouteRuleSources(CORE_ROOT, continuityJson)
    const request = reworkRouteRequest(
      sources.routeRulesSha256, sources.planRulesSha256, sources.lockRulesSha256,
    )
    const snapshot = buildReworkRouteSnapshot(REWORK_ROUTE_IDS, reworkRouteFeed(request), request, continuityJson)
    const rules = bindReworkRouteRules(sources, snapshot.subject)
    expect(() => attestReworkRouteMethod(
      forge(projection(snapshot, rules)), snapshot, rules, continuityJson, KEY,
    )).toThrow()
  })

  it('fails closed before compilation without a current reader or valid HMAC key', async () => {
    const compiler = vi.fn()
    const withoutReader = createImagoMethodHandler({ coreRoot: '/not-read' }, {
      runCompiler: vi.fn(), runReworkRouteCompiler: compiler,
    })
    expect(await withoutReader('reworkRouteMethod', REWORK_ROUTE_IDS, signal())).toMatchObject({ ok: false })
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', 'short')
    const read = vi.fn()
    const invalidKey = createImagoMethodHandler({ coreRoot: '/not-read' }, {
      runCompiler: vi.fn(), readReworkRouteSource: read, runReworkRouteCompiler: compiler,
    })
    expect(await invalidKey('reworkRouteMethod', REWORK_ROUTE_IDS, signal())).toMatchObject({ ok: false })
    expect(read).not.toHaveBeenCalled()
    expect(compiler).not.toHaveBeenCalled()
  })
})
