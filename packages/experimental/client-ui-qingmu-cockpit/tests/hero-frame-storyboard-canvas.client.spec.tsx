// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ImagoHeroFrameStoryboardMethodRequest,
  ImagoHeroFrameStoryboardMethodResponse,
  QingmuYimengPort,
  YimengCommitStoryboardCanvasRequest,
  YimengCommitStoryboardCanvasResponse,
  YimengHeroFrameStoryboardsProjection,
  YimengPreviewStoryboardCanvasResponse,
  YimengProposeStoryboardCanvasResponse,
  YimengRecoverStoryboardCanvasCommitResponse,
  YimengShotRelationsProjection,
  YimengWorkflowProjection,
} from '../src/client/contracts.ts'
import { HeroFrameStoryboardCanvas } from '../src/client/HeroFrameStoryboardCanvas.tsx'
import type { QingmuCockpitKey } from '../src/client/locales.ts'
import { zh } from '../src/client/locales.ts'
import {
  createStoryboardCanvasRecoveryMarker,
  deriveStoryboardCanvasIdempotencyKey,
  writeStoryboardCanvasRecoveryMarker,
} from '../src/client/storyboard-canvas-recovery.ts'

const sha = (character: string): string => character.repeat(64)
const STORYBOARD_SOURCE_SHA = sha('1')
const RELATIONS_SHA = sha('2')
const BASE_SNAPSHOT_SHA = sha('3')
const SHOT_SNAPSHOT_SHA = sha('4')
const HERO_MEDIA_SHA = sha('5')
const HERO_BINDING_SHA = sha('6')
const METHOD_HERO_BINDING_SHA = sha('7')
const METHOD_RAW_SHA = sha('8')
const COMPILED_SHA = sha('9')
const PROJECTION_SHA = sha('a')
const INPUT_SHA = sha('b')
const TARGET_SHA = sha('c')
const SELECTED_SHOT_SHA = sha('d')
const METHOD_SHA = sha('e')
const PAYLOAD_SHA = sha('f')
const AUTHORITATIVE_SOURCE_SHA = sha('0')
const AUTHORITATIVE_SNAPSHOT_SHA = sha('a')
const CHANGED_PATHS = [
  '$.directorPlan.storyboardCanvas',
  '$.directorPlan.subjectLayout',
  '$.directorPlan.objectAnchors',
  '$.directorPlan.actionTrajectory',
  '$.visualAtoms.storyboardCanvas',
  '$.visualAtoms.subjectLayout',
  '$.visualAtoms.objectAnchors',
  '$.visualAtoms.actionTrajectory',
] as const

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) as string
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

const RELATIONS: YimengShotRelationsProjection = {
  schema: 'jason.scene-shot-beat-element-relations.v1',
  projectId: 'project-1',
  episodeId: 'episode-1',
  storyboardRevision: {
    episodeRevision: 3,
    revisionId: 'storyboard-revision-1',
    revisionVersion: 1,
    sourceSha256: STORYBOARD_SOURCE_SHA,
  },
  scenes: [{ sceneId: 'scene-1', name: '雨夜巷口', profileRevision: 2, snapshotSha256: sha('2') }],
  shots: [{
    shotId: 'frame-1',
    sceneId: 'scene-1',
    title: '雨夜相遇',
    beats: [{
      beatId: 'beat-1',
      order: 0,
      type: 'action',
      startSec: 0,
      endSec: 2.5,
      actorIds: ['character-1'],
      propIds: ['prop-1'],
      visualResponsibility: '林青进入巷口。',
    }],
    elements: [
      { elementKind: 'actor', elementId: 'character-1', name: '林青', profileRevision: 2, snapshotSha256: sha('4') },
      { elementKind: 'scene', elementId: 'scene-1', name: '雨夜巷口', profileRevision: 2, snapshotSha256: sha('2') },
      { elementKind: 'prop', elementId: 'prop-1', name: '黑伞', profileRevision: 1, snapshotSha256: sha('5') },
    ],
  }],
  valid: true,
  blockers: [],
}

const HERO = {
  assetId: 'hero-frame-1',
  mediaSha256: HERO_MEDIA_SHA,
  browserUrl: '/api/qingmu/assets/hero-frame-1/content',
  bindingSha256: HERO_BINDING_SHA,
} as const

