// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ShootingFirstFrame, assertShootingPreview } from '../src/client/ShootingFirstFrame.tsx'
import type { AssetImageReferencePort } from '../src/client/AssetImageReferences.tsx'
const scope = { projectId:'project-1',episodeId:'episode-1',frameId:'frame-4' }
const preview = { ...scope,schema:'qingmu.shooting-first-frame-preview.v1',preflightId:'a'.repeat(64),payloadHash:'b'.repeat(64),prompt:'POV视点人物：杰克；独立入画人物：莉娜',povObserver:'杰克',estimatedCny:.2,blockers:[],n:1,maxAttempts:1,selectAsOfficial:false }
const result = { ...scope,schema:'qingmu.shooting-first-frame-state.v1',requestId:`shooting-${preview.preflightId}`,task:{ id:'task-one',kernel_status:'Succeeded' },candidate:{ assetId:'asset-new',sha256:'c'.repeat(64),browserUrl:'http://127.0.0.1:65269/api/media/media-new',isSelected:false,qualityStatus:'pending' } }
const review = { ...scope, frameDigest:'d'.repeat(64),accepted:true,title:'驾驶视点',imagePromptCn:'当前分镜要求',preflight:{ technicalReady:true } }
function jsonBody(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body
  if (typeof body !== 'string') throw new Error('expected a JSON string request body')
  return JSON.parse(body) as Record<string, unknown>
}
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
it('restores human sign-in inline but waits for another click on the newly displayed revision', async () => {
  let signedIn = false
  const updated = { ...review, accepted:false, frameDigest:'e'.repeat(64), imagePromptCn:'登录期间已更新的分镜要求' }
  const fetcher = vi.fn(async (path:string, init?:RequestInit) => {
    if (path.endsWith('/human-session')) {
      expect(JSON.parse(String(init?.body))).toEqual({ username:'human-test',password:'private-test' })
      signedIn = true
      return Response.json({ ok:true })
    }
    if (path.endsWith('/confirm')) {
      if (!signedIn) return Response.json({ detail:'请登录本人账户' },{ status:401 })
      expect(JSON.parse(String(init?.body)).expected_frame_digest).toBe(updated.frameDigest)
      return Response.json({ status:{ ...updated,accepted:true } })
    }
    return Response.json(path.includes('/review?') ? signedIn ? updated : { ...review,accepted:false } : preview)
  })
  vi.stubGlobal('fetch',fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  fireEvent.click(await screen.findByRole('button',{ name:'确认本镜分镜' }))
  await screen.findByRole('form',{ name:'恢复分镜确认登录' })
  fireEvent.change(screen.getByLabelText('账户'),{ target:{ value:'human-test' } })
  fireEvent.change(screen.getByLabelText('密码'),{ target:{ value:'private-test' } })
  fireEvent.click(screen.getByRole('button',{ name:'登录本人账户' }))
  await screen.findByText(updated.imagePromptCn)
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/confirm'))).toHaveLength(1)
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/submit'))).toBe(false)
  expect(document.body.textContent).not.toContain('private-test')
  expect(JSON.stringify(localStorage)).not.toContain('private-test')
  fireEvent.click(await screen.findByRole('button',{ name:'确认本镜分镜' }))
  await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/confirm'))).toHaveLength(2))
})
it('allows recovery when an expired browser cookie prevents the initial read, and clears failed passwords', async () => {
  const fetcher = vi.fn(async (_path:string) => Response.json({ detail:'expired' },{ status:401 }))
  vi.stubGlobal('fetch',fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  await screen.findByRole('form',{ name:'恢复分镜确认登录' })
  fireEvent.change(screen.getByLabelText('账户'),{ target:{ value:'human-test' } })
  fireEvent.change(screen.getByLabelText('密码'),{ target:{ value:'incorrect' } })
  fireEvent.click(screen.getByRole('button',{ name:'登录本人账户' }))
  await screen.findByText('登录未完成，请检查账户和密码后重试。')
  expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('')
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/confirm') || path.endsWith('/submit'))).toBe(false)
})
it.each([
  ['DispatchPending', '首帧任务已入队，等待派发进度更新；请勿重复生成。'],
  ['QualityPending', '正在检查生成结果并准备候选，尚未人工认可。'],
  ['Succeeded', '任务已结束，但候选尚未就绪，需要检查结果落盘；未重新生成。'],
])('renders %s from the original receipt without claiming generation or resubmitting', async (kernel_status, message) => {
  localStorage.setItem(`qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`,
    JSON.stringify({ preview, requestId:result.requestId }))
  const fetcher = vi.fn(async (path:string) => ({ ok:true,json:async () => path.includes('/review?') ? review
    : { ...result,task:{ id:'task-one',kernel_status },candidate:null } }))
  vi.stubGlobal('fetch',fetcher)
  const view = render(<ShootingFirstFrame scope={scope} />)
  await screen.findByText(message)
  view.unmount(); render(<ShootingFirstFrame scope={scope} />)
  await screen.findByText(message)
  expect(fetcher.mock.calls.every(([path]) => path.includes('/state?') || path.includes('/review?'))).toBe(true)
  expect(screen.queryByRole('button',{ name:'生成这张首帧（仅一次）' })).toBeNull()
})
it('does not claim an unsubmitted provider outcome while dispatch is in flight', async () => {
  localStorage.setItem(`qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`,
    JSON.stringify({ preview, requestId:result.requestId }))
  vi.stubGlobal('fetch',vi.fn(async (path:string) => ({ ok:true,json:async () => path.includes('/review?') ? review
    : { ...result,task:{ id:'task-one',kernel_status:'DispatchPending',local_status:'dispatching',provider_status:'DISPATCHING' },candidate:null } })))
  render(<ShootingFirstFrame scope={scope} />)
  await screen.findByText('正在提交原首帧请求，等待供应商回执；请勿重复生成。')
  expect(screen.queryByText(/尚未提交供应商/)).toBeNull()
  expect(screen.queryByRole('button',{ name:'生成这张首帧（仅一次）' })).toBeNull()
})
it('keeps reading after the image arrives until the original task settles', async () => {
  localStorage.setItem(`qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`,
    JSON.stringify({ preview, requestId:result.requestId }))
  let settled = false
  const fetcher = vi.fn(async (path:string) => ({ ok:true,json:async () => path.includes('/review?') ? review
    : { ...result, canActivate:!settled,canRegenerate:settled,
      task:{ id:'task-one',kernel_status:settled ? 'Succeeded' : 'QualityPending' } } }))
  vi.stubGlobal('fetch',fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  await screen.findByAltText('镜头新首帧 · 待你定版')
  expect(screen.getByRole('button',{ name:'继续原首帧任务' })).toBeTruthy()
  settled = true
  await waitFor(() => { expect(screen.getByRole('button',{ name:'重新生成首帧' })).toBeTruthy() }, { timeout:5500 })
  expect(screen.queryByRole('button',{ name:'继续原首帧任务' })).toBeNull()
  expect(fetcher.mock.calls.every(([path]) => path.includes('/state?') || path.includes('/review?'))).toBe(true)
})
it('shows full prompt, submits once and restores by GET after remount', async () => {
  localStorage.clear()
  const fetcher = vi.fn(async (path:string) => ({ ok:true,json:async () => path.includes('/review?') ? review : path.endsWith('/preview') ? preview : result }))
  vi.stubGlobal('fetch',fetcher)
  const view = render(<ShootingFirstFrame scope={scope} />)
  const button = await screen.findByRole('button',{ name:'生成这张首帧（仅一次）' })
  expect(screen.getByText(preview.prompt)).toBeTruthy()
  fireEvent.click(button); fireEvent.click(button)
  await screen.findByAltText('镜头新首帧 · 待你定版')
  view.unmount(); render(<ShootingFirstFrame scope={scope} />)
  await screen.findByAltText('镜头新首帧 · 待你定版')
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(1)
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/preview'))).toHaveLength(1)
  expect(screen.queryByRole('button',{ name:'采用这张' })).toBeNull()
})
it('notifies once per materialized request across remounts while still notifying a new request', async () => {
  const key = `qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`
  localStorage.setItem(key, JSON.stringify({ preview, requestId:result.requestId }))
  let current = result
  const fetcher = vi.fn(async (path:string) => Response.json(path.includes('/review?') ? review : current))
  vi.stubGlobal('fetch',fetcher)
  const onCommitted = vi.fn(async () => undefined)
  const first = render(<ShootingFirstFrame scope={scope} onCommitted={onCommitted} />)
  await screen.findByAltText('镜头新首帧 · 待你定版')
  await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1))
  first.unmount()
  const restored = render(<ShootingFirstFrame scope={scope} onCommitted={onCommitted} />)
  await screen.findByAltText('镜头新首帧 · 待你定版')
  expect(onCommitted).toHaveBeenCalledTimes(1)
  restored.unmount()
  const next = { ...preview,preflightId:'e'.repeat(64) }
  current = { ...result,requestId:`shooting-${next.preflightId}` }
  localStorage.setItem(key, JSON.stringify({ preview:next,requestId:current.requestId }))
  render(<ShootingFirstFrame scope={scope} onCommitted={onCommitted} />)
  await screen.findByAltText('镜头新首帧 · 待你定版')
  await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(2))
  expect(fetcher.mock.calls.every(([path]) => path.includes('/state?') || path.includes('/review?'))).toBe(true)
  expect(screen.queryByRole('button',{ name:'采用这张' })).toBeNull()
})
it('does not POST again after a lost submit response', async () => {
  localStorage.clear()
  const fetcher = vi.fn(async (path:string) => {
    if (path.endsWith('/submit')) throw new Error('connection lost')
    return { ok:true,json:async () => path.includes('/review?') ? review : path.endsWith('/preview') ? preview : { ...result,candidate:null,task:{ id:'task-one',kernel_status:'Failed' } } }
  })
  vi.stubGlobal('fetch',fetcher)
  const view = render(<ShootingFirstFrame scope={scope} />)
  fireEvent.click(await screen.findByRole('button',{ name:'生成这张首帧（仅一次）' }))
  await waitFor(() => { expect(fetcher.mock.calls.some(([path]) => path.endsWith('/submit'))).toBe(true) })
  view.unmount(); render(<ShootingFirstFrame scope={scope} />)
  await screen.findByText('本次生成未完成，已停止，不自动重试。')
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(1)
})

