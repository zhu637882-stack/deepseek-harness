import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type {
  ImagoHeroFrameStoryboardAnnotation,
  ImagoHeroFrameStoryboardMethodRequest,
  ImagoHeroFrameStoryboardMethodResponse,
  ImagoHeroFrameStoryboardPoint,
  QingmuYimengPort,
  YimengCommitStoryboardCanvasRequest,
  YimengCommitStoryboardCanvasResponse,
  YimengHeroFrameStoryboardsProjection,
  YimengPreviewStoryboardCanvasRequest,
  YimengPreviewStoryboardCanvasResponse,
  YimengProposeStoryboardCanvasResponse,
  YimengRecoverStoryboardCanvasCommitResponse,
  YimengShotRelationElement,
  YimengShotRelationsProjection,
  YimengWorkflowProjection,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import { buildHeroFrameRelationRequest } from './ShotRelationMethodView.tsx'
import {
  clearStoryboardCanvasRecoveryMarker,
  createStoryboardCanvasRecoveryMarker,
  deriveStoryboardCanvasIdempotencyKey,
  readStoryboardCanvasRecoveryMarker,
  writeStoryboardCanvasRecoveryMarker,
} from './storyboard-canvas-recovery.ts'
import type {
  StoryboardCanvasCommitRecoveryMarker,
  StoryboardCanvasRecoveryMarkerRead,
} from './storyboard-canvas-recovery.ts'
import css from './QingmuCockpit.module.css'

const SHA256 = /^[0-9a-f]{64}$/u
const MAX_ANNOTATIONS = 256
const COORDINATE_MAX = 10_000
const POINTER_STEP = 100
const STORYBOARD_CANVAS_CHANGED_PATHS = [
  '$.directorPlan.storyboardCanvas',
  '$.directorPlan.subjectLayout',
  '$.directorPlan.objectAnchors',
  '$.directorPlan.actionTrajectory',
  '$.visualAtoms.storyboardCanvas',
  '$.visualAtoms.subjectLayout',
  '$.visualAtoms.objectAnchors',
  '$.visualAtoms.actionTrajectory',
] as const

type AnnotationKind = ImagoHeroFrameStoryboardAnnotation['kind']
type ElementKind = ImagoHeroFrameStoryboardAnnotation['elementRef']['elementKind']

interface HeroFrameStoryboardCanvasProps {
  readonly relations: YimengShotRelationsProjection
  readonly heroFrameStoryboards: YimengHeroFrameStoryboardsProjection | undefined
  readonly selectedShotId: string
  readonly port: QingmuYimengPort
  readonly t: (key: QingmuCockpitKey) => string
  readonly onCommitted: () => Promise<YimengWorkflowProjection | undefined>
}

interface CanvasElement {
  readonly elementId: string
  readonly elementKind: ElementKind
  readonly name: string
}

interface CanvasContext {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly storyboardRevisionVersion: number
  readonly storyboardSourceSha256: string
  readonly frameId: string
  readonly shotSnapshotSha256: string
  readonly heroFrame: {
    readonly assetId: string
    readonly mediaSha256: string
    readonly browserUrl: string
    readonly bindingSha256: string
  }
  readonly baseSnapshotSha256: string
  readonly savedCanvas: unknown | null
  readonly savedRawAnnotationsSha256: string | null
  readonly savedCompiledSha256: string | null
  readonly annotations: readonly ImagoHeroFrameStoryboardAnnotation[]
  readonly elements: readonly CanvasElement[]
  readonly lineageKey: string
}

type ContextResult =
  | { readonly status: 'empty'; readonly reason: 'selection' | 'hero' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly value: CanvasContext }

interface VerifiedMethod {
  readonly response: ImagoHeroFrameStoryboardMethodResponse
  readonly methodSha256: string
  readonly projectionSha256: string
  readonly plainAnnotationsSha256: string
  readonly methodRawAnnotationsSha256: string
  readonly compiledResultSha256: string
  readonly reviewTitle: string
  readonly decisionBoundary: string
  readonly hints: readonly { readonly id: string; readonly title: string; readonly guidance: string }[]
  readonly checks: readonly { readonly id: string; readonly label: string }[]
}

interface CanvasProposal {
  readonly changeSetId: string
  readonly targetId: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly payloadSha256: string
  readonly raw: YimengProposeStoryboardCanvasResponse
}

interface CanvasPreview {
  readonly changeSetId: string
  readonly payloadSha256: string
  readonly canCommit: boolean
  readonly changed: boolean
  readonly changedPaths: readonly string[]
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly raw: YimengPreviewStoryboardCanvasResponse
}

interface CanvasCommitReceipt {
  readonly changeSetId: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly projectId: string
  readonly episodeId: string
  readonly baseStoryboardRevisionId: string
  readonly authoritativeStoryboardRevisionId: string
  readonly authoritativeStoryboardSourceSha256: string
  readonly frameId: string
  readonly authoritativeRevision: number
  readonly authoritativeSnapshotSha256: string
  readonly rawAnnotationsSha256: string
  readonly compiledSha256: string
  readonly heroFrameAssetId: string
  readonly heroFrameMediaSha256: string
  readonly heroFrameBindingSha256: string
  readonly methodHeroFrameBindingSha256: string
  readonly methodRawAnnotationsSha256: string
  readonly payloadSha256: string
  readonly idempotencyKey: string
  readonly raw: YimengCommitStoryboardCanvasResponse
}

type BusyPhase = 'method' | 'proposal' | 'preview' | 'commit' | 'recover' | 'refresh' | null

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} 不是对象`)
  return value as Record<string, unknown>
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 不是非空字符串`)
  return value
}

function sha256Of(value: unknown, label: string): string {
  const result = stringOf(value, label)
  if (!SHA256.test(result)) throw new Error(`${label} 不是 SHA-256`)
  return result
}

