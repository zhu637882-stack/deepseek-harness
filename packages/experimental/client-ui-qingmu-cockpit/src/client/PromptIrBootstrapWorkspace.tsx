import { useEffect, useRef, useState } from 'react'
import type {
  ImagoPromptIrBootstrapMethodResponse,
  YimengBootstrapPromptIrResponse,
  YimengPromptIrBootstrapResponse,
  YimengSelectPromptIrResponse,
} from './contracts.ts'
import type { PromptIrWorkspaceProps } from './PromptIrWorkspace.tsx'
import css from './QingmuCockpit.module.css'
import directorCss from './DirectorWorkspace.module.css'

const SHA256 = /^[0-9a-f]{64}$/
const EDITABLE_FIELDS = [
  'imageGenPrompt', 'lastFrameImagePrompt', 'videoGenPrompt', 'motionPrompt', 'negativePrompt',
] as const
const DRAFT_MARKER_PREFIX = 'qingmu.prompt-ir-bootstrap.draft.v1:'
const SELECT_MARKER_PREFIX = 'qingmu.prompt-ir-bootstrap.select.v1:'

interface BootstrapFrame {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly label: string
}

interface DraftRecoveryMarker {
  readonly schema: 'qingmu.prompt-ir-bootstrap-draft-recovery.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly idempotencyKey: string
  readonly expectedContextSnapshotSha256: string
  readonly methodProjectionSha256: string
}

interface SelectionRecoveryMarker {
  readonly schema: 'qingmu.prompt-ir-bootstrap-selection-recovery.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly draftPromptIrId: string
  readonly draftVersion: number
  readonly draftContentSha256: string
  readonly bootstrapMethodSha256: string
  readonly idempotencyKey: string
}

type Operation = 'idle' | 'loading' | 'compiling' | 'committing' | 'recovering' | 'selecting'

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value === value.trim() && !/[\u0000\r\n]/.test(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value)
}

function isExact(value: unknown, expected: unknown): boolean {
  return value === expected
}

function bootstrapFrameOf(props: PromptIrWorkspaceProps): BootstrapFrame | undefined {
  for (const item of props.shotItems) {
    const shot = recordOf(item)
    const frameId = shot?.frameId
    const shotId = shot?.shotId
    if (!isIdentifier(frameId) || (frameId !== props.selectedShotId && shotId !== props.selectedShotId)) continue
    const label = typeof shot?.name === 'string' && shot.name.trim() !== ''
      ? shot.name.trim()
      : typeof shot?.title === 'string' && shot.title.trim() !== '' ? shot.title.trim() : frameId
    return {
      projectId: props.projectId,
      episodeId: props.episodeId,
      storyboardRevisionId: props.storyboardRevisionId,
      frameId,
      label,
    }
  }
  return undefined
}

function markerKey(prefix: string, frame: BootstrapFrame): string {
  return `${prefix}${frame.projectId}:${frame.episodeId}:${frame.storyboardRevisionId}:${frame.frameId}`
}

function frameRequest(frame: BootstrapFrame) {
  return {
    projectId: frame.projectId,
    episodeId: frame.episodeId,
    storyboardRevisionId: frame.storyboardRevisionId,
    frameId: frame.frameId,
  }
}

function readMarker(key: string): unknown {
  const raw = window.sessionStorage.getItem(key)
  if (raw === null) return undefined
  return JSON.parse(raw) as unknown
}

function readDraftMarker(key: string, frame: BootstrapFrame): DraftRecoveryMarker | undefined {
  const marker = recordOf(readMarker(key))
  if (marker === undefined) return undefined
  if (marker.schema !== 'qingmu.prompt-ir-bootstrap-draft-recovery.v1'
    || marker.projectId !== frame.projectId || marker.episodeId !== frame.episodeId
    || marker.storyboardRevisionId !== frame.storyboardRevisionId || marker.frameId !== frame.frameId
    || !isIdentifier(marker.idempotencyKey)
    || !isSha256(marker.expectedContextSnapshotSha256)
    || !isSha256(marker.methodProjectionSha256)) {
    throw new Error('Draft 恢复标记与当前镜头不一致')
  }
  return marker as unknown as DraftRecoveryMarker
}

