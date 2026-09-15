import { useEffect, useRef, useState } from 'react'
import type { AssetImageReference } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { ReferenceVideoAsset } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import { usePrivateReferencePreview, type PrivateReferencePreviewPort } from './usePrivateReferencePreview.ts'
import css from './AssetImageReferences.module.css'
import { ReferenceImageDesign } from './ReferenceImageDesign.tsx'
type Point = readonly [number, number]
type Box = readonly [number, number, number, number]

/** Reuse project-owned image reads for ordered references and region selection. */
export type AssetImageReferencePort = Pick<QingmuYimengPort, 'referenceVideoAssets'> & PrivateReferencePreviewPort

function ReferenceImage({ projectId, asset, reference, port, onChange, disabled, allowRegions }: {
  projectId: string
  asset: ReferenceVideoAsset | undefined
  reference: AssetImageReference
  port: AssetImageReferencePort
  onChange: (value: AssetImageReference) => void
  disabled: boolean
  allowRegions: boolean
}) {
  const { preview } = usePrivateReferencePreview(projectId, asset, port, 0)
  const url = asset?.browserUrl || preview?.url
  const [dimensions, setDimensions] = useState<Point>([0, 0])
  const [drawing, setDrawing] = useState<Box>()
  const start = useRef<Point>()
  const boxes = reference.boxes ?? []
  function point(event: React.PointerEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect()
    return [Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * dimensions[0]),
      Math.round(Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * dimensions[1])]
  }
  return <>
    {url ? <div className={css.image} aria-label={allowRegions ? '拖动框选修改区域' : '首帧参考图片'} onPointerDown={(event) => {
      if (!allowRegions || disabled || boxes.length >= 2 || !dimensions[0] || event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId); start.current = point(event)
    }} onPointerMove={(event) => {
      if (!start.current) return
      const end = point(event), begin = start.current
      setDrawing([Math.min(begin[0], end[0]), Math.min(begin[1], end[1]), Math.max(begin[0], end[0]), Math.max(begin[1], end[1])])
    }} onPointerUp={(event) => {
      if (!start.current) return
      const end = point(event), begin = start.current
      const box: Box = [Math.min(begin[0], end[0]), Math.min(begin[1], end[1]), Math.max(begin[0], end[0]), Math.max(begin[1], end[1])]
      start.current = undefined; setDrawing(undefined)
      if (box[2] > box[0] && box[3] > box[1]) onChange({ ...reference, boxes: [...boxes, box] })
    }} onPointerCancel={() => { start.current = undefined; setDrawing(undefined) }}>
      <img src={url} alt={asset?.label ?? '已绑定参考图'} draggable={false} onLoad={(event) => {
        setDimensions([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])
      }} />
      {[...boxes, ...(drawing ? [drawing] : [])].map((box, index) => <span key={index} className={css.box} style={{
        left: `${box[0] / dimensions[0] * 100}%`, top: `${box[1] / dimensions[1] * 100}%`,
        width: `${(box[2] - box[0]) / dimensions[0] * 100}%`, height: `${(box[3] - box[1]) / dimensions[1] * 100}%`,
      }} />)}
    </div> : <p>参考已按原图版本绑定。图片预览暂不可用。</p>}
    {allowRegions && <p>可拖动框选最多两处修改区域，坐标按原图保存。也可直接描述整图派生；生成后需检查区域外内容。</p>}
    {boxes.length > 0 && <button type="button" disabled={disabled} onClick={() => { onChange({ ...reference, boxes: [] }) }}>清除框选</button>}
  </>
}

interface AssetImageReferencesProps {
  readonly projectId: string
  readonly references: readonly AssetImageReference[]
  readonly port: AssetImageReferencePort
  readonly onChange: (value: readonly AssetImageReference[]) => void
  readonly disabled: boolean
  readonly allowRegions?: boolean
  readonly refreshToken?: number
}

/** Choose references within one project; switching projects discards the previous catalog and page. */
export function AssetImageReferences(props: AssetImageReferencesProps) {
  return <ProjectImageReferences key={`${props.projectId}:${props.refreshToken ?? 0}`} {...props} />
}

function ProjectImageReferences({ projectId, references, port, onChange, disabled, allowRegions = true }: AssetImageReferencesProps) {
  const [assets, setAssets] = useState<ReferenceVideoAsset[]>([]), [page, setPage] = useState(1), [pages, setPages] = useState(1)
  const [error, setError] = useState(''), [loading, setLoading] = useState(false)
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('')
    void port.referenceVideoAssets({ projectId, page }, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setAssets(previous => [...previous.filter(item => !result.items.some(next => next.assetId === item.assetId)),
        ...result.items.filter(item => item.mediaType === 'reference_image')]); setPages(result.pages)
    }).catch(() => { if (!controller.signal.aborted) setError('参考图片读取失败，请重新展开重试。') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [page, port, projectId])
  return <div className={css.references}>
    <p>图片按加入顺序编号。图 1 记录为派生来源；每张图的用途会与图片一起送入模型。引用不会改变素材选用状态。</p>
    <label>添加参考图<select value="" disabled={disabled || loading || references.length >= 9} onChange={(event) => {
      const asset = assets.find(item => item.assetId === event.target.value)
      if (asset) onChange([...references, { assetId: asset.assetId, assetSha256: asset.assetSha256, purpose: `保持${asset.label}的可辨特征，结合本次画面描述生成。`, boxes: [] }])
    }}><option value="">选择本项目图片</option>{assets.filter(asset => !references.some(ref => ref.assetId === asset.assetId)).map(asset => <option key={asset.assetId} value={asset.assetId}>{asset.label}</option>)}</select></label>
    {page < pages && <button type="button" disabled={loading || disabled} onClick={() => { setPage(page + 1) }}>加载更多图片</button>}
    {references.map((reference, index) => {
      const asset = assets.find(item => item.assetId === reference.assetId && item.assetSha256 === reference.assetSha256)
      const update = (value: AssetImageReference) => { onChange(references.map((item, n) => n === index ? value : item)) }
      return <section key={reference.assetId} aria-label={`参考图 ${index + 1}`}>
        <h4>图 {index + 1} · {asset?.label ?? '已绑定图片'}</h4>
        <ReferenceImage projectId={projectId} asset={asset} reference={reference} port={port}
          disabled={disabled} allowRegions={allowRegions} onChange={update} />
        <ReferenceImageDesign asset={asset} />
        <label>图 {index + 1} 的用途<textarea value={reference.purpose} disabled={disabled}
          onChange={(event) => { update({ ...reference, purpose: event.target.value }) }} /></label>
        <div><button type="button" disabled={disabled || index === 0} onClick={() => {
          const next = [...references], previous = next[index - 1]
          if (previous) { next[index - 1] = reference; next[index] = previous; onChange(next) }
        }}>向前移</button><button type="button" disabled={disabled} onClick={() => { onChange(references.filter((_, n) => n !== index)) }}>移除此引用</button></div>
      </section>
    })}
    {error && <p role="status">{error}</p>}
  </div>
}
