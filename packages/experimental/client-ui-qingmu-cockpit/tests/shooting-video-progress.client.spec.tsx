// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ShootingVideoProgress } from '../src/client/ShootingVideoProgress.tsx'
const scope = { projectId:'p',episodeId:'e',sceneId:'s',frameId:'f' }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('reads current take ordinal from Writer instead of treating a historical receipt as the next attempt', async () => {
  const state = { ...scope,taskId:'original',kernelStatus:'Succeeded',takeCount:1,nextTakeOrdinal:2 }
  const fetcher = vi.fn(async () => ({ ok:true,json:async () => state }))
  vi.stubGlobal('fetch',fetcher)
  const onState = vi.fn(); const onCommitted = vi.fn(async () => {})
  render(<ShootingVideoProgress scope={scope} onState={onState} onCommitted={onCommitted} />)
  await waitFor(() => expect(onState).toHaveBeenCalledWith(state))
  expect(onCommitted).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button',{ name:'继续原视频任务' })).toBeNull()
})
it('refresh only reads; an explicit resume references the same task, never the paid queue endpoint', async () => {
  const state = { ...scope,taskId:'original',kernelStatus:'DispatchPending',takeCount:1,nextTakeOrdinal:null }
  const fetcher = vi.fn(async (path:string, init?:RequestInit) => {
    if (init?.method === 'POST') {
      expect(path.endsWith('video-resume')).toBe(true)
      expect(JSON.parse(String(init.body)).task_id).toBe('original')
    }
    return { ok:true,json:async () => ({ ...state,execution:{ activated:true } }) }
  })
  vi.stubGlobal('fetch',fetcher)
  const props = { scope,onState:vi.fn(),onCommitted:vi.fn(async () => {}) }
  const view = render(<ShootingVideoProgress {...props} />)
  await screen.findByRole('button',{ name:'继续原视频任务' })
  view.unmount(); render(<ShootingVideoProgress {...props} />)
  const button = await screen.findByRole('button',{ name:'继续原视频任务' })
  expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  fireEvent.click(button); fireEvent.click(button)
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1))
})
