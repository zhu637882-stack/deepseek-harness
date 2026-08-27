import { createHash, createHmac } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { continuityJson } from '../../qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'
import { FINDING_REQUEST as request, findingFeed, findingSha } from '../../qingmu-yimeng-read-adapter/tests/shot-finding-fixture.ts'
import { apply, createImagoMethodHandler } from '../src/index.ts'
import {
  attestShotFindingMethod, buildShotFindingSnapshot, parseShotFindingMethodRequest, readShotFindingRules,
  SHOT_FINDING_RULE_PATHS, type ShotFindingRules,
} from '../src/shot-finding.ts'
import type { ImagoShotFindingMethodProjection, ImagoShotFindingMethodResponse, ImagoShotFindingMethodSnapshot } from '../src/types.ts'

const KEY = 'fixture-only-shot-finding-method-key-32-bytes'
const roots: string[] = []
const signal = () => new AbortController().signal
const stages = [
  { id: 'C5F', stage_id: 'C5F', owner_role: 'C5', scope: 'global' },
  { id: 'F', stage_id: 'F', owner_role: 'F', scope: 'per_lsu' },
  { id: 'A0', stage_id: 'A0', owner_role: 'A0', scope: 'global' },
]

async function localRules() {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-finding-rules-'))
  roots.push(root)
  const content: Record<string, string> = {
    'pipeline/workflow-spec.v6.production-beta.json': JSON.stringify({ stages }),
    'pipeline/v6-stage-contracts.json': JSON.stringify({ contracts: stages }),
    'pipeline/role-capability-spec.v6.json': JSON.stringify({ roles: stages.map(stage => ({ id: stage.owner_role })) }),
    'skill-package/imago-lsu-dailies-qc/scripts/validate_lsu_qc.py': 'VALID_OWNERS = {\n"F", "C5F", "G1",\n}\nraise RuntimeError("never execute this fixture")\n',
    'pipeline/v6-lsuqc-provider-neutral-review-policy.json': JSON.stringify({
      schema: 'IMAGO-V6-LSUQCProviderNeutralReviewPolicy-v1', accepted_inputs: { current_decision_schema_version: '2.1.0' },
      review_state_machine: { automatic_content_decision: false }, decision_contract: { bounded_rework_and_earliest_owner_required: true },
    }),
    'docs/qingmu-os/report-source.md': 'Finding Contract：对象、问题、证据、Owner、严重度、建议',
  }
  for (const path of SHOT_FINDING_RULE_PATHS) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content[path] ?? `fixture-source:${path}\n`)
  }
  return { root, rules: await readShotFindingRules(root) }
}
function projection(snapshot: ImagoShotFindingMethodSnapshot, rules: ShotFindingRules): ImagoShotFindingMethodProjection {
  return { schema: 'qingmu.imago-shot-finding-method.v1', subject: snapshot.subject,
    subjectSnapshotSha256: snapshot.snapshotSha256, definition: rules.definition,
    ruleBindings: rules.hashes, rulesSha256: findingSha(rules.hashes) }
}
beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('current Finding method boundary', () => {
  it('accepts only three canonical identifiers', () => {
    expect(parseShotFindingMethodRequest(request)).toEqual(request)
    for (const value of [null, {}, [], { ...request, subject: findingFeed().subject },
      { ...request, approved: true }, { ...request, coreRoot: '/other' }, { ...request, frameId: '  frame-z' },
      { ...request, frameId: '\ud800' }, { ...request, projectId: 'line\nbreak' }]) {
      expect(() => parseShotFindingMethodRequest(value)).toThrow()
    }
  })

  it.each([
    ['FEFF only', '\ufeff'], ['FEFF boundaries', '\ufeffframe-z\ufeff'], ['astral code points', '🎬'.repeat(256)],
  ])('preserves Python-valid %s identifiers in requests and method snapshots', (_label, value) => {
    const ids = { ...request, frameId: value }
    expect(parseShotFindingMethodRequest(ids)).toEqual(ids)
    const feed = findingFeed()
    const subject = { ...feed.subject, ...ids, assetId: value }
    expect(buildShotFindingSnapshot(ids, { ...feed, ...ids, subject, snapshotSha256: findingSha(subject) }, continuityJson).subject)
      .toEqual(subject)
  })

  it.each([
    ['NEL only', '\u0085'], ['separator only', '\u001c'],
    ['NEL prefix', '\u0085frame-z'], ['separator suffix', 'frame-z\u001c'],
  ])('rejects Python-stripped %s identifiers before method compilation', (_label, value) => {
    expect(() => parseShotFindingMethodRequest({ ...request, frameId: value })).toThrow()
    const feed = findingFeed()
    const subject = { ...feed.subject, assetId: value }
    expect(() => buildShotFindingSnapshot(request, { ...feed, subject, snapshotSha256: findingSha(subject) }, continuityJson)).toThrow()
  })

  it('binds only fresh selected-video bytes and frame semantics, not ledger history or permissions', () => {
    const feed = findingFeed()
    const snapshot = buildShotFindingSnapshot(request, feed, continuityJson)
    expect(snapshot).toEqual({ schema: 'qingmu.shot-finding-method-snapshot.v1', subject: feed.subject, snapshotSha256: feed.snapshotSha256 })
    expect(buildShotFindingSnapshot(request, { ...feed, capabilities: { canRecordFinding: false }, items: [] }, continuityJson))
      .toEqual(snapshot)
    expect(JSON.stringify(snapshot)).not.toContain('actorId')
  })

  it.each([
    ['frameNo', 0], ['frameNo', true], ['storyboardRevision', 1.25], ['storyboardRevision', Number.MAX_SAFE_INTEGER + 1],
    ['assetVersion', -1], ['assetVersion', false], ['assetSha256', null], ['frameContentSha256', 'invalid'],
    ['assetId', ''], ['frameId', 'other'], ['schema', 'legacy'],
  ])('rejects invalid current subject %s', (field, value) => {
    const feed = findingFeed()
    const subject = { ...feed.subject, [field]: value }
    expect(() => buildShotFindingSnapshot(request, { ...feed, subject, snapshotSha256: findingSha(subject) }, continuityJson)).toThrow()
  })

  it('rejects unavailable, cross-project, and incorrectly hashed sources', () => {
    const feed = findingFeed()
    for (const changed of [
      { ...feed, projectId: 'other' }, { ...feed, snapshotSha256: '0'.repeat(64) },
      { ...feed, subject: { ...feed.subject, approved: true } },
      { ...feed, subject: null, snapshotSha256: null, availability: { status: 'unavailable', reason: 'not-selected' } },
    ]) expect(() => buildShotFindingSnapshot(request, changed, continuityJson)).toThrow()
  })

  it('reads fixed source bytes and maps active stages to roles without choosing an Owner', async () => {
    const { rules } = await localRules()
    expect(Object.keys(rules.hashes)).toEqual(SHOT_FINDING_RULE_PATHS)
    expect(rules.definition.ownerOptions).toEqual([
      { stageId: 'C5F', roleId: 'C5', scope: 'global' }, { stageId: 'F', roleId: 'F', scope: 'per_lsu' },
    ])
    expect(rules.definition).toMatchObject({ statusOnRecord: 'OPEN', approvalAuthority: 'not_granted', reworkExecutionAllowed: false })
    expect(JSON.stringify(rules.definition)).not.toContain('G1')
  })

  it('attests the exact current method without exposing the key or performing a write', async () => {
    const { root, rules } = await localRules()
    const read = vi.fn(async () => ({ ok: true as const, value: findingFeed() }))
    const compiler = vi.fn(async (snapshot: ImagoShotFindingMethodSnapshot) => projection(snapshot, rules))
    const handler = createImagoMethodHandler(
      { coreRoot: root }, { runCompiler: vi.fn(), readShotFindings: read, runShotFindingCompiler: compiler },
    )
    const requestSignal = signal()
    const result = await handler('shotFindingMethod', request, requestSignal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('method failed')
    const value = result.value as ImagoShotFindingMethodResponse
    expect(value.projectionSha256).toBe(findingSha(value.projection))
    const { signature, ...unsigned } = value.methodAttestation
    expect(signature).toBe(createHmac('sha256', KEY).update(continuityJson(unsigned), 'utf8').digest('hex'))
    expect(read).toHaveBeenCalledExactlyOnceWith(request, requestSignal)
    expect(compiler).toHaveBeenCalledOnce()
    expect(JSON.stringify(value)).not.toContain(KEY)
  })

  it.each(['subject', 'snapshot', 'fields', 'owner', 'severity', 'status', 'approval', 'rework', 'path', 'sha', 'extra'])(
    'rejects forged compiler %s', async (kind) => {
      const { rules } = await localRules()
      const snapshot = buildShotFindingSnapshot(request, findingFeed(), continuityJson)
      const result = projection(snapshot, rules)
      const changed = {
        ...result,
        ...(kind === 'subject' ? { subject: { ...result.subject, frameId: 'other' } } : {}),
        ...(kind === 'snapshot' ? { subjectSnapshotSha256: '0'.repeat(64) } : {}),
        ...(['fields', 'owner', 'severity', 'status', 'approval', 'rework'].includes(kind) ? { definition: {
          ...result.definition, ...(kind === 'fields' ? { requiredFields: [] } : {}),
          ...(kind === 'owner' ? { ownerOptions: [{ stageId: 'G1', roleId: 'G1', scope: 'global' }] } : {}),
          ...(kind === 'severity' ? { severities: ['INFO'] } : {}), ...(kind === 'status' ? { statusOnRecord: 'CLOSED' } : {}),
          ...(kind === 'approval' ? { approvalAuthority: 'granted' } : {}), ...(kind === 'rework' ? { reworkExecutionAllowed: true } : {}),
        } } : {}),
        ...(kind === 'path' ? { ruleBindings: { ...rules.hashes, '/tmp/untrusted': '0'.repeat(64) } } : {}),
        ...(kind === 'sha' ? { rulesSha256: '0'.repeat(64) } : {}), ...(kind === 'extra' ? { chosenOwner: 'F' } : {}),
      }
      expect(() => attestShotFindingMethod(changed, snapshot, rules, continuityJson, KEY)).toThrow()
    },
  )

  it('rejects a source changed during compilation without returning an attestation', async () => {
    const { root, rules } = await localRules()
    const handler = createImagoMethodHandler({ coreRoot: root }, { runCompiler: vi.fn(),
      readShotFindings: async () => ({ ok: true, value: findingFeed() }),
      runShotFindingCompiler: async (snapshot) => {
        await writeFile(join(root, 'scripts/compile_qingmu_shot_finding_method.py'), '# changed during compile\n')
        return projection(snapshot, rules)
      },
    })
    expect(await handler('shotFindingMethod', request, signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('fails closed on missing read capability, failed reads, missing key, and cancellation', async () => {
    const compiler = vi.fn()
    const dependencies = { runCompiler: vi.fn(), runShotFindingCompiler: compiler }
    const handler = createImagoMethodHandler({ coreRoot: '/not-read' }, dependencies)
    expect(await handler('shotFindingMethod', request, signal())).toMatchObject({ ok: false })
    const read = vi.fn(async () => ({ ok: false as const, error: { code: 'internal' as const, message: 'source unavailable', details: {} } }))
    const withRead = createImagoMethodHandler({ coreRoot: '/not-read' }, { ...dependencies, readShotFindings: read })
    expect(await withRead('shotFindingMethod', request, signal())).toEqual(await read())
    read.mockClear()
    const controller = new AbortController()
    controller.abort()
    expect(await withRead('shotFindingMethod', request, controller.signal)).toMatchObject({ ok: false })
    expect(read).not.toHaveBeenCalled()
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    expect(await withRead('shotFindingMethod', request, signal())).toMatchObject({ ok: false })
    expect(read).not.toHaveBeenCalled()
    expect(compiler).not.toHaveBeenCalled()
  })

  it('registers only on loopback and tolerates the read plugin being unplugged', async () => {
    const ctx = new Context()
    const handle = vi.fn<(channel: string, handler: ConnectionRpcHandler, options?: ConnectionRpcHandlerOptions) => void>()
    ctx.provide('connection', { rpc: { handle } } as unknown as Context['connection'])
    apply(ctx, { coreRoot: '/not-read' })
    expect(handle).toHaveBeenCalledWith('/qingmu-imago-method', expect.any(Function), { authority: 'loopback' })
    const handler = handle.mock.calls[0]?.[1]
    expect(await handler?.('shotFindingMethod', request, signal())).toMatchObject({ ok: false })
  })

  it.skipIf(!process.env.IMAGO_OS_CORE_ROOT)('runs the actual Core compiler with exact current-rule hashes and no project state', async () => {
    const root = process.env.IMAGO_OS_CORE_ROOT
    if (root === undefined) throw new Error('Core root required')
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), readShotFindings: async () => ({ ok: true, value: findingFeed() }),
    })
    const result = await handler('shotFindingMethod', request, signal())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoShotFindingMethodResponse
    expect(value.projection.definition.ownerOptions).toHaveLength(10)
    expect(value.projection.subject).toEqual(findingFeed().subject)
    expect(value.projection.rulesSha256).toBe(createHash('sha256').update(continuityJson(value.projection.ruleBindings)).digest('hex'))
  })
})
