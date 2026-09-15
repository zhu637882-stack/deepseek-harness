/** Timed sound observations for the selected rendered film. */
import type { WorkingCutSoundReview as SoundReview } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const labels: Record<string, string> = {
  dialogue: '对白清晰度', delivery: '语气与表演', ambience: '环境底声连续性',
  acoustics: '空间声学', foley: '动作拟音', music: '音乐与转场',
  space: '空间与进出方向', cast: '人物衔接', props: '道具状态', action: '动作衔接', voice: '角色音色',
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
  return <section aria-label="整片连续性与声音检查">
    <h4>整片连续性与声音检查</h4>
    <p>连着看前后镜的场景、人物、道具与动作，同时听角色音色和转场声音。结论来自模型，需结合原片判断。</p>
    {changed && <p>当前剪辑已有修改。下方检查对应正在播放的已合成版本；重新合成后可检查新版。</p>}
    {(state === 'none' || review?.methodChanged) && <><button type="button" disabled={busy || state === 'pending'} onClick={onReview}>检查此版连续性与声音</button>
      <p>调用阿里音画审片模型，使用已配置的 API 额度。</p></>}
    {review?.methodChanged && <p>保留的是旧版报告，尚未按选用视频的生成依据检查。</p>}
    {state === 'pending' && <p role="status">正在检查此版成片，离开后可回来查看结果。</p>}
    {state === 'failed' && <p role="alert">整片检查未完成：{review?.errorCode ?? '未取得结果'}。原片仍可播放，未自动重复调用。</p>}
    {state === 'complete' && <>
      <p>新版检查对照选用视频当时的对白与导演设计；缺少依据的镜头仍需核实。听写和判断均来自模型，不等于人工验收。</p>
      {review?.summary && <p>模型原始意见：{review.summary}</p>}
      {!!review?.transitions?.length && <div aria-label="前后镜连续性报告">
        {review.transitions.map(transition => <details key={transition.cutIndex}>
          <summary>连接处 {transition.cutIndex} · {time(transition.atSec)} · {transition.checks.filter(c => c.status === 'fail').length} 项问题 / {transition.checks.filter(c => c.status === 'unverified').length} 项待确认</summary>
          <button type="button" onClick={() => { onSeek(Math.max(0, transition.atSec - 2)) }}>连看这个连接处</button>
          <ul>{transition.checks.map(check => <li key={check.kind}>
            <strong>{labels[check.kind] ?? check.kind} · {statuses[check.status]}</strong>
            <p>{check.evidence || '尚无前后两镜的完整观察依据。'}</p>
            {check.timeRanges.map(([start, end], i) => <button key={i} type="button"
              onClick={() => { onSeek(start) }}>{time(start)}—{time(end)} 回看</button>)}
          </li>)}</ul>
        </details>)}
      </div>}
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
