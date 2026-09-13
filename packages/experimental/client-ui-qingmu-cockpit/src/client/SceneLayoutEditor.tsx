/** Shared blockout and per-image camera inside the existing asset draft. */
import { useEffect, useRef, useState } from 'react'
import type { ImageCamera, SceneLayout, SceneLayoutPreview } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import css from './SceneLayoutEditor.module.css'

type Vector = readonly [number, number, number]
const initialCamera: ImageCamera = { position: [0, -5, 1.6], target: [0, 0, 1], verticalFov: 50 }
function VectorInput({ label, value, onChange, positive = false }: {
  label: string
  value: Vector
  onChange: (v: Vector) => void
  positive?: boolean
}) {
  return <div className={css.vector}><span>{label}</span>{value.map((entry, index) => <label key={index}>{['X', 'Y', 'Z'][index]}
    <input aria-label={`${label} ${['X', 'Y', 'Z'][index]}`} type="number" step="0.1" min={positive ? 0.01 : -1000} max="1000" value={entry}
      onChange={(event) => {
        const v = event.target.valueAsNumber
        if (Number.isFinite(v) && (!positive || v > 0)) onChange(value.map((n, i) => i === index ? v : n) as unknown as Vector)
      }} />
  </label>)}</div>
}

/** Edit fixed volumes, inspect another camera, and keep the preview distinct from generated art.
 * @param props - Current project draft, optional shared-layout edit and scoped preview command.
 * @returns A plan, camera controls and the exact composition input.
 */
