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
  attestTakeTechnicalQcMethod,
  buildTakeTechnicalQcSnapshot,
  parseTakeTechnicalQcMethodRequest,
  readTakeTechnicalQcRules,
  TAKE_TECHNICAL_QC_RULE_PATHS,
  type TakeTechnicalQcRules,
} from '../src/take-technical-qc.ts'
import { takeAcceptanceJcsJson } from '../src/take-acceptance.ts'
import type {
  ImagoTakeTechnicalQcMethodProjection,
  ImagoTakeTechnicalQcMethodResponse,
  ImagoTakeTechnicalQcMethodSnapshot,
} from '../src/types.ts'

const KEY = 'fixture-only-take-qc-key-32-bytes'
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

async function localRules(): Promise<{ root: string; rules: TakeTechnicalQcRules }> {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-take-qc-rules-'))
  roots.push(root)
  const content: Record<string, string> = {
    'pipeline/v6-video-generation-routing-policy.json': JSON.stringify({
      schema: 'IMAGO-V6-VideoGenerationRoutingPolicy-v1', activation: { compiler_active: true },
      principles: { macro_and_micro_qc_must_both_pass: true },
      post_generation_acceptance: {
        macro_qc_required: true, micro_qc_required: true, unverified_is_not_pass: true,
      },
    }),
    'pipeline/v6-video-reference-integrity-overlay-policy.json': JSON.stringify({
      schema: 'IMAGO-V6-VideoReferenceOrchestrationPolicy-v1',
      qc_layer_contract: {
        MACRO_QC: ['STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE'],
        MICRO_QC: [
          'IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER',
          'LOCKED_DIALOGUE', 'TECHNICAL_RECEIPT',
        ],
        both_layers_required_for_final_pass: true, unverified_is_not_pass: true,
      },
    }),
    'pipeline/v6-lsuqc-provider-neutral-review-policy.json': JSON.stringify({
      schema: 'IMAGO-V6-LSUQCProviderNeutralReviewPolicy-v1',
      activation: {
        provider_neutral_review_enabled: true, technical_pass_auto_promotes_content: false,
      },
      inspection_contract: {
        allowed_window_results: ['PASS', 'FAIL', 'UNVERIFIED'],
        unverified_is_not_pass: true, macro_and_micro_qc_both_required: true,
      },
      decision_contract: { technical_success_is_not_content_pass: true },
    }),
    'pipeline/v6-lsuqc-completion-routing-policy.json': JSON.stringify({
      schema: 'IMAGO-V6-LSUQCCompletionRoutingPolicy-v1',
      activation: { automatic_generation_retry: false },
      rework_branch: {
        paid_generation_authorized: false, automatic_retry: false,
        completion_release_forbidden: true,
      },
    }),
    'scripts/compile_qingmu_element_method.py': '# imported compiler fixture\n',
    'scripts/compile_qingmu_take_acceptance_method.py': '# imported compiler fixture\n',
    'scripts/compile_qingmu_take_qc_method.py': '# take QC compiler fixture\n',
  }
  for (const path of TAKE_TECHNICAL_QC_RULE_PATHS) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content[path] ?? '')
  }
  return { root, rules: await readTakeTechnicalQcRules(root, pythonCanonical) }
}

