/** Native AI writing produces a reviewable draft for the existing project text-import flow. */
import { useEffect, useRef, useState } from 'react'
import type { NativeStoryPort, StoryDraftResult } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'
import css from './NativeDirectorComposer.module.css'

interface WritingRequest { sessionId: string; baseline: number; submitted: boolean }
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
export function NativeStoryComposer({ port, projectId, episodeId, source, settings, disabled, onAdopt }: {
  readonly port: NativeStoryPort
  readonly projectId: string
  readonly episodeId: string
  readonly source: string
  readonly settings: string
  readonly disabled: boolean
  readonly onAdopt: (text: string) => void
}) {
  const key = `qingmu.story-session.v1:${projectId}:${episodeId}`
  const [request, setRequest] = useState(() => restore(key))
  const [result, setResult] = useState<StoryDraftResult>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const mounted = useRef(true), lock = useRef(false)
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
  async function send() {
    if (disabled || lock.current || !source.trim() || (request?.submitted && !result?.finished)) return
    lock.current = true; setBusy(true); setNotice('')
    try {
      const current = request ?? { sessionId: `session-${crypto.randomUUID()}`, baseline: -1, submitted: false }
      persist(current)
      await port.prepare(current.sessionId)
      const previous = await port.read(current.sessionId, -1)
      if (!mounted.current) return
      if (previous.running) { persist({ ...current, submitted: true }); setNotice('原编剧仍在运行，正在读取进展。'); return }
      const next = { ...current, baseline: previous.lastSeq, submitted: true }
      persist(next); setResult(undefined)
      await port.send(current.sessionId, `为青木当前项目写出完整可拍摄的中文短剧。项目：${projectId}，剧集：${episodeId}。本次文字是当前创作依据，不读取其他项目或镜头。\n创作设定：${settings}\n创作原点或现有稿：\n${source}\n请实际读取 cinematic-director、open-film-writer 及其必要写作参考，先理解人物目标、因果与关系变化，再完成自然对白和可见行动；不要只返回大纲或计划。完整剧本单独放在一个 txt 代码块，格式为“场景一：地点·时间”“动作：具体动作”“姓名：台词”，每项各占一行。人物表、导演阐述和时长安排放在代码块外。遵守本项目已选风格和时长。新构思由你提出供用户采用；不要改动现有正式剧本或媒体，不声称用户已审看。`)
      setNotice('青木编剧已开始。你可以离开此页，回来继续查看原结果。')
    } catch (error) {
      if (mounted.current) setNotice(`本次发送或读取未获确认，请先读取原结果，避免重复调用。${error instanceof Error ? error.message : ''}`)
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const pending = request?.submitted === true && !result?.finished
  return <section className={css.composer} aria-label="AI 编剧">
    <h4>让青木写剧本</h4>
    <p>把故事想法或修改要求写在下方，青木会调用编剧与导演方法，给出一份可编辑的完整稿。</p>
    <button type="button" disabled={disabled || busy || pending || !source.trim()} onClick={() => { void send() }}>
      {busy || pending ? '编剧处理中…' : result?.finished ? '根据当前文字重新写作' : '用当前文字创作剧本'}
    </button>
    {request && <button type="button" disabled={busy} onClick={() => { setRequest({ ...request }); setNotice('正在读取原编剧结果。') }}>读取原编剧结果</button>}
    {notice && <p role="status">{notice}</p>}
    {result?.error && <p role="alert">编剧未完成：{result.error}</p>}
    {result?.text && <details open><summary>编剧完整稿</summary><pre>{result.text}</pre></details>}
    {result?.script && <button type="button" disabled={disabled || busy} onClick={() => {
      onAdopt(result.script); setNotice('已放入剧本文字。可继续修改，解析后保存为本集剧本。')
    }}>采用到剧本文字</button>}
    {result?.finished && !result.error && !result.script && <p>这次返回没有独立剧本块。可将需要的正文复制到下方，再解析保存。</p>}
  </section>
}
