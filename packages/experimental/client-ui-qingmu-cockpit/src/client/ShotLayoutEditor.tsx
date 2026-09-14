/** Per-shot framing over the saved scene, without making a second room layout. */
import { useEffect, useState } from 'react'
import type { AssetDesignState, ImageCamera, ImageObjectState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import { imageObjectStates } from './image-object-states.ts'
import { SceneLayoutEditor } from './SceneLayoutEditor.tsx'

/** Scene identity comes from the current frame; only an unmaterialized plan may use its unique scene name. */
export interface ShotLayoutContext {
  readonly projectId: string
  readonly episodeId: string
  readonly sceneId: string | null | undefined
  readonly sceneName?: string | undefined
  readonly ratio: string | undefined
  readonly readAssetDesign: QingmuYimengPort['readAssetDesign']
  readonly previewSceneLayout: QingmuYimengPort['previewSceneLayout']
}

function cameraValue(value: unknown): ImageCamera | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const vector = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3
    && v.every(n => typeof n === 'number' && Number.isFinite(n))
  if (!vector(row.position) || !vector(row.target) || typeof row.verticalFov !== 'number'
    || !Number.isFinite(row.verticalFov) || (row.roll !== undefined && (typeof row.roll !== 'number' || !Number.isFinite(row.roll)))) return null
  return { position: row.position, target: row.target, verticalFov: row.verticalFov,
    ...(row.roll === undefined ? {} : { roll: row.roll as number }) }
}

/** Reads on expansion, isolates late responses and edits only the current shot camera.
 * @param props - Bound scene, authored camera and parent-owned save callback.
 * @returns Shared geography and a per-shot framing preview; opening never generates media.
 */
export function ShotLayoutEditor({ context, value, onChange, objectStates, onObjectStates }: {
  readonly context: ShotLayoutContext
  readonly value: unknown
  readonly objectStates?: unknown
  readonly onObjectStates?: ((states: readonly ImageObjectState[]) => void) | undefined
  readonly onChange: (camera: ImageCamera | null) => void
}) {
  const { projectId, episodeId, sceneId, sceneName, ratio, readAssetDesign, previewSceneLayout } = context
  const [open, setOpen] = useState(false), [reload, setReload] = useState(0)
  const [source, setSource] = useState<AssetDesignState | null>(null), [error, setError] = useState('')
  useEffect(() => {
    setSource(null); setError('')
    if (!open) return
    const controller = new AbortController()
    void readAssetDesign({ projectId, episodeId }, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.projectId !== projectId || result.episodeId !== episodeId) throw new Error('场景资料与当前项目不一致，请重新读取。')
      setSource(result)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '场景资料读取失败。')
    })
    return () => { controller.abort() }
  }, [open, reload, projectId, episodeId, readAssetDesign])
  const scoped = source?.projectId === projectId && source.episodeId === episodeId ? source : null
  const matches = scoped?.design?.assets.filter(item => item.kind === 'scene'
    && (sceneId === undefined ? item.name === sceneName : !!sceneId && item.id === sceneId)) ?? []
  const scene = matches.length === 1 ? matches[0] : undefined
  let states: readonly ImageObjectState[] | null = null
  let stateError = ''
  try { states = imageObjectStates(objectStates) } catch (cause) { stateError = cause instanceof Error ? cause.message : '本图物件布置格式不兼容' }
  const camera = cameraValue(value)
  const sceneCamera = cameraValue(scene?.imageCamera)
  return <details onToggle={(event) => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open) }}>
    <summary>共用场景与本镜取景</summary>
    {open && <>
      <p>每个镜头沿用同一场景布置，在这里调整摄影机。人物站位与当前道具状态按本镜导演设计在本图中调整。</p>
      {!scoped && !error && <p role="status">正在读取共用场景…</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => { setReload(n => n + 1) }}>重新读取场景布局</button>
      {scoped && !scene && <p>未找到本镜对应的唯一场景设计。请先在素材页核对场景；不会借用其他房间的布局。</p>}
      {scene && <>
        <p><strong>{scene.name}</strong> · 共用布局在素材页维护，当前镜头调整不会移动其他镜头的门窗或家具。</p>
        {value == null && sceneCamera && <p>首次启用取景会沿用这个场景的素材机位，再按本镜设计调整。</p>}
        {scene.space && <p>{Object.values(scene.space).filter(value => typeof value === 'string').join('\n')}</p>}
        {stateError ? <p role="alert">{stateError}；完整设计保留原文，请先交给导演整理。</p> : value != null && camera === null ? <p role="alert">本镜已有其他格式的机位设计，原文保留在完整设计中；请先交给导演整理。</p>
          : ratio ? <SceneLayoutEditor projectId={projectId} episodeId={episodeId} layout={scene.sceneLayout}
            camera={camera} imageObjectStates={states} onObjectStates={onObjectStates} defaultCamera={sceneCamera ?? undefined} ratio={ratio} onCamera={onChange} previewLayout={previewSceneLayout} usage="shot" />
            : <p>当前读取未提供影片画幅，请刷新到最新项目状态后调整机位。</p>}
      </>}
    </>}
  </details>
}
