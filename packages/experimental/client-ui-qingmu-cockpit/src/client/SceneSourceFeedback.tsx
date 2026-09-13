/** Scene feedback travels to asset revision without adopting a candidate or sending a model request. */
import { useState } from 'react'
import type { AssetDesignState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

interface Scope { projectId: string; episodeId: string }
interface Feedback extends Scope {
  sceneId: string
  sceneName: string
  scriptSha256: string
  assetSha256: string
  storyboardSha256: string
  issues: string[]
}
const labels: Record<string, string> = {
  severity: '类型', source: '来源', issue: '问题', consequence: '影响', proposedFix: '导演建议',
}
const prefix = ({ projectId, episodeId }: Scope) => `qingmu.scene-feedback.v1:${projectId}:${episodeId}:`
const href = ({ projectId, episodeId }: Scope, view: string) => `?${new URLSearchParams({
  qingmuView: view, qingmuProject: projectId, qingmuEpisode: episodeId,
})}`
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function describe(value: unknown): string {
  if (typeof value === 'string') return value
  if (!object(value)) return JSON.stringify(value)
  return Object.entries(value).map(([key, item]) => `${labels[key] ?? key}：${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')
}
function candidate(text: string, scope: Scope, sceneId: string, sceneName: string): Feedback | undefined {
  try {
    const value: unknown = JSON.parse(text)
    if (object(value) && value.sceneId === sceneId && Array.isArray(value.sourceIssues) && value.sourceIssues.length
      && typeof value.sourceScriptSha256 === 'string' && typeof value.sourceAssetStateSha256 === 'string'
      && typeof value.sourceStoryboardSha256 === 'string') return { ...scope, sceneId, sceneName,
      scriptSha256: value.sourceScriptSha256, assetSha256: value.sourceAssetStateSha256,
      storyboardSha256: value.sourceStoryboardSha256, issues: value.sourceIssues.map(describe) }
  } catch { /* An incomplete editable JSON draft is retained by the composer; adoption reports its format error. */ }
  return undefined
}
function read(scope: Scope): Feedback[] {
  const results: Feedback[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith(prefix(scope))) continue
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (object(value) && value.projectId === scope.projectId && value.episodeId === scope.episodeId
        && typeof value.sceneId === 'string' && key === prefix(scope) + value.sceneId && typeof value.sceneName === 'string'
        && typeof value.scriptSha256 === 'string' && typeof value.assetSha256 === 'string' && typeof value.storyboardSha256 === 'string'
        && Array.isArray(value.issues) && value.issues.every(item => typeof item === 'string')) results.push(value as unknown as Feedback)
    } catch { /* Unreadable local feedback cannot become a creative instruction; the native candidate remains available. */ }
  }
  return results
}
function Issues({ issues }: { readonly issues: string[] }) {
  return <ol>{issues.map((issue, index) => <li key={index}><p style={{ whiteSpace: 'pre-wrap' }}>{issue}</p></li>)}</ol>
}

/**
 * Inspect a scene's unresolved sources and explicitly carry them to this episode's asset page.
 * @param props Current candidate, scene and project binding.
 * @returns Local feedback and a scoped navigation link; no approval or project write.
 */
export function SceneSourceFeedback({ text, projectId, episodeId, sceneId, sceneName }: Scope & {
  readonly text: string
  readonly sceneId: string
  readonly sceneName: string
}) {
  const [error, setError] = useState('')
  const feedback = candidate(text, { projectId, episodeId }, sceneId, sceneName)
  if (!feedback) return null
  return <section aria-label="导演待核对问题">
    <h4>导演发现 {feedback.issues.length} 项待核对问题</h4>
    <p>以下是候选稿的意见，需要按当前剧本和设计核对。素材问题可带回修订；时长、剧本等问题仍在相应页面处理。</p>
    <Issues issues={feedback.issues} />
    <a href={href(feedback, 'assets')} onClick={(event) => {
      try { localStorage.setItem(prefix(feedback) + sceneId, JSON.stringify(feedback)) } catch {
        event.preventDefault(); setError('本机未能保留反馈，原稿仍在本页，请先复制需要的内容。')
      }
    }}>带着问题去素材设计</a>
    {error && <p role="alert">{error}</p>}
  </section>
}

/**
 * Recover scene feedback as optional asset revision context, separate from current project facts.
 * @param props Current asset state and an explicit callback that edits the user's revision text.
 * @returns Per-scene feedback, source-change notice and return navigation.
 */
export function AssetSourceFeedback({ state, onUse, disabled }: {
  readonly state: AssetDesignState
  readonly onUse: (text: string) => void
  readonly disabled: boolean
}) {
  const [items, setItems] = useState(() => read(state))
  if (!items.length) return null
  return <section aria-label="整场导演反馈">
    <h3>来自整场导演的待核对问题</h3>
    {items.map(item => <article key={item.sceneId}>
      <h4>{item.sceneName}</h4>
      {(state.scriptSha256 !== item.scriptSha256 || state.stateSha256 !== item.assetSha256)
        && <p>反馈后的剧本或素材已有变化。请对照当前版本核对，旧意见不覆盖新设计。</p>}
      <Issues issues={item.issues} />
      <button type="button" disabled={disabled} onClick={() => { onUse(
        `整场导演反馈（${item.sceneName}）：\n${item.issues.join('\n\n')}\n以上是待核对意见，不是新的项目事实。请按当前剧本与设计核对，只协调素材职责内的问题；保留其他有效设计，剧本、时长或逐镜问题指出相应处理位置。不要声称反馈已自动解决。`,
      ) }}>加入创作补充</button>
      <button type="button" disabled={disabled} onClick={() => {
        localStorage.removeItem(prefix(item) + item.sceneId); setItems(items.filter(value => value.sceneId !== item.sceneId))
      }}>移除此条反馈</button>
    </article>)}
    <p>加入补充只编辑本机要求；设计保存后，再回分镜读取最新依据并协调整场。移除反馈不会批准或采用原导演稿。</p>
    <a href={href(state, 'storyboard')}>返回分镜协调</a>
  </section>
}
