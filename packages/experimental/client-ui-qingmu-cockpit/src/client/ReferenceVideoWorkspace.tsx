/** Explicit image/voice bindings and verbatim prompt editing within the director workspace. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ReferenceVideoAsset, ReferenceVideoParameters, ReferenceVideoPreviewResponse, ReferenceVideoPromptPart,
  ReferenceVideoDraftResponse,
  ReferenceVideoQuoteResponse, ReferenceVideoMaterialsState,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import css from './ReferenceVideoWorkspace.module.css'
import { usePrivateReferencePreview, type PrivateReferencePreviewPort } from './usePrivateReferencePreview.ts'
import { ReferenceVideoRuns } from './ReferenceVideoRuns.tsx'
import { inheritReferenceBindings } from './reference-draft-inheritance.ts'
import { ReferenceImageDesign } from './ReferenceImageDesign.tsx'

/** One shot's local reference draft; previewing never queues paid work. */
export interface ReferenceVideoWorkspaceProps {
  readonly projectId: string
  readonly frameId: string
  readonly initialPrompt: string
  /** Seed an unsaved shot from its director timing; persisted controls take precedence. */
  readonly initialDurationSec?: number | undefined
  readonly shotLabel?: string
  readonly initialOpen?: boolean
  readonly embedded?: boolean
  readonly referenceSources?: readonly { readonly frameId: string; readonly label: string }[]
  readonly onUnsavedChange?: (dirty: boolean) => void
  readonly onOpenShooting?: ((frameId: string) => void) | undefined
  readonly onRequestDirector?: (() => void) | undefined
  readonly port: Pick<QingmuYimengPort, 'referenceVideoAssets' | 'readLocalReferenceCandidateContent' | 'referenceVideoPreview' | 'referenceVideoDraft' | 'saveReferenceVideoDraft' | 'referenceVideoQuote' | 'referenceVideoRuns' | 'queueReferenceVideo'> & PrivateReferencePreviewPort & Partial<Pick<QingmuYimengPort, 'readReferenceVideoMaterials' | 'prepareReferenceVideoMaterial' | 'readReferenceVideoCandidateRegistration' | 'registerReferenceVideoCandidateForReview' | 'captureReferenceVideoFrame' | 'readReferenceVideoFrame'>>
}

type Chosen = Omit<ReferenceVideoAsset, 'mediaType'> & { readonly bindingToken: string; readonly mediaType: ReferenceVideoAsset['mediaType'] | 'unavailable' }

function makeRequestId() {
  return globalThis.crypto.randomUUID()
}

function configurationMessage(configurationError: string | null) {
  if (configurationError?.includes('reference_video_upload_endpoint_unsupported')) {
    return '当前阿里连接尚未开通临时素材访问。'
  }
  if (configurationError?.includes('credentials_missing') || configurationError?.includes('credential')) {
    return '请配置阿里凭据后再准备素材。'
  }
  return '当前阿里临时素材服务暂不可用，请检查连接后再准备。'
}

function materialStatusText(material: ReferenceVideoMaterialsState['materials'][number]) {
  if (material.status === 'ready') {
    return material.expiresAt === null ? '已准备，可用于阿里请求' : `已准备，至 ${new Date(material.expiresAt * 1000).toLocaleString('zh-CN')} 有效`
  }
  if (material.status === 'expired') return '临时引用已过期'
  if (material.status === 'failed') return '准备失败'
  if (material.status === 'unknown') return '上传结果待确认'
  if (material.status === 'uploading') return '正在准备'
  return '尚未准备'
}

/** Edit reference nodes independently from literal dialogue and inspect the actual request.
 * @param props - Current shot and the authenticated host read port.
 * @returns Director reference editor.
 */