function heroProjection(heroFrame: typeof HERO | null = HERO): YimengHeroFrameStoryboardsProjection {
  return {
    schema: 'jason.qingmu-hero-frame-storyboards.v1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    episodeRevision: 3,
    storyboardRevision: {
      revisionId: 'storyboard-revision-1',
      revisionVersion: 1,
      sourceSha256: STORYBOARD_SOURCE_SHA,
    },
    shotRelationsSha256: RELATIONS_SHA,
    shots: [{
      shotId: 'frame-1',
      shotSnapshotSha256: SHOT_SNAPSHOT_SHA,
      heroFrame,
      canvas: null,
      blockers: [],
    }],
    shotsSha256: BASE_SNAPSHOT_SHA,
    valid: true,
    blockers: [],
  }
}

function compiledFor(request: ImagoHeroFrameStoryboardMethodRequest) {
  const annotation = request.canvas.annotations[0]
  if (annotation === undefined) return { subjectLayout: [], objectAnchors: [], actionTrajectory: [] }
  if (annotation.kind !== 'subject_region' || annotation.elementRef.elementKind !== 'actor') {
    throw new Error('fixture requires an actor subject region')
  }
  const first = annotation.points[0]
  const second = annotation.points[1]
  if (first === undefined || second === undefined) throw new Error('fixture requires a two-point region')
  return {
    subjectLayout: [{
      annotationId: annotation.annotationId,
      elementRef: { elementKind: 'actor' as const, elementId: annotation.elementRef.elementId },
      bounds: {
        xMin: Math.min(first.x, second.x),
        yMin: Math.min(first.y, second.y),
        xMax: Math.max(first.x, second.x),
        yMax: Math.max(first.y, second.y),
      },
    }],
    objectAnchors: [],
    actionTrajectory: [],
  }
}

function methodResponse(request: ImagoHeroFrameStoryboardMethodRequest): ImagoHeroFrameStoryboardMethodResponse {
  const selectedShot = request.shots.find(shot => shot.shotId === request.selectedShotId)
  if (selectedShot === undefined) throw new Error('fixture selected Shot missing')
  return {
    schema: 'qingmu.imago-hero-frame-storyboard-method-adapter-result.v1',
    projectionSha256: PROJECTION_SHA,
    projection: {
      schema: 'qingmu.imago-hero-frame-storyboard-method-projection.v1',
      input_snapshot_sha256: INPUT_SHA,
      target: {
        projectId: request.projectId,
        episodeId: request.episodeId,
        episodeRevision: request.episodeRevision,
        storyboardRevisionId: request.storyboardRevisionId,
        storyboardRevisionVersion: request.storyboardRevisionVersion,
        storyboardSourceSha256: request.storyboardSourceSha256,
        relationSnapshotSha256: RELATIONS_SHA,
        selectedShotId: request.selectedShotId,
        selectedShotSnapshotSha256: SHOT_SNAPSHOT_SHA,
      },
      canvas_projection: {
        canonicalShotIdSource: 'yimeng_storyboard_frame_id',
        shotId: request.selectedShotId,
        selectedShot,
        heroFrame: {
          assetId: request.heroFrame.assetId,
          mediaSha256: request.heroFrame.mediaSha256,
          bindingSha256: METHOD_HERO_BINDING_SHA,
        },
        baseCanvasSha256: request.canvas.baseCanvasSha256,
        rawAnnotations: request.canvas.annotations,
        rawAnnotationsSha256: METHOD_RAW_SHA,
        compiledResult: compiledFor(request),
        compiledResultSha256: COMPILED_SHA,
      },
      method_definition: { sha256: METHOD_SHA },
      source_bindings: [],
      field_hints: [{ hint_id: 'coordinates', title: '坐标', guidance: '使用 0..10000 整数坐标。' }],
      checklist: [{ check_id: 'shot-id', label: '保持权威 Shot ID', required: true }],
      work_order_projection: {
        operation: 'compileHeroFrameStoryboardCanvas',
        allowed_mutations: ['replaceStoryboardCanvas'],
        providerCalls: 0,
        workerStarted: false,
      },
      review_card: { title: 'Hero Frame 画布结构检查', decision_boundary: '只检查结构，不代表批准或签收。' },
      legal_work_set: {},
      authority_snapshot_attestation: 'not_verified_by_compiler',
      project_state_persisted: false,
      providerCalls: 0,
      workerStarted: false,
      selection_executed: false,
      human_approval_inferred: false,
      human_signoff_inferred: false,
    },
    methodAttestation: {
      schema: 'qingmu.imago-hero-frame-storyboard-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256: PROJECTION_SHA,
      inputSnapshotSha256: INPUT_SHA,
      targetSha256: TARGET_SHA,
      relationSnapshotSha256: RELATIONS_SHA,
      selectedShotSha256: SHOT_SNAPSHOT_SHA,
      heroFrameBindingSha256: METHOD_HERO_BINDING_SHA,
      rawAnnotationsSha256: METHOD_RAW_SHA,
      compiledResultSha256: COMPILED_SHA,
      signature: SELECTED_SHOT_SHA,
    },
  }
}

