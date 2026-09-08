import { useEffect, useRef, useState } from 'react'
import type {
  CreationScope, CreativeContractState, ProjectInitializationRequest, ProjectInitializationResult, TextImportDraft,
  TextImportState, TextImportRequest,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import css from './CreationWorkspace.module.css'

type Port = Pick<QingmuYimengPort, 'readCreativeContract' | 'initializeProject' | 'recoverProjectInitialization' | 'readTextImport' | 'createTextImport' | 'correctTextImport' | 'confirmTextImport'>
const NEW_PROJECT = 'qingmu.creation.project.v1'
const LABELS = { scene: '场景', action: '动作', dialogue: '对白', narration: '旁白', transition: '转场', skip: '忽略' }
const errorText = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  if (/401|token|未登录|authentication/.test(message)) return '本地会话已过期。请运行 qingmu-local.py login，重新进入后读取恢复；输入已保留。'
  if (/403|forbidden/.test(message)) return '当前身份无权操作这个项目。输入已保留，请检查登录身份。'
  if (/409|conflict|stale|superseded/.test(message)) return '来源或版本已变化，本次操作未获确认。输入已保留，请读取最新结果后检查。'
  return `未能确认结果，输入已保留。请先“读取恢复”，不要另开同一请求。${message}`
}
function readLocal(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as unknown } catch { return null }
}
function displayText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : '[不支持的文本字段]'
}
function saveLocal(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}
async function digest(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('')
}
function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0))
}
interface ProjectLocal {
  name: string
  aspectRatio: ProjectInitializationRequest['aspectRatio']
  creationType: ProjectInitializationRequest['creationType']
  episodeCount: number
  duration: string
  textInput: string
  intent?: ProjectInitializationRequest
}
const DEFAULT_PROJECT: ProjectLocal = {
  name: '', aspectRatio: '9:16', creationType: 'story_idea', episodeCount: 1,
  duration: '1-2分钟', textInput: '',
}
function normalizeProjectLocal(value: unknown): ProjectLocal {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_PROJECT
  const raw = value as Record<string, unknown>
  const aspectRatio = ['9:16', '16:9', '1:1'].includes(String(raw.aspectRatio))
    ? raw.aspectRatio as ProjectLocal['aspectRatio'] : DEFAULT_PROJECT.aspectRatio
  const creationType = ['story_idea', 'novel_adapt', 'script_adapt', 'original_script'].includes(String(raw.creationType))
    ? raw.creationType as ProjectLocal['creationType'] : DEFAULT_PROJECT.creationType
  const episodeCount = typeof raw.episodeCount === 'number' && Number.isSafeInteger(raw.episodeCount)
    && raw.episodeCount >= 1 && raw.episodeCount <= 30 ? raw.episodeCount : DEFAULT_PROJECT.episodeCount
  const base: ProjectLocal = {
    name: typeof raw.name === 'string' ? raw.name.slice(0, 100) : '',
    aspectRatio, creationType, episodeCount,
    duration: typeof raw.duration === 'string' ? raw.duration.slice(0, 32) : DEFAULT_PROJECT.duration,
    textInput: typeof raw.textInput === 'string' ? raw.textInput.slice(0, 64000) : '',
  }
  const candidate = raw.intent
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return base
  const intent = candidate as Record<string, unknown>
  if (typeof intent.name !== 'string' || typeof intent.style !== 'string'
    || !['9:16', '16:9', '1:1'].includes(String(intent.aspectRatio)) || intent.mode !== 'whole_series'
    || !['story_idea', 'novel_adapt', 'script_adapt', 'original_script'].includes(String(intent.creationType))
    || typeof intent.episodeCount !== 'number' || !Number.isSafeInteger(intent.episodeCount)
    || typeof intent.duration !== 'string' || typeof intent.textInput !== 'string'
    || (intent.stylePackId !== null && typeof intent.stylePackId !== 'string')
    || typeof intent.idempotencyKey !== 'string') return base
  return { ...base, intent: intent as unknown as ProjectInitializationRequest }
}