it('shows an activation rejection instead of pretending the pending job is running', async () => {
  const pending = { ...result, candidate:null, canActivate:true, task:{ id:'task-one',kernel_status:'DispatchPending' } }
  const fetcher = vi.fn(async (path:string) => ({ ok:true,json:async () => path.includes('/review?') ? review : path.endsWith('/preview') ? preview
    : path.endsWith('/submit') ? { ...pending,execution:{ taskId:'task-one',activated:false,state:'activation_pending_verification' } } : pending }))
  vi.stubGlobal('fetch',fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  fireEvent.click(await screen.findByRole('button',{ name:'生成这张首帧（仅一次）' }))
  expect((await screen.findByRole('alert')).textContent).toContain('执行器尚未启动')
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(1)
})
it('blocks malformed, cross-frame or multi-attempt previews', () => {
  for (const patch of [{ frameId:'other' },{ maxAttempts:2 },{ n:2 },{ selectAsOfficial:true },{ payloadHash:'bad' }]) expect(() => assertShootingPreview({ ...preview,...patch },scope)).toThrow()
})
it('shows the actual shared-layout preview and reference numbering before submission', async () => {
  const composition = { imageUrl: 'data:image/png;base64,AA==', sha256: 'e'.repeat(64), sceneName: '修理室' }
  const quoted = { ...preview, references: [{ kind: '场景图', name: '修理室', role: 'scene_reference' }], compositionReference: composition }
  const fetcher = vi.fn(async (path: string) => ({ ok: true, json: async () => path.includes('/review?') ? review : quoted }))
  vi.stubGlobal('fetch', fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  expect((await screen.findByAltText('修理室的本镜空间取景参考')).getAttribute('src')).toBe(composition.imageUrl)
  expect(screen.getByText('图1 · 场景图 · 修理室')).toBeTruthy()
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/submit'))).toBe(false)
  expect(() => assertShootingPreview({ ...quoted, compositionReference: { ...composition, imageUrl: 'https://example.test/a' } }, scope)).toThrow()
})
it('prepares a distinct rework only after a click, persists it across refresh, and submits once', async () => {
  const next = { ...preview, preflightId:'e'.repeat(64), attemptOrdinal:2 }
  const nextId = `shooting-${next.preflightId}`
  localStorage.setItem(`qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`, JSON.stringify({ preview, requestId:result.requestId }))
  const fetcher = vi.fn(async (path:string, init?:RequestInit) => {
    if (path.endsWith('/preview')) expect(jsonBody(init).candidate_request_id).toBe(result.requestId)
    if (path.endsWith('/submit')) expect(jsonBody(init).candidate_request_id).toBe(nextId)
    return { ok:true,json:async () => path.includes('/review?') ? review : path.endsWith('/preview') ? next
      : path.includes(nextId) || path.endsWith('/submit') ? { ...result,requestId:nextId,canRegenerate:false }
        : { ...result,canRegenerate:true } }
  })
  vi.stubGlobal('fetch',fetcher)
  const view = render(<ShootingFirstFrame scope={scope} />)
  fireEvent.click(await screen.findByRole('button',{ name:'重新生成首帧' }))
  await screen.findByRole('button',{ name:'生成这张首帧（仅一次）' })
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(0)
  view.unmount(); const second = render(<ShootingFirstFrame scope={scope} />)
  const submit = await screen.findByRole('button',{ name:'生成这张首帧（仅一次）' })
  fireEvent.click(submit); fireEvent.click(submit)
  await screen.findByAltText('镜头新首帧 · 待你定版')
  second.unmount(); render(<ShootingFirstFrame scope={scope} />)
  await screen.findByAltText('镜头新首帧 · 待你定版')
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(1)
  expect(screen.queryByRole('button',{ name:'重新生成首帧' })).toBeNull()
})
it.each(['DispatchPending', 'ProviderPending', 'QualityPending'])('explicit %s resume preserves the original task identity and cannot prepare a new attempt', async (kernelStatus) => {
  localStorage.setItem(`qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`, JSON.stringify({ preview, requestId:result.requestId }))
  const fetcher = vi.fn(async (path:string, init?:RequestInit) => {
    if (path.endsWith('/submit')) expect(jsonBody(init).candidate_request_id).toBe(result.requestId)
    return { ok:true,json:async () => path.includes('/review?') ? review : { ...result,candidate:null,canRegenerate:false,canActivate:true,task:{ id:'original',kernel_status:kernelStatus } } }
  })
  vi.stubGlobal('fetch',fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  const button = await screen.findByRole('button',{ name:'继续原首帧任务' })
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(0)
  fireEvent.click(button); fireEvent.click(button)
  await waitFor(() => { expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(1) })
  expect(screen.queryByRole('button',{ name:'重新生成首帧' })).toBeNull()
})
it('restores a rejected request as an explicit stage blocker without another POST', async () => {
  localStorage.setItem(`qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`,
    JSON.stringify({ preview,requestId:result.requestId }))
  const fetcher = vi.fn(async (path:string) => ({ ok:true,json:async () => path.includes('/review?') ? { ...review,accepted:false } : ({ ...result,task:null,candidate:null,
    submissionBlocker:{ code:'storyboard_human_review_required',message:'请先逐镜确认分镜内容和提示词，再开始生成。' } }) }))
  vi.stubGlobal('fetch',fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  await screen.findByText('先确认本镜分镜')
  expect(screen.getByText('当前分镜要求')).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('正在核对原提交结果；不会重复提交。')).toBeNull()
  expect(screen.queryByRole('button',{ name:'生成这张首帧（仅一次）' })).toBeNull()
})
it('shows the original stage blocker during preview and never offers paid submit', async () => {
  vi.stubGlobal('fetch',vi.fn(async (path:string) => ({ ok:true,json:async () => path.includes('/review?') ? { ...review,accepted:false } : ({ ...preview,
    blockers:['existing_stage_gate_blocked'],submissionBlocker:{ message:'分镜签收已过期' } }) })))
  render(<ShootingFirstFrame scope={scope} />)
  await screen.findByText('先确认本镜分镜')
  expect(screen.getByText(/"message": "分镜签收已过期"/)).toBeTruthy()
  expect(screen.queryByRole('button',{ name:'生成这张首帧（仅一次）' })).toBeNull()
})
it('only a human click confirms the displayed SHA; confirmation never submits or adopts media', async () => {
  let accepted = false
  const fetcher = vi.fn(async (path:string, init?:RequestInit) => {
    if (path.endsWith('/confirm')) {
      expect(jsonBody(init).expected_frame_digest).toBe(review.frameDigest)
      accepted = true
      return { ok:true,json:async () => ({ status:review }) }
    }
    return { ok:true,json:async () => path.includes('/review?') ? { ...review,accepted } : {
      ...preview,blockers:accepted ? [] : ['existing_stage_gate_blocked'],
      ...(accepted ? {} : { submissionBlocker:{ message:'请先确认本镜分镜' } }),
    } }
  })
  vi.stubGlobal('fetch',fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  const button = await screen.findByRole('button',{ name:'确认本镜分镜' })
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/confirm') || path.endsWith('/submit'))).toHaveLength(0)
  fireEvent.click(button); fireEvent.click(button)
  await screen.findByRole('button',{ name:'生成这张首帧（仅一次）' })
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/confirm'))).toHaveLength(1)
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(0)
})
it('stale revision rejection never signs a newly fetched revision or submits', async () => {
  const fetcher = vi.fn(async (path:string) => ({ ok:!path.endsWith('/confirm'),json:async () =>
    path.endsWith('/confirm') ? { detail:'storyboard_human_review_frame_digest_mismatch' }
      : path.includes('/review?') ? { ...review,accepted:false } : { ...preview,blockers:['review_stale'] } }))
  vi.stubGlobal('fetch',fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  fireEvent.click(await screen.findByRole('button',{ name:'确认本镜分镜' }))
  expect((await screen.findByRole('alert')).textContent).toContain('本次没有确认')
  expect(screen.getByText(/storyboard_human_review_frame_digest_mismatch/).closest('details')?.open).toBe(false)
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/confirm'))).toHaveLength(1)
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(0)
})
it('refresh after successful confirmation never repeats confirmation or generation', async () => {
  localStorage.setItem(`qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`,
    JSON.stringify({ preview,requestId:result.requestId }))
  const fetcher = vi.fn(async (path:string) => ({ ok:true,json:async () => path.includes('/review?') ? review
    : path.endsWith('/preview') ? preview : { ...result,task:null,candidate:null } }))
  vi.stubGlobal('fetch',fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  fireEvent.click(await screen.findByRole('button',{ name:'重新检查本镜生成条件' }))
  await screen.findByRole('button',{ name:'生成这张首帧（仅一次）' })
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/confirm') || path.endsWith('/submit'))).toHaveLength(0)
})
it('does not read a preview or submit when the current shot has no saved requirement', async () => {
  const returnToStoryboard = vi.fn()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(<ShootingFirstFrame scope={scope} requirementsReady={false} onReturnToStoryboard={returnToStoryboard} />)
  expect(screen.getByText('先核对本镜分镜要求')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '生成这张首帧（仅一次）' })).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '返回分镜核对要求' }))
  expect(returnToStoryboard).toHaveBeenCalledTimes(1)
})
it('keeps reading an existing task when requirements are unavailable, without preparing or submitting', async () => {
  localStorage.setItem(`qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`,
    JSON.stringify({ preview, requestId: result.requestId }))
  const fetcher = vi.fn(async (path: string) => {
    void path
    return { ok: true, json: async () => ({ ...result, candidate: null, task: { id: 'task-one', kernel_status: 'Succeeded' } }) }
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ShootingFirstFrame scope={scope} requirementsReady={false} />)
  await screen.findByText('正在读取已存在首帧任务；不会重新提交。')
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => path.includes('/state?'))).toBe(true))
  expect(fetcher.mock.calls.every(([path]) => path.includes('/state?'))).toBe(true)
  expect(screen.queryByRole('button', { name: '生成这张首帧（仅一次）' })).toBeNull()
})

