/* oxlint-disable typescript/no-unnecessary-condition -- RPC values are revalidated before authority markers clear. */
/* oxlint-disable typescript/no-unnecessary-boolean-literal-compare -- Literal flags are part of the runtime RPC boundary. */
import { useEffect, useRef, useState } from 'react'
import type {
  ImagoPromptIrMethodRequest,
  ImagoPromptIrMethodResponse,
  QingmuYimengPort,
  YimengCommitPromptIrEditResponse,
  YimengPreviewPromptIrResponse,
  YimengPromptIrResponse,
  YimengProposePromptIrResponse,
  YimengRecoverPromptIrEditCommitRequest,
  YimengRecoverPromptIrEditCommitResponse,
  YimengRecoverPromptIrSelectionRequest,
  YimengRecoverPromptIrSelectionResponse,
  YimengSelectPromptIrResponse,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import {
  clearPromptIrEditRecoveryMarker,
  clearPromptIrSelectionRecoveryMarker,
  createPromptIrEditRecoveryMarker,
  createPromptIrSelectionRecoveryMarker,
  derivePromptIrEditIdempotencyKey,
  derivePromptIrSelectionIdempotencyKey,
  readPromptIrEditRecoveryMarker,
  readPromptIrSelectionRecoveryMarker,
  writePromptIrEditRecoveryMarker,
  writePromptIrSelectionRecoveryMarker,
  type PromptIrEditRecoveryMarker,
  type PromptIrEditRecoveryMarkerRead,
  type PromptIrRecoveryCoordinates,
  type PromptIrSelectionRecoveryMarker,
  type PromptIrSelectionRecoveryMarkerRead,
} from './prompt-ir-recovery.ts'
import css from './QingmuCockpit.module.css'

const SHA256 = /^[0-9a-f]{64}$/
const EDITABLE_FIELDS = [
  'imageGenPrompt',
  'lastFrameImagePrompt',
  'videoGenPrompt',
  'motionPrompt',
  'negativePrompt',
] as const

type EditableField = typeof EDITABLE_FIELDS[number]
type EditableProjection = YimengPromptIrResponse['subject']['editableProjection']
type DraftPromptIr = Pick<YimengCommitPromptIrEditResponse['promptIr'], 'id' | 'version' | 'contentSha256' | 'status'>
type Operation = 'idle' | 'loading' | 'checking' | 'previewing' | 'committing' | 'recovering-edit'
  | 'selecting' | 'recovering-selection'

interface PromptIrFrame extends PromptIrRecoveryCoordinates {
  readonly key: string
  readonly shotId: string
  readonly promptIrId: string
  readonly promptIrVersion: number
  readonly promptIrContentSha256: string
  readonly status: 'Draft' | 'Ready'
  readonly label: string
}

/** Props for the bounded PromptIR editor mounted in the existing Script & Assets slot. */
export interface PromptIrWorkspaceProps {
  readonly projectId: string
  readonly episodeId: string
  readonly shotItems: readonly unknown[]
  readonly storyboardRevisionId: string
  readonly selectedShotId: string
  readonly onSelectShotId: (shotId: string) => void
  readonly port: QingmuYimengPort
  readonly t: (key: QingmuCockpitKey) => string
  readonly onCommitted: () => Promise<void>
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && value === value.trim()
    && !/[\u0000\r\n]/.test(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sameProjection(left: EditableProjection, right: EditableProjection): boolean {
  return EDITABLE_FIELDS.every(field => left[field] === right[field])
}

function parseDraft(value: string): EditableProjection {
  const parsed = JSON.parse(value) as unknown
  const record = recordOf(parsed)
  if (record === undefined) throw new Error('PromptIR 编辑内容必须是 JSON 对象')
  const keys = Object.keys(record).sort()
  const expected = [...EDITABLE_FIELDS].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('PromptIR 编辑内容必须且只能包含五个允许字段')
  }
  for (const field of EDITABLE_FIELDS) {
    if (typeof record[field] !== 'string') throw new Error(`PromptIR 字段 ${field} 必须是字符串`)
  }
  return record as unknown as EditableProjection
}

function replacementsOf(base: EditableProjection, candidate: EditableProjection): Partial<EditableProjection> {
  const replacements: Partial<Record<EditableField, string>> = {}
  for (const field of EDITABLE_FIELDS) {
    if (base[field] !== candidate[field]) replacements[field] = candidate[field]
  }
  if (Object.keys(replacements).length === 0) throw new Error('PromptIR 五字段没有发生变化')
  return replacements
}

function framesOf(
  projectId: string,
  episodeId: string,
  shotItems: readonly unknown[],
  expectedStoryboardRevisionId: string,
): readonly PromptIrFrame[] {
  const candidates: PromptIrFrame[] = []
  for (const item of shotItems) {
    const shot = recordOf(item)
    const lineage = recordOf(shot?.promptLineage)
    const frameId = shot?.frameId
    const storyboardRevisionId = lineage?.storyboardRevisionId
    const promptIrId = lineage?.id
    const promptIrVersion = lineage?.version
    const promptIrContentSha256 = lineage?.contentSha256
    const status = lineage?.status
    if (
      !isIdentifier(frameId)
      || !isIdentifier(storyboardRevisionId)
      || storyboardRevisionId !== expectedStoryboardRevisionId
      || !isIdentifier(promptIrId)
      || !Number.isSafeInteger(promptIrVersion)
      || (promptIrVersion as number) < 1
      || typeof promptIrContentSha256 !== 'string'
      || !SHA256.test(promptIrContentSha256)
      || (status !== 'Ready' && status !== 'Draft')
    ) continue
    const key = `${storyboardRevisionId}:${frameId}`
    const name = typeof shot?.name === 'string' && shot.name.trim() !== ''
      ? shot.name
      : typeof shot?.shotId === 'string' && shot.shotId.trim() !== '' ? shot.shotId : frameId
    candidates.push({
      key,
      shotId: frameId,
      projectId,
      episodeId,
      storyboardRevisionId,
      frameId,
      promptIrId,
      promptIrVersion: promptIrVersion as number,
      promptIrContentSha256,
      status,
      label: `${name} · ${frameId}`,
    })
  }
  const counts = new Map<string, number>()
  for (const candidate of candidates) counts.set(candidate.key, (counts.get(candidate.key) ?? 0) + 1)
  return candidates.filter(candidate => counts.get(candidate.key) === 1)
}

function assertReadySnapshot(snapshot: YimengPromptIrResponse, frame: PromptIrFrame): void {
  const subject = snapshot.subject
  const readyLineageMismatch = frame.status === 'Ready' && (
    subject.promptIrId !== frame.promptIrId
    || subject.promptIrVersion !== frame.promptIrVersion
    || subject.promptIrContentSha256 !== frame.promptIrContentSha256
  )
  if (
    snapshot.schema !== 'jason.qingmu-prompt-ir-subject-read.v1'
    || subject.schema !== 'jason.qingmu-prompt-ir-subject.v1'
    || subject.projectId !== frame.projectId
    || subject.episodeId !== frame.episodeId
    || subject.targetType !== 'prompt_ir'
    || subject.targetId !== frame.key
    || subject.storyboardRevisionId !== frame.storyboardRevisionId
    || subject.frameId !== frame.frameId
    || subject.status !== 'Ready'
    || snapshot.baseRevision !== subject.promptIrVersion
    || !SHA256.test(snapshot.baseSnapshotSha256)
    || readyLineageMismatch
  ) {
    throw new Error('易梦当前 Ready PromptIR 与工作流镜头血缘不一致')
  }
}

function assertMethodResponse(
  response: ImagoPromptIrMethodResponse,
  request: ImagoPromptIrMethodRequest,
): void {
  const projection = response.projection
  const target = projection.target
  if (
    response.schema !== 'qingmu.imago-prompt-ir-method-adapter-result.v1'
    || projection.schema !== 'qingmu.imago-prompt-ir-method-projection.v1'
    || response.methodAttestation.projectionSha256 !== response.projectionSha256
    || response.methodAttestation.candidateSha256 !== projection.candidate_sha256
    || target.projectId !== request.projectId
    || target.episodeId !== request.episodeId
    || target.storyboardRevisionId !== request.storyboardRevisionId
    || target.frameId !== request.frameId
    || target.basePromptIrId !== request.basePromptIrId
    || target.baseVersion !== request.baseVersion
    || target.baseSnapshotSha256 !== request.baseSnapshotSha256
    || target.baseContentSha256 !== request.baseContentSha256
    || projection.project_state_persisted !== false
    || projection.providerCalls !== 0
    || projection.workerStarted !== false
    || projection.selection_executed !== false
    || projection.human_approval_inferred !== false
    || projection.human_signoff_inferred !== false
  ) {
    throw new Error('IMAGO PromptIR 方法回执与当前基线或零执行边界不一致')
  }
  for (const field of EDITABLE_FIELDS) {
    if (typeof projection.normalized_candidate[field] !== 'string') {
      throw new Error(`IMAGO PromptIR 方法缺少字段 ${field}`)
    }
  }
}

function assertProposal(
  proposal: YimengProposePromptIrResponse,
  snapshot: YimengPromptIrResponse,
  frame: PromptIrFrame,
): void {
  const changeSet = proposal.changeSet
  if (
    proposal.schema !== 'jason.qingmu-prompt-ir-change-set-proposal.v1'
    || proposal.nextAction !== 'preview'
    || changeSet.projectId !== frame.projectId
    || changeSet.episodeId !== frame.episodeId
    || changeSet.targetType !== 'prompt_ir'
    || changeSet.targetId !== frame.key
    || changeSet.baseRevision !== snapshot.baseRevision
    || changeSet.baseSnapshotSha256 !== snapshot.baseSnapshotSha256
    || !isIdentifier(changeSet.id)
    || !SHA256.test(changeSet.payloadSha256)
  ) {
    throw new Error('易梦 PromptIR 提案与当前 Ready 基线不一致')
  }
}

function assertPreview(
  preview: YimengPreviewPromptIrResponse,
  proposal: YimengProposePromptIrResponse,
  snapshot: YimengPromptIrResponse,
  candidate: EditableProjection,
  frame: PromptIrFrame,
): void {
  const base = preview.basePromptIr
  const draft = preview.candidatePromptIr
  if (
    preview.schema !== 'jason.qingmu-prompt-ir-preview.v1'
    || preview.changeSetId !== proposal.changeSet.id
    || preview.target.projectId !== frame.projectId
    || preview.target.episodeId !== frame.episodeId
    || preview.target.storyboardRevisionId !== frame.storyboardRevisionId
    || preview.target.frameId !== frame.frameId
    || preview.target.targetId !== frame.key
    || base.id !== snapshot.subject.promptIrId
    || base.version !== snapshot.subject.promptIrVersion
    || base.contentSha256 !== snapshot.subject.promptIrContentSha256
    || base.status !== 'Ready'
    || !sameProjection(base.editableProjection, snapshot.subject.editableProjection)
    || draft.status !== 'Draft'
    || !isIdentifier(draft.id)
    || !Number.isSafeInteger(draft.version)
    || draft.version <= base.version
    || !SHA256.test(draft.contentSha256)
    || !sameProjection(draft.editableProjection, candidate)
    || preview.promptDiff.changed !== true
    || !sameProjection(preview.promptDiff.before, snapshot.subject.editableProjection)
    || !sameProjection(preview.promptDiff.after, candidate)
    || preview.providerCalls !== 0
    || preview.workerStarted !== false
    || preview.humanApprovalInferred !== false
    || preview.humanSignoff !== false
  ) {
    throw new Error('易梦 PromptIR 预览与方法结果、基线或零执行边界不一致')
  }
}

function assertEditReceipt(
  receipt: YimengCommitPromptIrEditResponse,
  marker: PromptIrEditRecoveryMarker,
): void {
  if (
    receipt.schema !== 'jason.qingmu-prompt-ir-edit-commit-result.v1'
    || receipt.eventType !== 'PromptIrDraftCommitted'
    || receipt.changeSetId !== marker.changeSetId
    || receipt.projectId !== marker.projectId
    || receipt.episodeId !== marker.episodeId
    || receipt.targetType !== 'prompt_ir'
    || receipt.targetId !== marker.targetId
    || receipt.storyboardRevisionId !== marker.storyboardRevisionId
    || receipt.frameId !== marker.frameId
    || receipt.previousReadyPromptIr.id !== marker.basePromptIrId
    || receipt.previousReadyPromptIr.version !== marker.baseRevision
    || receipt.previousReadyPromptIr.status !== 'Ready'
    || !SHA256.test(receipt.previousReadyPromptIr.contentSha256)
    || receipt.promptIr.status !== 'Draft'
    || !isIdentifier(receipt.promptIr.id)
    || !Number.isSafeInteger(receipt.promptIr.version)
    || receipt.promptIr.version <= marker.baseRevision
    || !SHA256.test(receipt.promptIr.contentSha256)
    || receipt.payloadSha256 !== marker.expectedPayloadSha256
    || receipt.idempotencyKey !== marker.idempotencyKey
    || receipt.changed !== true
    || receipt.providerCalls !== 0
    || receipt.workerStarted !== false
    || receipt.humanApprovalInferred !== false
    || receipt.humanSignoff !== false
  ) {
    throw new Error('易梦 PromptIR Draft 回执与本次编辑提交血缘不一致')
  }
}

function assertEditRecovery(
  recovery: YimengRecoverPromptIrEditCommitResponse,
  marker: PromptIrEditRecoveryMarker,
): YimengCommitPromptIrEditResponse {
  if (
    recovery.schema !== 'jason.qingmu-command-receipt-recovery.v1'
    || recovery.recovered !== true
    || !SHA256.test(recovery.receiptSha256)
  ) throw new Error('PromptIR 编辑回执恢复合同不完整')
  assertEditReceipt(recovery.receipt, marker)
  return recovery.receipt
}

function assertSelectionReceipt(
  receipt: YimengSelectPromptIrResponse,
  marker: PromptIrSelectionRecoveryMarker,
): void {
  if (
    receipt.schema !== 'jason.qingmu-prompt-ir-selection-result.v1'
    || receipt.eventType !== 'PromptIrSelected'
    || receipt.projectId !== marker.projectId
    || receipt.episodeId !== marker.episodeId
    || receipt.targetType !== 'prompt_ir'
    || receipt.targetId !== `${marker.storyboardRevisionId}:${marker.frameId}`
    || receipt.storyboardRevisionId !== marker.storyboardRevisionId
    || receipt.frameId !== marker.frameId
    || receipt.selectedPromptIr.id !== marker.draftPromptIrId
    || receipt.selectedPromptIr.version !== marker.draftVersion
    || receipt.selectedPromptIr.contentSha256 !== marker.draftContentSha256
    || receipt.selectedPromptIr.status !== 'Ready'
    || receipt.idempotencyKey !== marker.idempotencyKey
    || receipt.changed !== true
    || receipt.providerCall !== false
    || receipt.workerStarted !== false
    || receipt.humanApprovalInferred !== false
    || receipt.humanSignoff !== false
  ) {
    throw new Error('易梦 PromptIR Ready 选择回执与本次选择血缘不一致')
  }
}

function assertSelectionRecovery(
  recovery: YimengRecoverPromptIrSelectionResponse,
  marker: PromptIrSelectionRecoveryMarker,
): YimengSelectPromptIrResponse {
  if (
    recovery.schema !== 'jason.qingmu-command-receipt-recovery.v1'
    || recovery.recovered !== true
    || !SHA256.test(recovery.receiptSha256)
  ) throw new Error('PromptIR 选择回执恢复合同不完整')
  assertSelectionReceipt(recovery.receipt, marker)
  return recovery.receipt
}

function assertSelectedReadyRead(
  snapshot: YimengPromptIrResponse,
  receipt: YimengSelectPromptIrResponse,
): void {
  const selected = receipt.selectedPromptIr
  const subject = snapshot.subject
  if (
    snapshot.schema !== 'jason.qingmu-prompt-ir-subject-read.v1'
    || subject.projectId !== receipt.projectId
    || subject.episodeId !== receipt.episodeId
    || subject.storyboardRevisionId !== receipt.storyboardRevisionId
    || subject.frameId !== receipt.frameId
    || subject.targetId !== receipt.targetId
    || subject.promptIrId !== selected.id
    || subject.promptIrVersion !== selected.version
    || subject.promptIrContentSha256 !== selected.contentSha256
    || subject.status !== 'Ready'
    || snapshot.baseRevision !== selected.version
  ) throw new Error('易梦重读的 Ready PromptIR 与选择回执不一致')
}

function methodItem(value: unknown): string {
  const record = recordOf(value)
  if (record === undefined) return String(value)
  const parts = ['field', 'title', 'label', 'guidance', 'description']
    .map(key => record[key])
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  if (parts.length > 0) return [...new Set(parts)].join(' · ')
  try {
    return JSON.stringify(record)
  } catch {
    return '[unavailable]'
  }
}

function editCommandRequest(marker: PromptIrEditRecoveryMarker): YimengRecoverPromptIrEditCommitRequest {
  return {
    changeSetId: marker.changeSetId,
    projectId: marker.projectId,
    episodeId: marker.episodeId,
    targetType: 'prompt_ir',
    targetId: marker.targetId,
    storyboardRevisionId: marker.storyboardRevisionId,
    frameId: marker.frameId,
    basePromptIrId: marker.basePromptIrId,
    baseRevision: marker.baseRevision,
    baseSnapshotSha256: marker.baseSnapshotSha256,
    idempotencyKey: marker.idempotencyKey,
    expectedPayloadSha256: marker.expectedPayloadSha256,
  }
}

function selectionCommandRequest(marker: PromptIrSelectionRecoveryMarker): YimengRecoverPromptIrSelectionRequest {
  return {
    projectId: marker.projectId,
    episodeId: marker.episodeId,
    storyboardRevisionId: marker.storyboardRevisionId,
    frameId: marker.frameId,
    draftPromptIrId: marker.draftPromptIrId,
    draftVersion: marker.draftVersion,
    draftContentSha256: marker.draftContentSha256,
    idempotencyKey: marker.idempotencyKey,
  }
}

/** Human-operated five-field PromptIR check, Draft commit, and separate Ready selection. */
export function PromptIrWorkspace({
  projectId,
  episodeId,
  shotItems,
  storyboardRevisionId,
  selectedShotId,
  onSelectShotId,
  port,
  t,
  onCommitted,
}: PromptIrWorkspaceProps) {
  const frames = framesOf(projectId, episodeId, shotItems, storyboardRevisionId)
  const active = frames.find(frame => frame.shotId === selectedShotId)
  const [reload, setReload] = useState(0)
  const [operation, setOperation] = useState<Operation>('idle')
  const [snapshot, setSnapshot] = useState<YimengPromptIrResponse>()
  const [draft, setDraft] = useState('')
  const [method, setMethod] = useState<ImagoPromptIrMethodResponse>()
  const [proposal, setProposal] = useState<YimengProposePromptIrResponse>()
  const [preview, setPreview] = useState<YimengPreviewPromptIrResponse>()
  const [editReceipt, setEditReceipt] = useState<YimengCommitPromptIrEditResponse>()
  const [draftPromptIr, setDraftPromptIr] = useState<DraftPromptIr>()
  const [editVerified, setEditVerified] = useState(false)
  const [selectionReceipt, setSelectionReceipt] = useState<YimengSelectPromptIrResponse>()
  const [editConfirmed, setEditConfirmed] = useState(false)
  const [selectionConfirmed, setSelectionConfirmed] = useState(false)
  const [error, setError] = useState<string>()
  const [editRecovery, setEditRecovery] = useState<PromptIrEditRecoveryMarkerRead>({ status: 'none' })
  const [selectionRecovery, setSelectionRecovery] = useState<PromptIrSelectionRecoveryMarkerRead>({ status: 'none' })
  const abortRef = useRef<AbortController>()

  useEffect(() => {
    abortRef.current?.abort()
    setSnapshot(undefined)
    setDraft('')
    setMethod(undefined)
    setProposal(undefined)
    setPreview(undefined)
    setEditReceipt(undefined)
    setDraftPromptIr(undefined)
    setEditVerified(false)
    setSelectionReceipt(undefined)
    setEditConfirmed(false)
    setSelectionConfirmed(false)
    setError(undefined)
    setOperation('idle')
    if (active === undefined) {
      setEditRecovery({ status: 'none' })
      setSelectionRecovery({ status: 'none' })
      return
    }
    setEditRecovery(readPromptIrEditRecoveryMarker(active))
    setSelectionRecovery(readPromptIrSelectionRecoveryMarker(active))
    const controller = new AbortController()
    abortRef.current = controller
    setOperation('loading')
    void port.promptIr({
      projectId: active.projectId,
      episodeId: active.episodeId,
      storyboardRevisionId: active.storyboardRevisionId,
      frameId: active.frameId,
    }, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      assertReadySnapshot(result, active)
      setSnapshot(result)
      setDraft(JSON.stringify(result.subject.editableProjection, null, 2))
      if (active.status === 'Draft') {
        setDraftPromptIr({
          id: active.promptIrId,
          version: active.promptIrVersion,
          contentSha256: active.promptIrContentSha256,
          status: 'Draft',
        })
        setEditVerified(true)
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(messageOf(cause))
    }).finally(() => {
      if (!controller.signal.aborted) setOperation('idle')
    })
    return () => { controller.abort() }
  }, [
    active?.episodeId,
    active?.frameId,
    active?.promptIrContentSha256,
    active?.promptIrId,
    active?.promptIrVersion,
    active?.projectId,
    active?.status,
    active?.storyboardRevisionId,
    port,
    reload,
  ])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const resetPreparedState = (): void => {
    setMethod(undefined)
    setProposal(undefined)
    setPreview(undefined)
    setEditConfirmed(false)
    setError(undefined)
  }

  const checkMethod = async (): Promise<void> => {
    if (snapshot === undefined || active === undefined || operation !== 'idle') return
    setError(undefined)
    let candidate: EditableProjection
    let replacements: Partial<EditableProjection>
    try {
      candidate = parseDraft(draft)
      replacements = replacementsOf(snapshot.subject.editableProjection, candidate)
    } catch (cause) {
      setError(messageOf(cause))
      return
    }
    const request: ImagoPromptIrMethodRequest = {
      projectId: active.projectId,
      episodeId: active.episodeId,
      storyboardRevisionId: active.storyboardRevisionId,
      frameId: active.frameId,
      basePromptIrId: snapshot.subject.promptIrId,
      baseVersion: snapshot.subject.promptIrVersion,
      baseSnapshotSha256: snapshot.baseSnapshotSha256,
      baseContentSha256: snapshot.subject.promptIrContentSha256,
      baseEditableProjection: snapshot.subject.editableProjection,
      candidateEditableProjection: replacements,
    }
    const controller = new AbortController()
    abortRef.current = controller
    setOperation('checking')
    try {
      const result = await port.promptIrMethod(request, controller.signal)
      if (controller.signal.aborted) return
      assertMethodResponse(result, request)
      setMethod(result)
      setProposal(undefined)
      setPreview(undefined)
      setEditConfirmed(false)
      setDraft(JSON.stringify(result.projection.normalized_candidate, null, 2))
    } catch (cause) {
      if (!controller.signal.aborted) setError(messageOf(cause))
    } finally {
      if (!controller.signal.aborted) setOperation('idle')
    }
  }

  const preparePreview = async (): Promise<void> => {
    if (
      snapshot === undefined
      || active === undefined
      || method === undefined
      || method.projection.blockers.length > 0
      || operation !== 'idle'
    ) return
    setError(undefined)
    let candidate: EditableProjection
    let replacements: Partial<EditableProjection>
    try {
      candidate = parseDraft(draft)
      if (!sameProjection(candidate, method.projection.normalized_candidate)) {
        throw new Error('PromptIR JSON 在方法检查后已变化，请重新检查')
      }
      replacements = replacementsOf(snapshot.subject.editableProjection, candidate)
    } catch (cause) {
      setError(messageOf(cause))
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setOperation('previewing')
    try {
      const nextProposal = await port.proposePromptIr({
        projectId: active.projectId,
        episodeId: active.episodeId,
        storyboardRevisionId: active.storyboardRevisionId,
        frameId: active.frameId,
        basePromptIrId: snapshot.subject.promptIrId,
        baseVersion: snapshot.subject.promptIrVersion,
        baseContentSha256: snapshot.subject.promptIrContentSha256,
        replacements,
      }, controller.signal)
      if (controller.signal.aborted) return
      assertProposal(nextProposal, snapshot, active)
      const nextPreview = await port.previewPromptIr({
        changeSetId: nextProposal.changeSet.id,
        projectId: active.projectId,
        episodeId: active.episodeId,
        targetType: 'prompt_ir',
        targetId: active.key,
        storyboardRevisionId: active.storyboardRevisionId,
        frameId: active.frameId,
        basePromptIrId: snapshot.subject.promptIrId,
        baseRevision: nextProposal.changeSet.baseRevision,
        baseSnapshotSha256: nextProposal.changeSet.baseSnapshotSha256,
      }, controller.signal)
      if (controller.signal.aborted) return
      assertPreview(nextPreview, nextProposal, snapshot, candidate, active)
      setProposal(nextProposal)
      setPreview(nextPreview)
      setEditConfirmed(false)
    } catch (cause) {
      if (!controller.signal.aborted) setError(messageOf(cause))
    } finally {
      if (!controller.signal.aborted) setOperation('idle')
    }
  }

  const finishEdit = async (
    receipt: YimengCommitPromptIrEditResponse,
    marker: PromptIrEditRecoveryMarker,
    controller: AbortController,
  ): Promise<void> => {
    assertEditReceipt(receipt, marker)
    if (controller.signal.aborted) return
    setEditRecovery({ status: 'none' })
    setEditReceipt(receipt)
    setDraftPromptIr(receipt.promptIr)
    setEditVerified(true)
    await Promise.allSettled([onCommitted()])
  }

  const commitEdit = async (): Promise<void> => {
    if (
      active === undefined
      || snapshot === undefined
      || proposal === undefined
      || preview === undefined
      || !editConfirmed
      || operation !== 'idle'
      || editRecovery.status !== 'none'
      || selectionRecovery.status !== 'none'
    ) return
    setError(undefined)
    let marker: PromptIrEditRecoveryMarker
    try {
      const idempotencyKey = await derivePromptIrEditIdempotencyKey(
        proposal.changeSet.id,
        proposal.changeSet.payloadSha256,
      )
      marker = createPromptIrEditRecoveryMarker({
        changeSetId: proposal.changeSet.id,
        projectId: active.projectId,
        episodeId: active.episodeId,
        targetType: 'prompt_ir',
        targetId: active.key,
        storyboardRevisionId: active.storyboardRevisionId,
        frameId: active.frameId,
        basePromptIrId: snapshot.subject.promptIrId,
        baseRevision: proposal.changeSet.baseRevision,
        baseSnapshotSha256: proposal.changeSet.baseSnapshotSha256,
        idempotencyKey,
        expectedPayloadSha256: proposal.changeSet.payloadSha256,
      })
      const existing = readPromptIrEditRecoveryMarker(active)
      if (existing.status !== 'none') {
        setEditRecovery(existing)
        throw new Error(t('promptIrRecoveryExists'))
      }
      if (!writePromptIrEditRecoveryMarker(marker)) throw new Error(t('promptIrRecoveryStorageFailed'))
    } catch (cause) {
      setError(messageOf(cause))
      return
    }
    setEditRecovery({ status: 'ready', marker })
    const controller = new AbortController()
    abortRef.current = controller
    setOperation('committing')
    let commandReceiptReceived = false
    try {
      const receipt = await port.commitPromptIrEdit(editCommandRequest(marker), controller.signal)
      if (controller.signal.aborted) return
      assertEditReceipt(receipt, marker)
      commandReceiptReceived = true
      const recovery = await port.recoverPromptIrEditCommit(editCommandRequest(marker), controller.signal)
      if (controller.signal.aborted) return
      await finishEdit(assertEditRecovery(recovery, marker), marker, controller)
    } catch (cause) {
      if (!controller.signal.aborted) {
        const message = messageOf(cause)
        setError(commandReceiptReceived ? message : `${message} · ${t('promptIrUnknownEditResult')}`)
      }
    } finally {
      if (!controller.signal.aborted) setOperation('idle')
    }
  }

  const recoverEdit = async (): Promise<void> => {
    if (editRecovery.status !== 'ready' || operation !== 'idle') return
    const marker = editRecovery.marker
    setError(undefined)
    const controller = new AbortController()
    abortRef.current = controller
    setOperation('recovering-edit')
    try {
      const recovery = await port.recoverPromptIrEditCommit(editCommandRequest(marker), controller.signal)
      if (controller.signal.aborted) return
      const receipt = assertEditRecovery(recovery, marker)
      await finishEdit(receipt, marker, controller)
    } catch (cause) {
      if (!controller.signal.aborted) setError(messageOf(cause))
    } finally {
      if (!controller.signal.aborted) setOperation('idle')
    }
  }

  const finishSelection = async (
    receipt: YimengSelectPromptIrResponse,
    marker: PromptIrSelectionRecoveryMarker,
    controller: AbortController,
  ): Promise<void> => {
    assertSelectionReceipt(receipt, marker)
    const authoritative = await port.promptIr({
      projectId: marker.projectId,
      episodeId: marker.episodeId,
      storyboardRevisionId: marker.storyboardRevisionId,
      frameId: marker.frameId,
    }, controller.signal)
    if (controller.signal.aborted) return
    assertSelectedReadyRead(authoritative, receipt)
    const editMarker = readPromptIrEditRecoveryMarker(marker)
    if (editMarker.status === 'invalid') throw new Error(editMarker.error)
    if (editMarker.status === 'ready' && !clearPromptIrEditRecoveryMarker(editMarker.marker)) {
      throw new Error(t('promptIrRecoveryClearFailed'))
    }
    if (!clearPromptIrSelectionRecoveryMarker(marker)) throw new Error(t('promptIrRecoveryClearFailed'))
    setSelectionRecovery({ status: 'none' })
    setSelectionReceipt(receipt)
    setSnapshot(authoritative)
    setDraft(JSON.stringify(authoritative.subject.editableProjection, null, 2))
    setMethod(undefined)
    setProposal(undefined)
    setPreview(undefined)
    setDraftPromptIr(undefined)
    setEditVerified(false)
    setEditConfirmed(false)
    setSelectionConfirmed(false)
    await Promise.allSettled([onCommitted()])
  }

  const selectDraft = async (): Promise<void> => {
    if (
      active === undefined
      || draftPromptIr === undefined
      || !editVerified
      || !selectionConfirmed
      || operation !== 'idle'
      || editRecovery.status !== 'none'
      || selectionRecovery.status !== 'none'
    ) return
    setError(undefined)
    let marker: PromptIrSelectionRecoveryMarker
    try {
      const request = {
        projectId: active.projectId,
        episodeId: active.episodeId,
        storyboardRevisionId: active.storyboardRevisionId,
        frameId: active.frameId,
        draftPromptIrId: draftPromptIr.id,
        draftVersion: draftPromptIr.version,
        draftContentSha256: draftPromptIr.contentSha256,
      }
      const idempotencyKey = await derivePromptIrSelectionIdempotencyKey(request)
      marker = createPromptIrSelectionRecoveryMarker({ ...request, idempotencyKey })
      const existing = readPromptIrSelectionRecoveryMarker(active)
      if (existing.status !== 'none') {
        setSelectionRecovery(existing)
        throw new Error(t('promptIrRecoveryExists'))
      }
      if (!writePromptIrSelectionRecoveryMarker(marker)) throw new Error(t('promptIrRecoveryStorageFailed'))
    } catch (cause) {
      setError(messageOf(cause))
      return
    }
    setSelectionRecovery({ status: 'ready', marker })
    const controller = new AbortController()
    abortRef.current = controller
    setOperation('selecting')
    let commandReceiptReceived = false
    try {
      const receipt = await port.selectPromptIr(selectionCommandRequest(marker), controller.signal)
      if (controller.signal.aborted) return
      assertSelectionReceipt(receipt, marker)
      commandReceiptReceived = true
      await finishSelection(receipt, marker, controller)
    } catch (cause) {
      if (!controller.signal.aborted) {
        const message = messageOf(cause)
        setError(commandReceiptReceived ? message : `${message} · ${t('promptIrUnknownSelectionResult')}`)
      }
    } finally {
      if (!controller.signal.aborted) setOperation('idle')
    }
  }

  const recoverSelection = async (): Promise<void> => {
    if (selectionRecovery.status !== 'ready' || operation !== 'idle') return
    const marker = selectionRecovery.marker
    setError(undefined)
    const controller = new AbortController()
    abortRef.current = controller
    setOperation('recovering-selection')
    try {
      const recovery = await port.recoverPromptIrSelection(selectionCommandRequest(marker), controller.signal)
      if (controller.signal.aborted) return
      const receipt = assertSelectionRecovery(recovery, marker)
      await finishSelection(receipt, marker, controller)
    } catch (cause) {
      if (!controller.signal.aborted) setError(messageOf(cause))
    } finally {
      if (!controller.signal.aborted) setOperation('idle')
    }
  }

  if (projectId === '' || episodeId === '') return <p className={css.empty}>{t('promptIrChooseEpisode')}</p>
  if (frames.length === 0) return <p className={css.empty}>{t('promptIrNoFrames')}</p>
  if (selectedShotId === '') return <p className={css.empty}>{t('promptIrChooseShot')}</p>
  if (active === undefined) return <p className={css.empty}>{t('promptIrSelectedShotUnavailable')}</p>

  const busy = operation !== 'idle'
  const locked = editRecovery.status !== 'none' || selectionRecovery.status !== 'none'
  const methodProjection = method?.projection
  return (
    <section className={css.scriptWorkspace} aria-label={t('promptIrWorkspaceTitle')}>
      <div className={css.scriptWorkspaceHead}>
        <div>
          <h3>{t('promptIrWorkspaceTitle')}</h3>
          <p>{t('promptIrWorkspaceBoundary')}</p>
        </div>
        <button type="button" disabled={busy} onClick={() => { setReload(value => value + 1) }}>
          {t('promptIrReload')}
        </button>
      </div>

      <label className={css.scriptEditor}>
        <span>{t('promptIrFrame')}</span>
        <select
          aria-label={t('promptIrFrame')}
          value={active.shotId}
          disabled={busy || locked}
          onChange={(event) => { onSelectShotId(event.target.value) }}
        >
          {frames.map(frame => <option key={frame.shotId} value={frame.shotId}>{frame.label} · {frame.status}</option>)}
        </select>
      </label>

      <dl className={css.scriptMeta}>
        <div><dt>{t('promptIrStatus')}</dt><dd>{snapshot?.subject.status ?? active?.status ?? t('unknown')}</dd></div>
        <div><dt>{t('promptIrVersion')}</dt><dd>{snapshot?.subject.promptIrVersion ?? active?.promptIrVersion ?? t('unknown')}</dd></div>
        <div><dt>{t('promptIrContentHash')}</dt><dd>{snapshot?.subject.promptIrContentSha256 ?? active?.promptIrContentSha256 ?? t('unknown')}</dd></div>
      </dl>

      {editRecovery.status === 'ready' && (
        <section className={css.recoveryDock} aria-label={t('promptIrEditRecoveryTitle')}>
          <div><h4>{t('promptIrEditRecoveryTitle')}</h4><p>{t('promptIrEditRecoveryBody')}</p></div>
          <dl>
            <div><dt>{t('changeSet')}</dt><dd>{editRecovery.marker.changeSetId}</dd></div>
            <div><dt>{t('promptIrFrame')}</dt><dd>{editRecovery.marker.frameId}</dd></div>
            <div><dt>{t('payloadHash')}</dt><dd>{editRecovery.marker.expectedPayloadSha256}</dd></div>
          </dl>
          <div className={css.recoveryActions}>
            <button type="button" className={css.primaryAction} disabled={busy} onClick={() => { void recoverEdit() }}>
              {operation === 'recovering-edit' ? t('promptIrRecoveringEdit') : t('promptIrRecoverEdit')}
            </button>
          </div>
        </section>
      )}

      {selectionRecovery.status === 'ready' && (
        <section className={css.recoveryDock} aria-label={t('promptIrSelectionRecoveryTitle')}>
          <div><h4>{t('promptIrSelectionRecoveryTitle')}</h4><p>{t('promptIrSelectionRecoveryBody')}</p></div>
          <dl>
            <div><dt>{t('promptIrDraftId')}</dt><dd>{selectionRecovery.marker.draftPromptIrId}</dd></div>
            <div><dt>{t('promptIrVersion')}</dt><dd>{selectionRecovery.marker.draftVersion}</dd></div>
            <div><dt>{t('promptIrContentHash')}</dt><dd>{selectionRecovery.marker.draftContentSha256}</dd></div>
          </dl>
          <div className={css.recoveryActions}>
            <button type="button" className={css.primaryAction} disabled={busy} onClick={() => { void recoverSelection() }}>
              {operation === 'recovering-selection' ? t('promptIrRecoveringSelection') : t('promptIrRecoverSelection')}
            </button>
          </div>
        </section>
      )}

      {(editRecovery.status === 'invalid' || selectionRecovery.status === 'invalid') && (
        <div className={css.scriptError} role="alert">
          <strong>{t('promptIrInvalidRecoveryTitle')}</strong>
          <p>{editRecovery.status === 'invalid' ? editRecovery.error : ''}</p>
          <p>{selectionRecovery.status === 'invalid' ? selectionRecovery.error : ''}</p>
        </div>
      )}

      <label className={css.scriptEditor}>
        <span>{t('promptIrDraftLabel')}</span>
        <textarea
          aria-label={t('promptIrDraftLabel')}
          value={draft}
          rows={16}
          spellCheck={false}
          disabled={busy || locked || snapshot === undefined || draftPromptIr !== undefined}
          onChange={(event) => {
            setDraft(event.target.value)
            resetPreparedState()
          }}
        />
        <small>{t('promptIrDraftHint')}</small>
      </label>

      <div className={css.scriptActions}>
        <button
          type="button"
          className={css.primaryAction}
          disabled={busy || locked || snapshot === undefined || draftPromptIr !== undefined}
          onClick={() => { void checkMethod() }}
        >
          {operation === 'checking' ? t('promptIrCheckingMethod') : t('promptIrCheckMethod')}
        </button>
        <span>{t('promptIrMethodBoundary')}</span>
      </div>

      {methodProjection !== undefined && (
        <section className={css.previewDock} aria-label={t('promptIrMethodTitle')}>
          <div className={css.previewHead}>
            <div><h4>{t('promptIrMethodTitle')}</h4><p>{t('promptIrZeroExecution')}</p></div>
          </div>
          <div className={css.previewColumns}>
            <div>
              <strong>{t('promptIrFieldHelp')}</strong>
              <ul className={css.list}>{methodProjection.field_hints.map((item, index) => (
                <li key={String(index)}>{methodItem(item)}</li>
              ))}</ul>
            </div>
            <div>
              <strong>{t('promptIrChecklist')}</strong>
              <ul className={css.list}>{methodProjection.checklist.map((item, index) => (
                <li key={String(index)}>{methodItem(item)}</li>
              ))}</ul>
            </div>
            <div>
              <strong>{t('changedPaths')}</strong>
              <ul className={css.list}>{methodProjection.changed_paths.map(path => <li key={path}>{path}</li>)}</ul>
            </div>
            <div>
              <strong>{t('blockers')}</strong>
              {methodProjection.blockers.length === 0
                ? <p>{t('noBlockers')}</p>
                : <ul className={css.list}>{methodProjection.blockers.map(item => <li key={item}>{item}</li>)}</ul>}
            </div>
            <div>
              <strong>{t('promptIrWarnings')}</strong>
              {methodProjection.warnings.length === 0
                ? <p>{t('promptIrNoWarnings')}</p>
                : <ul className={css.list}>{methodProjection.warnings.map(item => <li key={item}>{item}</li>)}</ul>}
            </div>
          </div>
          <div className={css.scriptActions}>
            <button
              type="button"
              className={css.primaryAction}
              disabled={busy || locked || methodProjection.blockers.length > 0 || methodProjection.changed_paths.length === 0}
              onClick={() => { void preparePreview() }}
            >
              {operation === 'previewing' ? t('promptIrPreparingPreview') : t('promptIrPreparePreview')}
            </button>
            <span>{t('promptIrPreviewBoundary')}</span>
          </div>
        </section>
      )}

      {preview !== undefined && proposal !== undefined && (
        <section className={css.previewDock} aria-label={t('promptIrPreviewTitle')}>
          <div className={css.previewHead}>
            <div><h4>{t('promptIrPreviewTitle')}</h4><p>{t('promptIrPreviewDraftOnly')}</p></div>
          </div>
          <dl className={css.previewMeta}>
            <div><dt>{t('changeSet')}</dt><dd>{proposal.changeSet.id}</dd></div>
            <div><dt>{t('promptIrDraftId')}</dt><dd>{preview.candidatePromptIr.id}</dd></div>
            <div><dt>{t('promptIrVersion')}</dt><dd>{preview.basePromptIr.version} → {preview.candidatePromptIr.version}</dd></div>
            <div><dt>{t('payloadHash')}</dt><dd>{proposal.changeSet.payloadSha256}</dd></div>
          </dl>
          <div className={css.previewColumns}>
            <div>
              <strong>{t('changedPaths')}</strong>
              <ul className={css.list}>{preview.promptDiff.changedPaths.map(path => <li key={path}>{path}</li>)}</ul>
            </div>
            <div><strong>{t('promptIrExecution')}</strong><p>{t('promptIrZeroExecution')}</p></div>
          </div>
          <div className={css.commitDock}>
            <label>
              <input
                type="checkbox"
                checked={editConfirmed}
                disabled={busy || locked}
                onChange={(event) => { setEditConfirmed(event.target.checked) }}
              />
              <span>{t('promptIrEditConfirm')}</span>
            </label>
            <button
              type="button"
              className={css.primaryAction}
              disabled={busy || locked || !editConfirmed}
              onClick={() => { void commitEdit() }}
            >
              {operation === 'committing' ? t('promptIrCommittingEdit') : t('promptIrCommitEdit')}
            </button>
          </div>
        </section>
      )}

      {draftPromptIr !== undefined && (
        <section className={css.commitReceipt} role="status">
          <h4>{t('promptIrDraftCommitted')}</h4>
          <dl>
            {editReceipt !== undefined && <div><dt>{t('receiptId')}</dt><dd>{editReceipt.commandReceiptId}</dd></div>}
            <div><dt>{t('promptIrDraftId')}</dt><dd>{draftPromptIr.id}</dd></div>
            <div><dt>{t('promptIrStatus')}</dt><dd>{draftPromptIr.status}</dd></div>
            <div><dt>{t('promptIrContentHash')}</dt><dd>{draftPromptIr.contentSha256}</dd></div>
          </dl>
          {editVerified && selectionRecovery.status === 'none' && (
            <div className={css.commitDock}>
              <label>
                <input
                  type="checkbox"
                  checked={selectionConfirmed}
                  disabled={busy}
                  onChange={(event) => { setSelectionConfirmed(event.target.checked) }}
                />
                <span>{t('promptIrSelectionConfirm')}</span>
              </label>
              <button
                type="button"
                className={css.primaryAction}
                disabled={busy || !selectionConfirmed}
                onClick={() => { void selectDraft() }}
              >
                {operation === 'selecting' ? t('promptIrSelecting') : t('promptIrSelect')}
              </button>
            </div>
          )}
        </section>
      )}

      {selectionReceipt !== undefined && (
        <section className={css.commitReceipt} role="status">
          <h4>{t('promptIrSelectedReady')}</h4>
          <dl>
            <div><dt>{t('receiptId')}</dt><dd>{selectionReceipt.commandReceiptId}</dd></div>
            <div><dt>{t('promptIrDraftId')}</dt><dd>{selectionReceipt.selectedPromptIr.id}</dd></div>
            <div><dt>{t('promptIrStatus')}</dt><dd>{selectionReceipt.selectedPromptIr.status}</dd></div>
            <div><dt>{t('promptIrContentHash')}</dt><dd>{selectionReceipt.selectedPromptIr.contentSha256}</dd></div>
          </dl>
          <p>{t('promptIrSelectionNotApproval')}</p>
        </section>
      )}

      {error !== undefined && <div className={css.scriptError} role="alert"><strong>{t('promptIrError')}</strong><p>{error}</p></div>}
    </section>
  )
}
