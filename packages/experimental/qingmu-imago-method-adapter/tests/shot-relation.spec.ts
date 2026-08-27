import { createHash, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
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
  'authoritative-frame-number',
  'shot-duration-and-dialogue-rhythm',
  'current-reference-lineage',
] as const
const CHECK_IDS = [
  'canonical-shot-id',
  'scene-resolves',
  'beat-local-only',
  'element-subsets-close',
  'revision-and-sha-current',
  'frame-number-unique',
  'dialogue-rhythm-valid',
  'current-reference-exact',
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
      frameNo: 20,
      sceneId: 'scene-1',
      durationSec: 3,
      dialogueRhythm: {
        cueCount: 1,
        timedCueCount: 1,
        cues: [{
          schemaVersion: 'dialogue-cue-v2',
          lineId: 'line-1',
          speakerId: 'actor-1',
          verbatimText: '别动。',
          plannedStartSec: 0,
          plannedEndSec: 1,
          timingVerified: true,
          legacy: false,
        }],
      },
      elementIds: ['actor-1', 'scene-element-1'],
      beats: [{ beatId: 'beat-1', elementIds: ['actor-1'] }],
    },
    {
      shotId: 'frame-2',
      frameNo: 3,
      sceneId: 'scene-1',
      durationSec: 3.5,
      dialogueRhythm: {
        cueCount: 1,
        timedCueCount: 1,
        cues: [{
          schemaVersion: 'dialogue-cue-v2',
          lineId: 'line-2',
          speakerId: 'actor-1',
          verbatimText: '快走。',
          plannedStartSec: 0.25,
          plannedEndSec: 1.25,
          timingVerified: true,
          legacy: false,
        }],
      },
      elementIds: ['actor-1', 'scene-element-1', 'prop-1'],
      beats: [{ beatId: 'beat-1', elementIds: ['actor-1', 'prop-1'] }],
    },
  ],
  elements: [
    {
      elementId: 'actor-1',
      elementKind: 'actor',
      profileRevision: 5,
      snapshotSha256: '3'.repeat(64),
      currentReferenceAvailability: 'available',
      currentReference: {
        assetId: 'asset-actor-1',
        sha256: '6'.repeat(64),
        lineage: {
          projectId: 'project-1',
          sourceEpisodeId: 'episode-source-1',
          ownerType: 'actor',
          ownerId: 'actor-1',
          role: 'identity_board',
          generationJobId: 'job-actor-1',
          sourceRevisionId: 'revision-actor-1',
          formalConsistencyCheckId: 'check-actor-1',
        },
      },
    },
    {
      elementId: 'scene-element-1',
      elementKind: 'scene',
      profileRevision: 4,
      snapshotSha256: '2'.repeat(64),
      currentReferenceAvailability: 'missing',
      currentReference: null,
    },
    {
      elementId: 'prop-1',
      elementKind: 'prop',
      profileRevision: 6,
      snapshotSha256: '4'.repeat(64),
      currentReferenceAvailability: 'missing',
      currentReference: null,
    },
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

function shotHashFields(shot: ImagoShotRelationMethodRequest['shots'][number]): Record<string, unknown> {
  const hex = (value: number | null): string | null => {
    if (value === null) return null
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setFloat64(0, value === 0 ? 0 : value, false)
    return `binary64:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
  }
  return {
    ...shot,
    durationSec: hex(shot.durationSec),
    dialogueRhythm: {
      ...shot.dialogueRhythm,
      cues: shot.dialogueRhythm.cues.map(cue => ({
        ...cue,
        plannedStartSec: hex(cue.plannedStartSec),
        plannedEndSec: hex(cue.plannedEndSec),
      })),
    },
  }
}

function relationSha256(request: ImagoShotRelationMethodRequest): string {
  const subject = {
    ...relationAuthority(request),
    shots: request.shots.map(shotHashFields),
  }
  return canonicalSha256({
    schema: 'qingmu.e5-3-seconds-binary64-hash-projection.v1',
    subject,
  })
}

function shotSha256(shot: ImagoShotRelationMethodRequest['shots'][number]): string {
  return canonicalSha256({
    schema: 'qingmu.e5-3-seconds-binary64-hash-projection.v1',
    subject: shotHashFields(shot),
  })
}

function projectionSha256(projection: ImagoShotRelationMethodProjection): string {
  const relationship = projection.relationship_projection
  return canonicalSha256({
    schema: 'qingmu.e5-3-seconds-binary64-hash-projection.v1',
    subject: {
      ...projection,
      relationship_projection: {
        ...relationship,
        shots: relationship.shots.map(shotHashFields),
        selectedShot: shotHashFields(relationship.selectedShot),
      },
    },
  })
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
      relationSnapshotSha256: relationSha256(request),
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
      operations: [
        'inspectCanonicalShotRelations',
        'inspectShotRiverRhythmAndReferences',
      ],
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
      review_dimensions: ['同一 Shot ID', '易梦 frameNo 唯一性', '镜头时长与对白节奏时窗', '当前参考 Asset ID、SHA-256 与完整 lineage'],
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

    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true)
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
      selectedShotSha256: shotSha256(REQUEST.shots[1]!),
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
      expect(relationSha256).toBe(expectedSnapshot(request).target.relationSnapshotSha256)
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
    const firstShot = REQUEST.shots[0]
    const secondShot = REQUEST.shots[1]
    const firstCue = firstShot?.dialogueRhythm.cues[0]
    if (firstElement === undefined) throw new Error('fixture first Element is missing')
    if (firstShot === undefined || secondShot === undefined || firstCue === undefined) {
      throw new Error('fixture E5-3 Shot or cue is missing')
    }
    const firstReference = firstElement.currentReference
    if (firstReference === null) throw new Error('fixture current reference is missing')
    const firstShotWithCue = (cuePatch: Record<string, unknown>): Record<string, unknown> => ({
      ...firstShot,
      dialogueRhythm: {
        ...firstShot.dialogueRhythm,
        cues: [{ ...firstCue, ...cuePatch }],
      },
    })
    const actorWithLineage = (lineagePatch: Record<string, unknown>): Record<string, unknown> => ({
      ...firstElement,
      currentReference: {
        ...firstReference,
        lineage: { ...firstReference.lineage, ...lineagePatch },
      },
    })
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
      { ...REQUEST, shots: [firstShot, { ...secondShot, frameNo: firstShot.frameNo }] },
      { ...REQUEST, shots: [{ ...firstShot, order: 1 }, secondShot] },
      { ...REQUEST, shots: [{ ...firstShot, durationSec: Number.NaN }, secondShot] },
      { ...REQUEST, shots: [{ ...firstShot, durationSec: Number.POSITIVE_INFINITY }, secondShot] },
      { ...REQUEST, shots: [{ ...firstShot, durationSec: -0 }, secondShot] },
      { ...REQUEST, shots: [firstShotWithCue({ plannedStartSec: Number.NaN }), secondShot] },
      { ...REQUEST, shots: [firstShotWithCue({ plannedEndSec: Number.POSITIVE_INFINITY }), secondShot] },
      { ...REQUEST, shots: [firstShotWithCue({ plannedEndSec: 3.25 }), secondShot] },
      { ...REQUEST, shots: [{
        ...firstShot,
        dialogueRhythm: {
          cueCount: 2,
          timedCueCount: 2,
          cues: [firstCue, { ...firstCue }],
        },
      }, secondShot] },
      { ...REQUEST, elements: [{ ...firstElement, currentReference: null }, ...REQUEST.elements.slice(1)] },
      { ...REQUEST, elements: [actorWithLineage({ projectId: 'project-foreign' }), ...REQUEST.elements.slice(1)] },
      { ...REQUEST, elements: [actorWithLineage({ ownerId: 'actor-foreign' }), ...REQUEST.elements.slice(1)] },
      { ...REQUEST, elements: [actorWithLineage({ role: 'prop_reference' }), ...REQUEST.elements.slice(1)] },
      { ...REQUEST, elements: [{
        ...firstElement,
        currentReference: { ...firstElement.currentReference, sha256: 'A'.repeat(64) },
      }, ...REQUEST.elements.slice(1)] },
    ]

    for (const [index, payload] of invalidPayloads.entries()) {
      const result = await handler('shotRelationMethod', payload, signal())
      expect(result.ok, `invalid payload ${String(index)} unexpectedly passed`).toBe(false)
      if (result.ok) throw new Error('invalid Shot relation input should fail')
      expect(result.error.code, `invalid payload ${String(index)}: ${result.error.message}`).toBe('bad-request')
    }
    expect(runShotRelationCompiler).not.toHaveBeenCalled()
  })

  it('normalizes negative-zero cue starts using JSON wire semantics', async () => {
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(async snapshot => projection(snapshot)),
    )
    const request = structuredClone(REQUEST)
    const cue = request.shots[0]?.dialogueRhythm.cues[0]
    if (cue === undefined) throw new Error('fixture dialogue cue is missing')
    Object.assign(request, { selectedShotId: request.shots[0]?.shotId })
    const zeroResult = await handler('shotRelationMethod', request, signal())
    expect(zeroResult.ok).toBe(true)
    Object.assign(cue, { plannedStartSec: -0 })

    const result = await handler('shotRelationMethod', request, signal())

    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const value = result.value as ImagoShotRelationMethodResponse
    expect(value.projection.relationship_projection.shots[0]?.dialogueRhythm.cues[0]?.plannedStartSec).toBe(0)
    expect(value.projection.target.relationSnapshotSha256).toBe(expectedSnapshot(REQUEST).target.relationSnapshotSha256)
    if (!zeroResult.ok) throw new Error(zeroResult.error.message)
    expect(value).toEqual(zeroResult.value)
  })

  it('rejects non-verbatim dialogue text before calling Core', async () => {
    const runShotRelationCompiler = vi.fn()
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(runShotRelationCompiler),
    )
    const invalidTexts = ['', ' ', ' 开始', '结束 ', '\u0085开始', '结束\u001c', '中\0文', '字'.repeat(257), '🎬'.repeat(257)]

    for (const legacy of [false, true]) {
      for (const verbatimText of invalidTexts) {
        const request = structuredClone(REQUEST)
        const cue = request.shots[0]?.dialogueRhythm.cues[0]
        if (cue === undefined) throw new Error('fixture dialogue cue is missing')
        Object.assign(cue, { verbatimText }, legacy
          ? {
            schemaVersion: 'dialogue-cue-legacy-v1',
            lineId: null,
            plannedStartSec: null,
            plannedEndSec: null,
            timingVerified: false,
            legacy: true,
          }
          : {})
        if (legacy) Object.assign(request.shots[0]?.dialogueRhythm ?? {}, { timedCueCount: 0 })

        const result = await handler('shotRelationMethod', request, signal())

        expect(result.ok, JSON.stringify({ legacy, verbatimText })).toBe(false)
        if (result.ok) throw new Error('invalid dialogue text should fail')
        expect(result.error.code).toBe('bad-request')
        expect(result.error.message).toContain('verbatimText')
      }
    }
    expect(runShotRelationCompiler).not.toHaveBeenCalled()
  })

  it('preserves Unicode dialogue text within the Core code-point limit', async () => {
    const handler = createImagoMethodHandler(
      { coreRoot: '/opt/imago-os-core' },
      dependencies(async snapshot => projection(snapshot)),
    )

    for (const verbatimText of ['字'.repeat(256), '🎬'.repeat(256), '\ufeff原文\ufeff']) {
      const request = structuredClone(REQUEST)
      const cue = request.shots[0]?.dialogueRhythm.cues[0]
      if (cue === undefined) throw new Error('fixture dialogue cue is missing')
      Object.assign(cue, { verbatimText })

      const result = await handler('shotRelationMethod', request, signal())

      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoShotRelationMethodResponse
      expect(value.projection.relationship_projection.shots[0]?.dialogueRhythm.cues[0]?.verbatimText)
        .toBe(verbatimText)
    }
  })

  it('fails closed on forged lineage, graph, method evidence, writes, execution, or approval', async () => {
    const variants = [
      (value: Record<string, unknown>): void => { value.provider_package = {} },
      (value: Record<string, unknown>): void => { value.blockers = [] },
      (value: Record<string, unknown>): void => { value.ruleSha = '1'.repeat(64) },
      (value: Record<string, unknown>): void => { value.dag = {} },
      (value: Record<string, unknown>): void => { value.projectState = {} },
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
        const relationships = value.relationship_projection as Record<string, unknown>
        const shots = relationships.shots as Record<string, unknown>[]
        shots[0] = { ...shots[0], order: 1 }
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
      const pythonWire = execFileSync('python3', ['-c', [
        'import json, sys',
        'payload = json.load(sys.stdin)',
        'payload["shots"][0]["durationSec"] = 3.0',
        'payload["shots"][0]["dialogueRhythm"]["cues"][0]["plannedStartSec"] = 0.0',
        'payload["shots"][0]["dialogueRhythm"]["cues"][0]["plannedEndSec"] = 1.0',
        'sys.stdout.write(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")))',
      ].join('\n')], {
        encoding: 'utf8',
        input: JSON.stringify(REQUEST),
      })
      expect(pythonWire).toContain('"durationSec":3.0')
      expect(pythonWire).toContain('"plannedStartSec":0.0')
      expect(pythonWire).toContain('"plannedEndSec":1.0')
      const pythonRoundTrippedRequest = JSON.parse(pythonWire) as ImagoShotRelationMethodRequest
      expect(pythonRoundTrippedRequest.shots[0]?.durationSec).toBe(3)
      expect(pythonRoundTrippedRequest.shots[0]?.dialogueRhythm.cues[0]?.plannedStartSec).toBe(0)
      expect(pythonRoundTrippedRequest.shots[0]?.dialogueRhythm.cues[0]?.plannedEndSec).toBe(1)
      expect(pythonRoundTrippedRequest.shots[1]?.durationSec).toBe(3.5)
      expect(pythonRoundTrippedRequest.shots[1]?.dialogueRhythm.cues[0]?.plannedStartSec).toBe(0.25)
      const handler = createImagoMethodHandler({})

      const result = await handler('shotRelationMethod', pythonRoundTrippedRequest, signal())

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as ImagoShotRelationMethodResponse
      expect(value.projection).toMatchObject({
        target: {
          relationSnapshotSha256: relationSha256(pythonRoundTrippedRequest),
          selectedShotId: pythonRoundTrippedRequest.selectedShotId,
        },
        relationship_projection: {
          canonicalShotIdSource: 'yimeng_storyboard_frame_id',
          beatIdScope: 'shot_local',
          selectedShot: pythonRoundTrippedRequest.shots[1],
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

  it.runIf(INTEGRATION_CORE_ROOT !== undefined && INTEGRATION_CORE_ROOT !== '')(
    'keeps finite seconds and all hash paths stable through Python, Harness, and Core',
    async () => {
      const handler = createImagoMethodHandler({})
      const timings = [
        [1, -0, 1],
        [3.5, 0.25, 1.25],
        [1e-7, 0, 1e-7],
        [9.999999e-7, 1e-7, 9.999999e-7],
        [1e-6, 0, 1e-6],
        [1e-5, 1e-7, 1e-5],
        [Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER],
        [2e16, 1e16, 2e16],
        [1e20, 0, 1e20],
        [1e21, 0, 1e21],
        [Number.MIN_VALUE, 0, Number.MIN_VALUE],
        [Number.MAX_VALUE, 0, Number.MAX_VALUE],
      ] as const

      for (const [durationSec, plannedStartSec, plannedEndSec] of timings) {
        const request = structuredClone(REQUEST)
        const shot = request.shots[1]
        const cue = shot?.dialogueRhythm.cues[0]
        if (shot === undefined || cue === undefined) throw new Error('fixture selected Shot cue is missing')
        Object.assign(shot, { durationSec })
        Object.assign(cue, { plannedStartSec, plannedEndSec })
        const pythonResult = JSON.parse(execFileSync('python3', ['-c', [
          'import json, sys',
          'sys.path.insert(0, sys.argv[1] + "/scripts")',
          'from compile_qingmu_shot_relation_method import e5_3_relation_snapshot_sha256',
          'payload = json.load(sys.stdin)',
          'for shot in payload["shots"]:',
          '    shot["durationSec"] = float(shot["durationSec"])',
          '    for cue in shot["dialogueRhythm"]["cues"]:',
          '        for key in ("plannedStartSec", "plannedEndSec"):',
          '            if cue[key] is not None: cue[key] = float(cue[key])',
          '        if cue["plannedStartSec"] == 0: cue["plannedStartSec"] = -0.0',
          'authority = {key: value for key, value in payload.items() if key != "selectedShotId"}',
          'authority["schema"] = "jason.qingmu-shot-relation-authority.v1"',
          'wire = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))',
          'sys.stdout.write(json.dumps({"wire": wire, "sha256": e5_3_relation_snapshot_sha256(authority)}))',
        ].join('\n'), INTEGRATION_CORE_ROOT ?? ''], {
          encoding: 'utf8',
          input: JSON.stringify(request),
        })) as { wire: string; sha256: string }
        const pythonRequest = JSON.parse(pythonResult.wire) as ImagoShotRelationMethodRequest
        const result = await handler('shotRelationMethod', pythonRequest, signal())

        expect(result.ok, `${String(durationSec)}: ${result.ok ? '' : result.error.message}`).toBe(true)
        if (!result.ok) throw new Error(result.error.message)
        const value = result.value as ImagoShotRelationMethodResponse
        const expected = expectedSnapshot(pythonRequest)
        const selected = value.projection.relationship_projection.selectedShot
        expect(selected).toEqual(JSON.parse(JSON.stringify(pythonRequest.shots[1])))
        expect(selected.durationSec).toBe(durationSec)
        expect(value.projection.target.relationSnapshotSha256).toBe(pythonResult.sha256)
        expect(value.projection.input_snapshot_sha256).toBe(canonicalSha256(expected))
        expect(value.methodAttestation.inputSnapshotSha256).toBe(canonicalSha256(expected))
        const pythonHashes = JSON.parse(execFileSync('python3', ['-c', [
          'import hashlib, json, struct, sys',
          'projection = json.load(sys.stdin)',
          'def seconds_hex(value):',
          '    return None if value is None else "binary64:" + struct.pack(">d", 0 if value == 0 else value).hex()',
          'def shot_fields(shot):',
          '    shot["durationSec"] = seconds_hex(shot["durationSec"])',
          '    for cue in shot["dialogueRhythm"]["cues"]:',
          '        for key in ("plannedStartSec", "plannedEndSec"): cue[key] = seconds_hex(cue[key])',
          '    return shot',
          'def digest(subject):',
          '    value = {"schema": "qingmu.e5-3-seconds-binary64-hash-projection.v1", "subject": subject}',
          '    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()',
          'relation = projection["relationship_projection"]',
          'relation["shots"] = [shot_fields(shot) for shot in relation["shots"]]',
          'relation["selectedShot"] = shot_fields(relation["selectedShot"])',
          'sys.stdout.write(json.dumps({"projection": digest(projection), "selectedShot": digest(relation["selectedShot"])}))',
        ].join('\n')], {
          encoding: 'utf8',
          input: JSON.stringify(value.projection),
        })) as { projection: string; selectedShot: string }
        expect(value.projectionSha256).toBe(projectionSha256(value.projection))
        expect(value.projectionSha256).toBe(pythonHashes.projection)
        expect(value.methodAttestation.projectionSha256).toBe(value.projectionSha256)
        expect(value.methodAttestation.selectedShotSha256).toBe(shotSha256(selected))
        expect(value.methodAttestation.selectedShotSha256).toBe(pythonHashes.selectedShot)
        const { signature, ...unsigned } = value.methodAttestation
        expect(signature).toBe(createHmac('sha256', TEST_ATTESTATION_KEY)
          .update(canonicalJson(unsigned), 'utf8').digest('hex'))
      }
    },
  )
})