it('chooses exact working images, prepares without signoff, and prevents generation after reference edits', async () => {
  const ref={ assetId:'working-scene',assetSha256:'f'.repeat(64),purpose:'保持房间门窗，人物位置按本镜设计。',boxes:[] }
  const working={ ...preview,referenceMode:'working',referenceBindings:[ref] }
  const fetcher=vi.fn(async (path:string,init?:RequestInit) => {
    if (path.includes('/review?')) return Response.json({ ...review,accepted:false })
    if (path.endsWith('/preview')) {
      const body=JSON.parse(String(init?.body))
      if (!body.reference_images) return Response.json({ detail:'first_frame_reference_not_ready' },{ status:409 })
      expect(body.reference_images[0].assetId).toBe(ref.assetId)
      return Response.json({ ...working, referenceBindings: body.reference_images })
    }
    return Response.json(result)
  })
  vi.stubGlobal('fetch',fetcher)
  const referencePort={ referenceVideoAssets:vi.fn(async () => ({ items:[{ assetId:ref.assetId,assetSha256:ref.assetSha256,
    mediaType:'reference_image',label:'工作场景图',browserUrl:'' }],pages:1 })), readLocalReferenceCandidateContent:vi.fn() }
  const view=render(<ShootingFirstFrame scope={scope} referencePort={referencePort as unknown as AssetImageReferencePort} />)
  await screen.findByText(/尚未定版所需参考素材/)
  await waitFor(() => expect(screen.getByRole('option',{ name:'工作场景图',hidden:true })).toBeTruthy())
  fireEvent.change(screen.getByLabelText('添加参考图'),{ target:{ value:ref.assetId } })
  fireEvent.change(screen.getByLabelText('图 1 的用途'),{ target:{ value:ref.purpose } })
  fireEvent.click(screen.getByRole('button',{ name:'用这些图片准备首帧',hidden:true }))
  await screen.findByRole('button',{ name:'生成这张首帧（仅一次）' })
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/confirm') || path.endsWith('/submit'))).toBe(false)
  fireEvent.change(screen.getByLabelText('图 1 的用途'),{ target:{ value:'修改后的用途' } })
  expect(screen.queryByRole('button',{ name:'生成这张首帧（仅一次）' })).toBeNull()
  view.unmount()
  render(<ShootingFirstFrame scope={scope} referencePort={referencePort as unknown as AssetImageReferencePort} />)
  await waitFor(() => expect((screen.getByLabelText('图 1 的用途') as HTMLTextAreaElement).value).toBe('修改后的用途'))
  expect(screen.queryByRole('button',{ name:'生成这张首帧（仅一次）' })).toBeNull()
  expect(screen.getByRole('status').textContent).toMatchSnapshot('unprepared reference edit survives reload')
  fireEvent.click(screen.getByRole('button',{ name:'用这些图片准备首帧',hidden:true }))
  fireEvent.click(await screen.findByRole('button',{ name:'生成这张首帧（仅一次）' }))
  await screen.findByAltText('镜头新首帧 · 待你定版')
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(1)
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/confirm'))).toBe(false)
})

