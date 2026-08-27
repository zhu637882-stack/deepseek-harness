import { createHash, createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createImagoMethodHandler,
  type ImagoMethodAdapterDependencies,
} from '../src/index.ts'
import type {
  ImagoHeroFrameStoryboardCompiledResult,
  ImagoHeroFrameStoryboardMethodProjection,
  ImagoHeroFrameStoryboardMethodRequest,
  ImagoHeroFrameStoryboardMethodResponse,
  ImagoHeroFrameStoryboardMethodSnapshot,
} from '../src/types.ts'

const signal = () => new AbortController().signal
const INTEGRATION_CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT?.trim()
const TEST_ATTESTATION_KEY = 'hero-frame-storyboard-test-key-is-long-enough'
const SOURCE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json',
  'pipeline/role-capability-spec.v6.json',
  'pipeline/v6-director-storyboard-production-loop-policy.json',
  'agents/c-ai-director/AGENTS.md',
  'skill-package/imago-c-director-development/SKILL.md',
  'skill-package/imago-c-director-development/references/scene-performance-blocking-method.md',
  'agents/c5-execution-director/AGENTS.md',
  'skill-package/imago-c5-execution-storyboard/SKILL.md',
  'skill-package/imago-c5-execution-storyboard/references/shot-grammar-continuity-lsu-method.md',
  'skill-package/imago-c5-execution-storyboard/references/director-storyboard-production-loop.md',
] as const
const SOURCE_KINDS = [
  'runtime_pointer',
  'runtime_channel_registry',
  'stage_contracts',
  'role_capability_spec',
  'director_storyboard_policy',
  'director_role_agent',
  'director_role_method',
  'director_relation_reference',
  'execution_director_role_agent',
  'execution_director_role_method',
  'execution_relation_reference',
  'director_storyboard_loop_reference',
] as const
const HINT_IDS = [
  'canonical-shot-identity',
  'normalized-canvas-coordinates',
  'shot-local-element-reference',
  'raw-and-compiled-pair',
  'preflight-not-approval',
] as const
const CHECK_IDS = [
  'canonical-shot-id',
  'hero-frame-lineage',
  'annotation-shape',
  'element-subset',
  'revision-and-sha-current',
  'zero-execution',
] as const
const FORBIDDEN = [
  'direct_project_state_write',
  'direct_database_write',
  'second_shot_identity_create',
  'imago_canvas_state_persist',
  'provider_dispatch',
  'asset_generation',
  'asset_selection',
  'human_approval',
  'human_signoff',
] as const

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort(compareUnicodeCodePoints)
      .map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`
  }
  throw new Error('fixture is not canonical JSON')
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

const REQUEST: ImagoHeroFrameStoryboardMethodRequest = {
  projectId: 'project-1',
  episodeId: 'episode-1',
  episodeRevision: 12,
  storyboardRevisionId: 'storyboard-revision-7',
  storyboardRevisionVersion: 7,
  storyboardSourceSha256: 'a'.repeat(64),
  selectedShotId: 'frame-1',
  scenes: [{
    sceneId: 'scene-1',
    profileRevision: 3,
    snapshotSha256: '1'.repeat(64),
    elementIds: ['scene-element-1', 'actor-1', 'prop-1'],
  }],
  shots: [{
    shotId: 'frame-1',
    sceneId: 'scene-1',
    elementIds: ['scene-element-1', 'actor-1', 'prop-1'],
    beats: [{ beatId: 'beat-1', elementIds: ['actor-1', 'prop-1'] }],
  }],
  elements: [
    {
      elementId: 'scene-element-1',
      elementKind: 'scene',
      profileRevision: 3,
      snapshotSha256: '1'.repeat(64),
    },
    {
      elementId: 'actor-1',
      elementKind: 'actor',
      profileRevision: 5,
      snapshotSha256: '2'.repeat(64),
    },
    {
      elementId: 'prop-1',
      elementKind: 'prop',
      profileRevision: 6,
      snapshotSha256: '3'.repeat(64),
    },
  ],
  heroFrame: {
    assetId: 'asset-hero-1',
    mediaSha256: 'b'.repeat(64),
  },
  canvas: {
    baseCanvasSha256: null,
    annotations: [
      {
        annotationId: 'subject-1',
        kind: 'subject_region',
        elementRef: { elementKind: 'actor', elementId: 'actor-1' },
        points: [{ x: 4100, y: 8200 }, { x: 100, y: 200 }],
      },
      {
        annotationId: 'anchor-1',
        kind: 'object_anchor',
        elementRef: { elementKind: 'prop', elementId: 'prop-1' },
        points: [{ x: 6500, y: 7100 }],
      },
      {
        annotationId: 'motion-1',
        kind: 'motion_vector',
        elementRef: { elementKind: 'actor', elementId: 'actor-1' },
        points: [{ x: 1200, y: 3000 }, { x: 8000, y: 3000 }],
      },
    ],
  },
}

function relationAuthority(request: ImagoHeroFrameStoryboardMethodRequest): Record<string, unknown> {
  return {
    schema: 'jason.qingmu-shot-relation-authority.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    episodeRevision: request.episodeRevision,
    storyboardRevisionId: request.storyboardRevisionId,
    storyboardRevisionVersion: request.storyboardRevisionVersion,
    storyboardSourceSha256: request.storyboardSourceSha256,
    scenes: request.scenes,
    shots: request.shots,
    elements: request.elements,
  }
}

function expectedSnapshot(request: ImagoHeroFrameStoryboardMethodRequest): ImagoHeroFrameStoryboardMethodSnapshot {
  const selectedShot = request.shots.find(shot => shot.shotId === request.selectedShotId)
  if (selectedShot === undefined) throw new Error('fixture selected Shot is missing')
  const target = {
    projectId: request.projectId,
    episodeId: request.episodeId,
    episodeRevision: request.episodeRevision,
    storyboardRevisionId: request.storyboardRevisionId,
    storyboardRevisionVersion: request.storyboardRevisionVersion,
    storyboardSourceSha256: request.storyboardSourceSha256,
    relationSnapshotSha256: canonicalSha256(relationAuthority(request)),
    selectedShotId: request.selectedShotId,
    selectedShotSnapshotSha256: canonicalSha256(selectedShot),
  }
  const heroFrameBinding = {
    schema: 'jason.qingmu-hero-frame-binding.v1',
    ...target,
    assetId: request.heroFrame.assetId,
    mediaSha256: request.heroFrame.mediaSha256,
  }
  const heroFrame = { ...request.heroFrame, bindingSha256: canonicalSha256(heroFrameBinding) }
  const rawAnnotations = {
    schema: 'jason.qingmu-storyboard-raw-annotations.v1',
    projectId: target.projectId,
    episodeId: target.episodeId,
    storyboardRevisionId: target.storyboardRevisionId,
    storyboardRevisionVersion: target.storyboardRevisionVersion,
    selectedShotId: target.selectedShotId,
    selectedShotSnapshotSha256: target.selectedShotSnapshotSha256,
    heroFrameBindingSha256: heroFrame.bindingSha256,
    annotations: request.canvas.annotations,
  }
  return {
    schema: 'qingmu.hero-frame-storyboard-method-snapshot.v1',
    target,
    scenes: request.scenes,
    shots: request.shots,
    elements: request.elements,
    heroFrame,
    canvas: {
      baseCanvasSha256: request.canvas.baseCanvasSha256,
      rawAnnotationsSha256: canonicalSha256(rawAnnotations),
      annotations: request.canvas.annotations,
    },
    authority: {
      business_truth: 'yimeng',
      shot_id_source: 'yimeng_storyboard_frame_id',
      hero_frame_source: 'yimeng_selected_first_frame',
      method_source: 'imago_os_current',
      human_approval: 'not_granted',
      paid_provider_authority: 'not_granted',
    },
  }
}

function compiledResult(): ImagoHeroFrameStoryboardCompiledResult {
  return {
    subjectLayout: [{
      annotationId: 'subject-1',
      elementRef: { elementKind: 'actor', elementId: 'actor-1' },
      bounds: { xMin: 100, yMin: 200, xMax: 4100, yMax: 8200 },
    }],
    objectAnchors: [{
      annotationId: 'anchor-1',
      elementRef: { elementKind: 'prop', elementId: 'prop-1' },
      point: { x: 6500, y: 7100 },
    }],
    actionTrajectory: [{
      annotationId: 'motion-1',
      elementRef: { elementKind: 'actor', elementId: 'actor-1' },
      from: { x: 1200, y: 3000 },
      to: { x: 8000, y: 3000 },
    }],
  }
}

function projection(snapshot: ImagoHeroFrameStoryboardMethodSnapshot): ImagoHeroFrameStoryboardMethodProjection {
  const selectedShot = snapshot.shots.find(shot => shot.shotId === snapshot.target.selectedShotId)
  if (selectedShot === undefined) throw new Error('fixture selected Shot is missing')
  const compiled = compiledResult()
  return {
    schema: 'qingmu.imago-hero-frame-storyboard-method-projection.v1',
    input_snapshot_sha256: canonicalSha256(snapshot),
    target: snapshot.target,
    canvas_projection: {
      canonicalShotIdSource: 'yimeng_storyboard_frame_id',
      shotId: snapshot.target.selectedShotId,
      selectedShot,
      heroFrame: snapshot.heroFrame,
      baseCanvasSha256: snapshot.canvas.baseCanvasSha256,
      rawAnnotations: snapshot.canvas.annotations,
      rawAnnotationsSha256: snapshot.canvas.rawAnnotationsSha256,
      compiledResult: compiled,
      compiledResultSha256: canonicalSha256(compiled),
    },
    method_definition: {
      id: 'imago-v6-c-c5-hero-frame-storyboard-canvas',
      version: 1,
      sha256: 'b'.repeat(64),
      stage_contract_sha256: { CDEV: 'c'.repeat(64), C5R: 'd'.repeat(64) },
      role_capability_sha256: { C: 'e'.repeat(64), C5: 'f'.repeat(64) },
      agent_paths: [SOURCE_PATHS[5], SOURCE_PATHS[8]],
      skill_paths: [SOURCE_PATHS[6], SOURCE_PATHS[9]],
    },
    source_bindings: SOURCE_PATHS.map((path, index) => ({
      kind: SOURCE_KINDS[index],
      path,
      sha256: '1'.repeat(64),
    })),
    field_hints: HINT_IDS.map(hintId => ({
      hint_id: hintId,
      title: `title-${hintId}`,
      guidance: `guidance-${hintId}`,
    })),
    checklist: CHECK_IDS.map(checkId => ({
      check_id: checkId,
      label: `label-${checkId}`,
      required: true,
    })),
    work_order_projection: {
      target: snapshot.target,
      operation: 'compileHeroFrameStoryboardCanvas',
      allowed_mutations: ['replaceStoryboardCanvas'],
      required_read_set: [{
        source: 'yimeng',
        resource: 'hero_frame_storyboard_canvas_snapshot',
        ...snapshot.target,
        heroFrameBindingSha256: snapshot.heroFrame.bindingSha256,
        baseCanvasSha256: snapshot.canvas.baseCanvasSha256,
        rawAnnotationsSha256: snapshot.canvas.rawAnnotationsSha256,
      }],
      before_compile: ['重新读取易梦画布快照。'],
      after_compile: ['只进入易梦 ChangeSet 预览。'],
      providerCalls: 0,
      workerStarted: false,
    },
    review_card: {
      title: 'Hero Frame / Storyboard Canvas 结构检查',
      summary: '编译确定性画布结果。',
      review_dimensions: ['同一 Shot ID'],
      hard_vetoes: ['不得创建第二真源'],
      decision_boundary: '结构通过只允许进入易梦 ChangeSet 预览。',
    },
    legal_work_set: {
      reads: ['yimeng_hero_frame_storyboard_canvas_snapshot'],
      writes: ['replace_storyboard_canvas_via_changeset'],
      forbidden: FORBIDDEN,
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
  runHeroFrameStoryboardCompiler: NonNullable<ImagoMethodAdapterDependencies['runHeroFrameStoryboardCompiler']>,
): ImagoMethodAdapterDependencies {
  return { runCompiler: vi.fn(), runHeroFrameStoryboardCompiler }
}

describe('qingmu Hero Frame Storyboard method adapter', () => {
  beforeEach(() => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', TEST_ATTESTATION_KEY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('derives every lineage SHA in the Host and attests the exact compiled canvas', async () => {
    const runHeroFrameStoryboardCompiler = vi.fn(
      async (snapshot: ImagoHeroFrameStoryboardMethodSnapshot) => projection(snapshot),
    )
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runHeroFrameStoryboardCompiler),
    )

    const result = await handler('heroFrameStoryboardMethod', REQUEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoHeroFrameStoryboardMethodResponse
    const snapshot = expectedSnapshot(REQUEST)
    expect(runHeroFrameStoryboardCompiler).toHaveBeenCalledWith(
      snapshot,
      expect.objectContaining({ coreRoot: '/opt/imago-os-core' }),
      expect.any(AbortSignal),
    )
    expect(value).toMatchObject({
      schema: 'qingmu.imago-hero-frame-storyboard-method-adapter-result.v1',
      projection: {
        target: snapshot.target,
        canvas_projection: {
          canonicalShotIdSource: 'yimeng_storyboard_frame_id',
          shotId: REQUEST.selectedShotId,
          heroFrame: snapshot.heroFrame,
          rawAnnotationsSha256: snapshot.canvas.rawAnnotationsSha256,
          compiledResult: compiledResult(),
        },
        project_state_persisted: false,
        providerCalls: 0,
        workerStarted: false,
        selection_executed: false,
        human_approval_inferred: false,
        human_signoff_inferred: false,
      },
    })
    expect(value.methodAttestation).toMatchObject({
      schema: 'qingmu.imago-hero-frame-storyboard-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256: value.projectionSha256,
      inputSnapshotSha256: canonicalSha256(snapshot),
      targetSha256: canonicalSha256(snapshot.target),
      relationSnapshotSha256: snapshot.target.relationSnapshotSha256,
      selectedShotSha256: snapshot.target.selectedShotSnapshotSha256,
      heroFrameBindingSha256: snapshot.heroFrame.bindingSha256,
      rawAnnotationsSha256: snapshot.canvas.rawAnnotationsSha256,
      compiledResultSha256: canonicalSha256(compiledResult()),
    })
    const { signature, ...unsigned } = value.methodAttestation
    expect(signature).toBe(createHmac('sha256', TEST_ATTESTATION_KEY)
      .update(canonicalJson(unsigned), 'utf8')
      .digest('hex'))
  })

  it('does not accept browser-supplied hashes or a second Shot identity and rejects invalid annotations before Core', async () => {
    const runHeroFrameStoryboardCompiler = vi.fn()
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runHeroFrameStoryboardCompiler),
    )
    const invalidPayloads: unknown[] = [
      { ...REQUEST, relationSnapshotSha256: '9'.repeat(64) },
      { ...REQUEST, selectedShotSnapshotSha256: '9'.repeat(64) },
      { ...REQUEST, heroFrame: { ...REQUEST.heroFrame, bindingSha256: '9'.repeat(64) } },
      { ...REQUEST, canvas: { ...REQUEST.canvas, rawAnnotationsSha256: '9'.repeat(64) } },
      { ...REQUEST, selectedShotId: 'frame-missing' },
      {
        ...REQUEST,
        canvas: {
          ...REQUEST.canvas,
          annotations: [REQUEST.canvas.annotations[0], REQUEST.canvas.annotations[0]],
        },
      },
      {
        ...REQUEST,
        canvas: {
          ...REQUEST.canvas,
          annotations: [{
            ...REQUEST.canvas.annotations[0],
            elementRef: { elementKind: 'actor', elementId: 'actor-outside-shot' },
          }],
        },
      },
      {
        ...REQUEST,
        canvas: {
          ...REQUEST.canvas,
          annotations: [{
            ...REQUEST.canvas.annotations[0],
            points: [{ x: 10_001, y: 0 }, { x: 100, y: 100 }],
          }],
        },
      },
      {
        ...REQUEST,
        canvas: {
          ...REQUEST.canvas,
          annotations: [{
            ...REQUEST.canvas.annotations[0],
            points: [{ x: 100, y: 100 }, { x: 100, y: 200 }],
          }],
        },
      },
      {
        ...REQUEST,
        canvas: {
          ...REQUEST.canvas,
          annotations: [{
            ...REQUEST.canvas.annotations[1],
            elementRef: { elementKind: 'actor', elementId: 'actor-1' },
          }],
        },
      },
    ]

    for (const payload of invalidPayloads) {
      const result = await handler('heroFrameStoryboardMethod', payload, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('invalid Storyboard Canvas input should fail')
      expect(result.error.code).toBe('bad-request')
    }
    expect(runHeroFrameStoryboardCompiler).not.toHaveBeenCalled()
  })

  it('fails closed on forged lineage, compiled output, method evidence, writes, execution, approval, or signoff', async () => {
    const variants = [
      (value: Record<string, unknown>): void => { value.provider_package = {} },
      (value: Record<string, unknown>): void => {
        const target = value.target as Record<string, unknown>
        target.selectedShotSnapshotSha256 = '9'.repeat(64)
      },
      (value: Record<string, unknown>): void => {
        const canvas = value.canvas_projection as Record<string, unknown>
        canvas.heroFrame = { assetId: 'forged', mediaSha256: '9'.repeat(64), bindingSha256: '9'.repeat(64) }
      },
      (value: Record<string, unknown>): void => {
        const canvas = value.canvas_projection as Record<string, unknown>
        canvas.compiledResultSha256 = '9'.repeat(64)
      },
      (value: Record<string, unknown>): void => {
        const definition = value.method_definition as Record<string, unknown>
        definition.agent_paths = [SOURCE_PATHS[5], SOURCE_PATHS[5]]
      },
      (value: Record<string, unknown>): void => {
        const workOrder = value.work_order_projection as Record<string, unknown>
        workOrder.allowed_mutations = ['direct_database_write']
      },
      (value: Record<string, unknown>): void => {
        const legalWorkSet = value.legal_work_set as Record<string, unknown>
        legalWorkSet.writes = ['imago_canvas_state_persist']
      },
      (value: Record<string, unknown>): void => { value.providerCalls = 1 },
      (value: Record<string, unknown>): void => { value.selection_executed = true },
      (value: Record<string, unknown>): void => { value.human_approval_inferred = true },
      (value: Record<string, unknown>): void => { value.human_signoff_inferred = true },
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
      const result = await handler('heroFrameStoryboardMethod', REQUEST, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('forged Storyboard Canvas projection should fail')
      expect(result.error.message).toContain('projection contract failed')
    }
  })

  it.runIf(INTEGRATION_CORE_ROOT !== undefined && INTEGRATION_CORE_ROOT !== '')(
    'runs the reviewed current Hero Frame Storyboard compiler with zero execution authority',
    async () => {
      const coreRoot = INTEGRATION_CORE_ROOT
      expect(existsSync(`${coreRoot}/scripts/compile_qingmu_hero_frame_storyboard_method.py`)).toBe(true)
      const handler = createImagoMethodHandler({})

      const result = await handler('heroFrameStoryboardMethod', REQUEST, signal())

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoHeroFrameStoryboardMethodResponse
      const snapshot = expectedSnapshot(REQUEST)
      expect(value.projection).toMatchObject({
        target: snapshot.target,
        canvas_projection: {
          canonicalShotIdSource: 'yimeng_storyboard_frame_id',
          shotId: REQUEST.selectedShotId,
          heroFrame: snapshot.heroFrame,
          rawAnnotationsSha256: snapshot.canvas.rawAnnotationsSha256,
          compiledResult: compiledResult(),
        },
        project_state_persisted: false,
        providerCalls: 0,
        workerStarted: false,
        selection_executed: false,
        human_approval_inferred: false,
        human_signoff_inferred: false,
      })
      expect(value.projection.legal_work_set).toMatchObject({
        writes: ['replace_storyboard_canvas_via_changeset'],
      })
    },
  )
})
