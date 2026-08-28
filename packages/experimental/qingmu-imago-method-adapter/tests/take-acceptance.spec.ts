import { createHash, createHmac } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TAKE_ACCEPTANCE_REQUEST as request,
  takeAcceptanceFixture,
} from '../../qingmu-yimeng-read-adapter/tests/take-acceptance-fixture.ts'
import { apply, createImagoMethodHandler } from '../src/index.ts'
import {
  attestTakeAcceptanceMethod,
  buildTakeAcceptanceSnapshot,
  evaluateTakeAcceptance,
  parseTakeAcceptanceMethodRequest,
  readTakeAcceptanceRules,
  TAKE_ACCEPTANCE_RULE_PATHS,
  takeAcceptanceJcsJson,
  type TakeAcceptanceRules,
} from '../src/take-acceptance.ts'
import type {
  ImagoTakeAcceptanceMethodProjection,
  ImagoTakeAcceptanceMethodResponse,
  ImagoTakeAcceptanceMethodSnapshot,
} from '../src/types.ts'

const KEY = 'fixture-only-take-acceptance-key-32-bytes'
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

async function localRules(): Promise<{ root: string; rules: TakeAcceptanceRules }> {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-take-acceptance-rules-'))
  roots.push(root)
  const content: Record<string, string> = {
    'pipeline/imago-os-current.json': JSON.stringify({
      schema: 'IMAGO-CurrentRuntimePointer-v1', status: 'ACTIVE', public_system_name: 'IMAGO OS',
      resolution: {
        internal_runtime_channel: 'V6_PRODUCTION_BETA', internal_contract_id: '6.0.0-draft.2',
        controller: 'scripts/imago_v6_beta_ctl.py', workflow_spec: 'pipeline/workflow-spec.v6.production-beta.json',
      },
    }),
    'pipeline/workflow-channel-registry.json': JSON.stringify({
      schema: 'IMAGO-WorkflowChannelRegistry-v2', public_runtime_pointer: 'pipeline/imago-os-current.json',
      system_scope: 'V6_ONLY', default_new_project_channel: 'V6_PRODUCTION_BETA', pre_v6_import_allowed: false,
      pre_v6_fallback_allowed: false, cross_version_lock_or_status_inheritance_allowed: false,
      channels: [{
        channel_id: 'V6_PRODUCTION_BETA', workflow_family: 'V6', workflow_version: '6.0.0-draft.2', stable: false,
        fallback: false, pre_v6_project_import_allowed: false, internal_runtime_only: true, user_selectable: false,
      }],
    }),
    'pipeline/v6-video-generation-routing-policy.json': JSON.stringify({
      schema: 'IMAGO-V6-VideoGenerationRoutingPolicy-v1', activation: { compiler_active: true },
      principles: { macro_and_micro_qc_must_both_pass: true },
      post_generation_acceptance: {
        macro_qc_required: true, micro_qc_required: true, unverified_is_not_pass: true,
        technical_video_receipt_fields: [
          'duration_seconds', 'width', 'height', 'codec_name', 'nb_frames', 'avg_frame_rate', 'r_frame_rate',
          'actual_average_frame_rate',
        ],
        actual_rate_basis: 'NB_FRAMES_OVER_MEASURED_DURATION_CROSSCHECK_AVG_FRAME_RATE',
      },
    }),
    'pipeline/v6-video-reference-integrity-overlay-policy.json': JSON.stringify({
      schema: 'IMAGO-V6-VideoReferenceOrchestrationPolicy-v1', active: false,
      qc_layer_contract: {
        MACRO_QC: ['STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE'],
        MICRO_QC: ['IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER', 'LOCKED_DIALOGUE', 'TECHNICAL_RECEIPT'],
        both_layers_required_for_final_pass: true, unverified_is_not_pass: true,
      },
    }),
    'scripts/probe_v6_video_receipt.py': 'IMAGO-V6-TechnicalVideoReceipt-v1 -count_frames -xerror nb_frames avg_frame_rate r_frame_rate\n',
    'docs/qingmu-os/report-source.md': 'E6-5：真实 receipt、严格解码和 QC。 Gate B（Provider 特定） UNVERIFIED_FOR_PAID_PRODUCTION\n',
    'scripts/compile_qingmu_take_acceptance_method.py': '# fixture compiler; never executed\n',
  }
  for (const path of TAKE_ACCEPTANCE_RULE_PATHS) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content[path] ?? '')
  }
  return { root, rules: await readTakeAcceptanceRules(root, value => pythonCanonical(value)) }
}

