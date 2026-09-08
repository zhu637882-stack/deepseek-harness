import { createHash, createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createImagoMethodHandler,
  type ImagoMethodAdapterDependencies,
} from '../src/index.ts'
import type {
  ImagoPromptIrEditableProjection,
  ImagoPromptIrMethodRequest,
  ImagoPromptIrMethodResponse,
  ImagoPromptIrMethodSnapshot,
} from '../src/types.ts'

const signal = () => new AbortController().signal
const INTEGRATION_CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT?.trim()
const TEST_ATTESTATION_KEY = 'qingmu-prompt-ir-method-test-attestation-key'
const EDITABLE_FIELDS = [
  'imageGenPrompt',
  'lastFrameImagePrompt',
  'videoGenPrompt',
  'motionPrompt',
  'negativePrompt',
] as const
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
  'runtime_pointer',
  'runtime_channel_registry',
  'stage_contracts',
  'role_capability_spec',
  'prompt_ir_policy',
  'role_agent',
  'role_method',
] as const
const D_STAGE_CONTRACT_SHA256 = 'a'.repeat(64)
const E_STAGE_CONTRACT_SHA256 = 'd'.repeat(64)

interface MutablePromptIrMappingEntry {
  stage_ids: string[]
  stage_contract_bindings: { stage_id: string; contract_sha256: string }[]
  method_sha256: string
  card_bindings: { sha256: string; provenance_sha256: string }[]
}

interface MutablePromptIrProjection {
  method_definition: { field_mapping: { fields: MutablePromptIrMappingEntry[] } }
  source_bindings: { sha256?: string }[]
  field_hints: { mapping_sha256?: string }[]
}

function firstMappingEntry(value: MutablePromptIrProjection): MutablePromptIrMappingEntry {
  const entry = value.method_definition.field_mapping.fields[0]
  if (entry === undefined) throw new Error('expected baseline PromptIR mapping entry')
  return entry
}

function firstCardBinding(value: MutablePromptIrProjection): MutablePromptIrMappingEntry['card_bindings'][number] {
  const binding = firstMappingEntry(value).card_bindings[0]
  if (binding === undefined) throw new Error('expected baseline PromptIR card binding')
  return binding
}

