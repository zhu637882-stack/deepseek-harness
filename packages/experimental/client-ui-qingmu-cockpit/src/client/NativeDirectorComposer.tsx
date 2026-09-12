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
      const next = '请整理当前镜头的视频生成稿。读取已保存的完整导演设计、全片镜头衔接、剧本、当前引用草稿和素材；依据 Leos 六部门及本片已选方法，把空间与动作起止状态、运镜的起点路径终点、表演反应、逐句对白与语气停顿、光影、环境底声和空间声学完整转为一份可执行生成稿。保留导演明确安排的换场、时间跳跃、多人对白和画面文字。逐个说明引用素材的用途，处理参考图与目标状态的冲突，清除已被新设计替代的旧描述，不在旧稿末尾追加另一套指令，不缩写成摘要。保留未要求修改的台词、素材绑定和生成参数；确有冲突时说明理由。保存前逐项交叉核对整份稿：物件总量与叙事主道具数量不能混淆，背景陈设与动作道具分清；每个动作的接触、持有、起止状态和相邻镜头接续不能互相矛盾；结尾约束必须与前文场景、表演和摄影兼容。发现矛盾就在原段落中统一修正，无法判定时明确指出，不虚报完成。保存本镜引用草稿后读取回执并预览实际请求，说明调整与未解决问题。不要提交视频、选用候选或修改其他镜头。'
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