function readSelectionMarker(key: string, frame: BootstrapFrame): SelectionRecoveryMarker | undefined {
  const marker = recordOf(readMarker(key))
  if (marker === undefined) return undefined
  if (marker.schema !== 'qingmu.prompt-ir-bootstrap-selection-recovery.v1'
    || marker.projectId !== frame.projectId || marker.episodeId !== frame.episodeId
    || marker.storyboardRevisionId !== frame.storyboardRevisionId || marker.frameId !== frame.frameId
    || !isIdentifier(marker.draftPromptIrId) || typeof marker.draftVersion !== 'number'
    || !Number.isSafeInteger(marker.draftVersion) || marker.draftVersion < 1
    || !isSha256(marker.draftContentSha256)
    || !isSha256(marker.bootstrapMethodSha256)
    || !isIdentifier(marker.idempotencyKey)) {
    throw new Error('Ready 选择恢复标记与当前 Draft 不一致')
  }
  return marker as unknown as SelectionRecoveryMarker
}

function writeMarker(key: string, marker: DraftRecoveryMarker | SelectionRecoveryMarker): void {
  window.sessionStorage.setItem(key, JSON.stringify(marker))
}

function clearMarker(key: string): void {
  window.sessionStorage.removeItem(key)
}

function requestWithoutSchema<T extends DraftRecoveryMarker | SelectionRecoveryMarker>(marker: T): Omit<T, 'schema'> {
  const { schema, ...request } = marker
  void schema
  return request
}

