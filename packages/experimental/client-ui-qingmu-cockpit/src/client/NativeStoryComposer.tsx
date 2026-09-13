/** Native AI writing produces a reviewable draft for the existing project text-import flow. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { NativeStoryPort, StoryDraftResult } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'
import css from './NativeDirectorComposer.module.css'

interface WritingRequest { sessionId: string; baseline: number; submitted: boolean; sourceKey?: string }
interface CandidateEdit { sessionId: string; baseline: number; resultSeq: number; text: string }
function restoreEdit(key: string): CandidateEdit | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${key}:edited`) ?? 'null')
    if (value && typeof value === 'object' && 'sessionId' in value && typeof value.sessionId === 'string'
      && 'baseline' in value && typeof value.baseline === 'number' && 'resultSeq' in value && typeof value.resultSeq === 'number'
      && 'text' in value && typeof value.text === 'string') return value as CandidateEdit
  } catch { /* The immutable native result remains available if a local edit is unreadable. */ }
  return undefined
}
function restore(key: string): WritingRequest | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (value && typeof value === 'object' && 'sessionId' in value && typeof value.sessionId === 'string'
      && 'baseline' in value && typeof value.baseline === 'number' && 'submitted' in value && typeof value.submitted === 'boolean') return value as WritingRequest
  } catch { /* A malformed browser entry cannot identify a native writing request. */ }
  return undefined
}

/**
 * Keep each episode's writing session separate and let its owner adopt the completed text.
 * @param props Current project source and settings; adoption edits text, not the saved script.
 * @returns A native writing control with recovery from the original durable session.
 */
