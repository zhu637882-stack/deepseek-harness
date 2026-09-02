import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  parseQueueProductionTakeIntent,
  prepareProductionTakeCommand,
  type ProductionTakeHelpers,
} from '../src/production-take.ts'

const KEY = 'qingmu-production-take-test-attestation-key'
const SHA = (character: string): string => character.repeat(64)
const INTENT = {
  projectId: 'project-1', episodeId: 'episode-1', storyboardRevisionId: 'revision-1', frameId: 'shot-1',
  takeKind: 'initial', takeOrdinal: 1, confirmReady: true,
  firstFrameSelectionReceiptSha256: SHA('d'), selectedFirstFrameAssetId: 'asset-first-frame-1',
  selectedFirstFrameMaterializedSha256: SHA('e'), videoPreflightSha256: SHA('f'),
  videoQuoteProjectionSha256: SHA('0'), maximumReservationCny: 0.3,
  candidateCount: 1, maxAttempts: 1, selectAsOfficial: false, paidConfirmed: true,
  paidConfirmationText: '我确认本次镜头视频生成最高费用为 0.3000 CNY。',
} as const
const EDITABLE = {
  imageGenPrompt: '雨夜街口，锁定人物造型。', lastFrameImagePrompt: '人物停在门前。',
  videoGenPrompt: '镜头缓慢推进，人物抬头。', motionPrompt: '雨丝斜落，衣角轻摆。',
  negativePrompt: '无文字，无水印。',
}
const METHOD_CANDIDATE = { videoGenPrompt: EDITABLE.videoGenPrompt }
const SOURCE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json',
  'pipeline/role-capability-spec.v6.json',
  'pipeline/v6-video-generation-routing-policy.json',
  'agents/e-image-to-video/AGENTS.md',
  'skill-package/imago-e-kling-lsu-compiler/SKILL.md',
] as const
const SOURCE_KINDS = [
  'runtime_pointer', 'runtime_channel_registry', 'stage_contracts', 'role_capability_spec',
  'prompt_ir_policy', 'role_agent', 'role_method',
] as const
const FIELD_HINTS = {
  imageGenPrompt: ['首帧图像提示词', '应用 D 阶段关键帧方法卡。'],
  lastFrameImagePrompt: ['尾帧图像提示词', '应用 D 阶段关键帧方法卡。'],
  videoGenPrompt: ['视频生成提示词', '应用 E 阶段视频提示词方法卡。'],
  motionPrompt: ['运动提示词', '应用 E 阶段视频提示词方法卡。'],
  negativePrompt: ['共享负面提示词', '同时应用 D 与 E 阶段方法卡。'],
} as const