function stageContractBinding(
  value: MutablePromptIrProjection,
  fieldIndex: number,
  bindingIndex: number,
): MutablePromptIrMappingEntry['stage_contract_bindings'][number] {
  const binding = value.method_definition.field_mapping.fields[fieldIndex]
    ?.stage_contract_bindings[bindingIndex]
  if (binding === undefined) throw new Error('expected baseline PromptIR stage contract binding')
  return binding
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort(compareUnicodeCodePoints).map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

const BASE_EDITABLE_PROJECTION: ImagoPromptIrEditableProjection = {
  imageGenPrompt: '雨夜街口，人物保持锁定造型。',
  lastFrameImagePrompt: '',
  videoGenPrompt: '镜头缓慢推进，人物抬头。',
  motionPrompt: '雨丝斜落，衣角轻摆。',
  negativePrompt: '无文字，无水印。',
}

const REQUEST_WITHOUT_SNAPSHOT = {
  projectId: 'project-1',
  episodeId: 'episode-1',
  storyboardRevisionId: 'storyboard-revision-1',
  frameId: 'frame-1',
  basePromptIrId: 'prompt-ir-1',
  baseVersion: 4,
  baseContentSha256: 'b'.repeat(64),
  baseEditableProjection: BASE_EDITABLE_PROJECTION,
  candidateEditableProjection: {
    videoGenPrompt: '镜头稳定推进，人物抬头后停住。',
  },
} as const

const BASE_SUBJECT = {
  schema: 'jason.qingmu-prompt-ir-subject.v1',
  projectId: REQUEST_WITHOUT_SNAPSHOT.projectId,
  episodeId: REQUEST_WITHOUT_SNAPSHOT.episodeId,
  targetType: 'prompt_ir',
  targetId: `${REQUEST_WITHOUT_SNAPSHOT.storyboardRevisionId}:${REQUEST_WITHOUT_SNAPSHOT.frameId}`,
  storyboardRevisionId: REQUEST_WITHOUT_SNAPSHOT.storyboardRevisionId,
  frameId: REQUEST_WITHOUT_SNAPSHOT.frameId,
  promptIrId: REQUEST_WITHOUT_SNAPSHOT.basePromptIrId,
  promptIrVersion: REQUEST_WITHOUT_SNAPSHOT.baseVersion,
  promptIrContentSha256: REQUEST_WITHOUT_SNAPSHOT.baseContentSha256,
  status: 'Ready',
  editableProjection: BASE_EDITABLE_PROJECTION,
} as const

const REQUEST: ImagoPromptIrMethodRequest = {
  ...REQUEST_WITHOUT_SNAPSHOT,
  baseSnapshotSha256: canonicalSha256(BASE_SUBJECT),
}

function projection(snapshot: ImagoPromptIrMethodSnapshot): Record<string, unknown> {
  const normalizedCandidate: ImagoPromptIrEditableProjection = {
    ...snapshot.baseEditableProjection,
    ...snapshot.candidateEditableProjection,
  }
  const changedPaths = EDITABLE_FIELDS
    .filter(field => snapshot.baseEditableProjection[field] !== normalizedCandidate[field])
    .map(field => `/editableProjection/${field}`)
  return {
    schema: 'qingmu.imago-prompt-ir-method-projection.v1',
    input_snapshot_sha256: canonicalSha256(snapshot),
    target: snapshot.target,
    normalized_candidate: normalizedCandidate,
    candidate_sha256: canonicalSha256(normalizedCandidate),
    changed_paths: changedPaths,
    blockers: changedPaths.length === 0 ? ['candidate_has_no_editable_changes'] : [],
    warnings: ['yimeng_v2_to_imago_v1_field_mapping_not_declared'],
    method_definition: {
      id: 'imago-v6-e-provider-neutral-prompt-ir-edit-method',
      version: 1,
      sha256: 'c'.repeat(64),
      stage_contract_sha256: 'd'.repeat(64),
      role_capability_sha256: 'e'.repeat(64),
      prompt_ir_schema: 'IMAGO-V6-VideoPromptIR-v1',
      field_mapping: 'not_declared',
      agent_path: SOURCE_PATHS[5],
      skill_path: SOURCE_PATHS[6],
    },
    source_bindings: SOURCE_PATHS.map((path, index) => ({
      kind: SOURCE_KINDS[index],
      path,
      sha256: 'f'.repeat(64),
    })),
    field_hints: [{
      hint_id: 'bounded-editable-surface',
      field: 'candidateEditableProjection',
      title: '可编辑面边界',
      guidance: '只允许五个 canonical 提示词字段。',
    }],
    checklist: [{
      check_id: 'method-only-zero-execution',
      label: '只编译方法，不执行生成或写入。',
      required: true,
    }],
    work_order_projection: {
      target: snapshot.target,
      operation: 'compilePromptIrCandidateProjection',
      allowed_mutations: [],
      editable_fields: EDITABLE_FIELDS,
      required_read_set: [{
        source: 'yimeng',
        resource: 'prompt_ir_authoritative_snapshot',
        projectId: snapshot.target.projectId,
        episodeId: snapshot.target.episodeId,
        targetId: `${snapshot.target.storyboardRevisionId}:${snapshot.target.frameId}`,
        storyboardRevisionId: snapshot.target.storyboardRevisionId,
        frameId: snapshot.target.frameId,
        promptIrId: snapshot.target.basePromptIrId,
        promptIrVersion: snapshot.target.baseVersion,
        snapshotSha256: snapshot.target.baseSnapshotSha256,
        contentSha256: snapshot.target.baseContentSha256,
        status: 'Ready',
      }],
      before_compile: ['核对完整基线快照 SHA。'],
      after_compile: ['展示结构差异并停止在任何写入前。'],
      providerCalls: 0,
      workerStarted: false,
    },
    authority_snapshot_attestation: 'not_verified_by_compiler',
    project_state_persisted: false,
    providerCalls: 0,
    workerStarted: false,
    selection_executed: false,
    human_approval_inferred: false,
    human_signoff_inferred: false,
  }
}

function dependencies(
  runPromptIrCompiler: NonNullable<ImagoMethodAdapterDependencies['runPromptIrCompiler']>,
): ImagoMethodAdapterDependencies {
  return {
    runCompiler: vi.fn(),
    runPromptIrCompiler,
    readPromptIrStageContracts: vi.fn(async () => ({
      source_path: SOURCE_PATHS[2],
      source_sha256: 'f'.repeat(64),
      bindings: [
        { stage_id: 'D', contract_sha256: D_STAGE_CONTRACT_SHA256 },
        { stage_id: 'E', contract_sha256: E_STAGE_CONTRACT_SHA256 },
      ],
    })),
  }
}

describe('qingmu PromptIR method adapter', () => {
  beforeEach(() => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', TEST_ATTESTATION_KEY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('binds the exact Ready subject, merges partial replacements, and HMAC-attests exact input and output', async () => {
    const runPromptIrCompiler = vi.fn(async (snapshot: ImagoPromptIrMethodSnapshot) => projection(snapshot))
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runPromptIrCompiler),
    )

    const result = await handler('promptIrMethod', REQUEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoPromptIrMethodResponse
    const expectedSnapshot: ImagoPromptIrMethodSnapshot = {
      schema: 'qingmu.prompt-ir-method-snapshot.v1',
      target: {
        projectId: REQUEST.projectId,
        episodeId: REQUEST.episodeId,
        storyboardRevisionId: REQUEST.storyboardRevisionId,
        frameId: REQUEST.frameId,
        basePromptIrId: REQUEST.basePromptIrId,
        baseVersion: REQUEST.baseVersion,
        baseSnapshotSha256: REQUEST.baseSnapshotSha256,
        baseContentSha256: REQUEST.baseContentSha256,
      },
      baseEditableProjection: REQUEST.baseEditableProjection,
      candidateEditableProjection: REQUEST.candidateEditableProjection,
      authority: {
        business_truth: 'yimeng',
        method_source: 'imago_os_current',
        human_approval: 'not_granted',
        paid_provider_authority: 'not_granted',
      },
    }
    expect(runPromptIrCompiler).toHaveBeenCalledWith(
      expectedSnapshot,
      expect.objectContaining({ coreRoot: '/opt/imago-os-core' }),
      expect.any(AbortSignal),
    )
    expect(value).toMatchObject({
      schema: 'qingmu.imago-prompt-ir-method-adapter-result.v1',
      projection: {
        normalized_candidate: {
          ...BASE_EDITABLE_PROJECTION,
          videoGenPrompt: REQUEST.candidateEditableProjection.videoGenPrompt,
        },
        changed_paths: ['/editableProjection/videoGenPrompt'],
        blockers: [],
        warnings: [],
        providerCalls: 0,
        workerStarted: false,
        maximumCostCny: '0',
        selection_executed: false,
      },
    })
    expect(value.projection.method_definition.field_mapping.fields.map(entry => ({
      field: entry.field,
      stage_ids: entry.stage_ids,
      stage_contracts: entry.stage_contract_bindings.map(binding => ({
        stage_id: binding.stage_id,
        contract_sha256: binding.contract_sha256,
      })),
      card_paths: entry.card_bindings.map(binding => binding.path),
    }))).toEqual([
      {
        field: 'imageGenPrompt',
        stage_ids: ['D'],
        stage_contracts: [{ stage_id: 'D', contract_sha256: D_STAGE_CONTRACT_SHA256 }],
        card_paths: ['assets/keyframe-prompt-template.md'],
      },
      {
        field: 'lastFrameImagePrompt',
        stage_ids: ['D'],
        stage_contracts: [{ stage_id: 'D', contract_sha256: D_STAGE_CONTRACT_SHA256 }],
        card_paths: ['assets/keyframe-prompt-template.md'],
      },
      {
        field: 'videoGenPrompt',
        stage_ids: ['E'],
        stage_contracts: [{ stage_id: 'E', contract_sha256: E_STAGE_CONTRACT_SHA256 }],
        card_paths: ['assets/video-prompt-template.md'],
      },
      {
        field: 'motionPrompt',
        stage_ids: ['E'],
        stage_contracts: [{ stage_id: 'E', contract_sha256: E_STAGE_CONTRACT_SHA256 }],
        card_paths: ['assets/video-prompt-template.md'],
      },
      {
        field: 'negativePrompt',
        stage_ids: ['D', 'E'],
        stage_contracts: [
          { stage_id: 'D', contract_sha256: D_STAGE_CONTRACT_SHA256 },
          { stage_id: 'E', contract_sha256: E_STAGE_CONTRACT_SHA256 },
        ],
        card_paths: ['assets/keyframe-prompt-template.md', 'assets/video-prompt-template.md'],
      },
    ])
    const fieldMapping = value.projection.method_definition.field_mapping
    expect(fieldMapping.schema).toBe('qingmu.imago-prompt-ir-field-mapping.v1')
    expect(fieldMapping.version).toBe(1)
    expect(fieldMapping.sha256).toMatch(/^[0-9a-f]{64}$/u)
    const directorBindings = value.projection.source_bindings.slice(-2)
    expect(directorBindings.map(binding => binding.stage_id)).toEqual(['D', 'E'])
    for (const binding of directorBindings) {
      expect(binding.kind).toBe('director_method_card')
      expect(binding.sha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(binding.provenance_sha256).toMatch(/^[0-9a-f]{64}$/u)
    }
    expect(value.projection.field_hints).toHaveLength(5)
    expect(value.projection.field_hints.map(hint => hint.mapping_sha256)).toEqual(
      Array(5).fill(value.projection.method_definition.field_mapping.sha256),
    )
    expect(REQUEST.baseContentSha256).not.toBe(canonicalSha256(REQUEST.baseEditableProjection))
    expect(value.methodAttestation).toMatchObject({
      schema: 'qingmu.imago-prompt-ir-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256: value.projectionSha256,
      inputSnapshotSha256: canonicalSha256(expectedSnapshot),
      targetSha256: canonicalSha256(expectedSnapshot.target),
      baseEditableProjectionSha256: canonicalSha256(expectedSnapshot.baseEditableProjection),
      candidateEditableProjectionSha256: canonicalSha256(expectedSnapshot.candidateEditableProjection),
      candidateSha256: value.projection.candidate_sha256,
    })
    const { signature, ...unsigned } = value.methodAttestation
    expect(signature).toBe(createHmac('sha256', TEST_ATTESTATION_KEY)
      .update(canonicalJson(unsigned), 'utf8')
      .digest('hex'))
  })

  it('rejects incomplete bases, empty or unknown replacements, blank values, and snapshot drift before Core', async () => {
    const runPromptIrCompiler = vi.fn()
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runPromptIrCompiler),
    )
    const { negativePrompt: _negativePrompt, ...incompleteBase } = BASE_EDITABLE_PROJECTION
    const invalidPayloads: unknown[] = [
      { ...REQUEST, baseEditableProjection: incompleteBase },
      { ...REQUEST, candidateEditableProjection: {} },
      { ...REQUEST, candidateEditableProjection: { compiled: 'forbidden' } },
      { ...REQUEST, candidateEditableProjection: { motionPrompt: '   ' } },
      { ...REQUEST, projectId: 'changed-without-new-snapshot-sha' },
      { ...REQUEST, promptIrContentSha256: 'c'.repeat(64) },
    ]

    for (const payload of invalidPayloads) {
      const result = await handler('promptIrMethod', payload, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('invalid PromptIR input should fail')
      expect(result.error.code).toBe('bad-request')
    }
    expect(runPromptIrCompiler).not.toHaveBeenCalled()
  })

  it('fails closed on forged candidate, diff, mapping, evidence, or execution receipts', async () => {
    const variants = [
      (value: Record<string, unknown>): void => { value.provider_package = {} },
      (value: Record<string, unknown>): void => {
        value.normalized_candidate = { ...BASE_EDITABLE_PROJECTION, videoGenPrompt: 'forged' }
      },
      (value: Record<string, unknown>): void => { value.candidate_sha256 = REQUEST.baseContentSha256 },
      (value: Record<string, unknown>): void => { value.changed_paths = [] },
      (value: Record<string, unknown>): void => { value.warnings = [] },
      (value: Record<string, unknown>): void => { value.providerCalls = 1 },
      (value: Record<string, unknown>): void => {
        value.source_bindings = SOURCE_PATHS.map((path, index) => ({
          kind: index === 4 ? 'provider_compiler' : SOURCE_KINDS[index],
          path,
          sha256: 'f'.repeat(64),
        }))
      },
    ]

    for (const mutate of variants) {
      const handler = createImagoMethodHandler(
        { coreRoot: '/opt/imago-os-core' },
        dependencies(async (snapshot) => {
          const value = structuredClone(projection(snapshot))
          mutate(value)
          return value
        }),
      )
      const result = await handler('promptIrMethod', REQUEST, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('forged PromptIR projection should fail')
      expect(result.error.message).toContain('projection contract failed')
    }
  })

  it('rejects missing, duplicate, misplaced, or SHA-drifted explicit field mappings', async () => {
    const bootstrapHandler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(async snapshot => projection(snapshot)),
    )
    const baselineResult = await bootstrapHandler('promptIrMethod', REQUEST, signal())
    expect(baselineResult.ok).toBe(true)
    if (!baselineResult.ok) throw new Error(baselineResult.error.message)
    const baseline = (baselineResult.value as ImagoPromptIrMethodResponse).projection
    const variants: ((value: MutablePromptIrProjection) => void)[] = [
      (value) => { value.method_definition.field_mapping.fields.pop() },
      (value) => { value.method_definition.field_mapping.fields.push(
        structuredClone(firstMappingEntry(value)),
      ) },
      (value) => { firstMappingEntry(value).stage_ids = ['E'] },
      (value) => { stageContractBinding(value, 0, 0).contract_sha256 = 'b'.repeat(64) },
      (value) => { stageContractBinding(value, 2, 0).contract_sha256 = 'b'.repeat(64) },
      (value) => { stageContractBinding(value, 4, 1).stage_id = 'D' },
      (value) => { firstMappingEntry(value).method_sha256 = 'a'.repeat(64) },
      (value) => { firstCardBinding(value).sha256 = 'a'.repeat(64) },
      (value) => { firstCardBinding(value).provenance_sha256 = 'a'.repeat(64) },
      (value) => {
        const binding = value.source_bindings.at(-1)
        if (binding === undefined) throw new Error('expected baseline PromptIR source binding')
        binding.sha256 = 'a'.repeat(64)
      },
      (value) => {
        const hint = value.field_hints[0]
        if (hint === undefined) throw new Error('expected baseline PromptIR field hint')
        hint.mapping_sha256 = 'a'.repeat(64)
      },
    ]

    for (const mutate of variants) {
      const handler = createImagoMethodHandler(
        { coreRoot: '/opt/imago-os-core' },
        dependencies(async () => {
          const value = structuredClone(baseline) as unknown as MutablePromptIrProjection
          mutate(value)
          return value
        }),
      )
      const result = await handler('promptIrMethod', REQUEST, signal())
      expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    }
  })

  it('produces the same mapping and projection SHA for the same input', async () => {
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(async snapshot => projection(snapshot)),
    )
    const first = await handler('promptIrMethod', REQUEST, signal())
    const second = await handler('promptIrMethod', REQUEST, signal())
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('deterministic PromptIR mapping should compile')
    const firstValue = first.value as ImagoPromptIrMethodResponse
    const secondValue = second.value as ImagoPromptIrMethodResponse
    expect(secondValue.projection.method_definition.field_mapping.sha256)
      .toBe(firstValue.projection.method_definition.field_mapping.sha256)
    expect(secondValue.projectionSha256).toBe(firstValue.projectionSha256)
  })

  it.runIf(INTEGRATION_CORE_ROOT !== undefined && INTEGRATION_CORE_ROOT !== '')(
    'runs the reviewed current PromptIR compiler with exact D/E mapping and no execution authority',
    async () => {
      const coreRoot = INTEGRATION_CORE_ROOT
      expect(existsSync(`${coreRoot}/scripts/compile_qingmu_prompt_ir_method.py`)).toBe(true)
      const handler = createImagoMethodHandler({})

      const result = await handler('promptIrMethod', REQUEST, signal())

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoPromptIrMethodResponse
      expect(value.projection).toMatchObject({
        candidate_sha256: canonicalSha256({
          ...BASE_EDITABLE_PROJECTION,
          ...REQUEST.candidateEditableProjection,
        }),
        changed_paths: ['/editableProjection/videoGenPrompt'],
        warnings: [],
        project_state_persisted: false,
        providerCalls: 0,
        workerStarted: false,
        maximumCostCny: '0',
        selection_executed: false,
        human_approval_inferred: false,
        human_signoff_inferred: false,
      })
      expect(value.projection).not.toHaveProperty('provider_package')
      const fields = value.projection.method_definition.field_mapping.fields
      expect(fields[0]?.stage_contract_bindings[0]?.contract_sha256)
        .not.toBe(fields[2]?.stage_contract_bindings[0]?.contract_sha256)
      expect(fields[4]?.stage_contract_bindings.map(binding => binding.stage_id)).toEqual(['D', 'E'])
    },
  )
})
