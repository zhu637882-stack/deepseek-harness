/** Keep the selected shot mounted while sending to the existing native DSH conversation. */
import { useEffect, useRef, useState } from 'react'
import type { NativeDirectorPromptTarget } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { useDirectorConnection, type NativeDirectorSessionPort } from './native-director-session.ts'
import { NativeDialogueProgress } from './NativeDialogueProgress.tsx'
import css from './NativeDirectorComposer.module.css'

const pendingKey = 'qingmu.native-director-unconfirmed.v1'
const unknownNotice = '上次发送结果尚未确认，可能已进入原会话。请核对原会话后再解除发送保护，勿重复发送。'
function retainedRequest(): string {
  try { return sessionStorage.getItem(pendingKey) ?? '' } catch { return '发送状态存储不可用' }
}
function storedDraft(key: string): string {
  try { return (sessionStorage.getItem(key) ?? '').slice(0, 16000) } catch { return '' }
}

/** A user-initiated native turn, not a second provider client or business-write path. */
export function NativeDirectorComposer({ port, sessionId, scopeKey, ready, target, onCommitted }: {
  readonly port: NativeDirectorSessionPort
  readonly sessionId: string | undefined
  readonly scopeKey: string
  readonly ready: boolean
  readonly target?: NativeDirectorPromptTarget | undefined
  readonly onCommitted?: (() => Promise<unknown>) | undefined
}) {
  const connection = useDirectorConnection(port.connection)
  const draftKey = `qingmu.director-text.v1:${sessionId ?? 'unbound'}:${scopeKey}`
  const [draft, setDraft] = useState(() => ({ key: draftKey, text: storedDraft(draftKey) }))
  const text = draft.key === draftKey ? draft.text : storedDraft(draftKey)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [unconfirmed, setUnconfirmed] = useState(retainedRequest)
  const pending = useRef<AbortController>()
  const targetKey = JSON.stringify(target)
  useEffect(() => {
    pending.current?.abort(); pending.current = undefined; setBusy(false)
    const retained = retainedRequest()
    setUnconfirmed(retained); setNotice(retained ? unknownNotice : '')
    return () => { pending.current?.abort() }
  }, [connection, scopeKey, sessionId, port, targetKey])
  async function send() {
    if (!ready || !connection || !sessionId || !target || target.sessionId !== sessionId
      || !text.trim() || pending.current || unconfirmed || retainedRequest()) return
    const record = JSON.stringify({ requestId: crypto.randomUUID(), target, text })
    try { sessionStorage.setItem(pendingKey, record) } catch {
      setNotice('无法保存发送状态，本次没有发送。请检查浏览器存储。'); return
    }
    const request = new AbortController()
    pending.current = request; setBusy(true); setNotice('')
    try {
      await port.prompt(target, text, request.signal)
      if (!request.signal.aborted && pending.current === request) {
        sessionStorage.removeItem(draftKey)
        if (retainedRequest() === record) sessionStorage.removeItem(pendingKey)
        setDraft({ key: draftKey, text: '' })
        setNotice('要求已交给当前导演处理；下面显示实际进展。')
      }
    } catch (error) {
      if (!request.signal.aborted) {
        setUnconfirmed(record)
        setNotice(`${unknownNotice} 要求已保留。${error instanceof Error ? error.message : ''}`)
      }
    } finally {
      if (pending.current === request) { pending.current = undefined; setBusy(false) }
    }
  }
  return <section className={css.composer} aria-label="向当前镜头的导演提要求">
    <button type="button" disabled={busy || !!text.trim()} onClick={() => {
      const next = '请整理当前镜头的视频生成稿。先读取已保存的完整导演设计、剧本、全片风格、前后镜接续依据、引用草稿和实际素材。按 Leos 六部门与本片方法核对叙事、空间、动作时序、运镜、表演、逐句对白语气、光影和声音。已经写好的设计优先用 promptParts 中的 {directorText:"current"} 原样带入，不再全文自由改写；你负责准确说明各引用素材的用途与接续关系。有可核实的冲突才修正原设计，说明依据；估计坐标下的一次机位计算不能证明原镜头不可行，不因此删除导演安排的构图、动作或人物。画面设计与起始图描述均需改变时，用 qingmu_save_director_plan 同步提交 directorPlan.visual 与 imagePromptCn，再读取新来源编译，不能追加另一套文字覆盖旧设计。保留导演安排的换场、时间跳跃、多人对白、画面文字与动作变化，不把局部终态扩大为全程要求。核对声音的制作环节：已决定在剪辑后添加的整片配乐、跨段声桥写入 editorialContext；soundPlan 保留本段原生对白、呼吸、环境与拟音，并说明该后期配乐不在分段视频中生成。剧中有源音乐、歌唱及导演明确选择的原生配乐不能一并删除。整理旧稿时完整保留其配乐意图，不能仅删去音乐段落。保持未要求修改的台词、素材和生成参数。接续已选视频时使用实际抽帧与看图工具；仅有素材信息时明确尚未看过，不能声称观察了画面。保存后读取回执并预览实际请求，报告具体调整与尚未验证处。不要提交视频、选用候选或修改其他镜头。'
      setDraft({ key: draftKey, text: next })
      try { sessionStorage.setItem(draftKey, next) }
      catch { setNotice('要求已填入；浏览器暂时无法保留，离开前请复制。') }
    }}>整理本镜生成稿</button>
    <label>导演要求<textarea aria-label="导演要求" value={text} maxLength={16000} disabled={busy}
      onChange={(event) => {
        const next = event.target.value
        setDraft({ key: draftKey, text: next })
        try {
          if (next) sessionStorage.setItem(draftKey, next)
          else sessionStorage.removeItem(draftKey)
        }
        catch { setNotice('当前文字尚在，但浏览器无法保留草稿；离开前请复制。') }
      }} placeholder="例如：这句台词再自然一点，保留其他镜头。" /></label>
    <button type="button" disabled={!ready || !target || target.sessionId !== sessionId || !connection || !sessionId || busy || !!unconfirmed || !text.trim()}
      onClick={() => { void send() }}>{busy ? '正在发送…' : '发送给当前导演'}</button>
    <p>导演按你的要求处理修改；生成画面的认可仍由你决定。</p>
    {notice && <p role="status">{notice}</p>}
    <NativeDialogueProgress port={port} sessionId={sessionId} target={target} onCommitted={onCommitted} />
    {!!unconfirmed && <details><summary>查看未确认的原要求</summary><pre>{unconfirmed}</pre>
      <button type="button" onClick={() => {
        try { sessionStorage.removeItem(pendingKey); setUnconfirmed(''); setNotice('已解除发送保护；请核对当前镜头后再发送。') }
        catch { setNotice('无法解除发送保护，请检查浏览器存储。') }
      }}>我已核对原会话，解除发送保护</button></details>}
  </section>
}