function proposalResponse(): YimengProposeStoryboardCanvasResponse {
  return {
    schema: 'jason.qingmu-storyboard-canvas-change-set-proposal.v1',
    changeSet: {
      schema: 'jason.qingmu-change-set.v1',
      id: 'change-set-1',
      workspaceId: null,
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'storyboard_frame',
      targetId: 'frame-1',
      baseRevision: 1,
      baseSnapshotSha256: BASE_SNAPSHOT_SHA,
      payloadSha256: PAYLOAD_SHA,
      originKind: 'human',
      actorUserId: 'user-1',
      harnessSessionId: null,
      status: 'draft',
      authoritativeRevision: null,
      authoritativeSnapshotSha256: null,
      committedByUserId: null,
      committedEventId: null,
      committedAt: null,
      createdAt: '2026-08-27T04:00:00.000Z',
      updatedAt: '2026-08-27T04:00:00.000Z',
    },
    nextAction: 'preview',
  }
}

interface FixtureState {
  request?: ImagoHeroFrameStoryboardMethodRequest
  canvas?: NonNullable<YimengHeroFrameStoryboardsProjection['shots'][number]['canvas']>
  receipt?: YimengCommitStoryboardCanvasResponse
}

function buildFixture(options: { readonly wrongPlainReceipt?: boolean } = {}) {
  const state: FixtureState = {}
  const heroFrameStoryboardMethod = vi.fn(async (request: ImagoHeroFrameStoryboardMethodRequest) => {
    state.request = request
    return methodResponse(request)
  })
  const proposeStoryboardCanvas = vi.fn(async () => proposalResponse())
  const previewStoryboardCanvas = vi.fn(async (): Promise<YimengPreviewStoryboardCanvasResponse> => {
    const request = state.request
    if (request === undefined) throw new Error('method request missing')
    const canvas: NonNullable<YimengHeroFrameStoryboardsProjection['shots'][number]['canvas']> = {
      schema: 'jason.qingmu-storyboard-canvas.v1',
      heroFrameBindingSha256: HERO_BINDING_SHA,
      annotations: request.canvas.annotations,
      rawAnnotationsSha256: canonicalSha256(request.canvas.annotations),
      compiled: compiledFor(request),
      compiledSha256: COMPILED_SHA,
    }
    state.canvas = canvas
    return {
      schema: 'jason.qingmu-storyboard-canvas-preview.v1',
      changeSetId: 'change-set-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'storyboard_frame',
      targetId: 'frame-1',
      operation: 'replaceStoryboardCanvas',
      storyboardRevision: {
        revisionId: 'storyboard-revision-1', revisionVersion: 1, sourceSha256: STORYBOARD_SOURCE_SHA,
      },
      baseRevision: 1,
      baseSnapshotSha256: BASE_SNAPSHOT_SHA,
      payloadSha256: PAYLOAD_SHA,
      heroFrame: { assetId: HERO.assetId, mediaSha256: HERO.mediaSha256, bindingSha256: HERO.bindingSha256 },
      methodHeroFrameBindingSha256: METHOD_HERO_BINDING_SHA,
      before: null,
      after: canvas as unknown as YimengPreviewStoryboardCanvasResponse['after'],
      changedPaths: CHANGED_PATHS,
      providerCalls: 0,
      workerStarted: false,
      selectionExecuted: false,
      humanApprovalInferred: false,
      humanSignoff: false,
    }
  })
  const commitStoryboardCanvas = vi.fn(async (
    request: YimengCommitStoryboardCanvasRequest,
  ): Promise<YimengCommitStoryboardCanvasResponse> => {
    const canvas = state.canvas
    if (canvas === undefined) throw new Error('preview canvas missing')
    state.receipt = {
      schema: 'jason.qingmu-storyboard-canvas-commit-result.v1',
      changeSetId: request.changeSetId,
      commandReceiptId: 'command-receipt-1',
      eventId: 'event-1',
      eventType: 'StoryboardCanvasReplaced',
      projectId: request.projectId,
      episodeId: request.episodeId,
      targetType: 'storyboard_frame',
      targetId: request.targetId,
      operation: 'replaceStoryboardCanvas',
      storyboardRevision: {
        base: { revisionId: 'storyboard-revision-1', revisionVersion: 1, sourceSha256: STORYBOARD_SOURCE_SHA },
        authoritative: { revisionId: 'storyboard-revision-2', revisionVersion: 2, sourceSha256: AUTHORITATIVE_SOURCE_SHA },
      },
      baseRevision: request.baseRevision,
      authoritativeRevision: 2,
      authoritativeSnapshotSha256: AUTHORITATIVE_SNAPSHOT_SHA,
      heroFrame: { assetId: HERO.assetId, mediaSha256: HERO.mediaSha256, bindingSha256: HERO.bindingSha256 },
      methodHeroFrameBindingSha256: METHOD_HERO_BINDING_SHA,
      rawAnnotationsSha256: options.wrongPlainReceipt === true ? METHOD_RAW_SHA : canvas.rawAnnotationsSha256,
      methodRawAnnotationsSha256: METHOD_RAW_SHA,
      compiledSha256: COMPILED_SHA,
      payloadSha256: request.expectedPayloadSha256,
      idempotencyKey: request.idempotencyKey,
      changed: true,
      providerCalls: 0,
      workerStarted: false,
      selectionExecuted: false,
      humanApprovalInferred: false,
      humanSignoff: false,
      deduplicated: false,
      committedAt: '2026-08-27T04:01:00.000Z',
    }
    return state.receipt
  })
  const recoverStoryboardCanvasCommit = vi.fn(async (
    _request: YimengCommitStoryboardCanvasRequest,
  ): Promise<YimengRecoverStoryboardCanvasCommitResponse> => {
    if (state.receipt === undefined) throw new Error('commit receipt missing')
    return {
      schema: 'jason.qingmu-command-receipt-recovery.v1',
      recovered: true,
      receiptSha256: canonicalSha256(state.receipt),
      receipt: state.receipt,
    }
  })
  const onCommitted = vi.fn(async (): Promise<YimengWorkflowProjection> => {
    if (state.canvas === undefined) throw new Error('authoritative canvas missing')
    const relations = {
      ...RELATIONS,
      storyboardRevision: {
        ...RELATIONS.storyboardRevision,
        revisionId: 'storyboard-revision-2',
        revisionVersion: 2,
        sourceSha256: AUTHORITATIVE_SOURCE_SHA,
      },
    }
    const projection: YimengHeroFrameStoryboardsProjection = {
      ...heroProjection(),
      storyboardRevision: {
        revisionId: 'storyboard-revision-2',
        revisionVersion: 2,
        sourceSha256: AUTHORITATIVE_SOURCE_SHA,
      },
      shots: [{
        shotId: 'frame-1',
        shotSnapshotSha256: SHOT_SNAPSHOT_SHA,
        heroFrame: HERO,
        canvas: state.canvas,
        blockers: [],
      }],
      shotsSha256: AUTHORITATIVE_SNAPSHOT_SHA,
    }
    return {
      projectId: 'project-1',
      episodeId: 'episode-1',
      director: { shotRelations: relations, heroFrameStoryboards: projection },
    } as unknown as YimengWorkflowProjection
  })
  const port = {
    heroFrameStoryboardMethod,
    proposeStoryboardCanvas,
    previewStoryboardCanvas,
    commitStoryboardCanvas,
    recoverStoryboardCanvasCommit,
  } as unknown as QingmuYimengPort
  return {
    state,
    port,
    onCommitted,
    heroFrameStoryboardMethod,
    proposeStoryboardCanvas,
    previewStoryboardCanvas,
    commitStoryboardCanvas,
    recoverStoryboardCanvasCommit,
  }
}

