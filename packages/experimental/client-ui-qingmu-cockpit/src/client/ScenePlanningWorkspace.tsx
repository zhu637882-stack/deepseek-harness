/** Script-to-scene planning over canonical Yimeng reads and durable commands. */
import { useEffect, useRef, useState } from 'react'
import type { PlanningBase, PlanningScene, PlanningShot, ScenePlanningRequest, ScenePlanningState, ScenePlanningResult } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { DirectorProposalItem, DirectorReplayProposal } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type {
  DirectorPaidAvailability,
  DirectorPaidWorkOrder,
  DirectorPaidWorkOrderStatus,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import type {
  DirectorContextBindingState,
  DirectorContextClientPort,
  DirectorObjectScope,
} from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import {
  createQingmuScenePlanningSavedMessage,
  type QingmuAdvisorySaveProof,
  type QingmuHostSync,
} from './host-sync.ts'
import css from './ScenePlanningWorkspace.module.css'

interface LocalPlan {
  activeIndex?: number
  sceneIndex: number
  shots: PlanningShot[]
  base: PlanningBase
  shotIds: string[]
  dirty: boolean
  pending?: ScenePlanningRequest
  pendingAdvisory?: QingmuAdvisorySaveProof
}
const retainedInputLimit = 98304
const labels = { title: '镜头名称', narrative: '叙事目的', visual: '画面描述', action: '动作与表演' } as const
function base(state: ScenePlanningState, sceneIndex: number): PlanningBase {
  if (state.scriptSha256 === null) throw new Error('请先保存剧本')
  return { sceneIndex, expectedScriptRevision: state.scriptRevision, expectedScriptSha256: state.scriptSha256,
    expectedStoryboardRevision: state.storyboard?.version ?? 0, expectedStoryboardSha256: state.storyboard?.sourceHash ?? null }
}
function saved(state: ScenePlanningState): LocalPlan | null {
  const p = state.planning
  return p === null ? null : { sceneIndex: p.sceneIndex, base: base(state, p.sceneIndex),
    shots: p.shots.map(({ id: _id, ...shot }) => shot), shotIds: p.shots.map(s => s.id), dirty: false }
}
function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/401|token|authentication/i.test(message)) return '会话已过期，请运行 qingmu-local.py login，再读取恢复。输入已保留，不会自动重发。'
  if (/403|forbidden/.test(message)) return '当前身份无权操作此项目。输入已保留，请核对本地登录身份。'
  if (/409|conflict|mismatch/.test(message)) return '剧本或分镜版本发生冲突。输入已保留，请读取恢复，核对来源后再处理。'
  return `未能确认结果。输入已保留，请先读取恢复。${message}`
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function waitForStatus(signal: AbortSignal, milliseconds = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }, { once: true })
  })
}

function validStoredShot(value: unknown): value is PlanningShot {
  const shot = objectOf(value)
  return shot !== null
    && typeof shot.title === 'string' && shot.title.length >= 1 && shot.title.length <= 120
    && typeof shot.narrative === 'string' && shot.narrative.length <= 2000
    && typeof shot.visual === 'string' && shot.visual.length <= 2000
    && typeof shot.action === 'string' && shot.action.length <= 2000
    && typeof shot.durationSec === 'number'
    && Number.isFinite(shot.durationSec)
    && shot.durationSec >= 0.5 && shot.durationSec <= 30
    && Array.isArray(shot.dialogueLineIds) && shot.dialogueLineIds.length <= 100
    && new Set(shot.dialogueLineIds).size === shot.dialogueLineIds.length
    && shot.dialogueLineIds.every(id => typeof id === 'string')
}

function isPlanningScene(value: ScenePlanningState['scenes'][number] | undefined): value is PlanningScene {
  return value !== undefined && 'importSourceLineIds' in value
}

function validPlanningBase(value: unknown): value is PlanningBase {
  const candidate = objectOf(value)
  return candidate !== null
    && Number.isSafeInteger(candidate.sceneIndex) && (candidate.sceneIndex as number) >= 1
    && Number.isSafeInteger(candidate.expectedScriptRevision) && (candidate.expectedScriptRevision as number) >= 1
    && typeof candidate.expectedScriptSha256 === 'string' && /^[a-f0-9]{64}$/u.test(candidate.expectedScriptSha256)
    && Number.isSafeInteger(candidate.expectedStoryboardRevision) && (candidate.expectedStoryboardRevision as number) >= 0
    && ((candidate.expectedStoryboardRevision === 0 && candidate.expectedStoryboardSha256 === null)
      || (typeof candidate.expectedStoryboardSha256 === 'string' && /^[a-f0-9]{64}$/u.test(candidate.expectedStoryboardSha256)))
}

/** Convert untrusted browser state into one bounded, non-resumable conflict copy. */
function retainedInput(value: unknown): LocalPlan | null {
  const candidate = objectOf(value)
  if (candidate === null || !Number.isSafeInteger(candidate.sceneIndex) || (candidate.sceneIndex as number) < 1
    || !validPlanningBase(candidate.base) || !Array.isArray(candidate.shots) || candidate.shots.length < 1 || candidate.shots.length > 8
    || !candidate.shots.every(validStoredShot) || typeof candidate.dirty !== 'boolean') return null
  if (candidate.activeIndex !== undefined
    && (!Number.isSafeInteger(candidate.activeIndex) || (candidate.activeIndex as number) < 0
      || (candidate.activeIndex as number) >= candidate.shots.length)) return null
  if (!Array.isArray(candidate.shotIds) || candidate.shotIds.length > 8
    || new Set(candidate.shotIds).size !== candidate.shotIds.length
    || !candidate.shotIds.every(id => typeof id === 'string')) return null
  let encoded: string
  try { encoded = JSON.stringify(candidate) } catch { return null }
  if (new TextEncoder().encode(encoded).byteLength > retainedInputLimit) return null
  return {
    ...(candidate.activeIndex === undefined ? {} : { activeIndex: candidate.activeIndex as number }),
    sceneIndex: candidate.sceneIndex as number,
    base: candidate.base,
    shots: candidate.shots.map(shot => ({ ...shot, dialogueLineIds: [...shot.dialogueLineIds] })),
    shotIds: [],
    dirty: true,
  }
}

function storedPlan(key: string): LocalPlan | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return retainedInput(raw) === null ? null : raw as LocalPlan
  } catch { return null }
}

