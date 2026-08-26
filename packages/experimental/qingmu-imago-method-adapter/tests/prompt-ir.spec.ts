import { createHash, createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createImagoMethodHandler,
  type ImagoMethodAdapterDependencies,
} from '../src/index.ts'
import type {
  ImagoPromptIrEditableProjection,
  ImagoPromptIrMethodProjection,
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

function projection(snapshot: ImagoPromptIrMethodSnapshot): ImagoPromptIrMethodProjection {
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
  return { runCompiler: vi.fn(), runPromptIrCompiler }
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
        warnings: ['yimeng_v2_to_imago_v1_field_mapping_not_declared'],
        providerCalls: 0,
        workerStarted: false,
        selection_executed: false,
      },
    })
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
          const value = structuredClone(projection(snapshot)) as unknown as Record<string, unknown>
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

  it.runIf(INTEGRATION_CORE_ROOT !== undefined && INTEGRATION_CORE_ROOT !== '')(
    'runs the reviewed current PromptIR compiler without mapping or execution authority',
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
        warnings: ['yimeng_v2_to_imago_v1_field_mapping_not_declared'],
        project_state_persisted: false,
        providerCalls: 0,
        workerStarted: false,
        selection_executed: false,
        human_approval_inferred: false,
        human_signoff_inferred: false,
      })
      expect(value.projection).not.toHaveProperty('provider_package')
    },
  )
})