const t = (key: QingmuCockpitKey): string => zh[key]

async function prepareAndConfirmCommit(): Promise<void> {
  fireEvent.change(screen.getByLabelText('点 1 X'), { target: { value: '1300' } })
  fireEvent.click(screen.getByRole('button', { name: '添加标注' }))
  fireEvent.click(screen.getByRole('button', { name: '运行 IMAGO 结构检查' }))
  await screen.findByRole('button', { name: '创建提案并读取技术预览' })
  fireEvent.click(screen.getByRole('button', { name: '创建提案并读取技术预览' }))
  await screen.findByText('技术预览')
  fireEvent.click(screen.getByRole('checkbox', { name: '我确认把此技术预览提交到易梦权威画布' }))
  fireEvent.click(screen.getByRole('button', { name: '提交权威画布' }))
}

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('HeroFrameStoryboardCanvas', () => {
  it('keeps one frame identity and completes method, proposal, preview, commit, GET-style recovery, and refresh', async () => {
    const fixture = buildFixture()
    render(<HeroFrameStoryboardCanvas
      relations={RELATIONS}
      heroFrameStoryboards={heroProjection()}
      selectedShotId="frame-1"
      port={fixture.port}
      t={t}
      onCommitted={fixture.onCommitted}
    />)

    expect(screen.getByRole('img', { name: '已选 Hero Frame 与故事板标注画布' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /主体区域|物件锚点|运动向量/u })).toHaveLength(3)
    await prepareAndConfirmCommit()
    await screen.findByText('权威画布已提交并完成回执恢复与刷新')

    const request = fixture.state.request
    const canvas = fixture.state.canvas
    const receipt = fixture.state.receipt
    expect(request?.selectedShotId).toBe('frame-1')
    expect(request?.canvas.annotations).toHaveLength(1)
    expect(request?.canvas.annotations[0]?.points[0]?.x).toBe(1300)
    expect(canvas?.rawAnnotationsSha256).toBe(canonicalSha256(request?.canvas.annotations))
    expect(canvas?.rawAnnotationsSha256).not.toBe(METHOD_RAW_SHA)
    expect(receipt?.rawAnnotationsSha256).toBe(canvas?.rawAnnotationsSha256)
    expect(receipt?.methodRawAnnotationsSha256).toBe(METHOD_RAW_SHA)
    expect(fixture.heroFrameStoryboardMethod).toHaveBeenCalledTimes(1)
    expect(fixture.proposeStoryboardCanvas).toHaveBeenCalledTimes(1)
    expect(fixture.previewStoryboardCanvas).toHaveBeenCalledTimes(1)
    expect(fixture.commitStoryboardCanvas).toHaveBeenCalledTimes(1)
    expect(fixture.recoverStoryboardCanvasCommit).toHaveBeenCalledTimes(1)
    expect(fixture.onCommitted).toHaveBeenCalledTimes(1)
    expect(sessionStorage.length).toBe(0)
    expect(receipt).toMatchObject({
      targetId: 'frame-1',
      providerCalls: 0,
      workerStarted: false,
      selectionExecuted: false,
      humanApprovalInferred: false,
      humanSignoff: false,
    })
  })

  it('finds an old-revision pending marker after authority refresh and recovers with its original GET coordinates only', async () => {
    const fixture = buildFixture()
    const canvas: NonNullable<YimengHeroFrameStoryboardsProjection['shots'][number]['canvas']> = {
      schema: 'jason.qingmu-storyboard-canvas.v1',
      heroFrameBindingSha256: HERO_BINDING_SHA,
      annotations: [],
      rawAnnotationsSha256: canonicalSha256([]),
      compiled: { subjectLayout: [], objectAnchors: [], actionTrajectory: [] },
      compiledSha256: COMPILED_SHA,
    }
    const idempotencyKey = await deriveStoryboardCanvasIdempotencyKey('change-set-1', PAYLOAD_SHA)
    const marker = createStoryboardCanvasRecoveryMarker({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboardRevisionId: 'storyboard-revision-1',
      frameId: 'frame-1',
      targetType: 'storyboard_frame',
      targetId: 'frame-1',
      changeSetId: 'change-set-1',
      baseRevision: 1,
      baseSnapshotSha256: BASE_SNAPSHOT_SHA,
      idempotencyKey,
      expectedPayloadSha256: PAYLOAD_SHA,
    })
    fixture.state.canvas = canvas
    fixture.state.receipt = {
      schema: 'jason.qingmu-storyboard-canvas-commit-result.v1',
      changeSetId: marker.changeSetId,
      commandReceiptId: 'command-receipt-1',
      eventId: 'event-1',
      eventType: 'StoryboardCanvasReplaced',
      projectId: marker.projectId,
      episodeId: marker.episodeId,
      targetType: 'storyboard_frame',
      targetId: marker.targetId,
      operation: 'replaceStoryboardCanvas',
      storyboardRevision: {
        base: { revisionId: marker.storyboardRevisionId, revisionVersion: 1, sourceSha256: STORYBOARD_SOURCE_SHA },
        authoritative: { revisionId: 'storyboard-revision-2', revisionVersion: 2, sourceSha256: AUTHORITATIVE_SOURCE_SHA },
      },
      baseRevision: marker.baseRevision,
      authoritativeRevision: 2,
      authoritativeSnapshotSha256: AUTHORITATIVE_SNAPSHOT_SHA,
      heroFrame: { assetId: HERO.assetId, mediaSha256: HERO.mediaSha256, bindingSha256: HERO.bindingSha256 },
      methodHeroFrameBindingSha256: METHOD_HERO_BINDING_SHA,
      rawAnnotationsSha256: canvas.rawAnnotationsSha256,
      methodRawAnnotationsSha256: METHOD_RAW_SHA,
      compiledSha256: COMPILED_SHA,
      payloadSha256: marker.expectedPayloadSha256,
      idempotencyKey: marker.idempotencyKey,
      changed: true,
      providerCalls: 0,
      workerStarted: false,
      selectionExecuted: false,
      humanApprovalInferred: false,
      humanSignoff: false,
      deduplicated: false,
      committedAt: '2026-08-27T04:01:00.000Z',
    }
    expect(writeStoryboardCanvasRecoveryMarker(marker)).toBe(true)

    const authoritativeRelations: YimengShotRelationsProjection = {
      ...RELATIONS,
      storyboardRevision: {
        ...RELATIONS.storyboardRevision,
        revisionId: 'storyboard-revision-2',
        revisionVersion: 2,
        sourceSha256: AUTHORITATIVE_SOURCE_SHA,
      },
    }
    const authoritativeProjection: YimengHeroFrameStoryboardsProjection = {
      ...heroProjection(),
      storyboardRevision: {
        revisionId: 'storyboard-revision-2',
        revisionVersion: 2,
        sourceSha256: AUTHORITATIVE_SOURCE_SHA,
      },
      shots: [{
        shotId: 'frame-1',
        shotSnapshotSha256: SHOT_SNAPSHOT_SHA,
        heroFrame: HERO,
        canvas,
        blockers: [],
      }],
      shotsSha256: AUTHORITATIVE_SNAPSHOT_SHA,
    }
    render(<HeroFrameStoryboardCanvas
      relations={authoritativeRelations}
      heroFrameStoryboards={authoritativeProjection}
      selectedShotId="frame-1"
      port={fixture.port}
      t={t}
      onCommitted={fixture.onCommitted}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '恢复原提交回执' }))
    await screen.findByText('权威画布已提交并完成回执恢复与刷新')

    expect(fixture.recoverStoryboardCanvasCommit).toHaveBeenCalledTimes(1)
    expect(fixture.recoverStoryboardCanvasCommit.mock.calls[0]?.[0]).toEqual({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboardRevisionId: 'storyboard-revision-1',
      frameId: 'frame-1',
      targetType: 'storyboard_frame',
      targetId: 'frame-1',
      changeSetId: 'change-set-1',
      baseRevision: 1,
      baseSnapshotSha256: BASE_SNAPSHOT_SHA,
      idempotencyKey,
      expectedPayloadSha256: PAYLOAD_SHA,
    })
    expect(fixture.heroFrameStoryboardMethod).not.toHaveBeenCalled()
    expect(fixture.proposeStoryboardCanvas).not.toHaveBeenCalled()
    expect(fixture.previewStoryboardCanvas).not.toHaveBeenCalled()
    expect(fixture.commitStoryboardCanvas).not.toHaveBeenCalled()
    expect(fixture.onCommitted).toHaveBeenCalledTimes(1)
    expect(sessionStorage.length).toBe(0)
  })

  it('fails closed when a receipt substitutes the rich method envelope SHA for the plain annotation SHA', async () => {
    const fixture = buildFixture({ wrongPlainReceipt: true })
    render(<HeroFrameStoryboardCanvas
      relations={RELATIONS}
      heroFrameStoryboards={heroProjection()}
      selectedShotId="frame-1"
      port={fixture.port}
      t={t}
      onCommitted={fixture.onCommitted}
    />)

    await prepareAndConfirmCommit()
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('提交回执与本次 IMAGO 方法不一致')
    })
    expect(fixture.commitStoryboardCanvas).toHaveBeenCalledTimes(1)
    expect(fixture.recoverStoryboardCanvasCommit).not.toHaveBeenCalled()
    expect(fixture.onCommitted).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(1)
  })

  it('aborts in-flight method work and resets prepared state when any lineage coordinate changes', async () => {
    const fixture = buildFixture()
    let capturedRequest: ImagoHeroFrameStoryboardMethodRequest | undefined
    let capturedSignal: AbortSignal | undefined
    let resolveMethod: ((response: ImagoHeroFrameStoryboardMethodResponse) => void) | undefined
    const heroFrameStoryboardMethod = vi.fn((
      request: ImagoHeroFrameStoryboardMethodRequest,
      signal?: AbortSignal,
    ): Promise<ImagoHeroFrameStoryboardMethodResponse> => {
      capturedRequest = request
      capturedSignal = signal
      return new Promise((resolve) => { resolveMethod = resolve })
    })
    const port = { ...fixture.port, heroFrameStoryboardMethod } as QingmuYimengPort
    const rendered = render(<HeroFrameStoryboardCanvas
      relations={RELATIONS}
      heroFrameStoryboards={heroProjection()}
      selectedShotId="frame-1"
      port={port}
      t={t}
      onCommitted={fixture.onCommitted}
    />)

    fireEvent.click(screen.getByRole('button', { name: '运行 IMAGO 结构检查' }))
    await waitFor(() => { expect(heroFrameStoryboardMethod).toHaveBeenCalledTimes(1) })
    rendered.rerender(<HeroFrameStoryboardCanvas
      relations={RELATIONS}
      heroFrameStoryboards={{ ...heroProjection(), shotsSha256: sha('c') }}
      selectedShotId="frame-1"
      port={port}
      t={t}
      onCommitted={fixture.onCommitted}
    />)

    await waitFor(() => { expect(capturedSignal?.aborted).toBe(true) })
    if (capturedRequest === undefined || resolveMethod === undefined) throw new Error('method fixture was not captured')
    resolveMethod(methodResponse(capturedRequest))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '运行 IMAGO 结构检查' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: '创建提案并读取技术预览' })).toBeNull()
    })
  })

  it('shows a no-Hero empty state without exposing generation, selection, or signoff actions', () => {
    const fixture = buildFixture()
    render(<HeroFrameStoryboardCanvas
      relations={RELATIONS}
      heroFrameStoryboards={heroProjection(null)}
      selectedShotId="frame-1"
      port={fixture.port}
      t={t}
      onCommitted={fixture.onCommitted}
    />)

    expect(screen.getByText('当前 Shot 没有已选 Hero Frame')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '运行 IMAGO 结构检查' })).toBeNull()
    expect(fixture.heroFrameStoryboardMethod).not.toHaveBeenCalled()
  })
})