export function SceneLayoutEditor({ projectId, episodeId, layout, camera, ratio, onLayout, onCamera, previewLayout, usage = 'asset' }: {
  readonly projectId: string
  readonly episodeId: string
  readonly layout: SceneLayout | null | undefined
  readonly camera: ImageCamera | null | undefined
  readonly ratio: string
  readonly onLayout?: ((value: SceneLayout | null) => void) | undefined
  readonly onCamera: (value: ImageCamera | null) => void
  readonly previewLayout: QingmuYimengPort['previewSceneLayout']
  readonly usage?: 'asset' | 'shot'
}) {
  const [selected, setSelected] = useState(''), [preview, setPreview] = useState<SceneLayoutPreview>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [, redraw] = useState(0)
  const controller = useRef<AbortController>()
  const drag = useRef<{ id: string; x0: number; y0: number; scale: number }>()
  const signature = JSON.stringify({ projectId, episodeId, layout, camera, ratio })
  const latest = useRef(signature); latest.current = signature
  useEffect(() => { setPreview(undefined); setError(''); setBusy(false); controller.current?.abort() }, [signature])
  useEffect(() => () => { controller.current?.abort() }, [])
  const objects = layout?.objects ?? []
  const active = objects.find(item => item.id === selected)
  const positions: [number, number][] = objects.flatMap((item) => {
    const radius = Math.hypot(item.size[0], item.size[1])/2
    return [[item.center[0]-radius, item.center[1]-radius], [item.center[0]+radius, item.center[1]+radius]]
  })
  if (camera) positions.push([camera.position[0], camera.position[1]], [camera.target[0], camera.target[1]])
  const minX = Math.min(-1, ...positions.map(p => p[0]))-1, maxX = Math.max(1, ...positions.map(p => p[0]))+1
  const minY = Math.min(-1, ...positions.map(p => p[1]))-1, maxY = Math.max(1, ...positions.map(p => p[1]))+1
  const scale = Math.min(560/(maxX-minX), 340/(maxY-minY))
  const px = (x: number) => 20+(x-(drag.current?.x0 ?? minX))*(drag.current?.scale ?? scale)
  const py = (y: number) => 360-(y-(drag.current?.y0 ?? minY))*(drag.current?.scale ?? scale)
  const drawingScale = drag.current?.scale ?? scale
  function changeObject(patch: Partial<SceneLayout['objects'][number]>) {
    if (layout && active && onLayout) onLayout({ ...layout,
      objects: objects.map(item => item.id === active.id ? { ...item, ...patch } : item) })
  }
  function start(event: React.PointerEvent<SVGGElement>, id: string) {
    if (event.currentTarget.closest('fieldset:disabled')) return
    if (event.button !== 0) return
    if (id !== '$camera' && id !== '$target') setSelected(id)
    if ((!onLayout && !id.startsWith('$')) || !camera && id.startsWith('$')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id, x0: minX, y0: minY, scale }
  }
  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (event.currentTarget.closest('fieldset:disabled')) return
    const d = drag.current; if (!d) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.round(((event.clientX-rect.left)/rect.width*600-20)/d.scale*10+d.x0*10)/10
    const y = Math.round((360-(event.clientY-rect.top)/rect.height*380)/d.scale*10+d.y0*10)/10
    if (camera && (d.id === '$camera' || d.id === '$target')) {
      const field = d.id === '$camera' ? 'position' : 'target'
      onCamera({ ...camera, [field]: [x, y, camera[field][2]] }); return
    }
    if (layout && onLayout) onLayout({ ...layout,
      objects: objects.map(item => item.id === d.id ? { ...item, center: [x, y, item.center[2]] } : item) })
  }
  async function showPreview() {
    if (!layout || !camera || busy) return
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    setBusy(true); setError('')
    try {
      const result = await previewLayout({ projectId, episodeId, layout, camera, ratio }, abort.signal)
      if (!abort.signal.aborted && latest.current === signature) setPreview(result)
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '空间预览失败') }
    finally { if (!abort.signal.aborted) setBusy(false) }
  }
  return <details className={css.editor}><summary>空间布置与取景预览{camera ? ' · 已启用构图辅助' : ''}</summary>
    <p>共用布局记录固定位置，摄影机决定本图取景。{onLayout ? '可在图中拖动物件、摄影机与目标点。' : '可拖动摄影机与目标点；共用物件保持原位。'}单位为米，Z 为离地高度；尺寸需要有依据。</p>
    {!layout && onLayout && <button type="button" onClick={() => { onLayout({ basis: '导演拟定，待与剧本和参考图核对。', coordinateFrame: '米制：X 向右、Y 向上、Z 离地高；请补充入口等固定方位。', objects: [{ id: 'object_1', label: '待设定物件', center: [0, 0, 0.5], size: [1, 1, 1], rotation: 0, color: '#a89f89' }] }) }}>开始布置空间</button>}
    {!layout && !onLayout && <p>请先在对应场景素材中建立布局。</p>}
    {layout && <>
      {onLayout ? <>
        <label>布局依据<textarea value={layout.basis} onChange={(e) => { onLayout({ ...layout, basis: e.target.value }) }} /></label>
        <label>平面方位<textarea value={layout.coordinateFrame}
          onChange={(e) => { onLayout({ ...layout, coordinateFrame: e.target.value }) }} /></label>
      </> : <p>{layout.coordinateFrame} · {layout.basis}</p>}
      <svg role="img" aria-label="共用场景平面图" viewBox="0 0 600 380" className={css.plan} onPointerMove={move}
        onPointerUp={() => { drag.current = undefined; redraw(n => n+1) }}
        onPointerCancel={() => { drag.current = undefined; redraw(n => n+1) }}>
        {objects.map(item => <g key={item.id} onPointerDown={(e) => { start(e, item.id) }} style={{ cursor: onLayout ? 'move' : 'pointer' }}>
          <title>{item.label}</title>
          <rect x={px(item.center[0])-item.size[0]*drawingScale/2} y={py(item.center[1])-item.size[1]*drawingScale/2}
            width={item.size[0]*drawingScale} height={item.size[1]*drawingScale} fill={item.color} fillOpacity="0.7" stroke={selected === item.id ? '#d7f388' : '#5e665f'} strokeWidth={selected === item.id ? 3 : 1}
            transform={`rotate(${-item.rotation} ${px(item.center[0])} ${py(item.center[1])})`} />
          {(objects.length <= 5 || selected === item.id) && <text x={px(item.center[0])} y={py(item.center[1])} textAnchor="middle" fill="#fff" fontSize="12" paintOrder="stroke" stroke="#222" strokeWidth="2">{item.label}</text>}
        </g>)}
        {camera && <><line x1={px(camera.position[0])} y1={py(camera.position[1])} x2={px(camera.target[0])} y2={py(camera.target[1])} stroke="#d7f388" strokeDasharray="5 4" />
          <g onPointerDown={(e) => { start(e, '$camera') }}><circle cx={px(camera.position[0])} cy={py(camera.position[1])} r="9" fill="#d7f388" /><text x={px(camera.position[0])+13} y={py(camera.position[1])} fill="#d7f388" fontSize="12">摄影机</text></g>
          <g onPointerDown={(e) => { start(e, '$target') }}><circle cx={px(camera.target[0])} cy={py(camera.target[1])} r="8" fill="none" stroke="#d7f388" strokeWidth="3" /></g></>}
      </svg>
      {!onLayout && <label>查看布置物件<select value={selected} onChange={(e) => { setSelected(e.target.value) }}>
        <option value="">选择并高亮物件</option>{objects.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>}
      {onLayout && <><label>布置物件<select value={selected} onChange={(e) => { setSelected(e.target.value) }}><option value="">选择物件</option>{objects.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <button type="button" disabled={objects.length >= 60} onClick={() => { const id = `object_${crypto.randomUUID()}`; onLayout({ ...layout, objects: [...objects, { id, label: '新物件', center: [0, 0, 0.5], size: [1, 1, 1], rotation: 0, color: '#a89f89' }] }); setSelected(id) }}>添加物件</button>
        {active && <><label>物件名称<input value={active.label} onChange={(e) => { changeObject({ label: e.target.value }) }} /></label>
          <VectorInput label="物件中心" value={active.center} onChange={(center) => { changeObject({ center }) }} />
          <VectorInput label="物件尺寸" value={active.size} positive onChange={(size) => { changeObject({ size }) }} />
          <label>平面旋转角度<input type="number" min="-360" max="360" value={active.rotation} onChange={(e) => { if (Number.isFinite(e.target.valueAsNumber)) changeObject({ rotation: e.target.valueAsNumber }) }} /></label>
          <label>识别色<input type="color" value={active.color} onChange={(e) => { changeObject({ color: e.target.value }) }} /></label>
          <button type="button" disabled={objects.length < 2} onClick={() => { onLayout({ ...layout, objects: objects.filter(row => row.id !== active.id) }); setSelected('') }}>移除此物件</button></>}
      </>}
      <label className={css.cameraToggle}><input type="checkbox" checked={!!camera} onChange={(e) => { onCamera(e.target.checked ? initialCamera : null) }} />用空间取景图辅助本图生成</label>
      {camera && <><VectorInput label="摄影机位置" value={camera.position} onChange={(position) => { onCamera({ ...camera, position }) }} />
        <VectorInput label="取景目标" value={camera.target} onChange={(target) => { onCamera({ ...camera, target }) }} />
        <label>垂直视野角度<input type="number" min="10" max="120" value={camera.verticalFov} onChange={(e) => { if (Number.isFinite(e.target.valueAsNumber)) onCamera({ ...camera, verticalFov: e.target.valueAsNumber }) }} /></label>
        <label>摄影机滚转角度<input type="number" min="-360" max="360" value={camera.roll ?? 0} onChange={(e) => { if (Number.isFinite(e.target.valueAsNumber)) onCamera({ ...camera, roll: e.target.valueAsNumber }) }} /></label>
        <button type="button" disabled={busy} onClick={() => { void showPreview() }}>{busy ? '计算取景…' : '预览当前取景'}</button></>}
      {preview && <><img className={css.preview} src={preview.imageUrl} alt="本图空间构图参考" /><p>{preview.guidance}</p>
        <p>当前体块取景可见：{preview.objects.filter(item => item.pixelCount).map(item => item.label).join('、') || '没有物件，请调整机位'}。</p></>}
      <p>{usage === 'shot' ? '保存本镜导演设计后，首帧预览和生成使用这个机位，沿用场景的共用布局。请同时核对上方首帧文字和人物站位。' : '保存素材设计后，启用的取景图会随参考素材一起发送。'}墙体有门窗时请分开布置墙段，空隙表示开口；体块不代表完整建筑模型。</p>
    </>}
    {error && <p role="status">{error}</p>}
  </details>
}