/** Treat browser persistence as untrusted and bind a pending RPC to the current canonical object before I/O. */
function validatedPendingIntent(
  value: unknown,
  currentState: ScenePlanningState | null,
  projectId: string,
  episodeId: string,
): ScenePlanningRequest | null {
  const intent = objectOf(value)
  const request = objectOf(intent?.request)
  if (currentState === null
    || currentState.projectId !== projectId
    || currentState.episodeId !== episodeId
    || intent?.projectId !== projectId
    || intent.episodeId !== episodeId
    || typeof intent.idempotencyKey !== 'string'
    || !/^[A-Za-z0-9._:-]{8,128}$/u.test(intent.idempotencyKey)
    || request === null
    || typeof request.sceneIndex !== 'number'
    || !Number.isSafeInteger(request.sceneIndex)
    || !currentState.scenes.some(scene => scene.sceneIndex === request.sceneIndex)) return null
  if (request.action === 'edit') {
    return typeof request.shotId === 'string'
      && validStoredShot(request.shot)
      && currentState.planning?.sceneIndex === request.sceneIndex
      && currentState.planning.shots.some(shot => shot.id === request.shotId)
      ? value as ScenePlanningRequest
      : null
  }
  return request.action === 'initialize'
    && Array.isArray(request.shots)
    && request.shots.length >= 1
    && request.shots.length <= 8
    && request.shots.every(validStoredShot)
    ? value as ScenePlanningRequest
    : null
}

/** One source scene and bounded shot editor, with explicit structural-only save.
 * @param props - Canonical scope and existing Host command port.
 * @returns Three-column planning workspace; never creates prompts, media or approval.
 */