/** Empty-state entry; only the server receipt decides which project was created. */
export function CreateProjectWorkspace({ port, onCreated, onCancel }: {
  readonly port: Port
  readonly onCreated: (result: ProjectInitializationResult) => Promise<void>
  readonly onCancel?: (() => void) | undefined
}) {
  const [local, setLocal] = useState<ProjectLocal>(() => normalizeProjectLocal(readLocal(NEW_PROJECT)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retryAllowed, setRetryAllowed] = useState(false)
  const lock = useRef(false)
  const update = (next: ProjectLocal) => {
    try { saveLocal(NEW_PROJECT, next); setLocal(next) } catch { setError('浏览器无法保存恢复标记，请允许本地存储后再创建。') }
  }
  const finish = async (result: ProjectInitializationResult) => {
    await onCreated(result)
    localStorage.removeItem(NEW_PROJECT)
  }
  const run = async (recover: boolean) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const intent = local.intent ?? {
        name: local.name.trim(), style: 'realistic', aspectRatio: local.aspectRatio,
        mode: 'whole_series' as const, creationType: local.creationType, episodeCount: local.episodeCount,
        duration: local.duration.trim(), textInput: local.textInput.trim(), stylePackId: null,
        idempotencyKey: crypto.randomUUID(),
      }
      if (!recover) {
        saveLocal(NEW_PROJECT, { ...local, intent }); setLocal({ ...local, intent })
        await finish(await port.initializeProject(intent))
      } else {
        // Matches the canonical sorted request keys used by the Host and API.
        const requestSha256 = await digest(new TextEncoder().encode(JSON.stringify({
          aspectRatio: intent.aspectRatio, creationType: intent.creationType, duration: intent.duration,
          episodeCount: intent.episodeCount, mode: intent.mode, name: intent.name, style: intent.style,
          stylePackId: intent.stylePackId, textInput: intent.textInput,
        })))
        await finish(await port.recoverProjectInitialization({ idempotencyKey: intent.idempotencyKey, requestSha256 }))
      }
    } catch (cause) {
      setError(errorText(cause))
      if (recover && /404|bootstrap_receipt_not_found/.test(String(cause))) {
        setRetryAllowed(true)
        setError('服务端尚未找到这个创建意图。可重试同一请求；即使原请求随后完成，也只会保留一个项目。')
      }
    } finally { lock.current = false; setBusy(false) }
  }
  return <section className={css.workspace} aria-label="新建创作项目">
    <header><span className={css.eyebrow}>唯一创作入口</span><h3>先锁定故事与创作设定</h3>
      <p>输入故事、类型和画面设定，原子创建项目与首集，并保存不可变创作合同。不会调用模型、生成媒体或启动制作。</p></header>
    <label>项目名称<input autoFocus maxLength={100} value={local.name} disabled={busy || local.intent !== undefined}
      onChange={(event) => { update({ ...local, name: event.target.value }) }} placeholder="例如：雨夜来信" /></label>
    <label>故事 / 创作原点<textarea rows={6} maxLength={64000} value={local.textInput} disabled={busy || local.intent !== undefined}
      onChange={(event) => { update({ ...local, textInput: event.target.value }) }}
      placeholder="写下故事梗概、人物关系或已有剧本正文。该输入的 SHA 会进入创作合同。" /></label>
    <details open><summary>创作设定</summary><p>画风：写实。方法版本和来源 SHA 由易梦写入创作合同；这里不激活 Provider。</p>
      <label>创作类型<select value={local.creationType} disabled={busy || local.intent !== undefined}
        onChange={(event) => { update({ ...local, creationType: event.target.value as ProjectLocal['creationType'] }) }}>
        <option value="story_idea">故事创意</option><option value="novel_adapt">小说改编</option>
        <option value="script_adapt">剧本改编</option><option value="original_script">原创剧本</option>
      </select></label>
      <label>画幅<select value={local.aspectRatio} disabled={busy || local.intent !== undefined}
        onChange={(event) => { update({ ...local, aspectRatio: event.target.value as ProjectLocal['aspectRatio'] }) }}>
        <option value="9:16">竖屏 9:16</option><option value="16:9">横屏 16:9</option><option value="1:1">方形 1:1</option>
      </select></label>
      <label>计划集数<input type="number" min={1} max={30} value={local.episodeCount} disabled={busy || local.intent !== undefined}
        onChange={(event) => { update({ ...local, episodeCount: Number(event.target.value) }) }} /></label>
      <label>单集时长<input maxLength={32} value={local.duration} disabled={busy || local.intent !== undefined}
        onChange={(event) => { update({ ...local, duration: event.target.value }) }} placeholder="例如：1-2分钟" /></label>
    </details>
    {error !== '' && <p role="alert" className={css.notice}>{error}</p>}
    {local.intent !== undefined && <p role="status">保留了本次创建意图。先读取服务端回执，不按项目名称猜测结果。</p>}
    <div className={css.actions}>
      <button className={css.primary} disabled={busy || local.name.trim() === '' || local.textInput.trim() === ''
        || local.duration.trim() === '' || local.episodeCount < 1 || local.episodeCount > 30
        || (local.intent !== undefined && !retryAllowed)} onClick={() => { void run(false) }}>
        {busy ? '正在确认…' : retryAllowed ? '重试同一创建请求' : '新建项目与第 1 集'}</button>
      {local.intent !== undefined && <button disabled={busy} onClick={() => { void run(true) }}>读取创建恢复</button>}
      {onCancel !== undefined && <button disabled={busy} onClick={onCancel}>返回项目</button>}
    </div>
  </section>
}