export function ReferenceVideoWorkspace({ projectId, frameId, initialPrompt, port,
  shotLabel, initialOpen, embedded, initialDurationSec, referenceSources, onUnsavedChange,
  onOpenShooting, onRequestDirector }: ReferenceVideoWorkspaceProps) {
  const [assets, setAssets] = useState<readonly ReferenceVideoAsset[]>([])
  const [page, setPage] = useState(0)
  const [pages, setPages] = useState(1)
  const [chosen, setChosen] = useState<readonly Chosen[]>([])
  const [parts, setParts] = useState<readonly ReferenceVideoPromptPart[]>([{ text: initialPrompt }])
  const [parameters, setParameters] = useState<ReferenceVideoParameters>({
    duration: initialDurationSec ?? 8, resolution: '720P', ratio: '16:9', audio: true, prompt_extend: false,
  })
  const [result, setResult] = useState<ReferenceVideoPreviewResponse>()
  const [quoteResult, setQuoteResult] = useState<ReferenceVideoQuoteResponse>()
  const [savedEpoch, setSavedEpoch] = useState(-1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [draftState, setDraftState] = useState<ReferenceVideoDraftResponse>()
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [sourceAccepted, setSourceAccepted] = useState(true)
  const [directorSourceSha256, setDirectorSourceSha256] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [draftMessage, setDraftMessage] = useState('正在读取草稿状态…')
  const [inheritFrom, setInheritFrom] = useState(referenceSources?.[0]?.frameId ?? '')
  const [inspected, setInspected] = useState<ReferenceVideoAsset>()
  const [previewRetry, setPreviewRetry] = useState(0)
  const [inheriting, setInheriting] = useState(false)
  const [materials, setMaterials] = useState<ReferenceVideoMaterialsState>()
  const [materialsLoading, setMaterialsLoading] = useState(false)
  const [preparingAssetId, setPreparingAssetId] = useState<string>()
  const inheritAbort = useRef<AbortController | undefined>(undefined)
  const epoch = useRef(0)
  const activeText = useRef<{ index: number; start: number; end: number }>({
    index: 0, start: initialPrompt.length, end: initialPrompt.length,
  })
  const previewAbort = useRef<AbortController | undefined>(undefined)
  const assetsAbort = useRef<AbortController | undefined>(undefined)
  const draftAbort = useRef<AbortController | undefined>(undefined)
  const saveAbort = useRef<AbortController | undefined>(undefined)
  const materialsAbort = useRef<AbortController | undefined>(undefined)
  const prepareAbort = useRef<AbortController | undefined>(undefined)
  const preparing = useRef(false)
  const readMaterials = useCallback(async (state: ReferenceVideoDraftResponse) => {
    const draft = state.draft
    const read = port.readReferenceVideoMaterials
    if (!draft || read === undefined || preparing.current) return
    materialsAbort.current?.abort()
    const controller = new AbortController(); materialsAbort.current = controller
    setMaterialsLoading(true)
    try {
      const next = await read({
        projectId, frameId, expectedRevision: draft.revision, expectedRequestSha256: draft.requestSha256,
      }, controller.signal)
      if (controller.signal.aborted) return
      if (next.projectId !== projectId || next.frameId !== frameId
        || next.draftRevision !== draft.revision || next.draftRequestSha256 !== draft.requestSha256) {
        throw new Error('引用素材状态与当前已存草稿不匹配，请重新读取。')
      }
      setMaterials(next)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '引用素材状态读取失败')
    } finally { if (!controller.signal.aborted) setMaterialsLoading(false) }
  }, [frameId, port, projectId])

  useEffect(() => {
    const controller = new AbortController(); draftAbort.current = controller
    void port.referenceVideoDraft({ projectId, frameId }, controller.signal).then((state) => {
      if (controller.signal.aborted) return
      setDraftState(state)
      if (state.draft) void readMaterials(state)
      if (epoch.current === 0) {
        if (state.draft) {
          setChosen(state.draft.request.bindings.map(binding => ({ ...binding, browserUrl: '', mediaType: state.mediaTypes[binding.bindingToken] ?? 'unavailable' })))
          setParts(state.draft.request.promptParts); setParameters(state.draft.request.parameters)
          setDirectorSourceSha256(state.draft.request.directorSourceSha256)
          activeText.current = { index: 0, start: 0, end: 0 }
          setSourceAccepted(state.draft.frameSha256 === state.frameSha256)
          setSavedEpoch(0)
        }
        setDraftLoaded(true)
        setDraftMessage(state.draft ? `已载入草稿版本 ${state.draft.revision}。` : '尚无已存草稿。')
      }
    }).catch(() => { if (!controller.signal.aborted) setDraftMessage('草稿状态读取失败；当前试排仍可预览，请重新读取。') })
    return () => {
      controller.abort(); previewAbort.current?.abort(); assetsAbort.current?.abort()
      draftAbort.current?.abort(); saveAbort.current?.abort(); materialsAbort.current?.abort(); prepareAbort.current?.abort()
      inheritAbort.current?.abort()
    }
  }, [port, projectId, frameId, readMaterials])

  const { preview: localPreview } = usePrivateReferencePreview(projectId, inspected, port, previewRetry)
  const inspect = (asset: ReferenceVideoAsset) => {
    if (asset.browserUrl !== '' || (asset.localReferenceScope === undefined && asset.localVoiceScope === undefined)) return
    setInspected(asset)
    setPreviewRetry(0)
  }
  const exactAsset = (assetId: string, assetSha256: string) => assets.find(asset => (
    asset.assetId === assetId && asset.assetSha256 === assetSha256
  ))

  const dirty = epoch.current > 0 && savedEpoch !== epoch.current
  useEffect(() => {
    onUnsavedChange?.(dirty)
    return () => { onUnsavedChange?.(false) }
  }, [dirty, onUnsavedChange])

  const inherit = async () => {
    const source = referenceSources?.find(item => item.frameId === inheritFrom && item.frameId !== frameId)
    if (!source || inheriting || saving) return
    inheritAbort.current?.abort()
    const controller = new AbortController(); inheritAbort.current = controller
    const start = epoch.current
    setInheriting(true); setError('')
    try {
      const value = await port.referenceVideoDraft({ projectId, frameId: source.frameId }, controller.signal)
      if (controller.signal.aborted) return
      if (value.projectId !== projectId || value.frameId !== source.frameId) throw new Error('来源镜头不匹配，请重新读取。')
      if (epoch.current !== start) throw new Error('读取期间已有新的编辑，已保留当前内容。需要沿用时请再点击。')
      const next = inheritReferenceBindings(chosen, value)
      const added = next.length - chosen.length
      if (added === 0) { setDraftMessage('当前镜头已包含这些引用，文字和参数未改动。'); return }
      invalidate()
      setChosen(next.map((item) => {
        const sourceAsset = exactAsset(item.assetId, item.assetSha256)
        return { ...item, browserUrl: sourceAsset?.browserUrl ?? '',
          ...(sourceAsset?.localReferenceScope === undefined ? {} : { localReferenceScope: sourceAsset.localReferenceScope }) }
      }))
      setDraftMessage(`已沿用${source.label} 的 ${added} 项引用；本镜文字和参数保留，尚未保存。`)
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '沿用引用失败') }
    finally { if (!controller.signal.aborted) setInheriting(false) }
  }

  const invalidate = () => {
    epoch.current += 1
    setDraftMessage('当前修改尚未保存。')
    previewAbort.current?.abort(); materialsAbort.current?.abort(); prepareAbort.current?.abort()
    setBusy(false); setPreparingAssetId(undefined); setMaterials(undefined); setResult(undefined); setQuoteResult(undefined); setError('')
  }
  const restore = async () => {
    draftAbort.current?.abort()
    const controller = new AbortController(); draftAbort.current = controller
    const start = epoch.current
    try {
      const state = await port.referenceVideoDraft({ projectId, frameId }, controller.signal)
      if (controller.signal.aborted) return
      if (epoch.current !== start) { setDraftMessage('读取期间又有编辑，已保留当前内容。需要恢复时请再点击。'); return }
      setDraftState(state)
      if (!state.draft) { setDraftLoaded(true); setSourceAccepted(true); setDraftMessage('服务器尚无草稿；当前试排已保留，可直接保存。'); return }
      invalidate()
      setSavedEpoch(epoch.current)
      setChosen(state.draft.request.bindings.map(binding => ({ ...binding, browserUrl: '', mediaType: state.mediaTypes[binding.bindingToken] ?? 'unavailable' })))
      setParts(state.draft.request.promptParts); setParameters(state.draft.request.parameters)
      setDirectorSourceSha256(state.draft.request.directorSourceSha256)
      activeText.current = { index: 0, start: 0, end: 0 }
      setDraftLoaded(true); setSourceAccepted(state.draft.frameSha256 === state.frameSha256)
      setDraftMessage(`已恢复草稿版本 ${state.draft.revision}。`)
      void readMaterials(state)
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '恢复草稿失败') }
  }
  const save = async () => {
    if (saving || !draftState || !sourceAccepted || (draftState.draft && !draftLoaded)) return
    draftAbort.current?.abort()
    const controller = new AbortController(); saveAbort.current = controller
    const start = epoch.current; setSaving(true); setError('')
    try {
      const state = await port.saveReferenceVideoDraft({ projectId, frameId,
        expectedRevision: draftState.draft?.revision ?? 0, expectedFrameSha256: draftState.frameSha256,
        request: { frameId, model: 'wan3.0-video',
          bindings: chosen.map(({ bindingToken, assetId, assetSha256, label }) => ({ bindingToken, assetId, assetSha256, label })),
          promptParts: parts, parameters, ...(directorSourceSha256 ? { directorSourceSha256 } : {}) } }, controller.signal)
      if (controller.signal.aborted) return
      setDraftState(state); setDraftLoaded(true); setSavedEpoch(start)
      setDraftMessage(epoch.current === start ? `已保存草稿版本 ${state.draft?.revision}。` : '上一版已保存，随后修改的内容尚未保存。')
      if (epoch.current === start) void readMaterials(state)
    } catch (cause) {
      if (!controller.signal.aborted) setError(`保存未确认，当前内容仍保留。${cause instanceof Error ? cause.message : '请重试或重新读取草稿。'}`)
    } finally { if (!controller.signal.aborted) setSaving(false) }
  }
  const loadAssets = async (refresh = false) => {
    if (loading) return
    const controller = new AbortController(); assetsAbort.current = controller
    setLoading(true); setError('')
    try {
      const next = await port.referenceVideoAssets({ projectId, page: refresh ? 1 : page + 1 }, controller.signal)
      if (controller.signal.aborted) return
      setAssets(previous => refresh ? next.items : [...previous, ...next.items.filter(item => !previous.some(old =>
        old.assetId === item.assetId && old.assetSha256 === item.assetSha256))])
      setChosen(previous => previous.map((chosenAsset) => {
        const catalogAsset = next.items.find(asset => asset.assetId === chosenAsset.assetId
          && asset.assetSha256 === chosenAsset.assetSha256)
        return catalogAsset === undefined ? chosenAsset : { ...chosenAsset, browserUrl: catalogAsset.browserUrl,
          ...(catalogAsset.localReferenceScope === undefined ? {} : { localReferenceScope: catalogAsset.localReferenceScope }) }
      }))
      setPage(next.page); setPages(next.pages)
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '素材读取失败') }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  const choose = (asset: ReferenceVideoAsset) => {
    const limit = asset.mediaType === 'reference_image' ? 10 : 5
    if (chosen.filter(item => item.mediaType === asset.mediaType).length >= limit) {
      setError(asset.mediaType === 'reference_image' ? '最多选择 10 张图片' : asset.mediaType === 'reference_video' ? '最多选择 5 段视频，合计不超过 15 秒' : '最多选择 5 段音色')
      return
    }
    invalidate(); setChosen(previous => [...previous, { ...asset, bindingToken: asset.assetId }])
  }
  const remove = (token: string) => {
    if (parts.some(part => 'bindingToken' in part && part.bindingToken === token)) { setError('先移除描述中的这条引用，再移除素材'); return }
    invalidate(); setChosen(previous => previous.filter(item => item.bindingToken !== token))
  }
  const insert = (token: string) => {
    const { index, start, end } = activeText.current
    const part = parts[index]
    if (!part || !('text' in part)) { setError('先点击描述中要插入引用的位置'); return }
    invalidate()
    setParts(previous => [
      ...previous.slice(0, index), { text: part.text.slice(0, start) },
      { bindingToken: token }, { text: part.text.slice(end) }, ...previous.slice(index + 1),
    ])
    activeText.current = { index: index + 2, start: 0, end: 0 }
  }
  const materialFor = (item: Chosen) => materials?.materials.find(material => (
    material.bindingToken === item.bindingToken && material.assetId === item.assetId
      && material.assetSha256 === item.assetSha256
  ))
  const prepareMaterial = async (item: Chosen) => {
    const draft = draftState?.draft
    const existing = materialFor(item)
    const prepare = port.prepareReferenceVideoMaterial
    if (preparing.current || preparingAssetId !== undefined || !draft || savedEpoch !== epoch.current || !sourceAccepted
      || prepare === undefined || !materials?.configured
      || existing?.status === 'ready' || existing?.status === 'unknown' || existing?.status === 'uploading') return
    preparing.current = true
    materialsAbort.current?.abort()
    materialsAbort.current = undefined
    setMaterialsLoading(false)
    prepareAbort.current?.abort()
    const controller = new AbortController(); prepareAbort.current = controller
    setPreparingAssetId(item.assetId); setError('')
    try {
      const next = await prepare({
        projectId, frameId, assetId: item.assetId, expectedRevision: draft.revision,
        expectedRequestSha256: draft.requestSha256, requestId: makeRequestId(),
      }, controller.signal)
      if (controller.signal.aborted) return
      if (next.projectId !== projectId || next.frameId !== frameId
        || next.draftRevision !== draft.revision || next.draftRequestSha256 !== draft.requestSha256) {
        throw new Error('准备回执与当前已存草稿不匹配，请读取素材状态。')
      }
      setMaterials({ ...next, providerCalls: 0, databaseWrites: 0 })
    } catch (cause) {
      if (!controller.signal.aborted) {
        setMaterials(previous => previous === undefined ? previous : {
          ...previous, allReady: false, materials: previous.materials.map(material => (
            material.assetId === item.assetId && material.assetSha256 === item.assetSha256
              ? { ...material, status: 'unknown', expiresAt: null, failureCode: null }
              : material
          )),
        })
        setError(cause instanceof Error ? `${cause.message} 请读取素材状态确认。` : '素材准备结果未确认；请读取素材状态确认。')
      }
    } finally {
      if (prepareAbort.current === controller) preparing.current = false
      if (!controller.signal.aborted) setPreparingAssetId(undefined)
    }
  }

  const preview = async () => {
    if (busy) return
    previewAbort.current?.abort(); setResult(undefined); setQuoteResult(undefined); setError('')
    const controller = new AbortController(); previewAbort.current = controller; setBusy(true)
    try {
      const response = await port.referenceVideoPreview({ projectId, frameId, model: 'wan3.0-video',
        bindings: chosen.map(({ bindingToken, assetId, assetSha256, label }) => (
          { bindingToken, assetId, assetSha256, label }
        )),
        promptParts: parts, parameters, ...(directorSourceSha256 ? { directorSourceSha256 } : {}) }, controller.signal)
      if (!controller.signal.aborted) {
        setResult(response)
        setDraftState(previous => previous && { ...previous, directorSource: response.directorSource })
      }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '预览失败') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const quote = async () => {
    const draft = draftState?.draft
    if (busy || !draft || savedEpoch !== epoch.current || !sourceAccepted) return
    previewAbort.current?.abort(); setResult(undefined); setQuoteResult(undefined); setError('')
    const controller = new AbortController(); previewAbort.current = controller; setBusy(true)
    try {
      const response = await port.referenceVideoQuote({ projectId, ...draft.request,
        draftRevision: draft.revision, draftRequestSha256: draft.requestSha256 }, controller.signal)
      if (!controller.signal.aborted) { setResult(response.preview); setQuoteResult(response) }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '估算失败，请核对已存草稿') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  let images = 0; let audios = 0; let videos = 0
  const aliases = new Map(chosen.map((item, index) => [item.bindingToken, item.mediaType === 'reference_image' ? `图${++images}` : item.mediaType === 'reference_audio' ? `音频${++audios}` : item.mediaType === 'reference_video' ? `视频${++videos}` : `失效素材${index + 1}`]))
  const savedDraft = draftState?.draft
  const currentMaterials = materials !== undefined && savedDraft !== null && savedDraft !== undefined
    && materials.draftRevision === savedDraft.revision
    && materials.draftRequestSha256 === savedDraft.requestSha256 ? materials : undefined
  const canPrepareMaterials = currentMaterials?.configured === true && savedEpoch === epoch.current
    && sourceAccepted && preparingAssetId === undefined && port.prepareReferenceVideoMaterial !== undefined
  const move = (index: number, delta: number) => {
    const next = [...chosen]; const other = next[index + delta]; const current = next[index]
    if (!other || !current) return
    next[index + delta] = current; next[index] = other
    invalidate(); setChosen(next)
  }

  const Container = embedded ? 'section' : 'details'
  return <Container className={css.workspace} data-embedded={embedded || undefined} {...(embedded ? {} : { open: initialOpen })}>
    {!embedded && <summary>
      <span className={css.eyebrow}>SHOT REFERENCE DESK</span>
      <span>精确引用 · 导演稿与候选</span>
      <small>人物、场景、声音与镜头意图在同一处确认</small>
    </summary>}
    <div className={css.intro}>
      {!embedded && <div>
        <p className={css.kicker}>青木导演工作台</p>
        <h3>{shotLabel ?? '镜头'} {draftState?.draft ? `· 草稿 v${draftState.draft.revision}` : '· 当前试排'}</h3>
        <p>确认引用、写导演意图、核价后登记候选。已选素材和候选不会自动替换。</p>
      </div>}
      <div className={css.sceneStatus} aria-label="当前工作状态">
        <span>{images} 张图</span><span>{audios} 段音色</span><span>{videos} 段视频</span><span>{draftState?.draft ? `草稿 v${draftState.draft.revision}` : '未保存'}</span>
      </div>
    </div>
    <section className={css.draftBar} aria-label="草稿操作">
      <button type="button" disabled={saving} onClick={() => { void restore() }}>恢复已存草稿（替换当前试排）</button>
      <button className={css.primaryAction} type="button" disabled={saving || !draftState || !sourceAccepted || Boolean(draftState.draft && !draftLoaded) || chosen.length === 0 || chosen.some(item => item.mediaType === 'unavailable' || !item.label.trim())} onClick={() => { void save() }}>{saving ? '保存草稿…' : '保存引用草稿'}</button>
      <p role="status">{draftMessage}</p>
    </section>
    {port.readReferenceVideoMaterials !== undefined && <section className={css.materialsBar} aria-label="准备引用素材">
      <div>
        <p className={css.kicker}>ALI REFERENCE MATERIALS</p>
        <h4>准备引用素材</h4>
        <p>{savedEpoch !== epoch.current
          ? '先保存当前引用草稿，再将图片或音色上传到阿里临时素材区。'
          : currentMaterials === undefined
            ? '读取已保存草稿的临时素材状态。保存本地草稿不等于阿里可读。'
            : currentMaterials.configured
              ? '逐份准备图片、音色或参考视频；临时素材约 48 小时有效，不会生成视频。'
              : '阿里临时素材尚未配置；已可访问的参考素材仍可预览。'}</p>
      </div>
      <div className={css.materialActions}>
        <button type="button" disabled={materialsLoading || preparingAssetId !== undefined || !draftState?.draft || savedEpoch !== epoch.current}
          onClick={() => { if (draftState) void readMaterials(draftState) }}>
          {materialsLoading ? '读取准备状态…' : '读取准备状态'}
        </button>
        {currentMaterials?.configured === false && <small role="status">{configurationMessage(currentMaterials.configurationError)}</small>}
      </div>
    </section>}
    {!sourceAccepted && <p role="alert">镜头在上次保存后已变化，请核对当前描述和素材。
      <button type="button" onClick={() => { setSourceAccepted(true); invalidate() }}>基于当前镜头继续编辑</button>
    </p>}
    {draftState?.directorSource && <section aria-label="当前导演设计">
      <details><summary>查看当前导演设计与全片风格，核对下方生成稿</summary>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{draftState.directorSource.prompt}</pre>
      </details>
      {directorSourceSha256 !== draftState.directorSource.sha256 && <p role="status">
        导演设计尚未同步到这份生成稿。请结合设计修改运镜、表演、声音和引用，也可交给青木导演整理。
      </p>}
      {onRequestDirector && <button type="button" disabled={busy || saving || dirty} onClick={onRequestDirector}>展开导演助手</button>}
      <p>{dirty ? '先保存引用草稿，再交给导演整理。' : '导演读取已保存的草稿与最新设计，整理为一份生成稿；完成后点击“恢复已存草稿”查看。'}</p>
      <label><input type="checkbox" checked={directorSourceSha256 === draftState.directorSource.sha256}
        onChange={(event) => {
          setDirectorSourceSha256(event.target.checked ? draftState.directorSource?.sha256 : undefined); invalidate()
        }} />
        我已对照当前设计整理生成稿，保留所需细节并处理相互矛盾的描述
      </label>
    </section>}
    {chosen.some(item => item.mediaType === 'unavailable') && <p role="alert">部分素材已删除或版本已变化，请移除失效引用并重新选择。</p>}
    <div className={css.workbench}>
      <section className={css.referenceShelf} aria-label="参考素材">
        <div className={css.sectionHeading}>
          <div><p className={css.kicker}>REFERENCE LIBRARY</p><h4>参考素材</h4></div>
          <button type="button" disabled={loading || (page > 0 && page >= pages)} onClick={() => { void loadAssets() }}>
            {loading ? '读取素材…' : page === 0 ? '读取项目素材' : page < pages ? '更多素材' : '素材已读完'}
          </button>
          {page > 0 && <button type="button" disabled={loading} onClick={() => { void loadAssets(true) }}>刷新素材</button>}
        </div>
        {referenceSources && referenceSources.length > 0 && <div className={css.inheritReferences}>
          <label>沿用本场引用<select aria-label="引用来源镜头" value={inheritFrom} disabled={inheriting || saving}
            onChange={(event) => { inheritAbort.current?.abort(); setInheriting(false); setInheritFrom(event.target.value) }}>
            {referenceSources.filter(source => source.frameId !== frameId).map(source => (
              <option key={source.frameId} value={source.frameId}>{source.label}</option>
            ))}
          </select></label>
          <button type="button" disabled={inheriting || saving || !inheritFrom} onClick={() => { void inherit() }}>
            {inheriting ? '读取来源引用…' : '沿用引用'}
          </button>
          <small>保留本镜文字与参数，只合并已保存的素材引用。</small>
        </div>}
        <p className={css.note}>可引用已有镜头的表演、运镜与场面，或描述如何续接、修改。视频参考最多 5 段、合计 15 秒；输入与输出合计不超过 30 秒。先检查源片是否存在需要避免的缺陷。</p>
        {assets.length > 0 && <div className={css.assets} aria-label="项目素材">
          {assets.map(asset => <article key={`${asset.assetId}:${asset.assetSha256}`}>
            {asset.browserUrl && (asset.mediaType === 'reference_image'
              ? <img src={asset.browserUrl} alt={asset.label} loading="lazy" />
              : asset.mediaType === 'reference_video'
                ? <video src={asset.browserUrl} controls preload="metadata" aria-label={asset.label} />
                : <audio src={asset.browserUrl} controls preload="none" aria-label={asset.label} />)}
            {!asset.browserUrl && asset.mediaType === 'reference_image' && <div className={css.privateImage}>私有原图</div>}
            <p>{asset.label}</p>
            <ReferenceImageDesign asset={asset} />
            <div className={css.assetActions}>
              {(asset.localReferenceScope !== undefined || asset.localVoiceScope !== undefined) && asset.browserUrl === '' && <button type="button"
                onClick={() => { inspect(asset) }}>{asset.mediaType === 'reference_audio' ? '试听音色' : '查看原图'}</button>}
              <button type="button" disabled={chosen.some(item => item.assetId === asset.assetId)}
                onClick={() => { choose(asset) }}>加入引用</button>
            </div>
          </article>)}
        </div>}
        {inspected !== undefined && <section className={css.privatePreview} aria-label={inspected.mediaType === 'reference_audio' ? '本地音色试听' : '本地原图检视'}>
          <header><p className={css.kicker}>PRIVATE ORIGINAL</p><button type="button" onClick={() => { setInspected(undefined) }}>{inspected.mediaType === 'reference_audio' ? '关闭试听' : '关闭原图'}</button></header>
          <h5>{inspected.label}</h5>
          {localPreview?.url !== undefined
            ? inspected.mediaType === 'reference_audio'
              ? <audio controls src={localPreview.url} preload="metadata" aria-label={`${inspected.label} 音色试听`} />
              : <img src={localPreview.url} alt={`${inspected.label} 私有原图`} />
            : localPreview?.failed
              ? <div role="alert"><p>这份本地参考暂时无法读取。</p><button type="button" onClick={() => { setPreviewRetry(value => value + 1) }}>重新读取原图</button></div>
              : <p>正在读取这份私有参考。</p>}
        </section>}
        {chosen.length > 0 && <ol className={css.bindings} aria-label="引用顺序">
          {chosen.map((item, index) => <li key={item.bindingToken}>
            <strong>{aliases.get(item.bindingToken)} · {item.label}</strong>
            <ReferenceImageDesign asset={exactAsset(item.assetId, item.assetSha256)} />
            {(() => {
              const material = currentMaterials?.materials.find(candidate => candidate.bindingToken === item.bindingToken
                && candidate.assetId === item.assetId && candidate.assetSha256 === item.assetSha256)
              if (material === undefined) return currentMaterials === undefined ? null : <small className={css.materialStatus} data-state="unknown">准备状态未返回</small>
              return <span className={css.materialStatus} data-state={material.status}>{materialStatusText(material)}</span>
            })()}
            {(() => {
              const material = currentMaterials?.materials.find(candidate => candidate.bindingToken === item.bindingToken
                && candidate.assetId === item.assetId && candidate.assetSha256 === item.assetSha256)
              if (material === undefined || !currentMaterials?.configured) return null
              if (material.status === 'unknown' || material.status === 'uploading') return <small className={css.materialHint}>请读取准备状态确认回执；不会自动重传。</small>
              if (material.status === 'ready') return null
              return <button type="button" className={css.prepareAction} disabled={!canPrepareMaterials}
                onClick={() => { void prepareMaterial(item) }}>
                {preparingAssetId === item.assetId ? '正在准备…'
                  : material.status === 'expired' ? `重新准备${aliases.get(item.bindingToken)}`
                    : material.status === 'failed' ? `重试准备${aliases.get(item.bindingToken)}`
                      : `准备${aliases.get(item.bindingToken)}`}
              </button>
            })()}
            {(() => {
              const catalogAsset = exactAsset(item.assetId, item.assetSha256)
              if (catalogAsset !== undefined && (catalogAsset.localReferenceScope !== undefined || catalogAsset.localVoiceScope !== undefined) && catalogAsset.browserUrl === '') {
                return <button type="button" onClick={() => { inspect(catalogAsset) }}>查看{aliases.get(item.bindingToken)}</button>
              }
              return item.mediaType === 'reference_image' && catalogAsset === undefined
                ? <small className={css.previewHint}>读取项目素材后可查看原图</small>
                : null
            })()}
            <input aria-label={`${aliases.get(item.bindingToken)}名称`} value={item.label} maxLength={128}
              onChange={(event) => {
                invalidate()
                setChosen(previous => previous.map(old => old.bindingToken === item.bindingToken
                  ? { ...old, label: event.target.value } : old))
              }} />
            <div className={css.actions}>
              <button type="button" onClick={() => { insert(item.bindingToken) }}>插入{aliases.get(item.bindingToken)}</button>
              <button type="button" aria-label={`${item.label}前移`} disabled={index === 0} onClick={() => { move(index, -1) }}>前移</button>
              <button type="button" aria-label={`${item.label}后移`} disabled={index === chosen.length - 1} onClick={() => { move(index, 1) }}>后移</button>
              <button type="button" aria-label={`移除${item.label}`} onClick={() => { remove(item.bindingToken) }}>移除</button>
            </div>
          </li>)}
        </ol>}
      </section>
      <section className={css.directorDesk} aria-label="导演描述与参数">
        <div className={css.sectionHeading}><div><p className={css.kicker}>DIRECTOR'S NOTE</p><h4>视频描述</h4></div>
          <button type="button" disabled={!initialPrompt} onClick={() => { invalidate(); setParts([{ text: initialPrompt }]); activeText.current = { index: 0, start: initialPrompt.length, end: initialPrompt.length } }}>载入当前视频描述</button>
        </div>
        <div className={css.prompt}>
          {parts.map((part, index) => 'text' in part
            ? (() => {
              const connector = parts.length > 1 && part.text.trim().length <= 40 && !part.text.includes('\n')
              return <textarea key={index} aria-label={`视频描述片段${index + 1}`}
                className={parts.length === 1 ? css.singleDirectorText : connector ? css.connectorText : css.directorText}
                rows={parts.length === 1 ? 6 : connector ? 1 : 4} value={part.text}
                placeholder="描述本镜的动作、机位与对白；也可让导演助手保存后，恢复已存草稿。"
                onSelect={(event) => {
                  const field = event.currentTarget
                  activeText.current = { index, start: field.selectionStart, end: field.selectionEnd }
                }}
                onChange={(event) => {
                  invalidate(); const text = event.target.value
                  setParts(previous => previous.map((old, i) => i === index ? { text } : old))
                }} />
            })()
            : <button key={index} type="button" className={css.chip} aria-label={`移除描述引用${aliases.get(part.bindingToken)}`}
              onClick={() => {
                invalidate(); setParts(previous => previous.filter((_, i) => i !== index))
                activeText.current = { index: 0, start: 0, end: 0 }
              }}>
              {aliases.get(part.bindingToken)} · {chosen.find(item => item.bindingToken === part.bindingToken)?.label} ×
            </button>)}
        </div>
        <div className={css.parameters}>
          <label>时长（秒）<input type="number" min={2} max={30} value={parameters.duration} onChange={(event) => { invalidate(); setParameters({ ...parameters, duration: Number(event.target.value) }) }} /></label>
          <label>画质<select value={parameters.resolution} onChange={(event) => { invalidate(); setParameters({ ...parameters, resolution: event.target.value as ReferenceVideoParameters['resolution'] }) }}>
            {['480P', '720P', '1080P'].map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label>画幅<select value={parameters.ratio} onChange={(event) => { invalidate(); setParameters({ ...parameters, ratio: event.target.value as ReferenceVideoParameters['ratio'] }) }}>
            {['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'].map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label><input type="checkbox" checked={parameters.audio} onChange={(event) => { invalidate(); setParameters({ ...parameters, audio: event.target.checked }) }} />原生声音</label>
          <label><input type="checkbox" checked={parameters.prompt_extend} onChange={(event) => { invalidate(); setParameters({ ...parameters, prompt_extend: event.target.checked }) }} />模型扩写描述</label>
        </div>
        <div className={css.previewActions}>
          <button type="button" disabled={busy || images + videos === 0 || chosen.some(item => item.mediaType === 'unavailable' || !item.label.trim())} onClick={() => { void preview() }}>{busy ? '核对素材与请求…' : '预览实际请求'}</button>
          <button className={css.primaryAction} type="button" disabled={busy || saving || !draftState?.draft || savedEpoch !== epoch.current || !sourceAccepted} onClick={() => { void quote() }}>估算已存草稿费用</button>
        </div>
        {quoteResult && <p className={css.quote} role="status">目录价估算 ¥{Number(quoteResult.cost.estimatedCny).toFixed(2)} · 1 个视频 · 计费 {quoteResult.cost.billableSeconds} 秒（输出 {quoteResult.preview.body.parameters.duration} 秒{(quoteResult.preview.referenceVideoDurationSec ?? 0) > 0 && <> + 输入 {quoteResult.preview.referenceVideoDurationSec} 秒</>}）。
          未扣费；未计账户折扣，实际结算以阿里账单为准。{!quoteResult.generationSubmissionEnabled
            && <>当前实例未启用付费生成，估算仅供核对。</>}<a href={quoteResult.cost.sourceUrl} target="_blank" rel="noreferrer">查看价格</a></p>}
      </section>
      <aside className={css.previewColumn} aria-label="镜头预览与候选">
        <div className={css.previewPlaceholder}>
          <p className={css.kicker}>SHOT PREVIEW</p><h4>{result ? '请求已核对' : '候选预览区'}</h4>
          <p>{result ? '这次请求的引用与参数已核对。生成后视频会在下方等待你审看。' : '保存并核价后，在这里查看候选视频。'}</p>
        </div>
        {result && <section className={css.requestPreview} aria-label="阿里请求预览" aria-live="polite">
          <p className={css.kicker}>REQUEST PREVIEW</p><h4>将发送的描述</h4><p className={css.compiled}>{result.body.input.prompt}</p>
          <p>{result.body.parameters.duration} 秒 · {result.body.parameters.resolution} · {result.body.parameters.ratio}
            {' · '}音色合计 {result.referenceAudioDurationSec} 秒{(result.referenceVideoDurationSec ?? 0) > 0 && <> · 视频参考合计 {result.referenceVideoDurationSec} 秒</>}</p>
          <p className={css.note}>这是当前核对的请求。生成进度见候选视频区。</p>
          <details><summary>查看引用版本与完整请求</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
        </section>}
        <ReferenceVideoRuns projectId={projectId} frameId={frameId} quote={quoteResult}
          port={port} onOpenShooting={onOpenShooting} onReferenceSaved={() => { void loadAssets(true) }} />
      </aside>
    </div>
    {error && <p role="alert">{error}</p>}
    <p className={css.note}>引用草稿按镜头保存。刷新后可恢复已保存内容；保存不会采用素材或启动生成。</p>
  </Container>
}