async function idempotencyKey(kind: 'draft' | 'select', values: readonly (string | number)[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([kind, ...values]))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
  return `prompt-ir-bootstrap-${kind}-${hex.slice(0, 32)}`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertState(result: YimengPromptIrBootstrapResponse, frame: BootstrapFrame): void {
  const context = recordOf(result.context) ?? {}
  const storyboard = recordOf(context.storyboard) ?? {}
  const currentFrame = recordOf(context.frame) ?? {}
  const challenge = recordOf(result.selectionChallenge)
  if (!isExact(result.schema, 'jason.qingmu-prompt-ir-bootstrap-state.v1')
    || context.projectId !== frame.projectId || context.episodeId !== frame.episodeId
    || storyboard.id !== frame.storyboardRevisionId || currentFrame.id !== frame.frameId
    || !isSha256(result.contextSnapshotSha256)
    || (result.draft === null) !== (result.draftMethodSha256 === null)
    || (result.draft === null) !== (challenge === undefined)
    || !isExact(result.providerCalls, 0) || !isExact(result.workerStarted, false)
    || !isExact(result.humanApprovalInferred, false) || !isExact(result.humanSignoff, false)
    || !isExact(result.selectionExecuted, false)) {
    throw new Error('首个 PromptIR 上下文与当前镜头或零执行边界不一致')
  }
  if (result.draft !== null && (
    challenge?.schema !== 'jason.qingmu-prompt-ir-bootstrap-selection-challenge.v1'
    || challenge.projectId !== frame.projectId || challenge.episodeId !== frame.episodeId
    || challenge.storyboardRevisionId !== frame.storyboardRevisionId || challenge.frameId !== frame.frameId
    || challenge.draftPromptIrId !== result.draft.promptIrId
    || challenge.draftVersion !== result.draft.promptIrVersion
    || challenge.draftContentSha256 !== result.draft.promptIrContentSha256
    || challenge.contextSnapshotSha256 !== result.contextSnapshotSha256
    || challenge.methodSha256 !== result.draftMethodSha256
    || !isSha256(challenge.methodProjectionSha256) || !isSha256(challenge.candidateSha256)
    || !isSha256(challenge.nonce) || !isSha256(challenge.signature)
  )) throw new Error('Ready 选择 challenge 与当前 Draft 不一致')
}

function assertMethod(
  result: ImagoPromptIrBootstrapMethodResponse,
  state: YimengPromptIrBootstrapResponse,
): void {
  const projection = result.projection
  const candidate = recordOf(projection.candidate) ?? {}
  const editable = recordOf(candidate.editableProjection) ?? {}
  const definition = recordOf(projection.method_definition) ?? {}
  const freshness = recordOf(result.selectionFreshnessAttestation)
  const challenge = recordOf(state.selectionChallenge)
  if (!isExact(result.schema, 'qingmu.imago-prompt-ir-bootstrap-method-adapter-result.v1')
    || !isExact(projection.schema, 'qingmu.imago-prompt-ir-bootstrap-method-projection.v1')
    || projection.context_snapshot_sha256 !== state.contextSnapshotSha256
    || result.methodAttestation.contextSnapshotSha256 !== state.contextSnapshotSha256
    || result.methodAttestation.projectionSha256 !== result.projectionSha256
    || result.methodAttestation.candidateSha256 !== projection.candidate_sha256
    || result.methodAttestation.methodSha256 !== definition.sha256
    || !isSha256(result.projectionSha256)
    || !isSha256(definition.sha256)
    || !isExact(candidate.status, 'Draft') || !isExact(candidate.advisoryOnly, true)
    || EDITABLE_FIELDS.some(field => typeof editable[field] !== 'string')
    || !isExact(projection.project_state_persisted, false) || !isExact(projection.providerCalls, 0)
    || !isExact(projection.workerStarted, false) || !isExact(projection.selection_executed, false)
    || !isExact(projection.human_approval_inferred, false)
    || !isExact(projection.human_signoff_inferred, false)) {
    throw new Error('IMAGO 首版 PromptIR 方法回执与当前上下文或零执行边界不一致')
  }
  if ((challenge === undefined) !== (freshness === undefined)) {
    throw new Error('IMAGO Ready 选择新鲜度证明缺失或意外出现')
  }
  if (challenge !== undefined && (
    freshness?.schema !== 'qingmu.imago-prompt-ir-bootstrap-selection-freshness-attestation.v1'
    || freshness.algorithm !== 'hmac-sha256'
    || freshness.projectionSha256 !== result.projectionSha256
    || freshness.contextSnapshotSha256 !== state.contextSnapshotSha256
    || freshness.methodSha256 !== definition.sha256
    || freshness.candidateSha256 !== projection.candidate_sha256
    || !isSha256(freshness.challengeSha256) || !isSha256(freshness.signature)
  )) throw new Error('IMAGO Ready 选择新鲜度证明与当前编译结果不一致')
}

function assertDraftReceipt(
  result: YimengBootstrapPromptIrResponse,
  marker: DraftRecoveryMarker,
): void {
  const prompt = recordOf(result.promptIr) ?? {}
  if (!isExact(result.schema, 'jason.qingmu-prompt-ir-bootstrap-result.v1')
    || result.projectId !== marker.projectId || result.episodeId !== marker.episodeId
    || result.storyboardRevisionId !== marker.storyboardRevisionId || result.frameId !== marker.frameId
    || result.contextSnapshotSha256 !== marker.expectedContextSnapshotSha256
    || result.idempotencyKey !== marker.idempotencyKey
    || !isExact(prompt.status, 'Draft') || !isIdentifier(prompt.promptIrId)
    || typeof prompt.promptIrVersion !== 'number' || !Number.isSafeInteger(prompt.promptIrVersion)
    || !isSha256(prompt.promptIrContentSha256)
    || !isExact(result.providerCalls, 0) || !isExact(result.workerStarted, false)
    || !isExact(result.humanApprovalInferred, false) || !isExact(result.humanSignoff, false)
    || !isExact(result.selectionExecuted, false)) {
    throw new Error('首个 PromptIR Draft 回执与当前镜头或零执行边界不一致')
  }
}

function assertSelection(
  result: YimengSelectPromptIrResponse,
  marker: SelectionRecoveryMarker,
): void {
  if (!isExact(result.schema, 'jason.qingmu-prompt-ir-selection-result.v1')
    || result.projectId !== marker.projectId || result.episodeId !== marker.episodeId
    || result.storyboardRevisionId !== marker.storyboardRevisionId || result.frameId !== marker.frameId
    || result.selectedPromptIr.id !== marker.draftPromptIrId
    || result.selectedPromptIr.version !== marker.draftVersion
    || result.selectedPromptIr.contentSha256 !== marker.draftContentSha256
    || !isExact(result.selectedPromptIr.status, 'Ready') || result.idempotencyKey !== marker.idempotencyKey
    || !isExact(result.providerCall, false) || !isExact(result.workerStarted, false)
    || !isExact(result.humanApprovalInferred, false) || !isExact(result.humanSignoff, false)) {
    throw new Error('首个 Ready 选择回执与当前 Draft 或零执行边界不一致')
  }
}

/** Return whether the selected real storyboard item can enter the first-PromptIR path. */
export function hasPromptIrBootstrapFrame(props: PromptIrWorkspaceProps): boolean {
  return bootstrapFrameOf(props) !== undefined
}

/** Two-step first PromptIR Draft materialization and authenticated Ready selection. */
export function PromptIrBootstrapWorkspace(props: PromptIrWorkspaceProps) {
  const frame = bootstrapFrameOf(props)
  const [state, setState] = useState<YimengPromptIrBootstrapResponse>()
  const [method, setMethod] = useState<ImagoPromptIrBootstrapMethodResponse>()
  const [draftReceipt, setDraftReceipt] = useState<YimengBootstrapPromptIrResponse>()
  const [selectionReceipt, setSelectionReceipt] = useState<YimengSelectPromptIrResponse>()
  const [draftMarker, setDraftMarker] = useState<DraftRecoveryMarker>()
  const [selectionMarker, setSelectionMarker] = useState<SelectionRecoveryMarker>()
  const [confirmed, setConfirmed] = useState(false)
  const [operation, setOperation] = useState<Operation>('idle')
  const [error, setError] = useState<string>()
  const [reload, setReload] = useState(0)
  const abortRef = useRef<AbortController>()

  useEffect(() => {
    abortRef.current?.abort()
    setState(undefined); setMethod(undefined); setDraftReceipt(undefined); setSelectionReceipt(undefined)
    setConfirmed(false); setError(undefined)
    if (frame === undefined) return
    try {
      setDraftMarker(readDraftMarker(markerKey(DRAFT_MARKER_PREFIX, frame), frame))
      setSelectionMarker(readSelectionMarker(markerKey(SELECT_MARKER_PREFIX, frame), frame))
    } catch (cause) { setError(`恢复标记不可读：${messageOf(cause)}`) }
    const controller = new AbortController()
    abortRef.current = controller
    setOperation('loading')
    void props.port.promptIrBootstrap(frameRequest(frame), controller.signal).then((result) => {
      if (controller.signal.aborted) return
      assertState(result, frame)
      setState(result)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(messageOf(cause))
    }).finally(() => { if (!controller.signal.aborted) setOperation('idle') })
    return () => { controller.abort() }
  }, [frame?.episodeId, frame?.frameId, frame?.projectId, frame?.storyboardRevisionId, props.port, reload])

  if (props.projectId === '' || props.episodeId === '') return <p className={css.empty}>请先选择项目和集。</p>
  if (frame === undefined) return <p className={css.empty}>当前镜头没有可核验的真实分镜帧。</p>
  const busy = operation !== 'idle'
  const draft = state?.draft
  const editable = draft?.editableProjection

  const compile = async (): Promise<void> => {
    if (state === undefined || busy || state.draft !== null || state.ready !== null) return
    const controller = new AbortController(); abortRef.current = controller
    setOperation('compiling'); setError(undefined)
    try {
      const result = await props.port.promptIrBootstrapMethod({
        context: state.context,
        contextSnapshotSha256: state.contextSnapshotSha256,
      }, controller.signal)
      if (controller.signal.aborted) return
      assertMethod(result, state)
      setMethod(result)
    } catch (cause) { if (!controller.signal.aborted) setError(messageOf(cause)) }
    finally { if (!controller.signal.aborted) setOperation('idle') }
  }

  const recoverDraft = async (marker: DraftRecoveryMarker): Promise<void> => {
    const controller = new AbortController(); abortRef.current = controller
    setOperation('recovering'); setError(undefined)
    try {
      const result = await props.port.recoverPromptIrBootstrap(requestWithoutSchema(marker), controller.signal)
      if (controller.signal.aborted) return
      assertDraftReceipt(result, marker)
      clearMarker(markerKey(DRAFT_MARKER_PREFIX, frame)); setDraftMarker(undefined); setDraftReceipt(result)
      setReload(value => value + 1); await props.onCommitted()
    } catch (cause) { if (!controller.signal.aborted) setError(messageOf(cause)) }
    finally { if (!controller.signal.aborted) setOperation('idle') }
  }

  const commitDraft = async (): Promise<void> => {
    if (state === undefined || method === undefined || busy) return
    const key = await idempotencyKey('draft', [frame.projectId, frame.episodeId, frame.storyboardRevisionId,
      frame.frameId, state.contextSnapshotSha256, method.projectionSha256])
    const marker: DraftRecoveryMarker = {
      schema: 'qingmu.prompt-ir-bootstrap-draft-recovery.v1',
      projectId: frame.projectId,
      episodeId: frame.episodeId,
      storyboardRevisionId: frame.storyboardRevisionId,
      frameId: frame.frameId,
      idempotencyKey: key,
      expectedContextSnapshotSha256: state.contextSnapshotSha256,
      methodProjectionSha256: method.projectionSha256,
    }
    try {
      writeMarker(markerKey(DRAFT_MARKER_PREFIX, frame), marker)
      setDraftMarker(marker)
    } catch (cause) {
      setError(`无法安全保存 Draft 恢复标记：${messageOf(cause)}`)
      return
    }
    const controller = new AbortController(); abortRef.current = controller
    setOperation('committing'); setError(undefined)
    try {
      const result = await props.port.bootstrapPromptIr({
        ...requestWithoutSchema(marker),
        methodProjection: method.projection,
        methodAttestation: method.methodAttestation,
      }, controller.signal)
      if (controller.signal.aborted) return
      assertDraftReceipt(result, marker)
      await recoverDraft(marker)
    } catch (cause) {
      if (!controller.signal.aborted) setError(`${messageOf(cause)} · 结果未知时请使用“恢复原 Draft 回执”，不要新建。`)
    } finally { if (!controller.signal.aborted) setOperation('idle') }
  }

  const select = async (markerOverride?: SelectionRecoveryMarker): Promise<void> => {
    if (busy) return
    const controller = new AbortController(); abortRef.current = controller
    setOperation('selecting'); setError(undefined)
    try {
      let marker = markerOverride
      let result: YimengSelectPromptIrResponse
      if (marker === undefined) {
        const methodSha256 = state?.draftMethodSha256
        const selectionChallenge = state?.selectionChallenge
        if (state === undefined || draft === null || draft === undefined
          || methodSha256 === null || methodSha256 === undefined
          || selectionChallenge === null || selectionChallenge === undefined || !confirmed) return
        const freshness = await props.port.promptIrBootstrapMethod({
          context: state.context,
          contextSnapshotSha256: state.contextSnapshotSha256,
          selectionChallenge,
        }, controller.signal)
        if (controller.signal.aborted) return
        assertMethod(freshness, state)
        const currentDefinition = recordOf(freshness.projection.method_definition)
        if (currentDefinition?.sha256 !== methodSha256) {
          throw new Error('IMAGO 方法已变化；当前 Draft 已过期，请刷新后重新生成。')
        }
        if (freshness.selectionFreshnessAttestation === undefined) {
          throw new Error('IMAGO Ready 选择新鲜度证明缺失，请刷新后重试。')
        }
        const key = await idempotencyKey('select', [
          frame.projectId, frame.episodeId, frame.storyboardRevisionId, frame.frameId,
          draft.promptIrId, draft.promptIrVersion, draft.promptIrContentSha256,
          methodSha256, freshness.projectionSha256,
        ])
        marker = {
          schema: 'qingmu.prompt-ir-bootstrap-selection-recovery.v1',
          projectId: frame.projectId, episodeId: frame.episodeId,
          storyboardRevisionId: frame.storyboardRevisionId, frameId: frame.frameId,
          draftPromptIrId: draft.promptIrId, draftVersion: draft.promptIrVersion,
          draftContentSha256: draft.promptIrContentSha256,
          bootstrapMethodSha256: methodSha256, idempotencyKey: key,
        }
        try {
          writeMarker(markerKey(SELECT_MARKER_PREFIX, frame), marker); setSelectionMarker(marker)
        } catch (cause) {
          setError(`无法安全保存 Ready 选择恢复标记：${messageOf(cause)}`)
          return
        }
        result = await props.port.selectBootstrapPromptIr({
          ...requestWithoutSchema(marker),
          methodProjection: freshness.projection,
          methodProjectionSha256: freshness.projectionSha256,
          methodAttestation: freshness.methodAttestation,
          selectionChallenge,
          selectionFreshnessAttestation: freshness.selectionFreshnessAttestation,
        }, controller.signal)
      } else {
        const recovered = await props.port.recoverPromptIrSelection({
          projectId: marker.projectId,
          episodeId: marker.episodeId,
          storyboardRevisionId: marker.storyboardRevisionId,
          frameId: marker.frameId,
          draftPromptIrId: marker.draftPromptIrId,
          draftVersion: marker.draftVersion,
          draftContentSha256: marker.draftContentSha256,
          idempotencyKey: marker.idempotencyKey,
        }, controller.signal)
        result = recovered.receipt
      }
      if (controller.signal.aborted) return
      assertSelection(result, marker)
      clearMarker(markerKey(SELECT_MARKER_PREFIX, frame)); setSelectionMarker(undefined)
      setSelectionReceipt(result); setConfirmed(false)
      await props.onCommitted(); setReload(value => value + 1)
    } catch (cause) {
      if (!controller.signal.aborted) setError(`${messageOf(cause)} · 可用同一选择回执恢复，不会创建第二版本。`)
    } finally { if (!controller.signal.aborted) setOperation('idle') }
  }

  return <section className={css.scriptWorkspace} aria-label="首个 PromptIR 引导">
    <div className={css.scriptWorkspaceHead}><div><h3>首个 PromptIR 引导</h3>
      <p>基于当前 Ready 分镜、已选本地参考和版本化 IMAGO 方法，只创建 Draft；零 Provider。</p></div>
    <button type="button" disabled={busy} onClick={() => { setReload(value => value + 1) }}>刷新</button></div>
    <p role="status">{frame.label} · {frame.frameId}</p>
    {state?.ready !== null && state?.ready !== undefined && <section className={css.commitReceipt} role="status">
      <h4>首个 Ready PromptIR 已选定</h4><p>Ready 只表示当前生效的提示词版本，不代表内容、权利、正式一致性或发布批准。</p>
      <p>v{state.ready.promptIrVersion} · {state.ready.promptIrContentSha256}</p></section>}
    {state !== undefined && state.draft === null && state.ready === null && <div className={css.scriptActions}>
      <button type="button" className={css.primaryAction} disabled={busy || draftMarker !== undefined}
        onClick={() => { void compile() }}>{operation === 'compiling' ? '正在核验方法…' : '生成首个 Draft 预览'}</button>
      <span>不会启动生成、选择参考或代替人工决定。</span></div>}
    {method !== undefined && <section className={css.previewDock} aria-label="首版 PromptIR 预览">
      <h4>方法生成的 Draft 预览</h4><p>保存后仍是 Draft，不会成为 Ready。</p>
      {EDITABLE_FIELDS.map((field) => {
        const value = recordOf(recordOf(method.projection.candidate)?.editableProjection)?.[field]
        return <div key={field} className={directorCss.diff}><strong>{field}</strong>
          <pre>{typeof value === 'string' ? value : ''}</pre></div>
      })}
      <button type="button" className={css.primaryAction} disabled={busy || draftMarker !== undefined}
        onClick={() => { void commitDraft() }}>{operation === 'committing' ? '正在保存 Draft…' : '保存首个 PromptIR Draft'}</button>
    </section>}
    {draftMarker !== undefined && <section className={css.recoveryDock} aria-label="Draft 回执恢复">
      <div><h4>Draft 提交结果待确认</h4><p>只读取原幂等回执，不会重新生成方法结果。</p></div>
      <button type="button" className={css.primaryAction} disabled={busy}
        onClick={() => { void recoverDraft(draftMarker) }}>恢复原 Draft 回执</button></section>}
    {draft !== null && draft !== undefined && <section className={css.commitReceipt} role="status">
      <h4>PromptIR Draft 已保存</h4><p>当前仍是 Draft；旧 Ready 不存在，生成与批准均未启动。</p>
      {EDITABLE_FIELDS.map(field => <details key={field}><summary>{field}</summary><p className={directorCss.promptText}>{editable?.[field] || '—'}</p></details>)}
      <details><summary>高级来源</summary><p>Draft {draft.promptIrId} · v{draft.promptIrVersion}</p>
        <p>内容 SHA {draft.promptIrContentSha256}</p><p>方法 SHA {state?.draftMethodSha256}</p></details>
      {selectionMarker === undefined && <div className={css.commitDock}><label><input type="checkbox" checked={confirmed}
        disabled={busy} onChange={(event) => { setConfirmed(event.target.checked) }} />
      <span>我确认把这个 Draft 选为当前 Ready 提示词版本；这不是内容、权利或发布批准。</span></label>
      <button type="button" className={css.primaryAction} disabled={busy || !confirmed}
        onClick={() => { void select() }}>{operation === 'selecting' ? '正在选择…' : '选为首个 Ready'}</button></div>}
    </section>}
    {selectionMarker !== undefined && <section className={css.recoveryDock} aria-label="Ready 选择恢复">
      <div><h4>选择结果待确认</h4><p>按原幂等命令恢复；不会再次创建 PromptIR。</p></div>
      <button type="button" className={css.primaryAction} disabled={busy}
        onClick={() => { void select(selectionMarker) }}>恢复原选择结果</button></section>}
    {draftReceipt !== undefined && <p role="status">Draft 回执 {draftReceipt.commandReceiptId} 已核验。</p>}
    {selectionReceipt !== undefined && <p role="status">Ready 选择回执 {selectionReceipt.commandReceiptId} 已核验；未推断任何人工签收。</p>}
    {error !== undefined && <div className={css.scriptError} role="alert"><strong>首个 PromptIR 操作失败</strong><p>{error}</p></div>}
  </section>
}