function projection(
  snapshot: ImagoTakeAcceptanceMethodSnapshot,
  rules: TakeAcceptanceRules,
): ImagoTakeAcceptanceMethodProjection {
  return {
    schema: 'qingmu.imago-take-acceptance-method.v1',
    subject: snapshot.evidence.subject,
    evidenceSnapshotSha256: snapshot.evidenceSnapshotSha256,
    definition: rules.definition,
    evaluation: evaluateTakeAcceptance(snapshot.evidence),
    ruleBindings: rules.hashes,
    rulesSha256: rules.rulesSha256,
  }
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('current Take acceptance method boundary', () => {
  it('accepts only three canonical identifiers and builds the exact JCS evidence snapshot', () => {
    expect(parseTakeAcceptanceMethodRequest(request)).toEqual(request)
    const feed = takeAcceptanceFixture()
    expect(buildTakeAcceptanceSnapshot(request, feed)).toEqual({
      schema: 'qingmu.take-acceptance-method-snapshot.v1',
      evidence: feed.evidence,
      evidenceSnapshotSha256: feed.evidenceSnapshotSha256,
    })
    for (const value of [null, {}, [], { ...request, approved: true }, { ...request, frameId: ' frame-z' },
      { ...request, frameId: '\ud800' }, { ...request, projectId: 'line\nbreak' }]) {
      expect(() => parseTakeAcceptanceMethodRequest(value)).toThrow()
    }
  })

  it('matches RFC 8785 number and UTF-16 key ordering semantics', () => {
    expect(takeAcceptanceJcsJson({ a: 1e21, b: 1e-7, c: -0 }, 'vector'))
      .toBe('{"a":1e+21,"b":1e-7,"c":0}')
    expect(takeAcceptanceJcsJson({ '\ufffd': 2, '😀': 1 }, 'astral')).toBe('{"😀":1,"�":2}')
    expect(() => takeAcceptanceJcsJson({ invalid: Number.NaN }, 'invalid')).toThrow()
  })

  it('rejects forged evidence hashes, URL-like extra fields, approval boundaries, and mismatched media', () => {
    const feed = takeAcceptanceFixture()
    const cases = [
      { ...feed, evidenceSnapshotSha256: '0'.repeat(64) },
      { ...feed, approved: true },
      { ...feed, boundaries: { ...feed.boundaries, gateBCompleted: true } },
      { ...feed, evidence: { ...feed.evidence, technicalReceipt: {
        ...feed.evidence.technicalReceipt, media: { ...feed.evidence.technicalReceipt.media, sha256: '0'.repeat(64) },
      } } },
      { ...feed, evidence: { ...feed.evidence, providerReceipt: { ...feed.evidence.providerReceipt, mediaUrl: 'https://example.invalid/video' } } },
    ]
    for (const changed of cases) expect(() => buildTakeAcceptanceSnapshot(request, changed)).toThrow()
  })

  it('reads exact current files while keeping the reference overlay inactive and Gate B closed', async () => {
    const { rules } = await localRules()
    expect(Object.keys(rules.hashes)).toEqual(TAKE_ACCEPTANCE_RULE_PATHS)
    expect(rules.definition).toMatchObject({
      mode: 'READ_ONLY_STATELESS_PROJECTION',
      boundaries: {
        businessTruth: 'yimeng', formalAcceptanceAllowed: false, gateBCompleted: false,
        inactiveReferenceOverlayActivated: false,
      },
    })
    expect(rules.rulesSha256).toBe(createHash('sha256').update(pythonCanonical(rules.hashes)).digest('hex'))
  })

  it('double-reads evidence and rules, then attests the exact non-approving evaluation', async () => {
    const { root, rules } = await localRules()
    const feed = takeAcceptanceFixture()
    const read = vi.fn(async () => ({ ok: true as const, value: feed }))
    const compiler = vi.fn(async (snapshot: ImagoTakeAcceptanceMethodSnapshot) => projection(snapshot, rules))
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), readTakeAcceptance: read, runTakeAcceptanceCompiler: compiler,
    })
    const requestSignal = signal()
    const result = await handler('takeAcceptanceMethod', request, requestSignal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoTakeAcceptanceMethodResponse
    expect(read).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenNthCalledWith(1, request, requestSignal)
    expect(read).toHaveBeenNthCalledWith(2, request, requestSignal)
    expect(compiler).toHaveBeenCalledOnce()
    expect(value.projection.evaluation).toMatchObject({
      technicalReceiptStatus: 'PASS', localControlStatus: 'PASS',
      productionVerificationStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION', formalAcceptanceAllowed: false,
      selectedIsApproval: false, gateBCompleted: false,
    })
    const { signature, ...unsigned } = value.methodAttestation
    expect(value.projectionSha256).toBe(createHash('sha256').update(takeAcceptanceJcsJson(value.projection, 'projection')).digest('hex'))
    expect(signature).toBe(createHmac('sha256', KEY).update(takeAcceptanceJcsJson(unsigned, 'attestation'), 'utf8').digest('hex'))
    expect(JSON.stringify(value)).not.toContain(KEY)
  })

  it.each(['subject', 'snapshot', 'definition', 'evaluation', 'rules', 'rulesSha', 'extra'])(
    'rejects forged compiler %s output', async (kind) => {
      const { rules } = await localRules()
      const snapshot = buildTakeAcceptanceSnapshot(request, takeAcceptanceFixture())
      const result = projection(snapshot, rules)
      const changed = {
        ...result,
        ...(kind === 'subject' ? { subject: { ...result.subject, takeId: 'forged' } } : {}),
        ...(kind === 'snapshot' ? { evidenceSnapshotSha256: '0'.repeat(64) } : {}),
        ...(kind === 'definition' ? { definition: { ...result.definition, boundaries: { ...result.definition.boundaries, gateBCompleted: true } } } : {}),
        ...(kind === 'evaluation' ? { evaluation: { ...result.evaluation, formalAcceptanceAllowed: true } } : {}),
        ...(kind === 'rules' ? { ruleBindings: { ...result.ruleBindings, '/tmp/forged': '0'.repeat(64) } } : {}),
        ...(kind === 'rulesSha' ? { rulesSha256: '0'.repeat(64) } : {}),
        ...(kind === 'extra' ? { approval: true } : {}),
      }
      expect(() => attestTakeAcceptanceMethod(changed, snapshot, rules, KEY)).toThrow()
    },
  )

  it('fails closed on evidence or rule drift, missing capability, missing key, and cancellation', async () => {
    const { root, rules } = await localRules()
    const feed = takeAcceptanceFixture()
    let reads = 0
    const changedFeed = { ...feed, boundaries: { ...feed.boundaries, databaseWrites: 1 } }
    const drift = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(),
      readTakeAcceptance: async () => ({ ok: true, value: reads++ === 0 ? feed : changedFeed }),
      runTakeAcceptanceCompiler: async snapshot => projection(snapshot, rules),
    })
    expect(await drift('takeAcceptanceMethod', request, signal())).toMatchObject({ ok: false, error: { code: 'internal' } })

    const missing = createImagoMethodHandler({ coreRoot: '/not-read' }, { runCompiler: vi.fn() })
    expect(await missing('takeAcceptanceMethod', request, signal())).toMatchObject({ ok: false })
    const controller = new AbortController()
    controller.abort()
    expect(await drift('takeAcceptanceMethod', request, controller.signal)).toMatchObject({ ok: false })
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    expect(await drift('takeAcceptanceMethod', request, signal())).toMatchObject({ ok: false })
  })

  it('registers only on loopback and tolerates the Yimeng reader being unplugged', async () => {
    const ctx = new Context()
    const handle = vi.fn<(channel: string, handler: ConnectionRpcHandler, options?: ConnectionRpcHandlerOptions) => void>()
    ctx.provide('connection', { rpc: { handle } } as unknown as Context['connection'])
    apply(ctx, { coreRoot: '/not-read' })
    expect(handle).toHaveBeenCalledWith('/qingmu-imago-method', expect.any(Function), { authority: 'loopback' })
    const handler = handle.mock.calls[0]?.[1]
    expect(await handler?.('takeAcceptanceMethod', request, signal())).toMatchObject({ ok: false })
  })

  it.skipIf(!process.env.IMAGO_OS_CORE_ROOT)('runs the actual Core compiler against current rule bytes', async () => {
    const root = process.env.IMAGO_OS_CORE_ROOT
    if (root === undefined) throw new Error('Core root required')
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), readTakeAcceptance: async () => ({ ok: true, value: takeAcceptanceFixture() }),
    })
    const result = await handler('takeAcceptanceMethod', request, signal())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoTakeAcceptanceMethodResponse
    expect(value.projection.evaluation.localControlStatus).toBe('PASS')
    expect(value.projection.evaluation.providerReceipt).toMatchObject({ status: 'bounded_local', actualProviderReceiptVerified: false })
    expect(value.projection.evaluation.productionVerificationStatus).toBe('UNVERIFIED_FOR_PAID_PRODUCTION')
    expect(value.projection.definition.boundaries.gateBCompleted).toBe(false)
  })
})