export function NativeStoryComposer({ port, projectId, episodeId, source, settings, disabled, onAdopt, purpose, inspectCandidate }: {
  readonly purpose?: {
    readonly key: string
    readonly jsonOutput?: boolean
    readonly title: string
    readonly description: string
    readonly prompt: string
    readonly action: string
    readonly adopt: string
    readonly adopted: string
    /** Complete current source replaces prior candidate history for a new revision. */
    readonly freshRevision?: boolean
    /** Locally captured source used to detect edits while authoring or after reload. */
    readonly sourceKey?: string
  }
  readonly port: NativeStoryPort
  readonly projectId: string
  readonly episodeId: string
  readonly source: string
  readonly settings: string
  readonly disabled: boolean
  readonly onAdopt: (text: string) => void | Promise<void>
  /** Local candidate inspection; does not submit or adopt the draft. */
  readonly inspectCandidate?: (text: string) => ReactNode
}) {
  const key = `qingmu.${purpose?.key ?? 'story'}-session.v1:${projectId}:${episodeId}`
  const [request, setRequest] = useState(() => restore(key))
  const [edited, setEdited] = useState(() => restoreEdit(key))
  const [result, setResult] = useState<StoryDraftResult>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const editorId = useId()
  const mounted = useRef(true), lock = useRef(false)
  const editing = edited && request && result?.finished && !result.error
    && edited.sessionId === request.sessionId && edited.baseline === request.baseline && edited.resultSeq === result.lastSeq
    ? edited : undefined
  const persist = (value: WritingRequest) => { localStorage.setItem(key, JSON.stringify(value)); setRequest(value) }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!request?.submitted) return
    let live = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const next = await port.read(request.sessionId, request.baseline)
        if (!live) return
        setResult(next)
        if (!next.finished) timer = setTimeout(() => { void read() }, 6000)
      } catch (error) { if (live) setNotice(`进展暂未读回，原请求保留。${error instanceof Error ? error.message : ''}`) }
    }
    void read()
    return () => { live = false; clearTimeout(timer) }
  }, [port, request])
  async function send(revise = false) {
    if (disabled || lock.current || !source.trim() || (request?.submitted && !result?.finished)) return
    lock.current = true; setBusy(true); setNotice('')
    try {
      const current = request && !(purpose?.freshRevision && result?.finished)
        ? request : { sessionId: `session-${crypto.randomUUID()}`, baseline: -1, submitted: false }
      persist(current)
      await port.prepare(current.sessionId)
      const previous = await port.read(current.sessionId, -1)
      if (!mounted.current) return
      if (previous.running) { persist({ ...current, submitted: true }); setNotice('原创作仍在运行，正在读取进展。'); return }
      const next = { ...current, baseline: previous.lastSeq, submitted: true,
        ...(purpose?.sourceKey !== undefined ? { sourceKey: purpose.sourceKey } : {}) }
      persist(next); setResult(undefined)
      const prompt = purpose?.prompt ?? `为青木当前项目写出完整可拍摄的中文短剧。项目：${projectId}，剧集：${episodeId}。本次文字是当前创作依据，不读取其他项目或镜头。\n创作设定：${settings}\n创作原点或现有稿：\n${source}\n请实际读取 cinematic-director、open-film-writer 及其必要写作参考，先理解人物目标、因果与关系变化，再完成自然对白和可见行动；不要只返回大纲或计划。完整剧本单独放在一个 txt 代码块，格式为“场景一：地点·时间”“动作：具体动作”“姓名：台词”，每项各占一行。理解剧情不可缺少的年代、人物关系和世界例外必须落实到正文中可见或可听的事实；人物表、导演阐述和时长估算放在代码块外。交稿前从正文检查关键道具的持有、位置、连接与运行状态，以及行动前提和结果；发现矛盾先修正文，允许有据可循的省略剪辑。遵守本项目已选风格和时长。新构思由你提出供用户采用；不要改动现有正式剧本或媒体，不声称用户已审看。`
      const revision = revise && result?.finished && !result.error
        ? `\n以下是上一份完整候选稿，只是待修订的提案，不能覆盖上面的当前正式来源和本次要求。对照当前来源与本次要求逐项检查并改进它，保留有效的丰富设计，修正全部相关出现处；不要把候选稿的自我评价当成通过证明。新稿仍按上面的输出格式完整交付，不只列修改建议。已有布局未明确更新时，文字与机位沿用当前布局；确需修改，提交完整且相容的布局与取景对象。图像引用按真实 assetId 与 SHA 核对，同图的多个用途合并在一条引用内；不虚构或重复引用。\n<previous_candidate>\n${editing ? `这是操作者编辑后的候选正文，仍须按当前来源核对。\n${editing.text}` : result.text}\n</previous_candidate>` : ''
      await port.send(current.sessionId, `本次工作阶段：${purpose?.title ?? '整集编剧'}。入口已提供本次来源，输出供本页采用的候选正文；已有镜头资料以本次来源为准；当前会话无需单镜绑定，不调用镜头写入工具。需要核对当前已保存素材或参考图时，用 qingmu_read_asset_design 读取本集设计和本项目图片目录，先查看返回的当前引用像素与用途，再按需用 qingmu_view_reference_image 查看其他图像。已有图片的空间、结构与设计文字冲突时，明确可见事实和不可见部分，协调本次设计，不凭文字声称图像已遵守。图片引用需保留实际 assetId/SHA 和具体用途。只有完成本页采用与保存后才成为项目正式内容。\n${prompt}${revision}`,
        { projectId, episodeId, purpose: purpose?.key ?? 'story' })
      setNotice('青木已开始创作。你可以离开此页，回来继续查看原结果。')
    } catch (error) {
      if (mounted.current) setNotice(`本次发送或读取未获确认，请先读取原结果，避免重复调用。${error instanceof Error ? error.message : ''}`)
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const pending = request?.submitted === true && !result?.finished
  const jsonBlocks = purpose?.jsonOutput && result?.finished && !result.error
    ? [...result.text.matchAll(/```json\s*\n([\s\S]*?)```/gi)] : []
  const originalText = result?.script || (jsonBlocks.length === 1 ? jsonBlocks[0]?.[1]?.trim() : '')
  const adoptable = editing?.text ?? originalText
  function editCandidate(text: string) {
    if (!request || !result?.finished || result.error) return
    const value = { sessionId: request.sessionId, baseline: request.baseline, resultSeq: result.lastSeq, text }
    localStorage.setItem(`${key}:edited`, JSON.stringify(value)); setEdited(value)
  }
  async function adoptResult(text: string) {
    if (disabled || lock.current) return
    lock.current = true; setBusy(true)
    try {
      if (request?.sourceKey !== undefined && purpose?.sourceKey !== request.sourceKey) {
        throw new Error('创作依据或本页设计已改变，原结果保留；请根据当前内容重新设计后采用。')
      }
      await onAdopt(text)
      if (mounted.current) setNotice(purpose?.adopted ?? '已放入剧本文字。可继续修改，解析后保存为本集剧本。')
    } catch (error) {
      if (mounted.current) setNotice(`没有采用：${error instanceof Error ? error.message : String(error)}`)
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  return <section className={css.composer} aria-label={purpose?.title ?? 'AI 编剧'}>
    <h4>{purpose?.title ?? '让青木写剧本'}</h4>
    <p>{purpose?.description ?? '把故事想法或修改要求写在下方，青木会调用编剧与导演方法，给出一份可编辑的完整稿。'}</p>
    <button type="button" disabled={disabled || busy || pending || !source.trim()} onClick={() => { void send() }}>
      {busy || pending ? '创作处理中…' : purpose?.action ?? (result?.finished ? '根据当前文字重新写作' : '用当前文字创作剧本')}
    </button>
    {purpose?.freshRevision && result?.finished && !result.error && result.text
      && <button type="button" disabled={disabled || busy || pending || !source.trim()} onClick={() => { void send(true) }}>按当前要求改进上稿</button>}
    {request && <button type="button" disabled={busy} onClick={() => { setRequest({ ...request }); setNotice('正在读取原创作结果。') }}>读取原创作结果</button>}
    {notice && <p role="status">{notice}</p>}
    {result?.error && <p role="alert">创作未完成：{result.error}</p>}
    {adoptable && purpose?.sourceKey !== undefined && request?.sourceKey === undefined
      && <p>这份旧稿没有记录当时的完整来源，请核对当前设定后再采用；重新设计会使用当前来源。</p>}
    {result?.text && <details open={!purpose}><summary>{purpose ? '查看完整设计文字' : '编剧完整稿'}</summary><pre>{result.text}</pre></details>}
    {originalText && !editing && <button type="button" disabled={disabled || busy}
      onClick={() => { editCandidate(originalText) }}>编辑这份候选</button>}
    {editing && <div>
      <label htmlFor={editorId}>候选正文</label>
      <textarea id={editorId} rows={16} value={editing.text} disabled={disabled || busy}
        onChange={(event) => { editCandidate(event.target.value) }} />
      <p>这是本机编辑稿，原生生成结果仍保留。采用时继续核对来源和内容，尚未保存到项目。</p>
      <button type="button" disabled={disabled || busy} onClick={() => { localStorage.removeItem(`${key}:edited`); setEdited(undefined) }}>恢复原生候选</button>
    </div>}
    {result?.finished && !result.error && adoptable && inspectCandidate?.(adoptable)}
    {adoptable && <button type="button" disabled={disabled || busy} onClick={() => {
      void adoptResult(adoptable)
    }}>{purpose?.adopt ?? '采用到剧本文字'}</button>}
    {result?.finished && !result.error && !adoptable && <p>这次返回缺少可采用的独立正文块。完整文字已保留，可修正后导入。</p>}
  </section>
}
