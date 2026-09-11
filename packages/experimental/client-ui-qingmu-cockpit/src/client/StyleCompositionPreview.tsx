import { useEffect, useState } from 'react'
import type { CreativeVisualSettings } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'

/** Show preset adjustments separately from authored creative decisions. */
export function VisualSettingsSummary({ settings }: { settings: CreativeVisualSettings }) {
  return <section aria-label="风格搭配结果">
    <p><strong>{settings.styleLabel}</strong>{settings.stylePackName && ` × ${settings.stylePackName}`}</p>
    <p>{settings.adjustments.length ? '已按基础画风调和风格包的默认建议。' : '这组预设未发现已识别的画风冲突。'}剧本事实与具体导演设计优先。</p>
    {settings.adjustments.length > 0 && <details><summary>查看调整的预设建议（{settings.adjustments.length} 项）</summary>
      <p>以下默认建议不再自动带入；你和导演自行编写的内容保持原样。</p>
      <ul>{settings.adjustments.map(item => <li key={item}>{item}</li>)}</ul>
    </details>}
    <details><summary>查看实际采用的风格描述</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{settings.effectivePrompt}</pre>
      {settings.effectiveNegative && <p>视觉避免项：{settings.effectiveNegative}</p>}
    </details>
  </section>
}

/** Ignore an earlier selection's late response when the user changes styles. */
export function StyleCompositionPreview({ port, style, stylePackId }: {
  port: Pick<QingmuYimengPort, 'readStyleComposition'>
  style: string
  stylePackId: string
}) {
  const [result, setResult] = useState<{ key: string; settings?: CreativeVisualSettings; error?: string }>()
  const [retry, setRetry] = useState(0)
  const key = `${style}:${stylePackId}`
  useEffect(() => {
    const controller = new AbortController()
    void port.readStyleComposition({ style, stylePackId }, controller.signal).then(
      (settings) => { if (!controller.signal.aborted) setResult({ key, settings }) },
      () => { if (!controller.signal.aborted) setResult({ key, error: '风格搭配暂未读取成功。' }) },
    )
    return () => { controller.abort() }
  }, [port, style, stylePackId, key, retry])
  if (result?.key !== key) return <p role="status">正在核对风格搭配…</p>
  if (result.settings) return <VisualSettingsSummary settings={result.settings} />
  return <p role="status">{result.error}<button onClick={() => { setResult(undefined); setRetry(value => value + 1) }}>重新核对风格</button></p>
}
