// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ShootingFirstFrame, assertShootingPreview } from '../src/client/ShootingFirstFrame.tsx'
const scope = { projectId:'project-1',episodeId:'episode-1',frameId:'frame-4' }
const preview = { ...scope,schema:'qingmu.shooting-first-frame-preview.v1',preflightId:'a'.repeat(64),payloadHash:'b'.repeat(64),prompt:'POV视点人物：杰克；独立入画人物：莉娜',povObserver:'杰克',estimatedCny:.2,blockers:[],n:1,maxAttempts:1,selectAsOfficial:false }
const result = { ...scope,schema:'qingmu.shooting-first-frame-state.v1',requestId:`shooting-${preview.preflightId}`,task:{ id:'task-one',kernel_status:'Succeeded' },candidate:{ assetId:'asset-new',sha256:'c'.repeat(64),browserUrl:'http://127.0.0.1:65269/api/media/media-new',isSelected:false,qualityStatus:'pending' } }
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
it('shows full prompt, submits once and restores by GET after remount', async () => {
  localStorage.clear()
  const fetcher = vi.fn(async (path:string) => ({ ok:true,json:async () => path.endsWith('/preview') ? preview : result }))
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
    return { ok:true,json:async () => path.endsWith('/preview') ? preview : { ...result,candidate:null,task:{ id:'task-one',kernel_status:'Failed' } } }
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
  const fetcher = vi.fn(async () => ({ ok:true,json:async () => ({ ...result,task:null,candidate:null,
    submissionBlocker:{ code:'storyboard_human_review_required',message:'请先逐镜确认分镜内容和提示词，再开始生成。' } }) }))
  vi.stubGlobal('fetch',fetcher)
  render(<ShootingFirstFrame scope={scope} />)
  await screen.findByText('尚未进入生成，未创建本次任务。请先逐镜确认分镜内容和提示词，再开始生成。')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('正在核对原提交结果；不会重复提交。')).toBeNull()
  expect(screen.queryByRole('button',{ name:'生成这张首帧（仅一次）' })).toBeNull()
})
it('shows the original stage blocker during preview and never offers paid submit', async () => {
  vi.stubGlobal('fetch',vi.fn(async () => ({ ok:true,json:async () => ({ ...preview,
    blockers:['existing_stage_gate_blocked'],submissionBlocker:{ message:'分镜签收已过期' } }) })))
  render(<ShootingFirstFrame scope={scope} />)
  await screen.findByText('尚未进入生成，未创建本次任务。分镜签收已过期')
  expect(screen.queryByRole('button',{ name:'生成这张首帧（仅一次）' })).toBeNull()
})