function projection(
  snapshot: ImagoTakeTechnicalQcMethodSnapshot,
  rules: TakeTechnicalQcRules,
): ImagoTakeTechnicalQcMethodProjection {
  return {
    schema: 'qingmu.imago-take-technical-qc-method.v1',
    subject: snapshot.evidence.subject,
    evidenceSnapshotSha256: snapshot.evidenceSnapshotSha256,
    technicalReceiptStatus: snapshot.evidence.technicalReceipt.status,
    definition: rules.definition,
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

describe('current Take technical-QC method boundary', () => {
  it('accepts only coordinates and keeps the exact E6-5 evidence snapshot', () => {
    expect(parseTakeTechnicalQcMethodRequest(request)).toEqual(request)
    const feed = takeAcceptanceFixture()
    expect(buildTakeTechnicalQcSnapshot(request, feed)).toEqual({
      schema: 'qingmu.take-technical-qc-method-snapshot.v1',
      evidence: feed.evidence,
      evidenceSnapshotSha256: feed.evidenceSnapshotSha256,
    })
    for (const value of [null, {}, [], { ...request, actorRole: 'reviewer' },
      { ...request, frameId: ' frame-z' }, { ...request, frameId: '\ud800' }]) {
      expect(() => parseTakeTechnicalQcMethodRequest(value)).toThrow()
    }
  })

  it('accepts a legal old selected Take whose generation lineage is nullable', () => {
    const feed = structuredClone(takeAcceptanceFixture()) as unknown as Record<string, unknown>
    const evidence = feed.evidence as Record<string, unknown>
    const subject = evidence.subject as Record<string, unknown>
    for (const field of [
      'taskId', 'capability', 'routeKey', 'provider', 'model', 'inputHash', 'submitId', 'outputSha256',
    ]) subject[field] = null
    evidence.providerReceipt = {
      schema: 'jason.qingmu-provider-submission-receipt-evidence.v1', status: 'missing',
      evidenceMode: 'unverified', actualProviderReceiptVerified: false, requestDryRun: null,
      taskRequestHashVerified: false, outboxState: null, dispatchEpoch: 0, dispatchDigest: null,
      payloadSha256: null, responseSha256: null, providerTaskId: null, providerStatus: null,
      localStatus: null, providerMediaBindingStatus: 'BLOCKED', providerMediaRecordId: null,
      blockers: ['PROVIDER_RECEIPT_MISSING'],
    }
    evidence.technicalReceipt = {
      schema: 'jason.qingmu-technical-video-receipt.v1',
      imagoReceiptSchema: 'IMAGO-V6-TechnicalVideoReceipt-v1', status: 'BLOCKED',
      media: { bytes: null, sha256: null },
      fullVideoDecode: {
        required: true, commandProfile: 'ffmpeg -v error -xerror -map 0:v:0 -f null -',
        status: 'BLOCKED', returncode: null,
      },
      blockers: ['TECHNICAL_RECEIPT_MISSING'], warnings: [], video: null, audio: null,
    }
    feed.evidenceSnapshotSha256 = createHash('sha256')
      .update(takeAcceptanceJcsJson(evidence, 'evidence')).digest('hex')
    expect(buildTakeTechnicalQcSnapshot(request, feed).evidence.subject).toMatchObject({
      frameContentSha256: '1'.repeat(64), taskId: null, outputSha256: null,
    })
  })

  it('binds all direct and imported compiler sources to the two-layer method', async () => {
    const { rules } = await localRules()
    expect(Object.keys(rules.hashes)).toEqual(TAKE_TECHNICAL_QC_RULE_PATHS)
    expect(rules.definition).toMatchObject({
      mode: 'STATELESS_TECHNICAL_QC_METHOD',
      catalog: {
        macro: { layer: 'MACRO_QC', codes: ['STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE'] },
        micro: {
          layer: 'MICRO_QC',
          codes: [
            'IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER',
            'LOCKED_DIALOGUE', 'TECHNICAL_RECEIPT',
          ],
        },
      },
      boundaries: {
        businessTruth: 'yimeng', technicalPassIsContentApproval: false,
        approvalInvalidationAllowed: false, reworkExecutionAllowed: false,
      },
    })
    expect(rules.rulesSha256)
      .toBe(createHash('sha256').update(pythonCanonical(rules.hashes)).digest('hex'))
  })

  it('double-reads evidence and rules, then creates a Host-only HMAC', async () => {
    const { root, rules } = await localRules()
    const feed = takeAcceptanceFixture()
    const read = vi.fn(async () => ({ ok: true as const, value: feed }))
    const compiler = vi.fn(async (snapshot: ImagoTakeTechnicalQcMethodSnapshot) => projection(snapshot, rules))
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(), readTakeTechnicalQcAcceptance: read,
      runTakeTechnicalQcCompiler: compiler,
    })
    const result = await handler('takeTechnicalQcMethod', request, signal())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoTakeTechnicalQcMethodResponse
    expect(read).toHaveBeenCalledTimes(2)
    expect(compiler).toHaveBeenCalledOnce()
    expect(value.projection.definition.boundaries).toMatchObject({
      technicalPassIsContentApproval: false, selectionChanged: false,
      formalApprovalChanged: false, episodeVerificationChanged: false,
      providerCalls: 0, budgetMutation: false,
    })
    const { signature, ...unsigned } = value.methodAttestation
    expect(value.projectionSha256).toBe(createHash('sha256')
      .update(takeAcceptanceJcsJson(value.projection, 'projection')).digest('hex'))
    expect(signature).toBe(createHmac('sha256', KEY)
      .update(takeAcceptanceJcsJson(unsigned, 'attestation'), 'utf8').digest('hex'))
    expect(JSON.stringify(value)).not.toContain(KEY)
  })

  it.each(['subject', 'receipt', 'definition', 'rules', 'rulesSha', 'extra'] as const)(
    'rejects forged compiler %s output', async (kind) => {
      const { rules } = await localRules()
      const snapshot = buildTakeTechnicalQcSnapshot(request, takeAcceptanceFixture())
      const result = projection(snapshot, rules)
      const changed = {
        ...result,
        ...(kind === 'subject' ? { subject: { ...result.subject, takeId: 'forged' } } : {}),
        ...(kind === 'receipt' ? { technicalReceiptStatus: 'BLOCKED' } : {}),
        ...(kind === 'definition' ? { definition: {
          ...result.definition,
          boundaries: { ...result.definition.boundaries, technicalPassIsContentApproval: true },
        } } : {}),
        ...(kind === 'rules' ? { ruleBindings: { ...result.ruleBindings, '/tmp/forged': '0'.repeat(64) } } : {}),
        ...(kind === 'rulesSha' ? { rulesSha256: '0'.repeat(64) } : {}),
        ...(kind === 'extra' ? { approval: true } : {}),
      }
      expect(() => attestTakeTechnicalQcMethod(changed, snapshot, rules, KEY)).toThrow()
    },
  )

  it('fails closed on evidence drift, source drift, and missing boundaries', async () => {
    const { root, rules } = await localRules()
    const feed = takeAcceptanceFixture()
    let reads = 0
    const changedFeed = { ...feed, boundaries: { ...feed.boundaries, databaseWrites: 1 } }
    const evidenceDrift = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(),
      readTakeTechnicalQcAcceptance: async () => ({
        ok: true, value: reads++ === 0 ? feed : changedFeed,
      }),
      runTakeTechnicalQcCompiler: async snapshot => projection(snapshot, rules),
    })
    expect(await evidenceDrift('takeTechnicalQcMethod', request, signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })

    let compilerCalls = 0
    const sourceDrift = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(),
      readTakeTechnicalQcAcceptance: async () => ({ ok: true, value: feed }),
      runTakeTechnicalQcCompiler: async (snapshot) => {
        compilerCalls += 1
        await writeFile(join(root, TAKE_TECHNICAL_QC_RULE_PATHS[6]), '# drifted source\n')
        return projection(snapshot, rules)
      },
    })
    expect(await sourceDrift('takeTechnicalQcMethod', request, signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(compilerCalls).toBe(1)

    const missing = createImagoMethodHandler({ coreRoot: '/not-read' }, { runCompiler: vi.fn() })
    expect(await missing('takeTechnicalQcMethod', request, signal())).toMatchObject({ ok: false })
  })

  it('keeps the endpoint on the Host service while denying the browser RPC wrapper', async () => {
    const ctx = new Context()
    const handle = vi.fn<(
      channel: string, handler: ConnectionRpcHandler, options?: ConnectionRpcHandlerOptions,
    ) => void>()
    ctx.provide('connection', { rpc: { handle } } as unknown as Context['connection'])
    apply(ctx, { coreRoot: '/not-read' })
    expect(handle).toHaveBeenCalledWith('/qingmu-imago-method', expect.any(Function), { authority: 'loopback' })
    const internal = ctx.get('qingmuImagoMethod')
    expect(typeof internal).toBe('function')
    expect(await internal?.('takeTechnicalQcMethod', request, signal()))
      .not.toMatchObject({ error: { message: 'Take technical-QC Method is Host-internal' } })
    const browser = handle.mock.calls[0]?.[1]
    expect(await browser?.('takeTechnicalQcMethod', request, signal())).toMatchObject({
      ok: false, error: { code: 'internal', message: 'Take technical-QC Method is Host-internal' },
    })
  })

  it.skipIf(!process.env.IMAGO_OS_CORE_ROOT)('runs the actual current Core compiler', async () => {
    const root = process.env.IMAGO_OS_CORE_ROOT
    if (root === undefined) throw new Error('Core root required')
    const handler = createImagoMethodHandler({ coreRoot: root }, {
      runCompiler: vi.fn(),
      readTakeTechnicalQcAcceptance: async () => ({ ok: true, value: takeAcceptanceFixture() }),
    })
    const result = await handler('takeTechnicalQcMethod', request, signal())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoTakeTechnicalQcMethodResponse
    expect(value.projection.definition.catalog.macro.codes).toHaveLength(5)
    expect(value.projection.definition.catalog.micro.codes).toHaveLength(7)
    expect(value.projection.definition.boundaries.technicalPassIsContentApproval).toBe(false)
  })
})
