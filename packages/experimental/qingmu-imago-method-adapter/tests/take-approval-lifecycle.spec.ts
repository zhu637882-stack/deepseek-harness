import { createHash, createHmac } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TAKE_APPROVAL_LIFECYCLE_REQUEST as request,
  takeApprovalLifecycleFixture,
} from '../../qingmu-yimeng-read-adapter/tests/take-approval-lifecycle-fixture.ts'
import { takeVersionSha } from '../../qingmu-yimeng-read-adapter/tests/take-version-fixture.ts'
import { apply, createImagoMethodHandler } from '../src/index.ts'
import {
  attestTakeApprovalLifecycleMethod,
  buildTakeApprovalLifecycleSnapshot,
  deriveTakeApprovalLifecycleTransition,
  parseTakeApprovalLifecycleMethodRequest,
  readTakeApprovalLifecycleRules,
  TAKE_APPROVAL_LIFECYCLE_RULE_PATHS,
  type TakeApprovalLifecycleRules,
} from '../src/take-approval-lifecycle.ts'
import { takeAcceptanceJcsJson } from '../src/take-acceptance.ts'
import type {
  ImagoTakeApprovalLifecycleMethodProjection,
  ImagoTakeApprovalLifecycleMethodResponse,
  ImagoTakeApprovalLifecycleMethodSnapshot,
} from '../src/types.ts'

const KEY = 'fixture-only-lifecycle-key-32-bytes'
const roots: string[] = []
const signal = () => new AbortController().signal

function pythonCanonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(pythonCanonical).join(',')}]`
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${pythonCanonical(item[key])}`).join(',')}}`
  }
  throw new Error('not canonical JSON')
}

async function localRules(): Promise<{ root: string; rules: TakeApprovalLifecycleRules }> {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-take-lifecycle-rules-'))
  roots.push(root)
  const content: Record<string, string> = {
    'pipeline/v6-lsuqc-provider-neutral-review-policy.json': JSON.stringify({
      schema: 'IMAGO-V6-LSUQCProviderNeutralReviewPolicy-v1',
      activation: { technical_pass_auto_promotes_content: false },
      decision_contract: {
        technical_success_is_not_content_pass: true,
        bounded_rework_and_earliest_owner_required: true,
      },
    }),
    'pipeline/v6-lsuqc-completion-routing-policy.json': JSON.stringify({
      schema: 'IMAGO-V6-LSUQCCompletionRoutingPolicy-v1',
      approval_branch: { selected_take_only: true },
      rework_branch: {
        one_earliest_owner_per_defect: true, paid_generation_authorized: false,
        automatic_retry: false, unbounded_redo_forbidden: true,
      },
    }),
    'docs/qingmu-os/report-source.md': [
      '上游对象或 SHA 改变时，所有依赖的批准和锁按规则失效',
      '失效事件', '第三轮同类返修不再直接生成', '人工编辑先产生新 revision，再重新送审',
    ].join('\n'),
    'scripts/compile_qingmu_element_method.py': '# imported compiler fixture\n',
    'scripts/compile_qingmu_take_acceptance_method.py': '# imported compiler fixture\n',
    'scripts/compile_qingmu_take_approval_lifecycle_method.py': '# lifecycle compiler fixture\n',
  }
  for (const path of TAKE_APPROVAL_LIFECYCLE_RULE_PATHS) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content[path] ?? '')
  }
  return { root, rules: await readTakeApprovalLifecycleRules(root, pythonCanonical) }
}

function approvableFeed() {
  const feed = takeApprovalLifecycleFixture()
  const current = feed.source.currentTake
  const source = {
    ...feed.source,
    currentDecision: {
      decisionId: 'decision-1', eventId: 'decision-event-1',
      takeId: current.takeSubject.takeId,
      takeVersionOrdinal: current.takeSubject.versionOrdinal,
      takeSubjectSha256: current.takeSubjectSha256,
      decision: 'approve', actorId: 'approver-1', actorNaturalPersonId: 'person-approver-1',
    } as const,
    currentAssessment: {
      assessmentId: 'assessment-1', eventId: 'assessment-event-1',
      takeId: current.takeSubject.takeId,
      takeVersionOrdinal: current.takeSubject.versionOrdinal,
      takeSubjectSha256: current.takeSubjectSha256,
      evidenceSnapshotSha256: 'a'.repeat(64), technicalPass: true, issueCodes: [],
      methodProjectionSha256: 'b'.repeat(64), rulesSha256: 'c'.repeat(64),
    } as const,
  }
  return { ...feed, source, sourceSnapshotSha256: takeVersionSha(source) }
}

function projection(
  snapshot: ImagoTakeApprovalLifecycleMethodSnapshot,
  rules: TakeApprovalLifecycleRules,
): ImagoTakeApprovalLifecycleMethodProjection {
  return {
    schema: 'qingmu.imago-take-approval-lifecycle-method.v1',
    subject: snapshot.source.currentTake.takeSubject,
    subjectSnapshotSha256: snapshot.source.currentTake.takeSubjectSha256,
    sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
    definition: rules.definition,
    transition: deriveTakeApprovalLifecycleTransition(snapshot.source, rules.rulesSha256),
    ruleBindings: rules.hashes, rulesSha256: rules.rulesSha256,
  }
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('current Take approval lifecycle method boundary', () => {
  it('accepts only coordinates and binds the exact fresh Yimeng source', () => {
    expect(parseTakeApprovalLifecycleMethodRequest(request)).toEqual(request)
    const feed = takeApprovalLifecycleFixture()
    expect(buildTakeApprovalLifecycleSnapshot(request, feed)).toEqual({
      schema: 'qingmu.take-approval-lifecycle-method-snapshot.v1',
      source: feed.source, sourceSnapshotSha256: feed.sourceSnapshotSha256,
    })
    for (const value of [null, {}, [], { ...request, action: 'APPROVE' },
      { ...request, frameId: ' frame-z' }, { ...request, frameId: '\ud800' }]) {
      expect(() => parseTakeApprovalLifecycleMethodRequest(value)).toThrow()
    }
    expect(() => buildTakeApprovalLifecycleSnapshot(request, {
      ...feed, sourceSnapshotSha256: 'f'.repeat(64),
    })).toThrow()
  })

  it('binds all current Core sources and derives approval without auto-approving', async () => {
    const { rules } = await localRules()
    expect(Object.keys(rules.hashes)).toEqual(TAKE_APPROVAL_LIFECYCLE_RULE_PATHS)
    const snapshot = buildTakeApprovalLifecycleSnapshot(request, approvableFeed())
    expect(deriveTakeApprovalLifecycleTransition(snapshot.source, rules.rulesSha256)).toMatchObject({
      state: 'READY_FOR_APPROVAL', legalActions: ['APPROVE'], approvalInherited: false,
      boundedFindingRouteRequired: false,
    })
    expect(rules.definition.boundaries).toMatchObject({
      businessTruth: 'yimeng', reworkExecuted: false, providerCalls: 0,
      humanSignoffInferred: false,
    })
  })

  it('double-reads source and rules, then creates a Host-only HMAC', async () => {
    const { root, rules } = await localRules()
    const feed = approvableFeed()
    const read = vi.fn(async () => ({ ok: true as const, value: feed }))
    const compiler = vi.fn(async (snapshot: ImagoTakeApprovalLifecycleMethodSnapshot) =>
      projection(snapshot, rules))
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), readTakeApprovalLifecycle: read,
      runTakeApprovalLifecycleCompiler: compiler,
    })
    const result = await handler('takeApprovalLifecycleMethod', request, signal())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoTakeApprovalLifecycleMethodResponse
    expect(read).toHaveBeenCalledTimes(2)
    expect(compiler).toHaveBeenCalledOnce()
    expect(value.projection.transition).toMatchObject({
      state: 'READY_FOR_APPROVAL', legalActions: ['APPROVE'], approvalInherited: false,
    })
    const { signature, ...unsigned } = value.methodAttestation
    expect(value.projectionSha256).toBe(createHash('sha256')
      .update(takeAcceptanceJcsJson(value.projection, 'projection')).digest('hex'))
    expect(signature).toBe(createHmac('sha256', KEY)
      .update(takeAcceptanceJcsJson(unsigned, 'attestation'), 'utf8').digest('hex'))
    expect(JSON.stringify(value)).not.toContain(KEY)
  })

  it.each(['transition', 'definition', 'source', 'rules', 'extra'] as const)(
    'rejects forged compiler %s output', async (kind) => {
      const { rules } = await localRules()
      const snapshot = buildTakeApprovalLifecycleSnapshot(request, approvableFeed())
      const result = projection(snapshot, rules)
      const changed = {
        ...result,
        ...(kind === 'transition' ? { transition: { ...result.transition, legalActions: ['RESUBMIT'] } } : {}),
        ...(kind === 'definition' ? { definition: {
          ...result.definition,
          boundaries: { ...result.definition.boundaries, reworkExecuted: true },
        } } : {}),
        ...(kind === 'source' ? { sourceSnapshotSha256: '0'.repeat(64) } : {}),
        ...(kind === 'rules' ? { ruleBindings: { ...result.ruleBindings, forged: '0'.repeat(64) } } : {}),
        ...(kind === 'extra' ? { humanApproval: true } : {}),
      }
      expect(() => attestTakeApprovalLifecycleMethod(changed, snapshot, rules, KEY)).toThrow()
    },
  )

  it('fails closed on source drift and rule drift', async () => {
    const { root, rules } = await localRules()
    const feed = approvableFeed()
    if (feed.source.currentDecision === null) throw new Error('decision fixture required')
    const changedSource = {
      ...feed.source,
      currentDecision: { ...feed.source.currentDecision, actorId: 'approver-2' },
    }
    const changedFeed = {
      ...feed,
      source: changedSource,
      sourceSnapshotSha256: takeVersionSha(changedSource),
    }
    let reads = 0
    const sourceDrift = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(),
      readTakeApprovalLifecycle: async () => ({
        ok: true, value: reads++ === 0 ? feed : changedFeed,
      }),
      runTakeApprovalLifecycleCompiler: async snapshot => projection(snapshot, rules),
    })
    expect(await sourceDrift('takeApprovalLifecycleMethod', request, signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })

    const ruleDrift = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), readTakeApprovalLifecycle: async () => ({ ok: true, value: feed }),
      runTakeApprovalLifecycleCompiler: async (snapshot) => {
        await writeFile(join(root, TAKE_APPROVAL_LIFECYCLE_RULE_PATHS[5]), '# drifted\n')
        return projection(snapshot, rules)
      },
    })
    expect(await ruleDrift('takeApprovalLifecycleMethod', request, signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('exposes only the coordinate-based lifecycle method to the browser RPC wrapper', async () => {
    const ctx = new Context()
    const handle = vi.fn<(
      channel: string, handler: ConnectionRpcHandler, options?: ConnectionRpcHandlerOptions,
    ) => void>()
    ctx.provide('connection', { rpc: { handle } } as unknown as Context['connection'])
    apply(ctx, { coreRoot: '/not-read' })
    const browser = handle.mock.calls[0]?.[1]
    expect(await browser?.('takeApprovalLifecycleMethod', { ...request, action: 'APPROVE' }, signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await browser?.('takeApprovalLifecycleMethod', request, signal()))
      .toMatchObject({ ok: false, error: { message: 'Yimeng read capability is unavailable' } })
  })

  it.skipIf(!process.env.IMAGO_OS_CORE_ROOT)('runs the actual current Core compiler', async () => {
    const root = process.env.IMAGO_OS_CORE_ROOT
    if (root === undefined) throw new Error('Core root required')
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(),
      readTakeApprovalLifecycle: async () => ({ ok: true, value: approvableFeed() }),
    })
    const result = await handler('takeApprovalLifecycleMethod', request, signal())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect((result.value as ImagoTakeApprovalLifecycleMethodResponse).projection.transition)
      .toMatchObject({ state: 'READY_FOR_APPROVAL', legalActions: ['APPROVE'] })
  })
})