interface ImportLocal {
  text: string
  filename: string
  rawBase64?: string | undefined
  pending?: { kind: 'create'; request: TextImportRequest } | { kind: 'confirm' | 'correct'; draftId: string } | undefined
  speakers: Record<string, string>
}
const EMPTY: ImportLocal = { text: '', filename: '粘贴剧本.txt', speakers: {} }

/** Human-readable canonical TextImportService preview, correction and explicit save. */
export function TextImportWorkspace({ port, projectId, episodeId, onSaved }: CreationScope & {
  readonly port: Port
  readonly onSaved: () => Promise<void>
}) {
  const cacheKey = `qingmu.creation.text.v1:${projectId}:${episodeId}`
  const [local, setLocal] = useState<ImportLocal>(() => readLocal(cacheKey) as ImportLocal | null ?? EMPTY)
  const [state, setState] = useState<TextImportState>()
  const [contract, setContract] = useState<CreativeContractState>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState(0)
  const [episodeIndex, setEpisodeIndex] = useState(1)
  const [retryAllowed, setRetryAllowed] = useState(false)
  const lock = useRef(false)
  const live = useRef(local)
  const mounted = useRef(true)
  const persist = (next: ImportLocal) => { saveLocal(cacheKey, next); live.current = next; setLocal(next) }
  const load = async () => {
    const pending = live.current.pending
    const result = await port.readTextImport({ projectId, episodeId,
      ...(pending?.kind === 'create' ? { intentKey: pending.request.idempotencyKey } : pending === undefined ? {} : { draftId: pending.draftId }) })
    if (!mounted.current) return
    setState(result)
    if (pending?.kind === 'create' && result.draft?.status === 'draft' && !result.draftActive) {
      setRetryAllowed(true)
      setNotice('原草稿已落盘，但创建索引未完成。可显式重试同一导入意图；不会覆盖较新草稿。')
    } else if (pending !== undefined && result.draft !== null) {
      persist({ ...live.current, pending: undefined })
      setNotice('已从易梦读回原草稿与当前剧本；没有重发写入。请检查状态后继续。')
    } else if (pending !== undefined) {
      setRetryAllowed(pending.kind === 'create')
      setNotice('尚未找到本次导入。保留原输入，可显式重试同一导入意图。')
    }
  }
  useEffect(() => {
    mounted.current = true
    void Promise.all([load(), port.readCreativeContract({ projectId }).then((value) => {
      if (mounted.current) {
        setContract(value)
        if (value.configured && value.sourceText !== null && live.current.text.trim() === ''
          && live.current.pending === undefined) {
          persist({ ...live.current, text: value.sourceText, filename: '创作入口剧本.txt', rawBase64: undefined })
          setNotice('已沿用唯一创作入口的原文；无需重复粘贴。请检查解析后再确认保存。')
        }
      }
    })])
      .catch((cause: unknown) => { if (mounted.current) setError(errorText(cause)) })
    return () => { mounted.current = false }
  // A keyed workspace owns one canonical scope for its whole lifetime.
  }, [projectId, episodeId])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (live.current.text !== '' || live.current.pending !== undefined) event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => { window.removeEventListener('beforeunload', guard) }
  }, [])
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await operation() } catch (cause) { if (mounted.current) setError(errorText(cause)) }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const update = (next: ImportLocal) => {
    try { persist(next) } catch { setError('本地恢复存储不可用；请先复制文字，勿关闭页面。') }
  }
  const create = async () => {
    if (state === undefined) throw new Error('先读取当前剧集')
    const bytes = local.rawBase64 === undefined ? new TextEncoder().encode(local.text) : decode(local.rawBase64)
    if (bytes.length === 0 || bytes.length > 131072 || local.text.length > 64000 || local.text.split(/\r?\n/).length > 1000) throw new Error('最多 128 KiB、64000 字、1000 行 UTF-8 文本')
    const request: TextImportRequest = local.pending?.kind === 'create' ? local.pending.request : {
      projectId, episodeId, filename: local.filename, contentBase64: base64(bytes), inputSha256: await digest(bytes),
      expectedScriptRevision: state.scriptRevision, idempotencyKey: crypto.randomUUID(),
    }
    persist({ ...local, pending: { kind: 'create', request } })
    setRetryAllowed(false)
    const result = await port.createTextImport(request)
    if (!mounted.current) return
    setState({ ...state, draft: result, draftActive: true }); setPage(0)
    persist({ ...live.current, pending: undefined, speakers: {} })
    setNotice('解析草稿已保存到易梦。检查下方场景、动作和说话人后，再确认写入剧本。')
  }
  const correct = async (draft: TextImportDraft, lineId: string, type: 'setSpeaker' | 'reclassify', value: string) => {
    persist({ ...local, pending: { kind: 'correct', draftId: draft.id } })
    const result = await port.correctTextImport({
      projectId, episodeId, draftId: draft.id, expectedFingerprint: draft.fingerprint, lineId, type, value,
    })
    if (!mounted.current) return
    setState(previous => previous === undefined ? previous : { ...previous, draft: result })
    const speakers = Object.fromEntries(Object.entries(live.current.speakers).filter(([key]) => key !== lineId))
    persist({ ...live.current, pending: undefined, speakers })
    setNotice('解析校正已保存；尚未写入剧本。')
  }
  const confirm = async (draft: TextImportDraft) => {
    persist({ ...local, pending: { kind: 'confirm', draftId: draft.id } })
    await port.confirmTextImport({ projectId, episodeId, draftId: draft.id, expectedFingerprint: draft.fingerprint,
      expectedScriptRevision: draft.baseScriptRevision, episodeIndex })
    await load()
    if (!mounted.current) return
    persist({ ...live.current, pending: undefined, text: '', rawBase64: undefined, speakers: {} })
    setNotice('剧本已保存。仅确认文本解析与写入；资产、分镜与媒体尚未生成。')
    await onSaved()
  }
  const upload = async (file: File) => {
    if (!/\.txt$/i.test(file.name) || file.size > 131072) throw new Error('请选择不超过 128 KiB 的 UTF-8 TXT 文件')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (text.length > 64000 || text.split(/\r?\n/).length > 1000) throw new Error('最多 64000 字、1000 行')
    persist({ ...local, text, filename: file.name, rawBase64: base64(bytes) })
    setNotice(`已读取 ${file.name}；尚未提交。编辑文字后将按新的粘贴文本保存来源。`)
  }
  const draft = state?.draft
  const binding = state?.script?.sourceBinding as Record<string, unknown> | undefined
  const savedCurrent = draft != null && binding?.draftId === draft.id && binding.inputSha256 === draft.input.sha256
    && (binding.draftFingerprint === draft.fingerprint || binding.draftFingerprint === draft.confirmation?.sourceDraftFingerprint)
    && state !== undefined && binding.baseScriptRevision === state.scriptRevision - 1
  const editable = draft?.status === 'draft' && state?.draftActive && draft.baseScriptRevision === state.scriptRevision && !savedCurrent
  const pending = local.pending !== undefined
  const scenes = state?.script?.scenes
  return <section className={css.workspace} aria-label="剧本导入工作区">
    <section className={css.saved} aria-label="创作设定合同">
      <header><span className={css.eyebrow}>创作设定锁</span><h4>{contract?.configured ? '创作合同已保存' : '创作合同未配置'}</h4></header>
      {contract?.configured && contract.contract !== null ? <>
        <p>版本 {contract.revision} · 已锁定 · 来源 SHA {contract.contract.source.textSha256.slice(0, 12)}…</p>
        <p>类型：{contract.contract.project.creationType} · {contract.contract.project.aspectRatio}
          {' · '}{contract.contract.project.episodeCount} 集 · {contract.contract.project.duration}</p>
        <details><summary>方法版本与完整 SHA</summary><pre>{JSON.stringify({
          contractSha256: contract.sha256, methods: contract.contract.methods,
        }, null, 2)}</pre></details>
      </> : <p role="status">{contract?.message ?? '正在读取创作合同…'}</p>}
      <p>锁定只表示创作来源和方法坐标固定，不代表内容批准、生成授权或人工签收。</p>
    </section>
    <header><span className={css.eyebrow}>第 1 步 · 剧本</span><h3>导入并整理你的剧本</h3>
      <p>粘贴文字或选择 UTF-8 TXT。先检查解析，再明确保存；不会调用模型或开始制作。</p></header>
    <div className={css.columns}>
      <div className={css.editor}>
        <label htmlFor="qingmu-script-text">剧本文字<textarea id="qingmu-script-text" value={local.text} maxLength={64000} disabled={busy || pending}
          onChange={(event) => { update({ ...local, text: event.target.value, filename: '粘贴剧本.txt', rawBase64: undefined }) }}
          placeholder={'场景一：雨夜旧街\n动作：门缓缓打开。\n林夏：请进。'} /></label>
        <small>最多 128 KiB / 64000 字 / 1000 行。未提交文字保留在本浏览器；服务端草稿可跨浏览器恢复。</small>
        <div className={css.actions}><label className={css.file}>导入 TXT<input type="file" accept=".txt,text/plain" disabled={busy || pending}
          onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void run(() => upload(file)); event.target.value = '' }} /></label>
        <button className={css.primary} disabled={busy || state === undefined || local.text.trim() === '' || (pending && (local.pending?.kind !== 'create' || !retryAllowed))}
          onClick={() => { void run(create) }}>{local.pending?.kind === 'create' ? '重试同一导入' : '解析并保存预览草稿'}</button>
        </div>
      </div>
      <aside className={css.help}><h4>输入提示</h4><p>每场戏先写“场景一：地点”，动作与对白各占一行。“林夏：请进。”会识别为对白。</p>
        <p>剧本已有内容时，新导入只生成草稿。确认前会核对当前版本，不能覆盖较新修改。</p>
        <button disabled={busy} onClick={() => { void run(load) }}>读取恢复 / 刷新预览</button>
        {state !== undefined && <p>当前剧本版本：{state.scriptRevision} · {state.script === null ? '尚未保存剧本' : '已有剧本'}</p>}
      </aside>
    </div>
    {error !== '' && <p role="alert" className={css.notice}>{error}</p>}
    {notice !== '' && <p role="status" className={css.notice}>{notice}</p>}
    {pending && <p role="status">有一个结果待核对的操作。切换或重入后请先读取恢复，不会自动重发确认。</p>}
    {retryAllowed && local.pending?.kind === 'create' && state?.draft === null && state.scriptRevision !== local.pending.request.expectedScriptRevision
      && <button disabled={busy} onClick={() => {
        update({ ...local, pending: undefined }); setRetryAllowed(false)
        setNotice('已保留原文字。请检查当前剧本后重新解析；尚未发送新请求。')
      }}>保留文字，按当前版本重新准备</button>}
    {draft != null && <section className={css.preview} aria-label="解析预览">
      <header><h4>解析预览 · {savedCurrent ? '已写入当前剧本' : draft.status === 'stale' ? '已过期' : draft.status === 'confirmed' ? '历史已确认草稿' : '待检查草稿'}</h4>
        <p>{draft.lines.length} 行 · 来源：{draft.input.filename} · 解析修订 {draft.revision}</p></header>
      {draft.lines.slice(page * 20, page * 20 + 20).map(line => <article key={line.id} className={css.line}>
        <label>行类型<select aria-label={`行类型 ${line.id}`} value={line.lineType} disabled={!editable || busy || pending}
          onChange={(event) => { void run(() => correct(draft, line.id, 'reclassify', event.target.value)) }}>
          {Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <p>{line.text || '空行'}</p>
        {(line.lineType === 'dialogue' || line.lineType === 'narration') && <div className={css.speaker}>
          <label>说话人<input aria-label={`说话人 ${line.id}`} maxLength={80} value={local.speakers[line.id] ?? line.speaker ?? ''} disabled={!editable || busy || pending}
            onChange={(event) => { update({ ...local, speakers: { ...local.speakers, [line.id]: event.target.value } }) }} /></label>
          <button disabled={!editable || busy || pending || local.speakers[line.id] === undefined} onClick={() => { void run(() => correct(draft, line.id, 'setSpeaker', local.speakers[line.id] ?? '')) }}>保存校正</button>
        </div>}
      </article>)}
      {draft.lines.length > 20 && <div className={css.actions}>
        <button disabled={page === 0} onClick={() => { setPage(page - 1) }}>上一页</button>
        <span>{page + 1} / {Math.ceil(draft.lines.length / 20)}</span>
        <button disabled={(page + 1) * 20 >= draft.lines.length} onClick={() => { setPage(page + 1) }}>下一页</button>
      </div>}
      {editable && <div className={css.actions}>
        <label>写入本集的解析分集<select value={episodeIndex} disabled={busy || pending}
          onChange={(event) => { setEpisodeIndex(Number(event.target.value)) }}>
          {[...new Set(draft.lines.map(line => line.episodeIndex))].map(index => <option key={index} value={index}>解析第 {index} 集</option>)}
        </select></label>
        <button className={css.primary} disabled={busy || pending || Object.keys(local.speakers).length > 0}
          onClick={() => { void run(() => confirm(draft)) }}>确认导入并保存剧本</button>
        <small>仅确认所选分集的文本解析；不批准内容、制作或媒体。</small>
      </div>}
      <details><summary>来源与恢复信息</summary><pre>{JSON.stringify({
        draftId: draft.id, fingerprint: draft.fingerprint, inputSha256: draft.input.sha256,
        baseScriptRevision: draft.baseScriptRevision, confirmation: draft.confirmation }, null, 2)}</pre></details>
    </section>}
    {Array.isArray(scenes) && <section className={css.saved} aria-label="已保存剧本"><h4>已保存剧本 · 版本 {state?.scriptRevision}</h4>
      {scenes.map((item, index) => {
        const scene = item as Record<string, unknown>
        return <article key={index}><h5>{displayText(scene.title, `场景 ${index + 1}`)}</h5>
          <p>{displayText(scene.actionDescription)}</p>
          {Array.isArray(scene.dialogues) && scene.dialogues.map((value, i) => {
            const dialogue = value as Record<string, unknown>
            return <p key={i}><strong>{displayText(dialogue.character)}：</strong>{displayText(dialogue.line)}</p>
          })}
        </article>
      })}
      <p className={css.notice}>下一步：检查剧本内容，再进入导演台规划。当前尚未生成资产、分镜或 Take；本操作不会自动生成。</p>
    </section>}
  </section>
}
