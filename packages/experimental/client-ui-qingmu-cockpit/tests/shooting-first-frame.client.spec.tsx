// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ShootingFirstFrame, assertShootingPreview } from '../src/client/ShootingFirstFrame.tsx'
const scope = { projectId:'project-1',episodeId:'episode-1',frameId:'frame-4' }
const preview = { ...scope,schema:'qingmu.shooting-first-frame-preview.v1',preflightId:'a'.repeat(64),payloadHash:'b'.repeat(64),prompt:'POV视点人物：杰克；独立入画人物：莉娜',povObserver:'杰克',estimatedCny:.2,blockers:[],n:1,maxAttempts:1,selectAsOfficial:false }
const result = { ...scope,schema:'qingmu.shooting-first-frame-state.v1',requestId:`shooting-${preview.preflightId}`,task:{ id:'task-one',kernel_status:'Succeeded' },candidate:{ assetId:'asset-new',sha256:'c'.repeat(64),browserUrl:'http://127.0.0.1:65269/api/media/media-new',isSelected:false,qualityStatus:'pending' } }
const review = { ...scope, frameDigest:'d'.repeat(64),accepted:true,title:'驾驶视点',imagePromptCn:'当前分镜要求',preflight:{ technicalReady:true } }
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
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
  await screen.findByText('首帧任务已入队，等待派发进度更新；请勿重复生成。')
  expect(screen.queryByText(/尚未提交供应商/)).toBeNull()
  expect(screen.queryByRole('button',{ name:'生成这张首帧（仅一次）' })).toBeNull()
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
it('does not POST again after a lost submit response', async () => {
  localStorage.clear()
  const fetcher = vi.fn(async (path:string) => {
    if (path.endsWith('/submit')) throw new Error('connection lost')
    return { ok:true,json:async () => path.includes('/review?') ? review : path.endsWith('/preview') ? preview : { ...result,candidate:null,task:{ id:'task-one',kernel_status:'Failed' } } }
  })
  vi.stubGlobal('fetch',fetcher)
  const view = render(<ShootingFirstFrame scope={scope} />)
  fireEvent.click(await screen.findByRole('button',{ name:'生成这张首帧（仅一次）' }))
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => path.endsWith('/submit'))).toBe(true))
  view.unmount(); render(<ShootingFirstFrame scope={scope} />)
  await screen.findByText('本次生成未完成，已停止，不自动重试。')
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(1)
})
it('blocks malformed, cross-frame or multi-attempt previews', () => {
  for (const patch of [{ frameId:'other' },{ maxAttempts:2 },{ n:2 },{ selectAsOfficial:true },{ payloadHash:'bad' }]) expect(() => assertShootingPreview({ ...preview,...patch },scope)).toThrow()
})
it('restores a rejected request as an explicit stage blocker without another POST', async () => {
  localStorage.setItem(`qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`,
    JSON.stringify({ preview,requestId:result.requestId }))
  const fetcher = vi.fn(async (path:string) => ({ ok:true,json:async () => path.includes('/review?') ? { ...review,accepted:false } : ({ ...result,task:null,candidate:null,
    submissionBlocker:{ code:'storyboard_human_review_required',message:'请先逐镜确认分镜内容和提示词，再开始生成。' } }) }))
  vi.stubGlobal('fetch',fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  await screen.findByText('尚未进入生成，未创建本次任务。请先逐镜确认分镜内容和提示词，再开始生成。')
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('正在核对原提交结果；不会重复提交。')).toBeNull()
  expect(screen.queryByRole('button',{ name:'生成这张首帧（仅一次）' })).toBeNull()
})
it('shows the original stage blocker during preview and never offers paid submit', async () => {
  vi.stubGlobal('fetch',vi.fn(async (path:string) => ({ ok:true,json:async () => path.includes('/review?') ? { ...review,accepted:false } : ({ ...preview,
    blockers:['existing_stage_gate_blocked'],submissionBlocker:{ message:'分镜签收已过期' } }) })))
  render(<ShootingFirstFrame scope={scope} />)
  await screen.findByText('尚未进入生成，未创建本次任务。分镜签收已过期')
  expect(screen.queryByRole('button',{ name:'生成这张首帧（仅一次）' })).toBeNull()
})
it('only a human click confirms the displayed SHA; confirmation never submits or adopts media', async () => {
  let accepted = false
  const fetcher = vi.fn(async (path:string, init?:RequestInit) => {
    if (path.endsWith('/confirm')) {
      const body = JSON.parse(String(init?.body)) as { expected_frame_digest:string }
      expect(body.expected_frame_digest).toBe(review.frameDigest)
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
  await screen.findByText('Error: storyboard_human_review_frame_digest_mismatch')
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
