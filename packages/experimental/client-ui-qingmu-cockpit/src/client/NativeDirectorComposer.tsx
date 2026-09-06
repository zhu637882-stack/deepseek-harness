/** Keep the selected shot mounted while sending to the existing native DSH conversation. */
import { useEffect, useRef, useState } from 'react'
import type { NativeDirectorPromptTarget } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { useDirectorConnection, type NativeDirectorSessionPort } from './native-director-session.ts'

const pendingKey = 'qingmu.native-director-unconfirmed.v1'
const unknownNotice = '上次发送结果尚未确认，可能已进入原会话。请核对原会话后再解除发送保护，勿重复发送。'
function retainedRequest(): string {
  try { return sessionStorage.getItem(pendingKey) ?? '' } catch { return '发送状态存储不可用' }
}

/** A user-initiated native turn, not a second provider client or business-write path. */
export function NativeDirectorComposer({ port, sessionId, scopeKey, ready, target }: {
  readonly port: NativeDirectorSessionPort
  readonly sessionId: string | undefined
  readonly scopeKey: string
  readonly ready: boolean
  readonly target?: NativeDirectorPromptTarget | undefined
}) {
  const connection = useDirectorConnection(port.connection)
  const [text, setText] = useState('')
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
        if (retainedRequest() === record) sessionStorage.removeItem(pendingKey)
        setText('')
        setNotice('要求已发送到当前导演会话；完成后可在下方读取建议。尚未保存或生成。')
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
  return <section aria-label="向当前镜头的导演提要求">
    <label>导演要求<textarea aria-label="导演要求" value={text} maxLength={16000} disabled={busy}
      onChange={(event) => { setText(event.target.value) }} placeholder="例如：保持铁轨在右侧，给本镜写首帧和视频提示词。" /></label>
    <button type="button" disabled={!ready || !target || target.sessionId !== sessionId || !connection || !sessionId || busy || !!unconfirmed || !text.trim()}
      onClick={() => { void send() }}>{busy ? '正在发送…' : '发送给当前导演'}</button>
    <p>直接使用当前 DSH 会话，不必关闭制作台。导演给建议，你决定是否采用和保存。</p>
    {notice && <p role="status">{notice}</p>}
    {!!unconfirmed && <details><summary>查看未确认的原要求</summary><pre>{unconfirmed}</pre>
      <button type="button" onClick={() => {
        try { sessionStorage.removeItem(pendingKey); setUnconfirmed(''); setNotice('已解除发送保护；请核对当前镜头后再发送。') }
        catch { setNotice('无法解除发送保护，请检查浏览器存储。') }
      }}>我已核对原会话，解除发送保护</button></details>}
  </section>
}