export function ScenePlanningWorkspace({
  projectId, episodeId, port, directorBridge, directorSessionId,
  hostSync, onUnsavedChange, onCommitted, onSelectShotId,
}: {
  readonly projectId: string
  readonly episodeId: string
  readonly port: Pick<QingmuYimengPort, 'readScenePlanning' | 'saveScenePlanning' | 'recoverScenePlanning'
    | 'requestDirectorProposal' | 'checkDirectorProposalFreshness'>
    & Partial<Pick<QingmuYimengPort, 'readDirectorProviderAvailability'
      | 'issueDirectorProviderWorkOrder' | 'readDirectorProviderWorkOrderStatus'>>
  readonly directorBridge?: DirectorContextClientPort | undefined
  readonly directorSessionId?: string | undefined
  readonly hostSync?: QingmuHostSync | undefined
  readonly onUnsavedChange: (dirty: boolean) => void
  readonly onCommitted: () => Promise<unknown>
  readonly onSelectShotId: (id: string) => void
}) {
  const key = `qingmu.scene-planning.v1:${projectId}:${episodeId}`
  const [state, setState] = useState<ScenePlanningState | null>(null)
  const [local, setLocal] = useState<LocalPlan | null>(() => storedPlan(key))
  const [retained, setRetained] = useState<LocalPlan | null>(() => retainedInput(storedPlan(`${key}:retained-input`)))
  const [sceneIndex, setSceneIndex] = useState(local?.sceneIndex ?? 1)
  const [index, setIndex] = useState(local?.activeIndex ?? 0)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<ScenePlanningResult | null>(null)
  const [proposal, setProposal] = useState<DirectorReplayProposal | null>(null)
  const [ignoredProposalItems, setIgnoredProposalItems] = useState<readonly string[]>([])
  const [adoptedProposalItems, setAdoptedProposalItems] = useState<readonly string[]>([])
  const [adoptedPaidItems, setAdoptedPaidItems] = useState<readonly string[]>([])
  const [proposalBusy, setProposalBusy] = useState(false)
  const [paidAvailability, setPaidAvailability] = useState<DirectorPaidAvailability | null>(null)
  const [paidWorkOrder, setPaidWorkOrder] = useState<DirectorPaidWorkOrder | null>(null)
  const [paidStatus, setPaidStatus] = useState<DirectorPaidWorkOrderStatus | null>(null)
  const [paidBusy, setPaidBusy] = useState(false)
  const [directorBinding, setDirectorBinding] = useState<DirectorContextBindingState | null>(null)
  const [directorStatus, setDirectorStatus] = useState<'unbound' | 'connecting' | 'current' | 'unavailable' | 'drifted'>('unbound')
  const [retryAllowed, setRetryAllowed] = useState(false)
  const [recoveryRead, setRecoveryRead] = useState(false)
  const lock = useRef(false)
  const live = useRef(true)
  const isLive = (): boolean => live.current
  const controller = useRef(new AbortController())
  const proposalController = useRef<AbortController>()
  const paidController = useRef<AbortController>()
  const proposalEpoch = useRef(0)
  const clearPaidProposal = () => {
    paidController.current?.abort()
    setPaidWorkOrder(null); setPaidStatus(null); setPaidBusy(false); setAdoptedPaidItems([])
  }
  useEffect(() => {
    live.current = true; controller.current = new AbortController()
    return () => { live.current = false; controller.current.abort(); proposalController.current?.abort(); paidController.current?.abort() }
  }, [])
  useEffect(() => {
    const operation = new AbortController()
    setPaidAvailability(null); clearPaidProposal()
    if (port.readDirectorProviderAvailability === undefined) return () => operation.abort()
    void port.readDirectorProviderAvailability({ projectId, episodeId }, operation.signal)
      .then((value) => { if (!operation.signal.aborted) setPaidAvailability(value) })
      .catch(() => { if (!operation.signal.aborted) setPaidAvailability(null) })
    return () => operation.abort()
  }, [episodeId, port, projectId])
  const update = (next: LocalPlan | null) => {
    try {
      if (next === null) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify(next))
      setLocal(next); setPreview(false)
    } catch { setError('浏览器不能保存恢复标记，请允许本地存储后再操作。') }
  }
  useEffect(() => {
    let active = true
    void port.readScenePlanning({ projectId, episodeId }).then((next) => {
      if (!active) return
      if (next.projectId !== projectId || next.episodeId !== episodeId) throw new Error('409 planning_read_scope_mismatch')
      setState(next)
      if (next.canonicalStoryboard !== null && next.canonicalStoryboard !== undefined) {
        const retainedInputCopy = local === null ? null : retainedInput(local)
        const priorRetained = retainedInput(storedPlan(`${key}:retained-input`))
        const retainedCopy = retainedInputCopy ?? priorRetained
        try {
          localStorage.removeItem(key)
          if (retainedCopy === null) localStorage.removeItem(`${key}:retained-input`)
          else localStorage.setItem(`${key}:retained-input`, JSON.stringify(retainedCopy))
        } catch { setError('自动分镜已建立，但浏览器无法保留旧规划输入；请先复制文字。') }
        setRetained(retainedCopy); setLocal(null); setSceneIndex(0); setIndex(0); setPreview(false)
        if (retainedCopy !== null) setError('已保留旧规划输入副本；自动分镜为当前权威来源，未发送恢复或保存请求。')
        return
      }
      if (local?.pending !== undefined
        && validatedPendingIntent(local.pending, next, projectId, episodeId) === null) {
        try { localStorage.removeItem(key) } catch { /* The invalid marker remains unusable in memory. */ }
        const plan = saved(next)
        setLocal(plan)
        setSceneIndex(plan?.sceneIndex ?? 1)
        setIndex(0)
        setError('已拒绝损坏或跨作用域的恢复标记，并载入当前权威规划；未发送恢复或保存请求。')
        return
      }
      if (local === null) {
        const plan = saved(next)
        const target = hostSync?.pendingTarget()
        const targetIndex = plan !== null && target !== null && target !== undefined
          && next.planning?.sceneId === target.sceneId
          ? plan.shotIds.findIndex(id => id === target.shotId)
          : -1
        const activeIndex = targetIndex >= 0 ? targetIndex : 0
        setLocal(plan === null ? null : { ...plan, activeIndex })
        setSceneIndex(plan?.sceneIndex ?? 1)
        setIndex(activeIndex)
      }
    }).catch((e: unknown) => { if (active) setError(errorText(e)) })
    return () => { active = false }
    // Scope remounts this workspace; initial hydration must not replace local edits.
  }, [projectId, episodeId, port, hostSync])
  useEffect(() => {
    const dirty = Boolean(local?.dirty || local?.pending)
    onUnsavedChange(dirty)
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', prevent)
    return () => { window.removeEventListener('beforeunload', prevent); onUnsavedChange(false) }
  }, [local, onUnsavedChange])
  const scene = state?.scenes.find(s => s.sceneIndex === (local?.sceneIndex ?? sceneIndex))
  const planningScene = isPlanningScene(scene) ? scene : undefined
  const current = local?.shots[index]
  const currentShotId = local?.shotIds[index]
  const canonicalStoryboard = state?.canonicalStoryboard ?? null
  const directorScope: DirectorObjectScope | null = state?.planning && currentShotId ? {
    projectId, episodeId, sceneId: state.planning.sceneId, shotId: currentShotId,
  } : null
  const paidScopeIsCurrent = paidWorkOrder !== null && directorScope !== null && directorBinding !== null
    && paidWorkOrder.projectId === directorScope.projectId
    && paidWorkOrder.episodeId === directorScope.episodeId
    && paidWorkOrder.sceneId === directorScope.sceneId
    && paidWorkOrder.shotId === directorScope.shotId
    && paidWorkOrder.inputSha256 === directorBinding.binding.contextSnapshotSha256
  const visiblePaidWorkOrder = paidScopeIsCurrent ? paidWorkOrder : null
  const visiblePaidStatus = paidScopeIsCurrent ? paidStatus : null
  const clearProposal = () => {
    proposalController.current?.abort()
    proposalEpoch.current += 1
    setProposal(null); setIgnoredProposalItems([]); setAdoptedProposalItems([]); setProposalBusy(false)
  }
  useEffect(() => {
    clearProposal()
    if (directorBridge === undefined || directorSessionId === undefined || directorScope === null) {
      setDirectorBinding(null); setDirectorStatus('unbound')
      return
    }
    const operation = new AbortController()
    const epoch = proposalEpoch.current
    setDirectorStatus('connecting')
    void directorBridge.enter(directorSessionId, directorScope, operation.signal).then((result) => {
      if (operation.signal.aborted || epoch !== proposalEpoch.current) return
      if (result.status === 'current') {
        setDirectorBinding(result.state); setDirectorStatus('current'); hostSync?.replay(result.state)
      } else {
        setDirectorBinding(result.state); setDirectorStatus('unavailable')
      }
    }).catch(() => {
      if (!operation.signal.aborted && epoch === proposalEpoch.current) {
        setDirectorBinding(null); setDirectorStatus('unavailable')
      }
    })
    return () => { operation.abort() }
  }, [directorBridge, directorSessionId, hostSync, projectId, episodeId, directorScope?.sceneId, directorScope?.shotId])
  useEffect(() => {
    clearPaidProposal()
  }, [directorScope?.sceneId, directorScope?.shotId, directorBinding?.binding.contextSnapshotSha256])
  const begin = () => {
    if (!state || !planningScene) return
    const shots = [0, 1].map(i => ({ title: `镜头 ${i + 1}`, narrative: '', visual: '', action: i === 0 ? planningScene.actionDescription : '',
      durationSec: 3, dialogueLineIds: planningScene.dialogues.filter((_, n) => n % 2 === i).map(d => d.sourceLineId) }))
    update({ sceneIndex, shots, base: base(state, sceneIndex), shotIds: [], dirty: true })
  }
  const change = (shot: PlanningShot) => {
    if (local) update({ ...local, activeIndex: index, dirty: true, shots: local.shots.map((s, i) => i === index ? shot : s) })
  }
  const requestProposal = async () => {
    const shotId = local?.shotIds[index]
    if (!state?.planning || !shotId || !directorScope || !directorBridge || !directorSessionId || proposalBusy) return
    proposalController.current?.abort()
    const operation = new AbortController()
    proposalController.current = operation
    const epoch = proposalEpoch.current + 1
    proposalEpoch.current = epoch
    setProposalBusy(true); setError('')
    try {
      const entry = await directorBridge.enter(directorSessionId, directorScope, operation.signal)
      if (entry.status !== 'current') throw new Error('director_context_unavailable')
      const result = await port.requestDirectorProposal({ projectId, episodeId,
        sceneId: state.planning.sceneId, shotId, suggestionType: 'text_director_proposal' }, operation.signal)
      const bound = await directorBridge.bindProposal(directorSessionId, result, operation.signal)
      if (!isLive() || operation.signal.aborted || epoch !== proposalEpoch.current) return
      setDirectorBinding(bound.state); setDirectorStatus('current')
      setProposal(result); setIgnoredProposalItems([]); setAdoptedProposalItems([])
    } catch (e) {
      if (isLive() && !operation.signal.aborted && epoch === proposalEpoch.current) {
        setDirectorStatus('unavailable')
        setError(`演练建议暂不可用；人工编辑不受影响。${errorText(e)}`)
      }
    } finally {
      if (isLive() && epoch === proposalEpoch.current) setProposalBusy(false)
    }
  }
  const requestPaidProposal = async () => {
    const shotId = local?.shotIds[index]
    const issueWorkOrder = port.issueDirectorProviderWorkOrder
    const readWorkOrderStatus = port.readDirectorProviderWorkOrderStatus
    if (!state?.planning || !shotId || !directorBinding || directorStatus !== 'current'
      || !paidAvailability?.enabled || paidBusy || issueWorkOrder === undefined
      || readWorkOrderStatus === undefined) return
    const confirmed = window.confirm(
      '这会向真实 DeepSeek deepseek-v4-pro 发送一次纯文本导演建议请求。'
      + '\n本次请求授权上限：¥0.30；最多 8000 输入 / 2000 输出 token；失败不自动重试。'
      + '\n建议默认只展示，可逐项采用到草稿并按真实来源保存；不会自动写入草稿、质检、Ready 或人工决定。是否继续？',
    )
    if (!confirmed) return
    paidController.current?.abort()
    const operation = new AbortController()
    paidController.current = operation
    setPaidBusy(true); setPaidWorkOrder(null); setPaidStatus(null); setError('')
    try {
      const identity = {
        expectedContextSnapshotSha256: directorBinding.binding.contextSnapshotSha256,
        methodPackageSha256: paidAvailability.methodPackageSha256 as string,
        methodPackageVersion: paidAvailability.methodPackageVersion as string,
        purpose: 'bounded_director_suggestion' as const,
        sceneId: state.planning.sceneId,
        shotId,
        suggestionType: 'text_director_proposal' as const,
      }
      const workOrder = await issueWorkOrder({
        projectId, episodeId, ...identity, idempotencyKey: await sha256(identity),
      }, operation.signal)
      if (!isLive() || operation.signal.aborted) return
      setPaidWorkOrder(workOrder)
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const status = await readWorkOrderStatus({
          projectId, episodeId, generationTaskId: workOrder.generationTaskId,
        }, operation.signal)
        if (!isLive() || operation.signal.aborted) return
        setPaidStatus(status)
        if (status.state === 'settled' || status.state === 'submission_unknown'
          || status.state === 'unknown' || status.state === 'failed') return
        await waitForStatus(operation.signal)
      }
      setError('真实 DeepSeek 请求状态仍未收敛；没有重试 Provider。请稍后读取当前状态。')
    } catch (e) {
      if (isLive() && !operation.signal.aborted) {
        setError(`真实 DeepSeek 建议未确认完成；没有自动重试。${errorText(e)}`)
      }
    } finally {
      if (isLive()) setPaidBusy(false)
    }
  }
  const adoptProposalItem = (item: DirectorProposalItem) => {
    if (!local || !current || !proposal || proposal.stale) return
    if (current[item.field] !== item.originalValue) {
      setError('当前草稿已变化，此建议不能直接采用。请重新读取建议；人工输入已保留。')
      return
    }
    if (item.field === 'durationSec') {
      if (typeof item.proposedValue !== 'number') return
      change({ ...current, durationSec: item.proposedValue })
    } else {
      if (typeof item.proposedValue !== 'string') return
      change({ ...current, [item.field]: item.proposedValue })
    }
    setAdoptedProposalItems(items => [...new Set([...items, item.id])])
  }
  const adoptPaidProposalItem = (item: Record<string, unknown>) => {
    if (!local || !current || paidStatus?.state !== 'settled') return
    const id = item.id
    const field = item.field
    if (typeof id !== 'string' || typeof field !== 'string') return
    if (field !== 'durationSec' && typeof item.proposedValue !== 'string') return
    if (field === 'durationSec' && typeof item.proposedValue !== 'number') return
    change({ ...current, [field]: item.proposedValue })
    setAdoptedPaidItems(items => [...new Set([...items, id])])
  }
  const finish = async (
    result: ScenePlanningResult,
    advisory: QingmuAdvisorySaveProof | null,
    intendedShotId?: string,
  ) => {
    if (!isLive()) return
    const next = await port.readScenePlanning({ projectId, episodeId }, controller.current.signal)
    if (!isLive()) return
    const selected = intendedShotId ?? result.shotIds[index]
    if (result.projectId !== projectId
      || result.episodeId !== episodeId
      || next.projectId !== projectId
      || next.episodeId !== episodeId
      || next.planning === null
      || next.planning.sceneId !== result.sceneId
      || selected === undefined
      || !result.shotIds.includes(selected)
      || !next.planning.shots.some(shot => shot.id === selected)
      || next.storyboard?.id !== result.storyboard.id
      || next.storyboard.version !== result.storyboard.version
      || next.storyboard.sourceHash !== result.storyboard.sourceHash) {
      throw new Error('409 planning_receipt_scope_mismatch')
    }
    setReceipt(result)
    const nextPlan = saved(next)
    const nextIndex = nextPlan?.shotIds.findIndex(id => id === selected) ?? -1
    setState(next)
    update(nextPlan === null ? null : { ...nextPlan, activeIndex: nextIndex >= 0 ? nextIndex : 0 })
    if (nextIndex >= 0) setIndex(nextIndex)
    setRetryAllowed(false); setRecoveryRead(false)
    onSelectShotId(selected)
    const warnings: string[] = []
    try {
      await onCommitted()
    } catch {
      if (!isLive()) return
      warnings.push('内层工作流投影刷新失败；保存回执仍有效，外层通知不受影响。')
    }
    if (!isLive()) return
    if (hostSync !== undefined) {
      if (directorBridge === undefined || directorSessionId === undefined) {
        warnings.push('当前 DSh 会话未绑定；未向外层发送刷新通知。请重新读取当前镜头。')
      } else {
        try {
          const entered = await directorBridge.enter(directorSessionId, {
            projectId, episodeId, sceneId: result.sceneId, shotId: selected,
          }, controller.current.signal)
          if (!isLive()) return
          if (entered.status !== 'current') {
            setDirectorBinding(entered.state); setDirectorStatus('unavailable')
            warnings.push('保存后的镜头上下文未能重新核对；未向外层发送刷新通知。')
          } else {
            setDirectorBinding(entered.state); setDirectorStatus('current')
            const message = createQingmuScenePlanningSavedMessage(result, entered.state, advisory)
            if (message === null || !hostSync.publish(message)) {
              warnings.push('外层刷新通知未确认发送；外层可安全手动刷新。')
            }
          }
        } catch {
          if (!isLive()) return
          warnings.push('保存后的镜头上下文核对失败；未向外层发送刷新通知。')
        }
      }
    }
    if (warnings.length > 0) setError(`规划已保存。${warnings.join(' ')}`)
  }
  const run = async (recover: boolean) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (recover) {
        if (local?.pending) {
          const intent = validatedPendingIntent(local.pending, state, projectId, episodeId)
          if (intent === null) throw new Error('409 planning_pending_scope_mismatch')
          await finish(
            await port.recoverScenePlanning(intent, controller.current.signal),
            local.pendingAdvisory ?? null,
            intent.request.action === 'edit' ? intent.request.shotId : undefined,
          )
        }
        else {
          const next = await port.readScenePlanning({ projectId, episodeId }, controller.current.signal)
          if (!isLive()) return
          setState(next)
          if (!local?.dirty) update(saved(next))
        }
      } else if (local && current) {
        const shotId = local.shotIds[index]
        let advisory: QingmuAdvisorySaveProof | null = local.pendingAdvisory ?? null
        if (local.shotIds.length > 0 && !shotId) throw new Error('当前镜头身份缺失，请读取恢复。')
        if (adoptedProposalItems.length > 0 && adoptedPaidItems.length > 0) {
          throw new Error('一次保存只允许一种建议来源（演练或真实 Provider）；请先取消其中一类的采用。')
        }
        if (shotId && proposal && adoptedProposalItems.length > 0) {
          if (directorBridge === undefined || directorSessionId === undefined) throw new Error('409 director_session_missing')
          const recovered = await directorBridge.recover(directorSessionId, controller.current.signal)
          if (recovered.status !== 'current'
            || recovered.state.proposal?.proposalId !== proposal.proposalId
            || recovered.state.proposal.proposalSha256 !== proposal.proposalSha256
            || recovered.state.binding.contextSnapshotSha256 !== proposal.inputSha256) {
            setDirectorBinding(recovered.status === 'unbound' ? null : recovered.state)
            setDirectorStatus(recovered.status === 'drifted' ? 'drifted' : 'unavailable')
            throw new Error('409 director_proposal_stale')
          }
          const freshness = await port.checkDirectorProposalFreshness({ projectId, episodeId,
            sceneId: proposal.sceneId, shotId, contextSnapshotSha256: proposal.inputSha256,
            methodPackageVersion: proposal.methodPackage.version,
            methodPackageSha256: proposal.methodPackage.methodPackageSha256,
            workOrderId: proposal.workOrder.workOrderId,
            workOrderSha256: proposal.workOrder.workOrderSha256,
            promptSha256: proposal.workOrder.promptSha256,
            proposalId: proposal.proposalId, proposalSha256: proposal.proposalSha256,
            outputSha256: proposal.outputSha256 }, controller.current.signal)
          if (!freshness.fresh) {
            throw new Error('409 director_proposal_stale')
          }
          advisory = {
            proposalId: proposal.proposalId,
            proposalSha256: proposal.proposalSha256,
            outputSha256: proposal.outputSha256,
            inputContextSnapshotSha256: proposal.inputSha256,
            methodPackageVersion: proposal.methodPackage.version,
            methodPackageSha256: proposal.methodPackage.methodPackageSha256,
            workOrderId: proposal.workOrder.workOrderId,
            workOrderSha256: proposal.workOrder.workOrderSha256,
            promptSha256: proposal.workOrder.promptSha256,
            adoptedItemIds: adoptedProposalItems,
          }
        } else if (shotId && adoptedPaidItems.length > 0) {
          // 真实 Provider 建议与演练建议共用同一新鲜度校验与保存链；
          // 付费提案身份=工单，proposalSha=outputSha（服务端已校验 sha(proposal)），outputSha=rawOutputSha。
          if (paidWorkOrder === null || paidStatus?.state !== 'settled') {
            throw new Error('409 director_paid_proposal_unavailable')
          }
          const paidReceipt = objectOf(paidStatus.executionReceipt)
          const proposalSha = typeof paidReceipt?.outputSha256 === 'string' ? paidReceipt.outputSha256 : ''
          const rawSha = typeof paidReceipt?.rawOutputSha256 === 'string' ? paidReceipt.rawOutputSha256 : ''
          if (!/^[a-f0-9]{64}$/.test(proposalSha) || !/^[a-f0-9]{64}$/.test(rawSha)) {
            throw new Error('409 director_paid_proposal_unavailable')
          }
          const freshness = await port.checkDirectorProposalFreshness({ projectId, episodeId,
            sceneId: paidWorkOrder.sceneId, shotId,
            contextSnapshotSha256: paidWorkOrder.inputSha256,
            methodPackageVersion: paidWorkOrder.methodPackage.version,
            methodPackageSha256: paidWorkOrder.methodPackage.sha256,
            workOrderId: paidWorkOrder.workOrderId,
            workOrderSha256: paidWorkOrder.workOrderSha256,
            promptSha256: paidWorkOrder.promptSha256,
            proposalId: paidWorkOrder.workOrderId, proposalSha256: proposalSha,
            outputSha256: rawSha }, controller.current.signal)
          if (!freshness.fresh) {
            throw new Error('409 director_proposal_stale')
          }
          advisory = {
            source: 'provider',
            proposalId: paidWorkOrder.workOrderId,
            proposalSha256: proposalSha,
            outputSha256: rawSha,
            inputContextSnapshotSha256: paidWorkOrder.inputSha256,
            methodPackageVersion: paidWorkOrder.methodPackage.version,
            methodPackageSha256: paidWorkOrder.methodPackage.sha256,
            workOrderId: paidWorkOrder.workOrderId,
            workOrderSha256: paidWorkOrder.workOrderSha256,
            promptSha256: paidWorkOrder.promptSha256,
            adoptedItemIds: adoptedPaidItems,
          }
        }
        const intent: ScenePlanningRequest = local.pending ?? { projectId, episodeId, idempotencyKey: crypto.randomUUID(),
          request: shotId ? { ...local.base, action: 'edit', shotId, shot: current }
            : { ...local.base, action: 'initialize', shots: local.shots } }
        const scopedIntent = validatedPendingIntent(intent, state, projectId, episodeId)
        if (scopedIntent === null) throw new Error('409 planning_pending_scope_mismatch')
        // Persist the exact intent before transmitting, so unknown outcomes are recoverable.
        const pending = { ...local, pending: scopedIntent, ...(advisory === null ? {} : { pendingAdvisory: advisory }) }
        localStorage.setItem(key, JSON.stringify(pending))
        setLocal(pending)
        await finish(
          await port.saveScenePlanning(scopedIntent, controller.current.signal),
          advisory,
          scopedIntent.request.action === 'edit' ? scopedIntent.request.shotId : undefined,
        )
      }
    } catch (e) {
      if (!isLive()) return
      setError(errorText(e))
      if (recover && /404|planning_receipt_not_found/.test(String(e))) {
        setRetryAllowed(true)
        try {
          const next = await port.readScenePlanning({ projectId, episodeId }, controller.current.signal)
          if (!isLive()) return
          setState(next); setRecoveryRead(true)
        } catch (readError) { if (isLive()) { setRecoveryRead(false); setError(errorText(readError)) } }
      }
    } finally { lock.current = false; if (isLive()) setBusy(false) }
  }
  const select = (next: number) => {
    if (local?.shotIds.length && local.dirty) { setError('请先保存当前镜头再切换；当前修改已保留。'); return }
    clearProposal(); clearPaidProposal()
    if (local) update({ ...local, activeIndex: next })
    setIndex(next); setPreview(false)
  }
  const canRebase = Boolean(local?.pending && retryAllowed && recoveryRead && state
    && state.scriptSha256 === local.base.expectedScriptSha256
    && ((state.planning && local.shotIds[index] === state.planning.shots[index]?.id)
      || (state.storyboard === null && local.shotIds.length === 0)))
  return <section className={css.workspace} aria-label="场景与镜头规划">
    <nav className={css.navigation} aria-label="剧本场景与规划镜头">
      <h3>场景与镜头</h3>
      {state?.scenes.map(s => <button type="button" key={s.sceneIndex} aria-pressed={s.sceneIndex === (local?.sceneIndex ?? sceneIndex)}
        disabled={Boolean(local) || busy} onClick={() => { setSceneIndex(s.sceneIndex) }}>{s.title}</button>)}
      {local?.shots.map((s, i) => <button type="button" key={local.shotIds[i] ?? i} aria-pressed={i === index}
        disabled={busy || Boolean(local.pending)} onClick={() => { select(i) }}>{String(i + 1).padStart(2, '0')} · {s.title}<small>{s.durationSec} 秒 · 规划镜头</small></button>)}
    </nav>
    <main className={css.content}>
      <header><small>导演入场 · 结构规划</small><h2>{scene?.title ?? '从已保存剧本建立镜头'}</h2>
        <p>只保存本场文本实体与规划镜头，不生成媒体，不批准内容。</p></header>
      {error && <p role="alert" className={css.notice}>{error}</p>}
      <div className={css.actions}><button type="button" disabled={busy || state === null} onClick={() => { void run(true) }}>读取恢复</button>
        {local?.pending && retryAllowed && <button type="button" disabled={busy || canRebase} onClick={() => { void run(false) }}>重试原保存</button>}
        {canRebase && <button type="button" onClick={() => {
          if (!local || !state || !current) return
          const latest = saved(state)
          if (latest) update({ ...latest, activeIndex: index, dirty: true, shots: latest.shots.map((s, i) => i === index ? current : s) })
          else { const { pending: _pending, ...editable } = local; update({ ...editable, base: base(state, local.sceneIndex) }) }
          setRetryAllowed(false); setRecoveryRead(false); setError('已保留文字并读取最新分镜；请重新预览，确认差异后保存。')
        }}>保留文字，按最新分镜重新准备</button>}</div>
      {local?.pending && retryAllowed && recoveryRead && state?.planning && local.shotIds.length === 0 && <button type="button" onClick={() => {
        if (!state.planning) return
        if (!window.confirm('另一份分镜已存在。保留本次未提交文字副本并载入已有镜头？不会把本次文字覆盖到服务器。')) return
        try {
          localStorage.setItem(`${key}:retained-input`, JSON.stringify(local))
          setRetained(local); update(saved(state)); setIndex(0); setSceneIndex(state.planning.sceneIndex)
          setRetryAllowed(false); setRecoveryRead(false); setError('已载入现有镜头。原输入保留在下方“冲突输入副本”，未重发或覆盖服务器。')
        } catch { setError('无法保留冲突输入副本；未离开当前编辑。请先复制文字。') }
      }}>保留输入副本，载入已存在镜头</button>}
      {canonicalStoryboard && <section className={css.notice} role="status" aria-label="自动分镜已建立">
        <h3>青木已自动建立 {canonicalStoryboard.shotCount} 个镜头</h3>
        <p>这 {canonicalStoryboard.shotCount} 个镜头来自当前权威自动分镜。本页的旧场景规划不适用；不会重置、保存或覆盖它们。</p>
        <p>主镜头工作区在本页下方“已有提示词、Take 与高级分镜”中。旧场景规划不可写；后续动作仍受各自确认/门禁。</p>
      </section>}
      {!canonicalStoryboard && !state?.scenes.length && <p>尚无可规划场景。请先到“剧本与资产”确认导入并保存剧本。</p>}
      {planningScene && <details open={!local}><summary>已保存原文 · 只读对照</summary><p>{planningScene.actionDescription || '原文未提供动作描述'}</p>
        {planningScene.dialogues.map(d => <p key={d.sourceLineId}><strong>{d.character}</strong>：{d.line}</p>)}</details>}
      {planningScene && local === null && state?.storyboard === null && <><p>初始提供两个空白规划卡；动作来自原文，对白初始分配需你核对，其他字段由你填写。</p>
        <button type="button" className={css.primary} onClick={begin}>建立本场镜头</button></>}
      {state?.storyboard && !canonicalStoryboard && local === null && <p>本集已有分镜；此入口不覆盖已有对象，请使用当前导演工作区。</p>}
      {local && current && <fieldset disabled={busy || Boolean(local.pending)} className={css.editor}>
        <legend>镜头 {index + 1} · {local.shotIds.length ? '编辑已保存规划' : '尚未保存'}</legend>
        {(Object.keys(labels) as (keyof typeof labels)[]).map(field => <label key={field}>{labels[field]}
          <textarea aria-label={labels[field]} rows={field === 'title' ? 1 : 2} maxLength={field === 'title' ? 120 : 2000} value={current[field]}
            onChange={(e) => { change({ ...current, [field]: e.target.value }) }} /></label>)}
        <label>规划时长（秒）<input aria-label="规划时长（秒）" type="number" min="0.5" max="30" step="0.5" value={current.durationSec}
          onChange={(e) => { change({ ...current, durationSec: Number(e.target.value) }) }} /></label>
        <div><h3>对白分配</h3><p>保留原文与来源行；此处未核验语音时序。</p>
          {planningScene?.dialogues.map(d => <label key={d.sourceLineId} className={css.dialogue}>{d.character}：{d.line}
            <select aria-label={`分配对白 ${d.character} ${d.line}`} value={local.shots.findIndex(s => s.dialogueLineIds.includes(d.sourceLineId))}
              disabled={local.shotIds.length > 0} onChange={(e) => {
                const target = Number(e.target.value)
                update({ ...local, dirty: true, shots: local.shots.map((s, i) => ({ ...s,
                  dialogueLineIds: [...s.dialogueLineIds.filter(id => id !== d.sourceLineId),
                    ...(i === target ? [d.sourceLineId] : [])] })) })
              }}>{local.shots.map((_, i) => <option key={i} value={i}>镜头 {i + 1}</option>)}</select></label>)}
        </div>
        {!local.shotIds.length && <button type="button" disabled={local.shots.length >= 8} onClick={() => {
          update({ ...local, shots: [...local.shots, { title: `镜头 ${local.shots.length + 1}`,
            narrative: '', visual: '', action: '', durationSec: 3, dialogueLineIds: [] }], dirty: true })
        }}>增加镜头（最多 8 个）</button>}
        <button type="button" disabled={!local.dirty || local.shots.some(s => !s.title.trim() || s.durationSec < 0.5 || s.durationSec > 30)} onClick={() => { setPreview(true) }}>预览保存影响</button>
      </fieldset>}
      {local?.shotIds[index] && current && <section className={css.proposal} aria-label="演练建议（非模型生成）">
        <header><div><small>Harness/DSh · replay-only · 非模型生成</small><h3>演练建议（非模型生成）</h3></div>
          <button type="button" disabled={proposalBusy || busy || Boolean(local.pending) || local.dirty
          || directorSessionId === undefined || directorStatus !== 'current'}
          onClick={() => { void requestProposal() }}>{proposalBusy ? '正在读取…' : '读取演练建议'}</button></header>
        <p>建议只作创意参考，尚未成为正式质检、参考选择、Ready 或人工决定。人工编辑始终可用。</p>
        {local.dirty && proposal === null && <p>请先保存或恢复当前草稿，再基于同一来源版本读取建议。</p>}
        {proposal?.stale && <p role="alert">来源已变化，这份建议已过期，不能采用。请保存或恢复后重新读取。</p>}
        {proposal?.items.filter(item => !ignoredProposalItems.includes(item.id)).map(item =>
          <article key={item.id} className={css.proposalCard}>
            <dl><dt>原值</dt><dd>{String(item.originalValue) || '（空）'}</dd>
              <dt>演练建议</dt><dd>{String(item.proposedValue) || '（空）'}</dd>
              <dt>影响</dt><dd>{item.impact}</dd></dl>
            <div className={css.actions}>
              <button type="button" disabled={proposal.stale || adoptedProposalItems.includes(item.id)
                || adoptedPaidItems.length > 0}
              onClick={() => { adoptProposalItem(item) }}>{adoptedProposalItems.includes(item.id) ? '已放入草稿' : '采用到草稿'}</button>
              <button type="button" disabled={adoptedProposalItems.includes(item.id)}
                onClick={() => { setIgnoredProposalItems(items => [...new Set([...items, item.id])]) }}>忽略</button>
            </div>
          </article>)}
        {adoptedProposalItems.length > 0 && <button type="button" onClick={() => {
          clearProposal()
          setError('已保留当前文字并转为人工草稿；后续保存不再沿用这份 replay 建议证明。')
        }}>保留文字，转为人工草稿</button>}
        {proposal && <details><summary>方法、演练声明与 SHA</summary><pre>{JSON.stringify({
          proposalId: proposal.proposalId, execution: proposal.execution, sourceTime: proposal.sourceTime,
          inputSha256: proposal.inputSha256, outputSha256: proposal.outputSha256,
          proposalSha256: proposal.proposalSha256, workOrder: proposal.workOrder,
          methodPackageSha256: proposal.methodPackage.methodPackageSha256,
        }, null, 2)}</pre></details>}
      </section>}
      {local?.shotIds[index] && current && <section className={css.proposal} aria-label="真实 DeepSeek 导演建议（Provider 生成）">
        <header><div><small>真实 Provider · DeepSeek · 纯文本 · 付费</small><h3>真实 DeepSeek 导演建议（Provider 生成）</h3></div>
          <button type="button" disabled={!paidAvailability?.enabled || paidBusy || busy || Boolean(local.pending)
          || local.dirty || directorStatus !== 'current'} onClick={() => { void requestPaidProposal() }}>
            {paidBusy ? '正在等待真实 Provider…' : '请求真实 DeepSeek 导演建议（会产生费用）'}
          </button></header>
        <p>与上方 replay 演练严格分开、来源不互冒。结果默认只作建议展示；你可逐项采用到草稿，
          保存时走与演练建议相同的新鲜度校验和正式保存链，并按「真实 Provider 来源」记录。
          不自动写草稿，不创建 PromptIR、媒体、正式质检、Ready 或人工决定。</p>
        {!paidAvailability?.enabled && <p role="status">当前项目 / 集未启用真实 DeepSeek 导演建议；默认关闭。</p>}
        {paidAvailability?.enabled && <dl><dt>模型</dt><dd>{paidAvailability.model}</dd>
          <dt>单次授权上限</dt><dd>¥{paidAvailability.maxPaidCny}</dd>
          <dt>请求边界</dt><dd>{paidAvailability.maxInputTokens} 输入 / {paidAvailability.maxOutputTokens} 输出 token；最多 1 次；0 重试</dd></dl>}
        {visiblePaidWorkOrder && <dl><dt>本次预估</dt><dd>¥{visiblePaidWorkOrder.pricingSnapshot.estimatedAmountCny}</dd>
          <dt>任务状态</dt><dd>{visiblePaidStatus?.state ?? visiblePaidWorkOrder.dispatchState}</dd>
          <dt>实际账单</dt><dd>{String(objectOf(visiblePaidStatus?.costAccounting)?.actualAmountCny ?? '待 Provider 账单对账')}</dd></dl>}
        {(() => {
          const receipt = objectOf(visiblePaidStatus?.executionReceipt)
          const providerProposal = objectOf(receipt?.proposal)
          const items = Array.isArray(providerProposal?.items) ? providerProposal.items : []
          return items.map((raw, itemIndex) => {
            const item = objectOf(raw)
            if (item === null || typeof item.field !== 'string') return null
            const field = item.field as keyof PlanningShot
            return <article key={typeof item.id === 'string' ? item.id : itemIndex} className={css.proposalCard}>
              <dl><dt>当前原值</dt><dd>{String(current[field] ?? '') || '（空）'}</dd>
                <dt>真实 Provider 建议</dt><dd>{String(item.proposedValue ?? '') || '（空）'}</dd>
                <dt>影响</dt><dd>{String(item.impact ?? '')}</dd></dl>
              <button type="button"
                disabled={busy || paidBusy || !current || adoptedPaidItems.includes(String(item.id))
                  || adoptedProposalItems.length > 0}
                onClick={() => { adoptPaidProposalItem(item) }}>
                {adoptedPaidItems.includes(String(item.id)) ? '已放入草稿' : '采用到草稿'}
              </button>
            </article>
          })
        })()}
        {visiblePaidStatus?.state === 'submission_unknown' && <p role="alert">提交结果未知，已禁止自动重试；请按任务号核对 Provider 与本地账本。</p>}
        {visiblePaidStatus && <details><summary>Provider 回执、usage 与 SHA</summary><pre>{JSON.stringify({
          provider: visiblePaidWorkOrder?.provider, model: visiblePaidWorkOrder?.model,
          workOrderId: visiblePaidWorkOrder?.workOrderId, generationTaskId: visiblePaidWorkOrder?.generationTaskId,
          workOrderSha256: visiblePaidWorkOrder?.workOrderSha256, status: visiblePaidStatus,
        }, null, 2)}</pre></details>}
      </section>}
      {preview && local && <section className={css.notice} aria-label="规划保存预览"><h3>保存影响</h3>
        <p>{local.shotIds.length ? '仅修改当前镜头，生成新的结构快照；旧依赖按现有规则失效。' : `新建 1 个真实场景、${new Set(planningScene?.dialogues.map(d => d.character)).size} 个独立文本人物和 ${local.shots.length} 个规划镜头。不同场景的同名人物不会静默合并。`}</p>
        {(local.shotIds.length ? [index] : local.shots.map((_, i) => i)).map(i => <article key={i}>
          <h4>{local.shots[i]?.title}</h4><p>{(Object.keys(labels) as (keyof typeof labels)[]).map(k =>
            `${labels[k]}：${state?.planning?.shots[i]?.[k] ?? '（无）'} → ${local.shots[i]?.[k] || '（未填写）'}`).join('\n')}</p>
          <p>时长：{local.shots[i]?.durationSec} 秒；对白：{local.shots[i]?.dialogueLineIds.length} 行</p></article>)}
        <p>不改原剧本，不创建 PromptIR、参考图、Take、制作任务或批准。结构 Ready 不代表内容已审。</p>
        <button type="button" className={css.primary} disabled={busy} onClick={() => { void run(false) }}>确认保存规划</button>
      </section>}
      {receipt && <p role="status">规划已保存 · 结构版本 {receipt.storyboard.version}。参考媒体与 PromptIR 尚未就绪。</p>}
      <details><summary>来源、版本与原回执</summary><pre>{JSON.stringify({ source: state?.planning?.source,
        storyboard: state?.storyboard, receipt, unsubmittedInput: local?.dirty ? local.shots : undefined }, null, 2)}</pre></details>
      {retained && <details><summary>冲突输入副本 · 仅本浏览器，未提交</summary><pre>{JSON.stringify(retained.shots, null, 2)}</pre></details>}
    </main>
    <aside className={css.properties}>
      <details open><summary>导演助理连接</summary>
        <p role="status">{directorSessionId === undefined
          ? '未选择 DSh 会话；人工编辑与保存仍可用。'
          : directorStatus === 'current' ? '已绑定当前镜头上下文 · replay-only'
            : directorStatus === 'connecting' ? '正在核对当前镜头上下文…'
              : directorStatus === 'drifted' ? '来源已漂移；旧建议不能采用。人工草稿已保留。'
                : '导演助理暂不可用；人工编辑与保存不受影响。'}</p>
        <dl><dt>项目 / 集</dt><dd>{projectId} / {episodeId}</dd>
          <dt>场景 / 镜头</dt><dd>{directorScope ? `${directorScope.sceneId} / ${directorScope.shotId}`
            : canonicalStoryboard ? `自动分镜已建立 · ${canonicalStoryboard.shotCount} 个镜头（旧场景规划不可写；后续动作仍受各自确认/门禁）`
              : '尚未建立真实镜头'}</dd>
          <dt>上下文 SHA</dt><dd>{directorBinding?.binding.contextSnapshotSha256 ?? '尚未绑定'}</dd></dl>
        <p>这里只绑定易梦只读上下文和演练建议，不向浏览器暴露 Host 凭据、Provider payload 或执行许可。</p>
      </details>
      <details open><summary>导演属性与缺口</summary><p>规划对象，不是已审内容。</p>
        <dl><dt>当前镜头</dt><dd>{current?.title ?? '尚未建立'}</dd><dt>分镜结构版本</dt><dd>{state?.storyboard?.version ?? '尚无'}</dd>
          <dt>参考媒体</dt><dd>本入口不创建参考；拍摄条件另行核验</dd><dt>PromptIR</dt><dd>本片不创建有效提示词</dd><dt>对白时序</dt><dd>未核验</dd></dl>
        <p>未提交输入保留在本浏览器；已保存内容和回执由易梦持久化。清空浏览器只可恢复已提交内容。</p></details></aside>
  </section>
}
