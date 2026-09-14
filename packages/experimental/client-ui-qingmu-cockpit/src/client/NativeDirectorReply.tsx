/** Show ordinary director replies through the existing read-only native history port. */
import { useEffect, useRef, useState } from 'react'
import type { NativeStoryPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'

export function NativeDirectorReply({ port, sessionId, scopeKey }: {
  readonly port: NativeStoryPort
  readonly sessionId: string
  readonly scopeKey: string
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  useEffect(() => {
    generation.current++; setText(''); setBusy(false)
    return () => { generation.current++ }
  }, [port, sessionId, scopeKey])
  async function read() {
    if (busy) return
    const current = generation.current
    setBusy(true)
    try {
      const result = await port.read(sessionId, -1)
      if (current !== generation.current) return
      setText(result.error || (result.running ? '导演正在处理，稍后读取即可，不需要重复发送。'
        : result.finished ? result.text || '本次处理已结束，没有文字回复。请核对保存结果。'
          : '当前导演尚无已完成回复。'))
    } catch (error) {
      if (current === generation.current) setText(error instanceof Error ? error.message : '读取回复失败，请重试读取。')
    } finally { if (current === generation.current) setBusy(false) }
  }
  return <section aria-label="导演最近回复">
    <button type="button" disabled={busy} onClick={() => { void read() }}>{busy ? '正在读取回复…' : '查看导演回复'}</button>
    <p>显示本项目导演最近一次回复；查看不会重新发送或生成视频。</p>
    {text && <pre role="status">{text}</pre>}
  </section>
}