it('recovers an unqueued working request and retains its references across another reload', async () => {
  const ref = { assetId: 'scene', assetSha256: 'f'.repeat(64), purpose: '保留已选场景', boxes: [] }
  const working = { ...preview, referenceMode: 'working', referenceBindings: [ref] }
  const key = `qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`
  localStorage.setItem(key, JSON.stringify({ preview: working, requestId: `shooting-${preview.preflightId}`, stage: 'submitted' }))
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/review?')) return Response.json({ ...review, accepted: false })
    if (path.endsWith('/preview')) {
      expect(JSON.parse(String(init?.body)).reference_images).toEqual([ref])
      return Response.json(working)
    }
    return Response.json({ ...result, task: null, candidate: null })
  })
  vi.stubGlobal('fetch', fetcher)
  const view = render(<ShootingFirstFrame scope={scope} />)
  fireEvent.click(await screen.findByRole('button', { name: '重新检查本镜生成条件' }))
  await screen.findByRole('button', { name: '生成这张首帧（仅一次）' })
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ stage: 'prepared', preview: { referenceBindings: [ref] } })
  view.unmount(); render(<ShootingFirstFrame scope={scope} />)
  await screen.findByRole('button', { name: '生成这张首帧（仅一次）' })
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/submit') || path.endsWith('/confirm'))).toBe(false)
})