function compare(left: string, right: string): number {
  const a = Array.from(left, item => item.codePointAt(0) ?? 0)
  const b = Array.from(right, item => item.codePointAt(0) ?? 0)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return a.length - b.length
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort(compare).map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

const helpers: ProductionTakeHelpers = {
  canonicalJson: value => canonical(value),
  inputError: message => new Error(`input:${message}`),
  responseError: message => new Error(`response:${message}`),
  readAttestationKey: () => KEY,
}

function promptIr() {
  return {
    schema: 'jason.qingmu-prompt-ir-subject-read.v1', baseRevision: 7, baseSnapshotSha256: SHA('a'),
    subject: {
      schema: 'jason.qingmu-prompt-ir-subject.v1', projectId: INTENT.projectId, episodeId: INTENT.episodeId,
      targetType: 'prompt_ir', targetId: 'revision-1:shot-1', storyboardRevisionId: INTENT.storyboardRevisionId,
      frameId: INTENT.frameId, promptIrId: 'prompt-ir-7', promptIrVersion: 7,
      promptIrContentSha256: SHA('b'), status: 'Ready', editableProjection: EDITABLE,
    },
  }
}

function methodResult() {
  const target = {
    projectId: INTENT.projectId, episodeId: INTENT.episodeId, storyboardRevisionId: INTENT.storyboardRevisionId,
    frameId: INTENT.frameId, basePromptIrId: 'prompt-ir-7', baseVersion: 7,
    baseSnapshotSha256: SHA('a'), baseContentSha256: SHA('b'),
  }
  const specifications = [
    ['imageGenPrompt', ['D']], ['lastFrameImagePrompt', ['D']], ['videoGenPrompt', ['E']],
    ['motionPrompt', ['E']], ['negativePrompt', ['D', 'E']],
  ] as const
  const cards = {
    D: {
      kind: 'director_method_card', stage_id: 'D', repo_id: 'director-skill-core',
      repository_commit: 'f'.repeat(40), path: 'assets/keyframe-prompt-template.md',
      sha256: SHA('1'), provenance_sha256: SHA('3'),
    },
    E: {
      kind: 'director_method_card', stage_id: 'E', repo_id: 'director-skill-core',
      repository_commit: 'f'.repeat(40), path: 'assets/video-prompt-template.md',
      sha256: SHA('2'), provenance_sha256: SHA('4'),
    },
  } as const
  const fields = specifications.map(([field, stageIds]) => ({
    field, stage_ids: stageIds,
    stage_contract_bindings: stageIds.map(stageId => ({ stage_id: stageId, contract_sha256: stageId === 'D' ? SHA('c') : SHA('d') })),
    method_sha256: SHA('e'),
    card_bindings: stageIds.map(stageId => cards[stageId]),
  }))
  const mappingUnsigned = { schema: 'qingmu.imago-prompt-ir-field-mapping.v1', version: 1, fields }
  const mapping = { ...mappingUnsigned, sha256: digest(mappingUnsigned) }
  const fieldHints = fields.map(entry => ({
    hint_id: `director-method-card-${entry.field}`, field: entry.field,
    title: FIELD_HINTS[entry.field][0], guidance: FIELD_HINTS[entry.field][1],
    mapping_sha256: mapping.sha256, stage_ids: entry.stage_ids,
    card_sha256s: entry.card_bindings.map(binding => binding.sha256),
  }))
  const snapshot = {
    schema: 'qingmu.prompt-ir-method-snapshot.v1', target,
    baseEditableProjection: EDITABLE, candidateEditableProjection: METHOD_CANDIDATE,
    authority: { business_truth: 'yimeng', method_source: 'imago_os_current', human_approval: 'not_granted', paid_provider_authority: 'not_granted' },
  }
  const projection = {
    schema: 'qingmu.imago-prompt-ir-method-projection.v1', input_snapshot_sha256: digest(snapshot), target,
    normalized_candidate: EDITABLE, candidate_sha256: digest(EDITABLE), changed_paths: [],
    blockers: ['candidate_has_no_editable_changes'], warnings: [],
    method_definition: {
      id: 'imago-v6-e-provider-neutral-prompt-ir-edit-method', version: 1, sha256: SHA('e'),
      stage_contract_sha256: SHA('d'), role_capability_sha256: SHA('5'),
      prompt_ir_schema: 'IMAGO-V6-VideoPromptIR-v1', field_mapping: mapping,
      agent_path: SOURCE_PATHS[5], skill_path: SOURCE_PATHS[6],
    },
    source_bindings: [
      ...SOURCE_PATHS.map((path, index) => ({ kind: SOURCE_KINDS[index], path, sha256: String(index + 1).repeat(64) })),
      cards.D, cards.E,
    ],
    field_hints: fieldHints, checklist: [{ check_id: 'zero', label: 'zero execution', required: true }],
    work_order_projection: {
      target, operation: 'compilePromptIrCandidateProjection', allowed_mutations: [],
      editable_fields: Object.keys(EDITABLE), required_read_set: [{
        source: 'yimeng', resource: 'prompt_ir_authoritative_snapshot', projectId: INTENT.projectId,
        episodeId: INTENT.episodeId, targetId: `${INTENT.storyboardRevisionId}:${INTENT.frameId}`,
        storyboardRevisionId: INTENT.storyboardRevisionId, frameId: INTENT.frameId,
        promptIrId: 'prompt-ir-7', promptIrVersion: 7, snapshotSha256: SHA('a'),
        contentSha256: SHA('b'), status: 'Ready',
      }], before_compile: ['validate Ready authority'], after_compile: ['preserve zero execution'],
      providerCalls: 0, workerStarted: false, maximumCostCny: '0',
    }, authority_snapshot_attestation: 'not_verified_by_compiler',
    project_state_persisted: false, providerCalls: 0, workerStarted: false, maximumCostCny: '0',
    selection_executed: false, human_approval_inferred: false, human_signoff_inferred: false,
  }
  const projectionSha256 = digest(projection)
  const unsignedAttestation = {
    schema: 'qingmu.imago-prompt-ir-method-attestation.v1', algorithm: 'hmac-sha256', projectionSha256,
    inputSnapshotSha256: digest(snapshot), targetSha256: digest(target),
    baseEditableProjectionSha256: digest(EDITABLE), candidateEditableProjectionSha256: digest(METHOD_CANDIDATE),
    candidateSha256: digest(EDITABLE),
  }
  return {
    schema: 'qingmu.imago-prompt-ir-method-adapter-result.v1', projectionSha256, projection,
    methodAttestation: { ...unsignedAttestation, signature: createHmac('sha256', KEY).update(canonical(unsignedAttestation), 'utf8').digest('hex') },
  }
}

function resignMethod(value: ReturnType<typeof methodResult>): void {
  value.projectionSha256 = digest(value.projection)
  const unsignedAttestation = {
    schema: 'qingmu.imago-prompt-ir-method-attestation.v1', algorithm: 'hmac-sha256',
    projectionSha256: value.projectionSha256,
    inputSnapshotSha256: value.methodAttestation.inputSnapshotSha256,
    targetSha256: value.methodAttestation.targetSha256,
    baseEditableProjectionSha256: value.methodAttestation.baseEditableProjectionSha256,
    candidateEditableProjectionSha256: value.methodAttestation.candidateEditableProjectionSha256,
    candidateSha256: value.methodAttestation.candidateSha256,
  }
  value.methodAttestation = {
    ...unsignedAttestation,
    signature: createHmac('sha256', KEY).update(canonical(unsignedAttestation), 'utf8').digest('hex'),
  }
}

function rehashMapping(value: ReturnType<typeof methodResult>): void {
  const mapping = value.projection.method_definition.field_mapping
  mapping.sha256 = digest({ schema: mapping.schema, version: mapping.version, fields: mapping.fields })
  for (const hint of value.projection.field_hints) hint.mapping_sha256 = mapping.sha256
}

function quote() {
  return {
    schema: 'jason.qingmu-ready-prompt-ir-first-frame-quote.v1', projectId: INTENT.projectId,
    episodeId: INTENT.episodeId, storyboardRevisionId: INTENT.storyboardRevisionId, frameId: INTENT.frameId,
    authoritySnapshot: {
      frame: { id: INTENT.frameId, sceneId: 'scene-1' },
      promptIr: { id: 'prompt-ir-7', version: 7, contentSha256: SHA('b'), status: 'Ready' },
      references: [{
        elementKind: 'character', elementId: 'character-1', assetId: 'asset-1', assetSha256: SHA('8'),
        materializedSha256: SHA('9'), selectionIdentity: 'selection-1', sourceRevisionId: 'source-1',
        referencePackSha256: SHA('0'),
      }], referenceExecutionBlockers: [],
    },
    authoritySnapshotSha256: SHA('a'), projectionSha256: SHA('b'), promptBinding: { dispatchCompatible: true, executionBlockers: [] },
    quoteReady: true, readOnly: true, providerCalls: 0, taskCreated: false, submitted: false, charged: false, blockers: [],
  }
}

function videoQuote() {
  const requiredPaidConfirmationText = INTENT.paidConfirmationText
  return {
    schema: 'jason.qingmu-writer-video-quote.v1', preflightSha256: INTENT.videoPreflightSha256,
    projectionSha256: INTENT.videoQuoteProjectionSha256, maximumReservationCny: INTENT.maximumReservationCny,
    candidateCount: 1, maxAttempts: 1, selectAsOfficial: false, quoteReady: true, dispatchReady: false,
    quoteBlockers: [], dispatchBlockers: ['operator_paid_confirmation_required'], requiredPaidConfirmationText,
    requiredPaidConfirmationTextSha256: digest(requiredPaidConfirmationText),
  }
}

function receipt(key: string, deduplicated = false) {
  return {
    schema: 'jason.qingmu-writer-production-take.v1', projectId: INTENT.projectId, episodeId: INTENT.episodeId,
    sceneId: 'scene-1', shotId: INTENT.frameId, storyboardRevisionId: INTENT.storyboardRevisionId,
    promptIr: { id: 'prompt-ir-7', version: 7, contentSha256: SHA('b'), videoPromptSha256: SHA('c') },
    authoritySnapshotSha256: SHA('a'), firstFrameQuoteProjectionSha256: SHA('b'), referenceBindings: quote().authoritySnapshot.references,
    firstFrameSelectionReceiptSha256: INTENT.firstFrameSelectionReceiptSha256,
    selectedFirstFrameAssetId: INTENT.selectedFirstFrameAssetId,
    selectedFirstFrameMaterializedSha256: INTENT.selectedFirstFrameMaterializedSha256,
    videoPreflightSha256: INTENT.videoPreflightSha256, videoQuoteProjectionSha256: INTENT.videoQuoteProjectionSha256,
    maximumReservationCny: INTENT.maximumReservationCny, candidateCount: 1, maxAttempts: 1, selectAsOfficial: false,
    paidConfirmed: true, paidConfirmationTextSha256: digest(INTENT.paidConfirmationText),
    takeKind: 'initial', takeOrdinal: 1, takeLimit: 2, taskId: 'task-1', taskStatus: 'queued',
    requestIdempotencyKey: key, idempotencyKey: 'writer-take-1', deduplicated, recovered: deduplicated, queued: true,
  }
}

function dependencies(overrides: {
  method?: ReturnType<typeof methodResult>
  quote?: ReturnType<typeof quote>
  videoQuote?: ReturnType<typeof videoQuote>
} = {}) {
  const readYimeng = vi.fn(async (endpoint: string) => ({
    ok: true as const,
    value: endpoint === 'promptIr' ? promptIr() : endpoint === 'firstFrameQuote'
      ? (overrides.quote ?? quote()) : (overrides.videoQuote ?? videoQuote()),
  }))
  const runPromptIrMethod = vi.fn(async () => ({ ok: true as const, value: overrides.method ?? methodResult() }))
  return { readYimeng, runPromptIrMethod }
}

describe('production Take Host bridge', () => {
  it('re-reads selected first-frame and current video quote authority before mapping the exact Writer request', async () => {
    const deps = dependencies()
    const prepared = await prepareProductionTakeCommand(INTENT, deps, helpers, new AbortController().signal)
    expect(deps.readYimeng.mock.calls.map(call => call[0])).toEqual(['promptIr', 'firstFrameQuote', 'videoQuote'])
    expect(deps.runPromptIrMethod).toHaveBeenCalledWith({
      projectId: INTENT.projectId,
      episodeId: INTENT.episodeId,
      storyboardRevisionId: INTENT.storyboardRevisionId,
      frameId: INTENT.frameId,
      basePromptIrId: 'prompt-ir-7',
      baseVersion: 7,
      baseSnapshotSha256: SHA('a'),
      baseContentSha256: SHA('b'),
      baseEditableProjection: EDITABLE,
      candidateEditableProjection: METHOD_CANDIDATE,
    }, expect.any(AbortSignal))
    expect(Object.keys(prepared.body).sort()).toEqual([
      'authoritySnapshotSha256', 'firstFrameQuoteProjectionSha256', 'idempotencyKey', 'promptIrContentSha256',
      'promptIrId', 'promptIrVersion', 'referenceBindings', 'storyboardRevisionId', 'takeKind',
      'firstFrameSelectionReceiptSha256', 'selectedFirstFrameAssetId', 'selectedFirstFrameMaterializedSha256',
      'videoPreflightSha256', 'videoQuoteProjectionSha256', 'maximumReservationCny', 'candidateCount', 'maxAttempts',
      'selectAsOfficial', 'paidConfirmed', 'paidConfirmationText',
    ].sort())
    expect(prepared.path).toBe('/api/qingmu/projects/project-1/episodes/episode-1/scenes/scene-1/shots/shot-1/production-takes')
    expect(prepared.body).not.toHaveProperty('ownerId')
    expect(prepared.body).not.toHaveProperty('ready')
    expect(prepared.body).not.toHaveProperty('provider')
    expect(prepared.body).not.toHaveProperty('model')
    expect(prepared.body).toMatchObject({
      firstFrameSelectionReceiptSha256: INTENT.firstFrameSelectionReceiptSha256,
      selectedFirstFrameAssetId: INTENT.selectedFirstFrameAssetId,
      selectedFirstFrameMaterializedSha256: INTENT.selectedFirstFrameMaterializedSha256,
      videoPreflightSha256: INTENT.videoPreflightSha256, videoQuoteProjectionSha256: INTENT.videoQuoteProjectionSha256,
      maximumReservationCny: INTENT.maximumReservationCny, candidateCount: 1, maxAttempts: 1, selectAsOfficial: false,
      paidConfirmed: true, paidConfirmationText: INTENT.paidConfirmationText,
    })
    const normalized = prepared.normalize(receipt(prepared.idempotencyKey))
    expect(normalized).toMatchObject({ providerCalls: 0, workerStarted: false, maximumCostCny: '0', receipt: { queued: true } })
    expect(JSON.stringify(normalized)).not.toMatch(/"(?:provider|model|routeKey|secret)"/u)
  })

  it('derives the same server key for repeat, refresh, and restart recovery', async () => {
    const first = await prepareProductionTakeCommand(INTENT, dependencies(), helpers, new AbortController().signal)
    const afterRestart = await prepareProductionTakeCommand(structuredClone(INTENT), dependencies(), helpers, new AbortController().signal)
    expect(afterRestart.idempotencyKey).toBe(first.idempotencyKey)
    expect(afterRestart.normalize(receipt(first.idempotencyKey, true)).receipt).toMatchObject({ deduplicated: true, recovered: true })
  })

  it.each([
    ['missing selection receipt', (() => { const { firstFrameSelectionReceiptSha256: _value, ...value } = INTENT; return value })()],
    ['forged paid flag', { ...INTENT, paidConfirmed: false }],
    ['wrong candidate count', { ...INTENT, candidateCount: 2 }],
    ['noncanonical confirmation', { ...INTENT, paidConfirmationText: ' 我确认费用。' }],
  ])('rejects an incomplete or forged browser %s', (_name, value) => {
    expect(() => parseQueueProductionTakeIntent(value, helpers))
      .toThrow(/(?:invalid fields|video quote confirmation invalid|paidConfirmationText)/u)
  })

  it.each([
    ['selected first-frame receipt', (value: ReturnType<typeof receipt>) => { value.firstFrameSelectionReceiptSha256 = SHA('1') }],
    ['selected first-frame asset', (value: ReturnType<typeof receipt>) => { value.selectedFirstFrameAssetId = 'asset-forged' }],
    ['selected first-frame bytes', (value: ReturnType<typeof receipt>) => { value.selectedFirstFrameMaterializedSha256 = SHA('1') }],
    ['video preflight', (value: ReturnType<typeof receipt>) => { value.videoPreflightSha256 = SHA('1') }],
    ['video quote', (value: ReturnType<typeof receipt>) => { value.videoQuoteProjectionSha256 = SHA('1') }],
    ['maximum reservation', (value: ReturnType<typeof receipt>) => { value.maximumReservationCny = 0.31 }],
    ['paid confirmation digest', (value: ReturnType<typeof receipt>) => { value.paidConfirmationTextSha256 = SHA('1') }],
  ])('rejects a recovered receipt with a forged %s binding', async (_name, mutate) => {
    const prepared = await prepareProductionTakeCommand(INTENT, dependencies(), helpers, new AbortController().signal)
    const forged = receipt(prepared.idempotencyKey, true)
    mutate(forged)
    expect(() => prepared.normalize(forged)).toThrow(/receipt lineage mismatch/u)
  })

  it.each([
    ['confirmation text', (value: ReturnType<typeof videoQuote>) => { value.requiredPaidConfirmationText = '客户端伪造确认。' }],
    ['confirmation digest', (value: ReturnType<typeof videoQuote>) => { value.requiredPaidConfirmationTextSha256 = SHA('1') }],
    ['extra dispatch blocker', (value: ReturnType<typeof videoQuote>) => { value.dispatchBlockers.push('budget_blocked') }],
  ])('rejects a stale or forged current video quote %s before POST', async (_name, mutate) => {
    const forged = videoQuote()
    mutate(forged)
    await expect(prepareProductionTakeCommand(INTENT, dependencies({ videoQuote: forged }), helpers, new AbortController().signal))
      .rejects.toThrow(/video quote authority mismatch/u)
  })

  it('rejects browser authority fields and tampered E1-B attestations before Writer', async () => {
    expect(() => parseQueueProductionTakeIntent({ ...INTENT, ownerId: 'owner-1' }, helpers)).toThrow(/invalid fields/u)
    const forged = methodResult()
    forged.methodAttestation.signature = SHA('f')
    const deps = dependencies({ method: forged })
    await expect(prepareProductionTakeCommand(INTENT, deps, helpers, new AbortController().signal))
      .rejects.toThrow(/attestation signature mismatch/u)
    expect(deps.readYimeng).toHaveBeenCalledTimes(1)
  })

  it('rejects a semantically forged E1-B method even after projection SHA and HMAC are recomputed', async () => {
    const forged = methodResult()
    forged.projection.method_definition.id = 'forged-provider-neutral-method'
    resignMethod(forged)
    const deps = dependencies({ method: forged })
    await expect(prepareProductionTakeCommand(INTENT, deps, helpers, new AbortController().signal))
      .rejects.toThrow(/Method definition mismatch/u)
    expect(deps.readYimeng).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'method schema identity', expected: /Method definition mismatch/u,
      mutate: (value: ReturnType<typeof methodResult>) => { value.projection.method_definition.prompt_ir_schema = 'forged-v1' },
    },
    {
      name: 'ordered source identity', expected: /source binding identity mismatch/u,
      mutate: (value: ReturnType<typeof methodResult>) => {
        (value.projection.source_bindings[0] as { kind: string }).kind = 'role_method'
      },
    },
    {
      name: 'field method digest binding', expected: /D\/E field mapping mismatch/u,
      mutate: (value: ReturnType<typeof methodResult>) => {
        value.projection.method_definition.field_mapping.fields[0]!.method_sha256 = SHA('9')
        rehashMapping(value)
      },
    },
    {
      name: 'independent D and E contracts', expected: /D\/E stage contract authority mismatch/u,
      mutate: (value: ReturnType<typeof methodResult>) => {
        for (const field of value.projection.method_definition.field_mapping.fields) {
          for (const binding of field.stage_contract_bindings) binding.contract_sha256 = SHA('d')
        }
        rehashMapping(value)
      },
    },
    {
      name: 'definition E contract binding', expected: /D\/E stage contract authority mismatch/u,
      mutate: (value: ReturnType<typeof methodResult>) => { value.projection.method_definition.stage_contract_sha256 = SHA('9') },
    },
    {
      name: 'input snapshot digest', expected: /snapshot authority mismatch/u,
      mutate: (value: ReturnType<typeof methodResult>) => { value.projection.input_snapshot_sha256 = SHA('9') },
    },
    {
      name: 'authority attestation', expected: /snapshot authority mismatch/u,
      mutate: (value: ReturnType<typeof methodResult>) => { value.projection.authority_snapshot_attestation = 'verified' },
    },
    {
      name: 'zero-execution work order', expected: /work-order boundary mismatch/u,
      mutate: (value: ReturnType<typeof methodResult>) => { value.projection.work_order_projection.providerCalls = 1 },
    },
  ])('rejects re-signed semantic forgery: $name', async ({ mutate, expected }) => {
    const forged = methodResult()
    mutate(forged)
    resignMethod(forged)
    const deps = dependencies({ method: forged })
    await expect(prepareProductionTakeCommand(INTENT, deps, helpers, new AbortController().signal))
      .rejects.toThrow(expected)
    expect(deps.readYimeng).toHaveBeenCalledTimes(1)
  })

  it('passes a distinct Take 3 intent to Writer so its durable cap can reject before side effects', async () => {
    expect(() => parseQueueProductionTakeIntent({ ...INTENT, confirmReady: false }, helpers)).toThrow(/confirmReady/u)
    const third = parseQueueProductionTakeIntent({ ...INTENT, takeKind: 'targeted_rework', takeOrdinal: 3 }, helpers)
    const first = await prepareProductionTakeCommand(INTENT, dependencies(), helpers, new AbortController().signal)
    const prepared = await prepareProductionTakeCommand(third, dependencies(), helpers, new AbortController().signal)
    expect(prepared.body.takeKind).toBe('targeted_rework')
    expect(prepared.idempotencyKey).not.toBe(first.idempotencyKey)
  })
})
