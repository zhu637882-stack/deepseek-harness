/** Timed sound observations for the selected rendered film. */
import type { WorkingCutSoundReview as SoundReview } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const labels: Record<string, string> = {
  dialogue: '对白清晰度', delivery: '语气与表演', ambience: '环境底声连续性',
  acoustics: '空间声学', foley: '动作拟音', music: '音乐与转场',
}
const statuses = { pass: '模型未发现问题', fail: '模型发现问题', unverified: '尚未确认', not_applicable: '本片不涉及' }
const time = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`

/** Show recoverable model findings without treating them as film acceptance.
 * @param props - Bound report, explicit submission and player seek actions.
 * @returns Sound checklist and film-time playback links.
 */
export function WorkingCutSoundReview({ review, busy, changed, onReview, onSeek }: {
  readonly review: SoundReview | undefined
  readonly busy: boolean
  readonly changed: boolean
  readonly onReview: () => void
  readonly onSeek: (seconds: number) => void
}) {
  const state = review?.state ?? 'none'
  return <section aria-label="整片声音检查">
    <h4>整片声音检查</h4>
    <p>检查整段成片中的对白、环境声、音乐与剪辑点。结论来自模型，需结合原片判断。</p>
    {changed && <p>当前剪辑已有修改。下方检查对应正在播放的已合成版本；重新合成后可检查新版。</p>}
    {state === 'none' && <><button type="button" disabled={busy} onClick={onReview}>检查此版整片声音</button>
      <p>调用阿里音画审片模型，使用已配置的 API 额度。</p></>}
    {state === 'pending' && <p role="status">正在检查此版成片，离开后可回来查看结果。</p>}
    {state === 'failed' && <p role="alert">声音检查未完成：{review?.errorCode ?? '未取得结果'}。原片仍可播放，未自动重复调用。</p>}
    {state === 'complete' && <>
      <p>本次检查没有提供与原片绑定的锁定台词，只能用于听写和听感观察。模型意见中若提到“与剧本一致”，不代表完成了逐字比对。</p>
      {review?.summary && <p>模型原始意见：{review.summary}</p>}
      <ul>{review?.checks.map(check => <li key={check.kind}>
        <strong>{labels[check.kind] ?? check.kind} · {statuses[check.status]}</strong>
        <p>{check.evidence || '模型没有提供足够的声音证据。'}</p>
        {check.timeRanges.map(([start, end], i) => <button key={i} type="button"
          onClick={() => { onSeek(start) }}>{time(start)}—{time(end)} 回听</button>)}
      </li>)}</ul>
      {!!review?.transcript?.length && <details><summary>对白听写与逐句回听（模型识别）</summary>
        <ol>{review.transcript.map((line, i) => <li key={i}>
          <button type="button" onClick={() => { onSeek(line.start_sec) }}>
            {time(line.start_sec)}—{time(line.end_sec)} 回听对白
          </button>{' '}{line.speaker}：{line.text}{line.delivery && <p>{line.delivery}</p>}
        </li>)}</ol>
      </details>}
    </>}
  </section>
}