it('keeps reference edits before preparation and isolates another shot from that draft', async () => {
  const ref = { assetId: 'scene', assetSha256: 'f'.repeat(64), purpose: '', boxes: [] }
  const referencePort = { referenceVideoAssets: vi.fn(async () => ({ items: [{ ...ref,
    mediaType: 'reference_image', label: '场景图', browserUrl: '' }], pages: 1 })), readLocalReferenceCandidateContent: vi.fn() }
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/review?')) return Response.json({ ...review, frameId: new URL(path, 'http://localhost').searchParams.get('frame_id') })
    const body = JSON.parse(String(init?.body))
    return Response.json({ ...preview, frameId: body.frame_ids[0] })
  })
  vi.stubGlobal('fetch', fetcher)
  const props = { scope, referencePort: referencePort as unknown as AssetImageReferencePort }
  const first = render(<ShootingFirstFrame {...props} />)
  await screen.findByRole('button', { name: '生成这张首帧（仅一次）' })
  fireEvent.change(screen.getByLabelText('添加参考图'), { target: { value: ref.assetId } })
  fireEvent.change(screen.getByLabelText('图 1 的用途'), { target: { value: '保留门窗和尺度，未准备的新用途' } })
  expect(screen.queryByRole('button', { name: '生成这张首帧（仅一次）' })).toBeNull()
  first.unmount()
  const second = render(<ShootingFirstFrame {...props} />)
  await waitFor(() => expect((screen.getByLabelText('图 1 的用途') as HTMLTextAreaElement).value).toBe('保留门窗和尺度，未准备的新用途'))
  expect(screen.queryByRole('button', { name: '生成这张首帧（仅一次）' })).toBeNull()
  second.unmount()
  const other = render(<ShootingFirstFrame {...props} scope={{ ...scope, frameId: 'another-frame' }} />)
  await screen.findByRole('button', { name: '生成这张首帧（仅一次）' })
  expect(screen.queryByLabelText('图 1 的用途')).toBeNull()
  other.unmount()
  render(<ShootingFirstFrame {...props} />)
  await screen.findByLabelText('图 1 的用途')
  fireEvent.click(screen.getByRole('button', { name: '移除此引用', hidden: true }))
  cleanup(); render(<ShootingFirstFrame {...props} />)
  await screen.findByRole('button', { name: '生成这张首帧（仅一次）' })
  expect(screen.queryByLabelText('图 1 的用途')).toBeNull()
  expect(fetcher.mock.calls.every(([path]) => path.includes('/review?') || path.endsWith('/preview'))).toBe(true)
})

