import { createHash, createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createImagoMethodHandler,
  type ImagoMethodAdapterDependencies,
} from '../src/index.ts'
import type {
  ImagoShotRelationMethodProjection,
  ImagoShotRelationMethodRequest,
  ImagoShotRelationMethodResponse,
  ImagoShotRelationMethodSnapshot,
} from '../src/types.ts'

const signal = () => new AbortController().signal
const INTEGRATION_CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT?.trim()
const TEST_ATTESTATION_KEY = 'test-only-qingmu-shot-relation-attestation-key'
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
  'scene-shot-binding',
  'shot-local-beat-scope',
  'element-subset-binding',
  'revision-sha-boundary',
  'read-only-method-boundary',
] as const
const CHECK_IDS = [
  'canonical-shot-id',
  'scene-resolves',
  'beat-local-only',
  'element-subsets-close',
  'revision-and-sha-current',
  'zero-execution',
] as const
const FORBIDDEN = [
  'project_state_write',
  'database_write',
  'relation_identity_create',
  'beat_state_persist',
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

const REQUEST: ImagoShotRelationMethodRequest = {
  projectId: 'project-1',
  episodeId: 'episode-1',
  episodeRevision: 9,
  storyboardRevisionId: 'storyboard-revision-7',
  storyboardRevisionVersion: 7,
  storyboardSourceSha256: 'a'.repeat(64),
  selectedShotId: 'frame-2',
  scenes: [{
    sceneId: 'scene-1',
    profileRevision: 4,
    snapshotSha256: '2'.repeat(64),
    elementIds: ['actor-1', 'scene-element-1', 'prop-1'],
  }],
  shots: [
    {
      shotId: 'frame-1',
      sceneId: 'scene-1',
      elementIds: ['actor-1', 'scene-element-1'],
      beats: [{ beatId: 'beat-1', elementIds: ['actor-1'] }],
    },
    {
      shotId: 'frame-2',
      sceneId: 'scene-1',
      elementIds: ['actor-1', 'scene-element-1', 'prop-1'],
      beats: [{ beatId: 'beat-1', elementIds: ['actor-1', 'prop-1'] }],
    },
  ],
  elements: [
    { elementId: 'actor-1', elementKind: 'actor', profileRevision: 5, snapshotSha256: '3'.repeat(64) },
    { elementId: 'scene-element-1', elementKind: 'scene', profileRevision: 4, snapshotSha256: '2'.repeat(64) },
    { elementId: 'prop-1', elementKind: 'prop', profileRevision: 6, snapshotSha256: '4'.repeat(64) },
  ],
}

function relationAuthority(request: ImagoShotRelationMethodRequest): Record<string, unknown> {
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

function expectedSnapshot(request: ImagoShotRelationMethodRequest): ImagoShotRelationMethodSnapshot {
  return {
    schema: 'qingmu.shot-relation-method-snapshot.v1',
    target: {
      projectId: request.projectId,
      episodeId: request.episodeId,
      episodeRevision: request.episodeRevision,
      storyboardRevisionId: request.storyboardRevisionId,
      storyboardRevisionVersion: request.storyboardRevisionVersion,
      storyboardSourceSha256: request.storyboardSourceSha256,
      relationSnapshotSha256: canonicalSha256(relationAuthority(request)),
      selectedShotId: request.selectedShotId,
    },
    scenes: request.scenes,
    shots: request.shots,
    elements: request.elements,
    authority: {
      business_truth: 'yimeng',
      shot_id_source: 'yimeng_storyboard_frame_id',
      beat_id_scope: 'shot_local',
      method_source: 'imago_os_current',
      human_approval: 'not_granted',
      paid_provider_authority: 'not_granted',
    },
  }
}

function projection(snapshot: ImagoShotRelationMethodSnapshot): ImagoShotRelationMethodProjection {
  const selectedShot = snapshot.shots.find(shot => shot.shotId === snapshot.target.selectedShotId)
  if (selectedShot === undefined) throw new Error('fixture selected Shot is missing')
  return {
    schema: 'qingmu.imago-shot-relation-method-projection.v1',
    input_snapshot_sha256: canonicalSha256(snapshot),
    target: snapshot.target,
    relationship_projection: {
      canonicalShotIdSource: 'yimeng_storyboard_frame_id',
      beatIdScope: 'shot_local',
      scenes: snapshot.scenes,
      shots: snapshot.shots,
      elements: snapshot.elements,
      selectedShot,
    },
    method_definition: {
      id: 'imago-v6-c-c5-scene-shot-beat-element-relation',
      version: 1,
      sha256: 'b'.repeat(64),
      yimeng_subject_schema: 'jason.qingmu-shot-relation-authority.v1',
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
      operation: 'inspectCanonicalShotRelations',
      allowed_mutations: [],
      required_read_set: [{
        source: 'yimeng',
        resource: 'scene_shot_beat_element_relation_snapshot',
        projectId: snapshot.target.projectId,
        episodeId: snapshot.target.episodeId,
        episodeRevision: snapshot.target.episodeRevision,
        storyboardRevisionId: snapshot.target.storyboardRevisionId,
        storyboardRevisionVersion: snapshot.target.storyboardRevisionVersion,
        storyboardSourceSha256: snapshot.target.storyboardSourceSha256,
        relationSnapshotSha256: snapshot.target.relationSnapshotSha256,
        selectedShotId: snapshot.target.selectedShotId,
      }],
      before_compile: ['重新读取易梦关系快照。'],
      after_compile: ['停止在任何写入或批准之前。'],
      providerCalls: 0,
      workerStarted: false,
    },
    review_card: {
      title: 'Scene / Shot / Beat / Element 关系检查',
      summary: '检查同一易梦 Shot 的结构闭合。',
      review_dimensions: ['同一 Shot ID'],
      hard_vetoes: ['不得创建第二真源'],
      decision_boundary: '结构通过不产生创意批准、资产选择或人工签收。',
    },
    legal_work_set: {
      reads: ['yimeng_scene_shot_beat_element_relation_snapshot'],
      writes: [],
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
  runShotRelationCompiler: NonNullable<ImagoMethodAdapterDependencies['runShotRelationCompiler']>,
): ImagoMethodAdapterDependencies {
  return { runCompiler: vi.fn(), runShotRelationCompiler }
}

describe('qingmu Shot relation method adapter', () => {
  beforeEach(() => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', TEST_ATTESTATION_KEY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('derives the exact Yimeng relation SHA, preserves Shot-local Beats, and attests exact input and output', async () => {
    const runShotRelationCompiler = vi.fn(
      async (snapshot: ImagoShotRelationMethodSnapshot) => projection(snapshot),
    )
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runShotRelationCompiler),
    )

    const result = await handler('shotRelationMethod', REQUEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoShotRelationMethodResponse
    const snapshot = expectedSnapshot(REQUEST)
    expect(runShotRelationCompiler).toHaveBeenCalledWith(
      snapshot,
      expect.objectContaining({ coreRoot: '/opt/imago-os-core' }),
      expect.any(AbortSignal),
    )
    expect(value).toMatchObject({
      schema: 'qingmu.imago-shot-relation-method-adapter-result.v1',
      projection: {
        target: snapshot.target,
        relationship_projection: {
          canonicalShotIdSource: 'yimeng_storyboard_frame_id',
          beatIdScope: 'shot_local',
          selectedShot: REQUEST.shots[1],
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
      schema: 'qingmu.imago-shot-relation-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256: value.projectionSha256,
      inputSnapshotSha256: canonicalSha256(snapshot),
      targetSha256: canonicalSha256(snapshot.target),
      relationSnapshotSha256: snapshot.target.relationSnapshotSha256,
      selectedShotSha256: canonicalSha256(REQUEST.shots[1]),
    })
    const { signature, ...unsigned } = value.methodAttestation
    expect(signature).toBe(createHmac('sha256', TEST_ATTESTATION_KEY)
      .update(canonicalJson(unsigned), 'utf8')
      .digest('hex'))
  })

  it('binds Episode, Scene, and Element authority lineage into the relation snapshot SHA', async () => {
    const baselineSha256 = expectedSnapshot(REQUEST).target.relationSnapshotSha256
    const lineageVariants: ImagoShotRelationMethodRequest[] = [
      { ...REQUEST, episodeRevision: REQUEST.episodeRevision + 1 },
      {
        ...REQUEST,
        scenes: REQUEST.scenes.map((scene, index) => index === 0
          ? { ...scene, profileRevision: scene.profileRevision + 1 }
          : scene),
      },
      {
        ...REQUEST,
        scenes: REQUEST.scenes.map((scene, index) => index === 0
          ? { ...scene, snapshotSha256: '5'.repeat(64) }
          : scene),
      },
      {
        ...REQUEST,
        elements: REQUEST.elements.map((element, index) => index === 0
          ? { ...element, profileRevision: element.profileRevision + 1 }
          : element),
      },
      {
        ...REQUEST,
        elements: REQUEST.elements.map((element, index) => index === 0
          ? { ...element, snapshotSha256: '6'.repeat(64) }
          : element),
      },
    ]
    const observedSha256 = new Set([baselineSha256])

    for (const request of lineageVariants) {
      const handler = createImagoMethodHandler(
        { coreRoot: '/opt/imago-os-core' },
        dependencies(async snapshot => projection(snapshot)),
      )
      const result = await handler('shotRelationMethod', request, signal())

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoShotRelationMethodResponse
      const relationSha256 = value.projection.target.relationSnapshotSha256
      expect(relationSha256).toBe(canonicalSha256(relationAuthority(request)))
      expect(relationSha256).not.toBe(baselineSha256)
      expect(value.projection.target.episodeRevision).toBe(request.episodeRevision)
      expect(value.projection.relationship_projection.scenes).toEqual(request.scenes)
      expect(value.projection.relationship_projection.elements).toEqual(request.elements)
      observedSha256.add(relationSha256)
    }

    expect(observedSha256).toHaveLength(lineageVariants.length + 1)
  })

  it('rejects browser-supplied authority, duplicate IDs, dangling relations, and unknown selected Shots before Core', async () => {
    const runShotRelationCompiler = vi.fn()
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runShotRelationCompiler),
    )
    const duplicateBeat = {
      ...REQUEST,
      shots: REQUEST.shots.map((shot, index) => index === 0
        ? { ...shot, beats: [...shot.beats, { beatId: 'beat-1', elementIds: [] }] }
        : shot),
    }
    const outsideScene = {
      ...REQUEST,
      scenes: [{ ...REQUEST.scenes[0], elementIds: ['actor-1', 'scene-element-1'] }],
    }
    const outsideShot = {
      ...REQUEST,
      shots: REQUEST.shots.map((shot, index) => index === 0
        ? { ...shot, beats: [{ ...shot.beats[0], elementIds: ['prop-1'] }] }
        : shot),
    }
    const firstElement = REQUEST.elements[0]
    if (firstElement === undefined) throw new Error('fixture first Element is missing')
    const invalidPayloads: unknown[] = [
      { ...REQUEST, relationSnapshotSha256: '9'.repeat(64) },
      duplicateBeat,
      outsideScene,
      outsideShot,
      { ...REQUEST, selectedShotId: 'missing-shot' },
      { ...REQUEST, elements: [...REQUEST.elements, firstElement] },
      {
        ...REQUEST,
        elements: [
          ...REQUEST.elements,
          { ...firstElement, profileRevision: firstElement.profileRevision + 1 },
        ],
      },
      { ...REQUEST, episodeRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...REQUEST, storyboardRevisionVersion: 0 },
      { ...REQUEST, storyboardRevisionVersion: Number.MAX_SAFE_INTEGER + 1 },
      {
        ...REQUEST,
        scenes: [{ ...REQUEST.scenes[0], profileRevision: Number.MAX_SAFE_INTEGER + 1 }],
      },
      {
        ...REQUEST,
        scenes: [{ ...REQUEST.scenes[0], snapshotSha256: 'A'.repeat(64) }],
      },
      {
        ...REQUEST,
        elements: REQUEST.elements.map((element, index) => index === 0
          ? { ...element, profileRevision: Number.MAX_SAFE_INTEGER + 1 }
          : element),
      },
      {
        ...REQUEST,
        elements: REQUEST.elements.map((element, index) => index === 0
          ? { ...element, snapshotSha256: 'z'.repeat(64) }
          : element),
      },
    ]

    for (const payload of invalidPayloads) {
      const result = await handler('shotRelationMethod', payload, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('invalid Shot relation input should fail')
      expect(result.error.code).toBe('bad-request')
    }
    expect(runShotRelationCompiler).not.toHaveBeenCalled()
  })

  it('fails closed on forged lineage, graph, method evidence, writes, execution, or approval', async () => {
    const variants = [
      (value: Record<string, unknown>): void => { value.provider_package = {} },
      (value: Record<string, unknown>): void => {
        const target = value.target as Record<string, unknown>
        target.relationSnapshotSha256 = '9'.repeat(64)
      },
      (value: Record<string, unknown>): void => {
        const relationships = value.relationship_projection as Record<string, unknown>
        relationships.selectedShot = REQUEST.shots[0]
      },
      (value: Record<string, unknown>): void => {
        const relationships = value.relationship_projection as Record<string, unknown>
        const scenes = relationships.scenes as Record<string, unknown>[]
        scenes[0] = { ...scenes[0], profileRevision: 99 }
      },
      (value: Record<string, unknown>): void => {
        const relationships = value.relationship_projection as Record<string, unknown>
        const elements = relationships.elements as Record<string, unknown>[]
        elements[0] = { ...elements[0], snapshotSha256: '8'.repeat(64) }
      },
      (value: Record<string, unknown>): void => {
        const definition = value.method_definition as Record<string, unknown>
        definition.skill_paths = [SOURCE_PATHS[6], SOURCE_PATHS[6]]
      },
      (value: Record<string, unknown>): void => {
        const bindings = value.source_bindings as Record<string, unknown>[]
        bindings[4] = { ...bindings[4], kind: 'provider_compiler' }
      },
      (value: Record<string, unknown>): void => {
        const workOrder = value.work_order_projection as Record<string, unknown>
        workOrder.allowed_mutations = ['project_state_write']
      },
      (value: Record<string, unknown>): void => {
        const legalWorkSet = value.legal_work_set as Record<string, unknown>
        legalWorkSet.writes = ['shadow_relation_write']
      },
      (value: Record<string, unknown>): void => { value.providerCalls = 1 },
      (value: Record<string, unknown>): void => { value.human_approval_inferred = true },
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
      const result = await handler('shotRelationMethod', REQUEST, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('forged Shot relation projection should fail')
      expect(result.error.message).toContain('projection contract failed')
    }
  })

  it.runIf(INTEGRATION_CORE_ROOT !== undefined && INTEGRATION_CORE_ROOT !== '')(
    'runs the reviewed current Shot relation compiler with zero execution authority',
    async () => {
      const coreRoot = INTEGRATION_CORE_ROOT
      expect(existsSync(`${coreRoot}/scripts/compile_qingmu_shot_relation_method.py`)).toBe(true)
      const handler = createImagoMethodHandler({})

      const result = await handler('shotRelationMethod', REQUEST, signal())

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoShotRelationMethodResponse
      expect(value.projection).toMatchObject({
        target: {
          relationSnapshotSha256: canonicalSha256(relationAuthority(REQUEST)),
          selectedShotId: REQUEST.selectedShotId,
        },
        relationship_projection: {
          canonicalShotIdSource: 'yimeng_storyboard_frame_id',
          beatIdScope: 'shot_local',
          selectedShot: REQUEST.shots[1],
        },
        project_state_persisted: false,
        providerCalls: 0,
        workerStarted: false,
        selection_executed: false,
        human_approval_inferred: false,
        human_signoff_inferred: false,
      })
      expect(value.projection.legal_work_set).toMatchObject({ writes: [] })
    },
  )
})