function integerOf(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${label} 不是有效整数`)
  return value as number
}

function arrayOf(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} 不是数组`)
  return value
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function canonicalSha256(value: unknown): Promise<string> {
  const cryptoValue: unknown = Reflect.get(globalThis, 'crypto')
  if (
    typeof cryptoValue !== 'object'
    || cryptoValue === null
    || !('subtle' in cryptoValue)
    || typeof cryptoValue.subtle !== 'object'
    || cryptoValue.subtle === null
    || !('digest' in cryptoValue.subtle)
    || typeof cryptoValue.subtle.digest !== 'function'
  ) throw new Error('当前浏览器不支持画布权威 SHA-256 计算')
  const digest = await (cryptoValue.subtle as SubtleCrypto).digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(value)),
  )
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function assertSame(actual: unknown, expected: unknown, label: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} 与当前权威读取不一致`)
}

function clampCoordinate(value: number): number {
  return Math.max(0, Math.min(COORDINATE_MAX, Math.round(value)))
}

function expectedPointCount(kind: AnnotationKind): 1 | 2 {
  return kind === 'object_anchor' ? 1 : 2
}

function compatible(kind: AnnotationKind, elementKind: ElementKind): boolean {
  return kind === 'subject_region' ? elementKind === 'actor'
    : kind === 'object_anchor' ? elementKind === 'prop'
      : true
}

function normalizePoint(value: unknown, label: string): ImagoHeroFrameStoryboardPoint {
  const point = recordOf(value, label)
  const keys = Object.keys(point).sort()
  if (keys.length !== 2 || keys[0] !== 'x' || keys[1] !== 'y') throw new Error(`${label} 字段不符合合同`)
  const x = integerOf(point.x, `${label}.x`)
  const y = integerOf(point.y, `${label}.y`)
  if (x > COORDINATE_MAX || y > COORDINATE_MAX) throw new Error(`${label} 超出 0..10000`)
  return { x, y }
}

function normalizeAnnotations(
  value: unknown,
  elements: readonly CanvasElement[],
  label: string,
): readonly ImagoHeroFrameStoryboardAnnotation[] {
  const rows = arrayOf(value, label)
  if (rows.length > MAX_ANNOTATIONS) throw new Error(`${label} 超过 ${String(MAX_ANNOTATIONS)} 条`)
  const allowed = new Map(elements.map(element => [element.elementId, element.elementKind]))
  const ids = new Set<string>()
  return rows.map((row, index) => {
    const item = recordOf(row, `${label}[${String(index)}]`)
    const keys = Object.keys(item).sort()
    if (canonicalJson(keys) !== canonicalJson(['annotationId', 'elementRef', 'kind', 'points'])) {
      throw new Error(`${label}[${String(index)}] 字段不符合合同`)
    }
    const annotationId = stringOf(item.annotationId, `${label}[${String(index)}].annotationId`)
    if (ids.has(annotationId)) throw new Error(`${label} 含重复 ID ${annotationId}`)
    ids.add(annotationId)
    const kind = item.kind
    if (kind !== 'subject_region' && kind !== 'object_anchor' && kind !== 'motion_vector') {
      throw new Error(`${label}[${String(index)}].kind 不受支持`)
    }
    const elementRef = recordOf(item.elementRef, `${label}[${String(index)}].elementRef`)
    if (canonicalJson(Object.keys(elementRef).sort()) !== canonicalJson(['elementId', 'elementKind'])) {
      throw new Error(`${label}[${String(index)}].elementRef 字段不符合合同`)
    }
    const elementId = stringOf(elementRef.elementId, `${label}[${String(index)}].elementId`)
    const elementKind = elementRef.elementKind
    if ((elementKind !== 'actor' && elementKind !== 'prop') || allowed.get(elementId) !== elementKind) {
      throw new Error(`${label}[${String(index)}] 引用了 Shot 外或类型不符的元素`)
    }
    if (!compatible(kind, elementKind)) throw new Error(`${label}[${String(index)}] 的工具与元素类型不符`)
    const points = arrayOf(item.points, `${label}[${String(index)}].points`).map((point, pointIndex) => (
      normalizePoint(point, `${label}[${String(index)}].points[${String(pointIndex)}]`)
    ))
    if (points.length !== expectedPointCount(kind)) throw new Error(`${label}[${String(index)}] 点数不正确`)
    if (kind === 'subject_region' && (points[0]?.x === points[1]?.x || points[0]?.y === points[1]?.y)) {
      throw new Error(`${label}[${String(index)}] 主体区域必须为非零矩形`)
    }
    if (kind === 'motion_vector' && points[0]?.x === points[1]?.x && points[0]?.y === points[1]?.y) {
      throw new Error(`${label}[${String(index)}] 运动向量起终点必须不同`)
    }
    return { annotationId, kind, elementRef: { elementKind, elementId }, points }
  })
}

function resolveCanvasContext(
  relations: YimengShotRelationsProjection,
  heroProjection: YimengHeroFrameStoryboardsProjection | undefined,
  selectedShotId: string,
): ContextResult {
  if (selectedShotId === '') return { status: 'empty', reason: 'selection' }
  try {
    if (heroProjection === undefined) return { status: 'empty', reason: 'hero' }
    if (
      heroProjection.projectId !== relations.projectId
      || heroProjection.episodeId !== relations.episodeId
      || heroProjection.episodeRevision !== relations.storyboardRevision.episodeRevision
      || heroProjection.storyboardRevision.revisionId !== relations.storyboardRevision.revisionId
      || heroProjection.storyboardRevision.revisionVersion !== relations.storyboardRevision.revisionVersion
      || heroProjection.storyboardRevision.sourceSha256 !== relations.storyboardRevision.sourceSha256
    ) throw new Error('Hero Frame 投影与 Shot 关系修订不一致')
    sha256Of(heroProjection.shotRelationsSha256, 'heroFrameStoryboards.shotRelationsSha256')
    const baseSnapshotSha256 = sha256Of(heroProjection.shotsSha256, 'heroFrameStoryboards.shotsSha256')

    const relationShots = relations.shots.filter(shot => shot.shotId === selectedShotId)
    const heroShots = heroProjection.shots.filter(shot => shot.shotId === selectedShotId)
    if (relationShots.length !== 1 || heroShots.length !== 1) throw new Error('所选 Shot 身份不是唯一权威 frame ID')
    const relationShot = relationShots[0]
    const heroShot = heroShots[0]
    if (relationShot === undefined || heroShot === undefined) throw new Error('所选 Shot 不存在')
    const shotSnapshotSha256 = sha256Of(heroShot.shotSnapshotSha256, 'shotSnapshotSha256')
    if (heroShot.heroFrame === null) return { status: 'empty', reason: 'hero' }
    const heroFrame = {
      assetId: stringOf(heroShot.heroFrame.assetId, 'heroFrame.assetId'),
      mediaSha256: sha256Of(heroShot.heroFrame.mediaSha256, 'heroFrame.mediaSha256'),
      browserUrl: stringOf(heroShot.heroFrame.browserUrl, 'heroFrame.browserUrl'),
      bindingSha256: sha256Of(heroShot.heroFrame.bindingSha256, 'heroFrame.bindingSha256'),
    }
    const elements = relationShot.elements.flatMap((element: YimengShotRelationElement): readonly CanvasElement[] => (
      element.elementKind === 'actor' || element.elementKind === 'prop'
        ? [{ elementId: element.elementId, elementKind: element.elementKind, name: element.name }]
        : []
    ))
    if (new Set(elements.map(element => element.elementId)).size !== elements.length) {
      throw new Error('所选 Shot 含重复 Actor/Prop ID')
    }
    const canvas = heroShot.canvas
    if (canvas !== null && canvas.heroFrameBindingSha256 !== heroFrame.bindingSha256) {
      throw new Error('已保存画布与当前 Hero Frame 绑定不一致')
    }
    const annotations = normalizeAnnotations(canvas?.annotations ?? [], elements, 'canvas.annotations')
    const savedRawAnnotationsSha256 = canvas === null ? null : sha256Of(canvas.rawAnnotationsSha256, 'canvas.rawAnnotationsSha256')
    const savedCompiledSha256 = canvas === null ? null : sha256Of(canvas.compiledSha256, 'canvas.compiledSha256')
    const lineageKey = canonicalJson({
      projectId: relations.projectId,
      episodeId: relations.episodeId,
      episodeRevision: relations.storyboardRevision.episodeRevision,
      storyboardRevisionId: relations.storyboardRevision.revisionId,
      storyboardRevisionVersion: relations.storyboardRevision.revisionVersion,
      storyboardSourceSha256: relations.storyboardRevision.sourceSha256,
      shotRelationsSha256: heroProjection.shotRelationsSha256,
      heroShotsSha256: heroProjection.shotsSha256,
      frameId: selectedShotId,
      shotSnapshotSha256,
      heroFrame,
      savedCanvas: canvas,
      baseSnapshotSha256,
    })
    return {
      status: 'ready',
      value: {
        projectId: relations.projectId,
        episodeId: relations.episodeId,
        storyboardRevisionId: relations.storyboardRevision.revisionId,
        storyboardRevisionVersion: relations.storyboardRevision.revisionVersion,
        storyboardSourceSha256: relations.storyboardRevision.sourceSha256,
        frameId: selectedShotId,
        shotSnapshotSha256,
        heroFrame,
        baseSnapshotSha256,
        savedCanvas: canvas,
        savedRawAnnotationsSha256,
        savedCompiledSha256,
        annotations,
        elements,
        lineageKey,
      },
    }
  } catch (error) {
    return { status: 'error', message: errorMessage(error) }
  }
}

function verifyMethodResponse(
  response: ImagoHeroFrameStoryboardMethodResponse,
  request: ImagoHeroFrameStoryboardMethodRequest,
  plainAnnotationsSha256: string,
): VerifiedMethod {
  const root = recordOf(response, 'Hero Frame 方法响应')
  if (root.schema !== 'qingmu.imago-hero-frame-storyboard-method-adapter-result.v1') throw new Error('Hero Frame 方法响应 schema 不匹配')
  const projectionSha256 = sha256Of(root.projectionSha256, 'method.projectionSha256')
  const projection = recordOf(root.projection, 'method.projection')
  if (projection.schema !== 'qingmu.imago-hero-frame-storyboard-method-projection.v1') throw new Error('Hero Frame 方法投影 schema 不匹配')
  const target = recordOf(projection.target, 'method.projection.target')
  const expectedTarget = {
    projectId: request.projectId,
    episodeId: request.episodeId,
    episodeRevision: request.episodeRevision,
    storyboardRevisionId: request.storyboardRevisionId,
    storyboardRevisionVersion: request.storyboardRevisionVersion,
    storyboardSourceSha256: request.storyboardSourceSha256,
    selectedShotId: request.selectedShotId,
  }
  for (const [key, value] of Object.entries(expectedTarget)) {
    if (target[key] !== value) throw new Error(`Hero Frame 方法目标 ${key} 漂移`)
  }
  const relationSnapshotSha256 = sha256Of(target.relationSnapshotSha256, 'method.target.relationSnapshotSha256')
  const selectedShotSnapshotSha256 = sha256Of(target.selectedShotSnapshotSha256, 'method.target.selectedShotSnapshotSha256')
  const selectedShot = request.shots.find(shot => shot.shotId === request.selectedShotId)
  if (selectedShot === undefined) throw new Error('方法请求缺少所选 Shot')
  const canvas = recordOf(projection.canvas_projection, 'method.canvas_projection')
  if (canvas.canonicalShotIdSource !== 'yimeng_storyboard_frame_id' || canvas.shotId !== request.selectedShotId) {
    throw new Error('Hero Frame 方法改变了 Shot 身份')
  }
  assertSame(canvas.selectedShot, selectedShot, 'Hero Frame 方法 selectedShot')
  const projectedHero = recordOf(canvas.heroFrame, 'method.canvas_projection.heroFrame')
  if (projectedHero.assetId !== request.heroFrame.assetId || projectedHero.mediaSha256 !== request.heroFrame.mediaSha256) {
    throw new Error('Hero Frame 方法改变了首帧资产血缘')
  }
  const heroFrameBindingSha256 = sha256Of(projectedHero.bindingSha256, 'method.heroFrame.bindingSha256')
  if (canvas.baseCanvasSha256 !== request.canvas.baseCanvasSha256) throw new Error('Hero Frame 方法改变了基础画布')
  assertSame(canvas.rawAnnotations, request.canvas.annotations, 'Hero Frame 方法原始标注')
  const methodRawAnnotationsSha256 = sha256Of(canvas.rawAnnotationsSha256, 'method.rawAnnotationsSha256')
  const compiledResultSha256 = sha256Of(canvas.compiledResultSha256, 'method.compiledResultSha256')
  recordOf(canvas.compiledResult, 'method.compiledResult')
  if (
    projection.authority_snapshot_attestation !== 'not_verified_by_compiler'
    || projection.project_state_persisted !== false
    || projection.providerCalls !== 0
    || projection.workerStarted !== false
    || projection.selection_executed !== false
    || projection.human_approval_inferred !== false
    || projection.human_signoff_inferred !== false
  ) throw new Error('Hero Frame 方法越过零执行边界')
  const workOrder = recordOf(projection.work_order_projection, 'method.work_order_projection')
  if (
    workOrder.operation !== 'compileHeroFrameStoryboardCanvas'
    || canonicalJson(workOrder.allowed_mutations) !== canonicalJson(['replaceStoryboardCanvas'])
    || workOrder.providerCalls !== 0
    || workOrder.workerStarted !== false
  ) throw new Error('Hero Frame 方法工作单边界不匹配')
  const attestation = recordOf(root.methodAttestation, 'method.methodAttestation')
  if (
    attestation.schema !== 'qingmu.imago-hero-frame-storyboard-method-attestation.v1'
    || attestation.algorithm !== 'hmac-sha256'
    || attestation.projectionSha256 !== projectionSha256
    || attestation.inputSnapshotSha256 !== projection.input_snapshot_sha256
    || attestation.relationSnapshotSha256 !== relationSnapshotSha256
    || attestation.selectedShotSha256 !== selectedShotSnapshotSha256
    || attestation.heroFrameBindingSha256 !== heroFrameBindingSha256
    || attestation.rawAnnotationsSha256 !== methodRawAnnotationsSha256
    || attestation.compiledResultSha256 !== compiledResultSha256
  ) throw new Error('Hero Frame 方法 HMAC 证明与投影血缘不一致')
  sha256Of(attestation.targetSha256, 'method.attestation.targetSha256')
  sha256Of(attestation.signature, 'method.attestation.signature')
  const method = recordOf(projection.method_definition, 'method.method_definition')
  const review = recordOf(projection.review_card, 'method.review_card')
  const hints = arrayOf(projection.field_hints, 'method.field_hints').map((value, index) => {
    const hint = recordOf(value, `method.field_hints[${String(index)}]`)
    return {
      id: stringOf(hint.hint_id, `method.field_hints[${String(index)}].hint_id`),
      title: stringOf(hint.title, `method.field_hints[${String(index)}].title`),
      guidance: stringOf(hint.guidance, `method.field_hints[${String(index)}].guidance`),
    }
  })
  const checks = arrayOf(projection.checklist, 'method.checklist').map((value, index) => {
    const check = recordOf(value, `method.checklist[${String(index)}]`)
    if (check.required !== true) throw new Error('Hero Frame 方法清单包含非必需项')
    return {
      id: stringOf(check.check_id, `method.checklist[${String(index)}].check_id`),
      label: stringOf(check.label, `method.checklist[${String(index)}].label`),
    }
  })
  if (hints.length === 0 || checks.length === 0) throw new Error('Hero Frame 方法缺少帮助或检查清单')
  return {
    response,
    methodSha256: sha256Of(method.sha256, 'method.method_definition.sha256'),
    projectionSha256,
    plainAnnotationsSha256,
    methodRawAnnotationsSha256,
    compiledResultSha256,
    reviewTitle: stringOf(review.title, 'method.review_card.title'),
    decisionBoundary: stringOf(review.decision_boundary, 'method.review_card.decision_boundary'),
    hints,
    checks,
  }
}

function storyboardCanvasSubject(
  context: CanvasContext,
  changeSetId: string,
): YimengPreviewStoryboardCanvasRequest {
  return {
    projectId: context.projectId,
    episodeId: context.episodeId,
    storyboardRevisionId: context.storyboardRevisionId,
    frameId: context.frameId,
    targetType: 'storyboard_frame',
    targetId: context.frameId,
    changeSetId,
    baseRevision: context.storyboardRevisionVersion,
    baseSnapshotSha256: context.baseSnapshotSha256,
  }
}

function storyboardCanvasCommitRequest(
  marker: StoryboardCanvasCommitRecoveryMarker,
): YimengCommitStoryboardCanvasRequest {
  return {
    projectId: marker.projectId,
    episodeId: marker.episodeId,
    storyboardRevisionId: marker.storyboardRevisionId,
    frameId: marker.frameId,
    targetType: 'storyboard_frame',
    targetId: marker.targetId,
    changeSetId: marker.changeSetId,
    baseRevision: marker.baseRevision,
    baseSnapshotSha256: marker.baseSnapshotSha256,
    idempotencyKey: marker.idempotencyKey,
    expectedPayloadSha256: marker.expectedPayloadSha256,
  }
}

function expectedCanvas(context: CanvasContext, method: VerifiedMethod): Record<string, unknown> {
  const projection = method.response.projection.canvas_projection
  return {
    schema: 'jason.qingmu-storyboard-canvas.v1',
    heroFrameBindingSha256: context.heroFrame.bindingSha256,
    annotations: projection.rawAnnotations,
    rawAnnotationsSha256: method.plainAnnotationsSha256,
    compiled: projection.compiledResult,
    compiledSha256: method.compiledResultSha256,
  }
}

function verifyProposalResponse(
  response: YimengProposeStoryboardCanvasResponse,
  context: CanvasContext,
): CanvasProposal {
  if (response.schema !== 'jason.qingmu-storyboard-canvas-change-set-proposal.v1' || response.nextAction !== 'preview') {
    throw new Error('故事板画布提案合同不匹配')
  }
  const changeSet = response.changeSet
  if (
    changeSet.schema !== 'jason.qingmu-change-set.v1'
    || changeSet.projectId !== context.projectId
    || changeSet.episodeId !== context.episodeId
    || changeSet.targetType !== 'storyboard_frame'
    || changeSet.targetId !== context.frameId
    || changeSet.baseRevision !== context.storyboardRevisionVersion
    || changeSet.baseSnapshotSha256 !== context.baseSnapshotSha256
    || changeSet.originKind !== 'human'
    || changeSet.status !== 'draft'
    || changeSet.authoritativeRevision !== null
    || changeSet.authoritativeSnapshotSha256 !== null
  ) throw new Error('故事板画布提案血缘不匹配')
  return {
    changeSetId: stringOf(changeSet.id, 'proposal.changeSet.id'),
    targetId: context.frameId,
    baseRevision: context.storyboardRevisionVersion,
    baseSnapshotSha256: context.baseSnapshotSha256,
    payloadSha256: sha256Of(changeSet.payloadSha256, 'proposal.changeSet.payloadSha256'),
    raw: response,
  }
}

function verifyPreviewResponse(
  response: YimengPreviewStoryboardCanvasResponse,
  context: CanvasContext,
  proposal: CanvasProposal,
  method: VerifiedMethod,
): CanvasPreview {
  const methodHeroFrameBindingSha256 = method.response.projection.canvas_projection.heroFrame.bindingSha256
  const expectedHeroFrame = {
    assetId: context.heroFrame.assetId,
    mediaSha256: context.heroFrame.mediaSha256,
    bindingSha256: context.heroFrame.bindingSha256,
  }
  if (
    response.schema !== 'jason.qingmu-storyboard-canvas-preview.v1'
    || response.changeSetId !== proposal.changeSetId
    || response.projectId !== context.projectId
    || response.episodeId !== context.episodeId
    || response.targetType !== 'storyboard_frame'
    || response.targetId !== context.frameId
    || response.operation !== 'replaceStoryboardCanvas'
    || response.storyboardRevision.revisionId !== context.storyboardRevisionId
    || response.storyboardRevision.revisionVersion !== context.storyboardRevisionVersion
    || response.storyboardRevision.sourceSha256 !== context.storyboardSourceSha256
    || response.baseRevision !== context.storyboardRevisionVersion
    || response.baseSnapshotSha256 !== context.baseSnapshotSha256
    || response.payloadSha256 !== proposal.payloadSha256
    || response.methodHeroFrameBindingSha256 !== methodHeroFrameBindingSha256
  ) throw new Error('故事板画布技术预览血缘不匹配')
  assertSame(response.heroFrame, expectedHeroFrame, '故事板画布技术预览 Hero Frame')
  assertSame(response.before, context.savedCanvas, '故事板画布技术预览旧画布')
  assertSame(response.after, expectedCanvas(context, method), '故事板画布技术预览新画布')
  assertSame(response.changedPaths, STORYBOARD_CANVAS_CHANGED_PATHS, '故事板画布技术预览变更路径')
  if (
    response.providerCalls !== 0
    || response.workerStarted !== false
    || response.selectionExecuted !== false
    || response.humanApprovalInferred !== false
    || response.humanSignoff !== false
  ) throw new Error('故事板画布技术预览越过零执行边界')
  return {
    changeSetId: proposal.changeSetId,
    payloadSha256: proposal.payloadSha256,
    canCommit: true,
    changed: true,
    changedPaths: response.changedPaths,
    providerCalls: 0,
    workerStarted: false,
    raw: response,
  }
}

function verifyCommitReceipt(
  response: YimengCommitStoryboardCanvasResponse,
  marker: StoryboardCanvasCommitRecoveryMarker,
): CanvasCommitReceipt {
  if (
    response.schema !== 'jason.qingmu-storyboard-canvas-commit-result.v1'
    || response.changeSetId !== marker.changeSetId
    || response.projectId !== marker.projectId
    || response.episodeId !== marker.episodeId
    || response.targetType !== 'storyboard_frame'
    || response.targetId !== marker.frameId
    || response.operation !== 'replaceStoryboardCanvas'
    || response.eventType !== 'StoryboardCanvasReplaced'
    || response.storyboardRevision.base.revisionId !== marker.storyboardRevisionId
    || response.storyboardRevision.base.revisionVersion !== marker.baseRevision
    || response.baseRevision !== marker.baseRevision
    || response.storyboardRevision.authoritative.revisionVersion !== response.authoritativeRevision
    || response.payloadSha256 !== marker.expectedPayloadSha256
    || response.idempotencyKey !== marker.idempotencyKey
    || response.changed !== true
  ) throw new Error('故事板画布提交回执血缘不匹配')
  if (
    response.providerCalls !== 0
    || response.workerStarted !== false
    || response.selectionExecuted !== false
    || response.humanApprovalInferred !== false
    || response.humanSignoff !== false
  ) throw new Error('故事板画布提交回执越过零执行边界')
  if (Number.isNaN(Date.parse(stringOf(response.committedAt, 'commit.committedAt')))) {
    throw new Error('故事板画布提交时间无效')
  }
  return {
    changeSetId: marker.changeSetId,
    commandReceiptId: stringOf(response.commandReceiptId, 'commit.commandReceiptId'),
    eventId: stringOf(response.eventId, 'commit.eventId'),
    projectId: marker.projectId,
    episodeId: marker.episodeId,
    baseStoryboardRevisionId: marker.storyboardRevisionId,
    authoritativeStoryboardRevisionId: stringOf(
      response.storyboardRevision.authoritative.revisionId,
      'commit.storyboardRevision.authoritative.revisionId',
    ),
    authoritativeStoryboardSourceSha256: sha256Of(
      response.storyboardRevision.authoritative.sourceSha256,
      'commit.storyboardRevision.authoritative.sourceSha256',
    ),
    frameId: marker.frameId,
    authoritativeRevision: integerOf(response.authoritativeRevision, 'commit.authoritativeRevision', 1),
    authoritativeSnapshotSha256: sha256Of(response.authoritativeSnapshotSha256, 'commit.authoritativeSnapshotSha256'),
    rawAnnotationsSha256: sha256Of(response.rawAnnotationsSha256, 'commit.rawAnnotationsSha256'),
    compiledSha256: sha256Of(response.compiledSha256, 'commit.compiledSha256'),
    heroFrameAssetId: stringOf(response.heroFrame.assetId, 'commit.heroFrame.assetId'),
    heroFrameMediaSha256: sha256Of(response.heroFrame.mediaSha256, 'commit.heroFrame.mediaSha256'),
    heroFrameBindingSha256: sha256Of(response.heroFrame.bindingSha256, 'commit.heroFrame.bindingSha256'),
    methodHeroFrameBindingSha256: sha256Of(
      response.methodHeroFrameBindingSha256,
      'commit.methodHeroFrameBindingSha256',
    ),
    methodRawAnnotationsSha256: sha256Of(
      response.methodRawAnnotationsSha256,
      'commit.methodRawAnnotationsSha256',
    ),
    payloadSha256: marker.expectedPayloadSha256,
    idempotencyKey: marker.idempotencyKey,
    raw: response,
  }
}

function verifyCommittedMethod(
  receipt: CanvasCommitReceipt,
  context: CanvasContext,
  method: VerifiedMethod,
): void {
  const methodCanvas = method.response.projection.canvas_projection
  if (
    receipt.baseStoryboardRevisionId !== context.storyboardRevisionId
    || receipt.raw.storyboardRevision.base.sourceSha256 !== context.storyboardSourceSha256
    || receipt.heroFrameAssetId !== context.heroFrame.assetId
    || receipt.heroFrameMediaSha256 !== context.heroFrame.mediaSha256
    || receipt.heroFrameBindingSha256 !== context.heroFrame.bindingSha256
    || receipt.methodHeroFrameBindingSha256 !== methodCanvas.heroFrame.bindingSha256
    || receipt.rawAnnotationsSha256 !== method.plainAnnotationsSha256
    || receipt.methodRawAnnotationsSha256 !== method.methodRawAnnotationsSha256
    || receipt.compiledSha256 !== method.compiledResultSha256
  ) throw new Error('故事板画布提交回执与本次 IMAGO 方法不一致')
}

async function verifyRecoveryResponse(
  response: YimengRecoverStoryboardCanvasCommitResponse,
  marker: StoryboardCanvasCommitRecoveryMarker,
  committed?: CanvasCommitReceipt,
): Promise<CanvasCommitReceipt> {
  if (response.schema !== 'jason.qingmu-command-receipt-recovery.v1' || response.recovered !== true) {
    throw new Error('故事板画布恢复回执合同不匹配')
  }
  const receiptSha256 = sha256Of(response.receiptSha256, 'recovery.receiptSha256')
  if (await canonicalSha256(response.receipt) !== receiptSha256) throw new Error('故事板画布恢复回执 SHA-256 不匹配')
  const recovered = verifyCommitReceipt(response.receipt, marker)
  if (committed !== undefined) assertSame(recovered.raw, committed.raw, '故事板画布提交与恢复回执')
  return recovered
}

function verifyAuthoritativeRefresh(
  projection: YimengWorkflowProjection,
  receipt: CanvasCommitReceipt,
): void {
  if (projection.projectId !== receipt.projectId || projection.episodeId !== receipt.episodeId) {
    throw new Error('刷新后的工作流不属于已提交项目/剧集')
  }
  const relations = projection.director.shotRelations
  const heroProjection = projection.director.heroFrameStoryboards
  if (
    relations.storyboardRevision.revisionId !== receipt.authoritativeStoryboardRevisionId
    || relations.storyboardRevision.revisionVersion !== receipt.authoritativeRevision
    || relations.storyboardRevision.sourceSha256 !== receipt.authoritativeStoryboardSourceSha256
    || heroProjection.storyboardRevision.revisionId !== receipt.authoritativeStoryboardRevisionId
    || heroProjection.storyboardRevision.revisionVersion !== receipt.authoritativeRevision
    || heroProjection.storyboardRevision.sourceSha256 !== receipt.authoritativeStoryboardSourceSha256
    || heroProjection.shotsSha256 !== receipt.authoritativeSnapshotSha256
    || heroProjection.valid !== true
    || heroProjection.blockers.length !== 0
  ) throw new Error('刷新后的故事板权威修订与提交回执不一致')
  const relationShots = relations.shots.filter(shot => shot.shotId === receipt.frameId)
  const heroShots = heroProjection.shots.filter(shot => shot.shotId === receipt.frameId)
  if (relationShots.length !== 1 || heroShots.length !== 1) throw new Error('刷新后未找到唯一权威 Shot')
  const heroShot = heroShots[0]
  if (heroShot === undefined || heroShot.heroFrame === null || heroShot.canvas === null || heroShot.blockers.length !== 0) {
    throw new Error('刷新后的 Hero Frame/画布不完整')
  }
  if (
    heroShot.heroFrame.assetId !== receipt.heroFrameAssetId
    || heroShot.heroFrame.mediaSha256 !== receipt.heroFrameMediaSha256
    || heroShot.heroFrame.bindingSha256 !== receipt.heroFrameBindingSha256
    || heroShot.canvas.heroFrameBindingSha256 !== receipt.heroFrameBindingSha256
    || heroShot.canvas.rawAnnotationsSha256 !== receipt.rawAnnotationsSha256
    || heroShot.canvas.compiledSha256 !== receipt.compiledSha256
  ) throw new Error('刷新后的 Hero Frame/画布内容与提交回执不一致')
}

function uniqueAnnotationId(kind: AnnotationKind, counter: number, annotations: readonly ImagoHeroFrameStoryboardAnnotation[]): string {
  const base = `qm-${kind}-${Date.now().toString(36)}-${counter.toString(36)}`
  if (!annotations.some(annotation => annotation.annotationId === base)) return base
  let suffix = 1
  while (annotations.some(annotation => annotation.annotationId === `${base}-${String(suffix)}`)) suffix += 1
  return `${base}-${String(suffix)}`
}

function AnnotationOverlay({ annotation }: { readonly annotation: ImagoHeroFrameStoryboardAnnotation }) {
  const first = annotation.points[0]
  const second = annotation.points[1]
  if (first === undefined) return null
  if (annotation.kind === 'subject_region' && second !== undefined) {
    const x = Math.min(first.x, second.x)
    const y = Math.min(first.y, second.y)
    return <rect
      className={css.canvasSubjectRegion}
      x={x}
      y={y}
      width={Math.abs(second.x - first.x)}
      height={Math.abs(second.y - first.y)}
    />
  }
  if (annotation.kind === 'object_anchor') {
    return <g className={css.canvasObjectAnchor}><circle cx={first.x} cy={first.y} r="180" /><path d={`M ${first.x - 300} ${first.y} H ${first.x + 300} M ${first.x} ${first.y - 300} V ${first.y + 300}`} /></g>
  }
  if (second === undefined) return null
  return <line className={css.canvasMotionVector} x1={first.x} y1={first.y} x2={second.x} y2={second.y} markerEnd="url(#qingmu-canvas-arrow)" />
}

/** E5-2 human-operated Hero Frame and Storyboard Canvas workbench for one canonical Shot. */
export function HeroFrameStoryboardCanvas({
  relations,
  heroFrameStoryboards,
  selectedShotId,
  port,
  t,
  onCommitted,
}: HeroFrameStoryboardCanvasProps) {
  const contextResult = useMemo(
    () => resolveCanvasContext(relations, heroFrameStoryboards, selectedShotId),
    [heroFrameStoryboards, relations, selectedShotId],
  )
  const context = contextResult.status === 'ready' ? contextResult.value : undefined
  const [annotations, setAnnotations] = useState<readonly ImagoHeroFrameStoryboardAnnotation[]>([])
  const [kind, setKind] = useState<AnnotationKind>('subject_region')
  const [elementId, setElementId] = useState('')
  const [points, setPoints] = useState<readonly ImagoHeroFrameStoryboardPoint[]>([
    { x: 2500, y: 2500 },
    { x: 7500, y: 7500 },
  ])
  const [activePointIndex, setActivePointIndex] = useState(0)
  const [cursor, setCursor] = useState<ImagoHeroFrameStoryboardPoint>({ x: 5000, y: 5000 })
  const [method, setMethod] = useState<VerifiedMethod>()
  const [proposal, setProposal] = useState<CanvasProposal>()
  const [preview, setPreview] = useState<CanvasPreview>()
  const [confirmed, setConfirmed] = useState(false)
  const [receipt, setReceipt] = useState<CanvasCommitReceipt>()
  const [recovery, setRecovery] = useState<StoryboardCanvasRecoveryMarkerRead>({ status: 'none' })
  const [busy, setBusy] = useState<BusyPhase>(null)
  const [error, setError] = useState<string>()
  const abortRef = useRef<AbortController>()
  const annotationCounterRef = useRef(0)
  const lineageRef = useRef<string>()
  lineageRef.current = context?.lineageKey

  const invalidatePrepared = (): void => {
    abortRef.current?.abort()
    setBusy(null)
    setMethod(undefined)
    setProposal(undefined)
    setPreview(undefined)
    setConfirmed(false)
    setReceipt(undefined)
    setError(undefined)
  }

  useEffect(() => {
    abortRef.current?.abort()
    setBusy(null)
    setMethod(undefined)
    setProposal(undefined)
    setPreview(undefined)
    setConfirmed(false)
    setReceipt(undefined)
    setError(undefined)
    setCursor({ x: 5000, y: 5000 })
    setActivePointIndex(0)
    if (context === undefined) {
      setAnnotations([])
      setElementId('')
      setRecovery({ status: 'none' })
      return
    }
    setAnnotations(context.annotations)
    const firstKind: AnnotationKind = context.elements.some(element => element.elementKind === 'actor')
      ? 'subject_region'
      : context.elements.some(element => element.elementKind === 'prop') ? 'object_anchor' : 'motion_vector'
    setKind(firstKind)
    setElementId(context.elements.find(element => compatible(firstKind, element.elementKind))?.elementId ?? '')
    setPoints(firstKind === 'object_anchor' ? [{ x: 5000, y: 5000 }] : [{ x: 2500, y: 2500 }, { x: 7500, y: 7500 }])
    setRecovery(readStoryboardCanvasRecoveryMarker({
      projectId: context.projectId,
      episodeId: context.episodeId,
      storyboardRevisionId: context.storyboardRevisionId,
      frameId: context.frameId,
    }))
    return () => { abortRef.current?.abort() }
  }, [context?.lineageKey])

  const updateKind = (nextKind: AnnotationKind): void => {
    if (context === undefined || recovery.status !== 'none') return
    invalidatePrepared()
    setKind(nextKind)
    setElementId(context.elements.find(element => compatible(nextKind, element.elementKind))?.elementId ?? '')
    setPoints(nextKind === 'object_anchor' ? [{ x: 5000, y: 5000 }] : [{ x: 2500, y: 2500 }, { x: 7500, y: 7500 }])
    setActivePointIndex(0)
  }

  const updatePoint = (index: number, axis: 'x' | 'y', value: number): void => {
    if (recovery.status !== 'none') return
    if (!Number.isFinite(value)) return
    invalidatePrepared()
    setPoints(current => current.map((point, pointIndex) => (
      pointIndex === index ? { ...point, [axis]: clampCoordinate(value) } : point
    )))
  }

  const placeActivePoint = (point: ImagoHeroFrameStoryboardPoint): void => {
    if (recovery.status !== 'none') return
    invalidatePrepared()
    setCursor(point)
    setPoints(current => current.map((value, index) => index === activePointIndex ? point : value))
    setActivePointIndex(current => (current + 1) % expectedPointCount(kind))
  }

  const onCanvasPointer = (event: PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0 || recovery.status !== 'none') return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    placeActivePoint({
      x: clampCoordinate((event.clientX - bounds.left) / bounds.width * COORDINATE_MAX),
      y: clampCoordinate((event.clientY - bounds.top) / bounds.height * COORDINATE_MAX),
    })
  }

  const moveCursor = (deltaX: number, deltaY: number): void => {
    setCursor(current => ({ x: clampCoordinate(current.x + deltaX), y: clampCoordinate(current.y + deltaY) }))
  }

  const onCanvasKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    const step = event.shiftKey ? POINTER_STEP * 5 : POINTER_STEP
    if (event.key === 'ArrowLeft') moveCursor(-step, 0)
    else if (event.key === 'ArrowRight') moveCursor(step, 0)
    else if (event.key === 'ArrowUp') moveCursor(0, -step)
    else if (event.key === 'ArrowDown') moveCursor(0, step)
    else if (event.key === 'Enter' || event.key === ' ') placeActivePoint(cursor)
    else return
    event.preventDefault()
  }

  const addAnnotation = (): void => {
    if (context === undefined || annotations.length >= MAX_ANNOTATIONS || recovery.status !== 'none') return
    const element = context.elements.find(candidate => candidate.elementId === elementId && compatible(kind, candidate.elementKind))
    if (element === undefined) {
      setError(t('canvasElementRequired'))
      return
    }
    try {
      annotationCounterRef.current += 1
      const candidate: ImagoHeroFrameStoryboardAnnotation = {
        annotationId: uniqueAnnotationId(kind, annotationCounterRef.current, annotations),
        kind,
        elementRef: { elementKind: element.elementKind, elementId: element.elementId },
        points,
      }
      const next = normalizeAnnotations([...annotations, candidate], context.elements, 'canvas.annotations')
      invalidatePrepared()
      setAnnotations(next)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const removeAnnotation = (annotationId: string): void => {
    if (recovery.status !== 'none') return
    invalidatePrepared()
    setAnnotations(current => current.filter(annotation => annotation.annotationId !== annotationId))
  }

  const runMethod = async (): Promise<void> => {
    if (context === undefined || busy !== null || recovery.status !== 'none') return
    const lineageKey = context.lineageKey
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy('method')
    setError(undefined)
    setMethod(undefined)
    setProposal(undefined)
    setPreview(undefined)
    setConfirmed(false)
    try {
      const relationRequest = buildHeroFrameRelationRequest(relations, context.frameId)
      const baseCanvasSha256 = context.savedCanvas === null ? null : await canonicalSha256(context.savedCanvas)
      if (controller.signal.aborted || lineageRef.current !== lineageKey) return
      const request: ImagoHeroFrameStoryboardMethodRequest = {
        ...relationRequest,
        heroFrame: { assetId: context.heroFrame.assetId, mediaSha256: context.heroFrame.mediaSha256 },
        canvas: { baseCanvasSha256, annotations },
      }
      const plainAnnotationsSha256 = await canonicalSha256(request.canvas.annotations)
      if (controller.signal.aborted || lineageRef.current !== lineageKey) return
      const response = await port.heroFrameStoryboardMethod(request, controller.signal)
      if (controller.signal.aborted || lineageRef.current !== lineageKey) return
      setMethod(verifyMethodResponse(response, request, plainAnnotationsSha256))
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }

  const preparePreview = async (): Promise<void> => {
    if (context === undefined || method === undefined || busy !== null || recovery.status !== 'none') return
    const lineageKey = context.lineageKey
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy('proposal')
    setError(undefined)
    setProposal(undefined)
    setPreview(undefined)
    setConfirmed(false)
    try {
      const methodProjection = method.response.projection
      const proposalResponse = await port.proposeStoryboardCanvas({
        projectId: context.projectId,
        episodeId: context.episodeId,
        storyboardRevisionId: context.storyboardRevisionId,
        frameId: context.frameId,
        operation: 'replaceStoryboardCanvas',
        baseRevision: context.storyboardRevisionVersion,
        baseSnapshotSha256: context.baseSnapshotSha256,
        heroFrameAssetId: context.heroFrame.assetId,
        heroFrameMediaSha256: context.heroFrame.mediaSha256,
        heroFrameBindingSha256: context.heroFrame.bindingSha256,
        methodProjection,
        methodProjectionSha256: method.projectionSha256,
        methodAttestation: method.response.methodAttestation,
      }, controller.signal)
      if (controller.signal.aborted || lineageRef.current !== lineageKey) return
      const verifiedProposal = verifyProposalResponse(proposalResponse, context)
      setBusy('preview')
      const previewResponse = await port.previewStoryboardCanvas(
        storyboardCanvasSubject(context, verifiedProposal.changeSetId),
        controller.signal,
      )
      if (controller.signal.aborted || lineageRef.current !== lineageKey) return
      const verifiedPreview = verifyPreviewResponse(previewResponse, context, verifiedProposal, method)
      setProposal(verifiedProposal)
      setPreview(verifiedPreview)
    } catch (cause) {
      if (!controller.signal.aborted && lineageRef.current === lineageKey) setError(errorMessage(cause))
    } finally {
      if (!controller.signal.aborted && lineageRef.current === lineageKey) setBusy(null)
    }
  }

  const commitCanvas = async (): Promise<void> => {
    if (
      context === undefined
      || method === undefined
      || proposal === undefined
      || preview === undefined
      || !confirmed
      || !preview.canCommit
      || busy !== null
      || recovery.status !== 'none'
    ) return
    const lineageKey = context.lineageKey
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy('commit')
    setError(undefined)
    let marker: StoryboardCanvasCommitRecoveryMarker | undefined
    try {
      const idempotencyKey = await deriveStoryboardCanvasIdempotencyKey(proposal.changeSetId, preview.payloadSha256)
      if (controller.signal.aborted || lineageRef.current !== lineageKey) return
      marker = createStoryboardCanvasRecoveryMarker({
        ...storyboardCanvasSubject(context, proposal.changeSetId),
        idempotencyKey,
        expectedPayloadSha256: preview.payloadSha256,
      })
      if (!writeStoryboardCanvasRecoveryMarker(marker)) throw new Error('无法安全保存故事板画布恢复坐标')
      setRecovery({ status: 'ready', marker })
      const commitResponse = await port.commitStoryboardCanvas(storyboardCanvasCommitRequest(marker), controller.signal)
      if (controller.signal.aborted || lineageRef.current !== lineageKey) return
      const committed = verifyCommitReceipt(commitResponse, marker)
      verifyCommittedMethod(committed, context, method)
      setBusy('recover')
      const recoveryResponse = await port.recoverStoryboardCanvasCommit(
        storyboardCanvasCommitRequest(marker),
        controller.signal,
      )
      if (controller.signal.aborted || lineageRef.current !== lineageKey) return
      const recovered = await verifyRecoveryResponse(recoveryResponse, marker, committed)
      verifyCommittedMethod(recovered, context, method)
      setBusy('refresh')
      const refreshed = await onCommitted()
      if (refreshed === undefined) throw new Error('提交后未返回权威工作流投影')
      verifyAuthoritativeRefresh(refreshed, recovered)
      if (!clearStoryboardCanvasRecoveryMarker(marker)) throw new Error('权威刷新后无法清除故事板画布恢复坐标')
      setRecovery({ status: 'none' })
      setReceipt(recovered)
    } catch (cause) {
      if (marker !== undefined) setRecovery({ status: 'ready', marker })
      if (!controller.signal.aborted || marker !== undefined) setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const recoverCommit = async (marker: StoryboardCanvasCommitRecoveryMarker): Promise<void> => {
    if (context === undefined || busy !== null) return
    const lineageKey = context.lineageKey
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy('recover')
    setError(undefined)
    try {
      const response = await port.recoverStoryboardCanvasCommit(
        storyboardCanvasCommitRequest(marker),
        controller.signal,
      )
      if (controller.signal.aborted || lineageRef.current !== lineageKey) return
      const recovered = await verifyRecoveryResponse(response, marker)
      setBusy('refresh')
      const refreshed = await onCommitted()
      if (refreshed === undefined) throw new Error('恢复后未返回权威工作流投影')
      verifyAuthoritativeRefresh(refreshed, recovered)
      if (!clearStoryboardCanvasRecoveryMarker(marker)) throw new Error('权威刷新后无法清除故事板画布恢复坐标')
      setRecovery({ status: 'none' })
      setReceipt(recovered)
    } catch (cause) {
      setRecovery({ status: 'ready', marker })
      if (!controller.signal.aborted) setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  if (contextResult.status === 'empty') {
    return (
      <section className={css.storyboardCanvas} aria-label={t('canvasTitle')}>
        <div className={css.canvasHead}><div><h4>{t('canvasTitle')}</h4><p>{t('canvasBoundary')}</p></div></div>
        <div className={css.canvasEmpty} role="status">
          <strong>{contextResult.reason === 'hero' ? t('canvasHeroMissing') : t('shotRelationChoose')}</strong>
          <p>{t('canvasHeroMissingBoundary')}</p>
        </div>
      </section>
    )
  }
  if (contextResult.status === 'error' || context === undefined) {
    return (
      <section className={css.storyboardCanvas} aria-label={t('canvasTitle')}>
        <div className={css.canvasHead}><div><h4>{t('canvasTitle')}</h4><p>{t('canvasBoundary')}</p></div></div>
        <p className={css.warning} role="alert">{t('canvasLineageError')}: {contextResult.status === 'error' ? contextResult.message : t('unknown')}</p>
      </section>
    )
  }

  const compatibleElements = context.elements.filter(element => compatible(kind, element.elementKind))
  const activePoint = points[activePointIndex] ?? points[0] ?? cursor
  const locked = recovery.status !== 'none' || busy !== null

  return (
    <section className={css.storyboardCanvas} aria-label={t('canvasTitle')}>
      <div className={css.canvasHead}>
        <div><h4>{t('canvasTitle')}</h4><p>{t('canvasBoundary')}</p></div>
        <span>{t('canvasShotId')}: {context.frameId}</span>
      </div>

      {recovery.status === 'invalid' && (
        <div className={css.recoveryDock} role="alert"><div><h4>{t('canvasRecoveryInvalid')}</h4><p>{recovery.error}</p></div></div>
      )}
      {recovery.status === 'ready' && (
        <div className={css.recoveryDock}>
          <div><h4>{t('canvasRecoveryTitle')}</h4><p>{t('canvasRecoveryBody')}</p></div>
          <button type="button" disabled={busy !== null} onClick={() => { void recoverCommit(recovery.marker) }}>
            {busy === 'recover' ? t('canvasRecovering') : busy === 'refresh' ? t('canvasRefreshing') : t('canvasRecover')}
          </button>
        </div>
      )}

      <div className={css.canvasWorkspace}>
        <div className={css.canvasStage}>
          <svg
            className={css.canvasSvg}
            viewBox="0 0 10000 10000"
            preserveAspectRatio="none"
            role="img"
            aria-label={t('canvasImageLabel')}
            tabIndex={locked ? -1 : 0}
            onPointerDown={onCanvasPointer}
            onKeyDown={onCanvasKeyDown}
          >
            <defs><marker id="qingmu-canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
            <image href={context.heroFrame.browserUrl} x="0" y="0" width="10000" height="10000" preserveAspectRatio="none" />
            <rect className={css.canvasVeil} x="0" y="0" width="10000" height="10000" />
            {annotations.map(annotation => <AnnotationOverlay key={annotation.annotationId} annotation={annotation} />)}
            <g className={css.canvasCursor} transform={`translate(${String(cursor.x)} ${String(cursor.y)})`}><circle r="115" /><path d="M -230 0 H 230 M 0 -230 V 230" /></g>
          </svg>
          <p className={css.canvasInstruction}>{t('canvasPointerHint')}</p>
        </div>

        <div className={css.canvasControls}>
          <fieldset disabled={locked}>
            <legend>{t('canvasTool')}</legend>
            <div className={css.canvasToolSwitch}>
              {(['subject_region', 'object_anchor', 'motion_vector'] as const).map(tool => (
                <button key={tool} type="button" aria-pressed={kind === tool} onClick={() => { updateKind(tool) }}>{t(`canvasTool_${tool}`)}</button>
              ))}
            </div>
            <label>{t('canvasElement')}<select value={elementId} onChange={(event) => { invalidatePrepared(); setElementId(event.target.value) }}>
              <option value="">{t('canvasChooseElement')}</option>
              {compatibleElements.map(element => (
                <option key={element.elementId} value={element.elementId}>
                  {element.name} · {element.elementId}
                </option>
              ))}
            </select></label>
            <div className={css.canvasPointGrid}>
              {points.map((point, index) => (
                <div className={css.canvasPointRow} key={index}>
                  <button type="button" aria-pressed={activePointIndex === index} onClick={() => { setActivePointIndex(index) }}>{t('canvasPoint')} {String(index + 1)}</button>
                  <label>X<input aria-label={`${t('canvasPoint')} ${String(index + 1)} X`} type="number" min="0" max="10000" step="1" value={point.x} onChange={(event) => { updatePoint(index, 'x', event.currentTarget.valueAsNumber) }} /></label>
                  <label>Y<input aria-label={`${t('canvasPoint')} ${String(index + 1)} Y`} type="number" min="0" max="10000" step="1" value={point.y} onChange={(event) => { updatePoint(index, 'y', event.currentTarget.valueAsNumber) }} /></label>
                </div>
              ))}
            </div>
            <div className={css.canvasNudge} aria-label={t('canvasKeyboardAlternative')}>
              <button type="button" aria-label={t('canvasMoveLeft')} onClick={() => { moveCursor(-POINTER_STEP, 0) }}>←</button>
              <button type="button" aria-label={t('canvasMoveUp')} onClick={() => { moveCursor(0, -POINTER_STEP) }}>↑</button>
              <button type="button" aria-label={t('canvasMoveDown')} onClick={() => { moveCursor(0, POINTER_STEP) }}>↓</button>
              <button type="button" aria-label={t('canvasMoveRight')} onClick={() => { moveCursor(POINTER_STEP, 0) }}>→</button>
              <button type="button" onClick={() => { placeActivePoint(cursor) }}>{t('canvasUseCursor')} {String(activePointIndex + 1)}</button>
            </div>
            <p>{t('canvasCursorPosition')}: {String(cursor.x)}, {String(cursor.y)} · {t('canvasActivePoint')}: {String(activePointIndex + 1)} ({String(activePoint.x)}, {String(activePoint.y)})</p>
            <button className={css.canvasAdd} type="button" disabled={annotations.length >= MAX_ANNOTATIONS || elementId === ''} onClick={addAnnotation}>{t('canvasAddAnnotation')}</button>
          </fieldset>
        </div>
      </div>

      <div className={css.canvasAnnotationList}>
        <div><h5>{t('canvasAnnotations')}</h5><span>{String(annotations.length)} / {String(MAX_ANNOTATIONS)}</span></div>
        {annotations.length === 0 ? <p className={css.empty}>{t('canvasNoAnnotations')}</p> : (
          <ul>{annotations.map(annotation => (
            <li key={annotation.annotationId}>
              <div><strong>{t(`canvasTool_${annotation.kind}`)}</strong><span>{annotation.elementRef.elementId}</span><small>{annotation.points.map(point => `(${String(point.x)}, ${String(point.y)})`).join(' → ')}</small></div>
              <button type="button" disabled={locked} onClick={() => { removeAnnotation(annotation.annotationId) }}>{t('canvasRemoveAnnotation')}</button>
            </li>
          ))}</ul>
        )}
      </div>

      <div className={css.canvasActions}>
        <button className={css.primaryAction} type="button" disabled={locked} onClick={() => { void runMethod() }}>
          {busy === 'method' ? t('canvasCheckingMethod') : t('canvasCheckMethod')}
        </button>
        <span>{t('canvasMethodBoundary')}</span>
      </div>

      {error !== undefined && <p className={css.warning} role="alert">{t('canvasOperationError')}: {error}</p>}

      {method !== undefined && (
        <div className={css.canvasMethodPanel}>
          <div><h5>{method.reviewTitle}</h5><span>{t('canvasStructuralCheck')}</span></div>
          <p>{method.decisionBoundary}</p>
          <dl>
            <div><dt>{t('shotRelationMethodHash')}</dt><dd>{method.methodSha256}</dd></div>
            <div><dt>{t('canvasPlainRawHash')}</dt><dd>{method.plainAnnotationsSha256}</dd></div>
            <div><dt>{t('canvasMethodRawHash')}</dt><dd>{method.methodRawAnnotationsSha256}</dd></div>
            <div><dt>{t('canvasCompiledHash')}</dt><dd>{method.compiledResultSha256}</dd></div>
          </dl>
          <div className={css.relationMethodColumns}>
            <article><h5>{t('shotRelationMethodFieldHelp')}</h5><ul>{method.hints.map(hint => <li key={hint.id}><strong>{hint.title}</strong><span>{hint.guidance}</span></li>)}</ul></article>
            <article><h5>{t('shotRelationMethodChecklist')}</h5><ul>{method.checks.map(check => <li key={check.id}><span>✓</span><strong>{check.label}</strong></li>)}</ul></article>
          </div>
          <div className={css.canvasActions}>
            <button className={css.primaryAction} type="button" disabled={busy !== null || recovery.status !== 'none'} onClick={() => { void preparePreview() }}>
              {busy === 'proposal'
                ? t('canvasPreparingProposal')
                : busy === 'preview' ? t('canvasPreparingPreview') : t('canvasPreparePreview')}
            </button>
            <span>{t('canvasPreviewPreparationBoundary')}</span>
          </div>
        </div>
      )}

      {proposal !== undefined && preview !== undefined && (
        <div className={css.previewDock}>
          <div className={css.previewHead}><div><h4>{t('canvasPreviewTitle')}</h4><p>{t('canvasPreviewBoundary')}</p></div><span>{preview.canCommit ? t('previewCommittable') : t('previewBlocked')}</span></div>
          <dl className={css.previewMeta}><div><dt>{t('changeSet')}</dt><dd>{proposal.changeSetId}</dd></div><div><dt>{t('payloadHash')}</dt><dd>{preview.payloadSha256}</dd></div></dl>
          <p>{preview.changed ? preview.changedPaths.join(', ') : t('noSemanticChange')}</p>
          <div className={css.commitDock}>
            <label><input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked) }} />{t('canvasConfirmCommit')}</label>
            <button className={css.primaryAction} type="button" disabled={!confirmed || !preview.canCommit || busy !== null} onClick={() => { void commitCanvas() }}>
              {busy === 'commit'
                ? t('canvasCommitting')
                : busy === 'recover' ? t('canvasRecovering') : busy === 'refresh' ? t('canvasRefreshing') : t('canvasCommit')}
            </button>
          </div>
        </div>
      )}

      {receipt !== undefined && (
        <div className={css.commitReceipt}><h4>{t('canvasCommitSucceeded')}</h4><dl><div><dt>{t('receiptId')}</dt><dd>{receipt.commandReceiptId}</dd></div><div><dt>{t('eventId')}</dt><dd>{receipt.eventId}</dd></div><div><dt>{t('authoritativeRevision')}</dt><dd>{String(receipt.authoritativeRevision)}</dd></div></dl><p>{t('canvasCommitNotApproval')}</p></div>
      )}
    </section>
  )
}