it('blocks a damaged reference draft instead of offering an older prepared request', async () => {
  const key = `qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`
  localStorage.setItem(key, JSON.stringify({ preview, requestId: result.requestId, stage: 'prepared' }))
  localStorage.setItem(`${key}:reference-draft`, JSON.stringify([{ assetId: 'scene', assetSha256: 'invalid', purpose: '新版' }]))
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(review)))
  const referencePort = { referenceVideoAssets: vi.fn(async () => ({ items: [], pages: 1 })) }
  render(<ShootingFirstFrame scope={scope} referencePort={referencePort as unknown as AssetImageReferencePort} />)
  await screen.findByText('引用草稿无法读取，请重新选择参考图。原生成记录仍保留，尚未重新提交。')
  expect(screen.queryByRole('button', { name: '生成这张首帧（仅一次）' })).toBeNull()
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ stage: 'prepared', preview })
})

it('recovers submitted inputs even when a different editable reference draft exists', async () => {
  const key = `qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`
  const original = { assetId: 'original-scene', assetSha256: 'f'.repeat(64), purpose: '已提交原用途', boxes: [] }
  const submitted = { ...preview, referenceMode: 'working', referenceBindings: [original] }
  localStorage.setItem(key, JSON.stringify({ preview: submitted, requestId: result.requestId, stage: 'submitted' }))
  localStorage.setItem(`${key}:reference-draft`, JSON.stringify([{ ...original, purpose: '本地未提交改动' }]))
  const fetcher = vi.fn(async (path: string) => Response.json(path.includes('/review?') ? review : result))
  vi.stubGlobal('fetch', fetcher)
  const referencePort = { referenceVideoAssets: vi.fn(async () => ({ items: [], pages: 1 })) }
  render(<ShootingFirstFrame scope={scope} referencePort={referencePort as unknown as AssetImageReferencePort} />)
  await screen.findByAltText('镜头新首帧 · 待你定版')
  expect((screen.getByLabelText('图 1 的用途') as HTMLTextAreaElement).value).toBe(original.purpose)
  expect(fetcher.mock.calls.every(([path]) => path.includes('/review?') || path.includes('/state?'))).toBe(true)
})

it('keeps an unwritable purpose edit visible and prevents generation from the older preparation', async () => {
  const ref = { assetId: 'scene', assetSha256: 'f'.repeat(64), purpose: '原用途', boxes: [] }
  const key = `qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`
  localStorage.setItem(key, JSON.stringify({ preview: { ...preview, referenceMode: 'working', referenceBindings: [ref] },
    requestId: result.requestId, stage: 'prepared' }))
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(review)))
  const referencePort = { referenceVideoAssets: vi.fn(async () => ({ items: [], pages: 1 })) }
  render(<ShootingFirstFrame scope={scope} referencePort={referencePort as unknown as AssetImageReferencePort} />)
  await screen.findByRole('button', { name: '生成这张首帧（仅一次）' })
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
  try {
    fireEvent.change(screen.getByLabelText('图 1 的用途'), { target: { value: '不能丢失的用途修订' } })
    expect((screen.getByLabelText('图 1 的用途') as HTMLTextAreaElement).value).toBe('不能丢失的用途修订')
    await screen.findByText('引用修改暂未保存到本机，请保留本页并重试。尚未提交生成。')
    expect(screen.queryByRole('button', { name: '生成这张首帧（仅一次）' })).toBeNull()
    expect(JSON.parse(localStorage.getItem(key)!).preview.referenceBindings).toEqual([ref])
  } finally { write.mockRestore() }
})
