// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeVideoReview } from '../src/client/NativeVideoReview.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const props = { episodeId: 'episode-1', frameId: 'frame-1', assetId: 'asset-1', sha256: 'a'.repeat(64) }
const result = (state: string, extra = {}) => ({ state, assetId: props.assetId, assetSha256: props.sha256, ...extra })

it('loads existing evidence, submits only on click, and refreshes with GET', async () => {
  const fetcher = vi.fn(async (_url, init) => Response.json(result(init.method === 'POST' ? 'pending' : 'none')))
  vi.stubGlobal('fetch', fetcher)
  render(<NativeVideoReview {...props} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '检查当前视频' }).hasAttribute('disabled')).toBe(false))
  expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(['GET'])
  fireEvent.click(screen.getByRole('button', { name: '检查当前视频' }))
  await screen.findByRole('button', { name: '正在检查音画…' })
  fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(['GET', 'POST', 'GET'])
})

it('shows heard evidence and the uncertain status without claiming approval', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(result('complete', { audit: {
    audio_review: { checks: { ambience: { status: 'fail', evidence: '对白开始时雨声消失。', time_ranges: [[2, 4]] },
      delivery: { status: 'unverified', evidence: '音量不足，无法确认语气。' } } },
  } }))))
  const view = render(<NativeVideoReview {...props} />)
  await screen.findByText('对白开始时雨声消失。')
  expect(view.container.textContent).toMatchInlineSnapshot('"音画检查对照导演设计检查当前视频，结果用于审看与返修。本版已检查刷新记录检查详情 · 1 项需调整 · 14 项待核实对白内容尚未确认本项没有可用的听觉证据。语气与表演无法确认音量不足，无法确认语气。环境底声需调整对白开始时雨声消失。2–4 秒空间声学尚未确认本项没有可用的听觉证据。动作拟音尚未确认本项没有可用的听觉证据。配乐衔接尚未确认本项没有可用的听觉证据。AI 检查供参考，最终是否采用由你决定。"')
})

it('rejects a response for another candidate', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...result('complete'), assetId: 'different' })))
  render(<NativeVideoReview {...props} />)
  await screen.findByRole('alert')
  expect(screen.queryByText('本版已检查')).toBeNull()
})

it('restores legacy evidence without paying again until an explicit method upgrade click', async () => {
  const fetcher = vi.fn(async (_url, init) => Response.json(result(init.method === 'POST' ? 'pending' : 'complete', { methodChanged: true })))
  vi.stubGlobal('fetch', fetcher)
  render(<NativeVideoReview {...props} />)
  await screen.findByRole('button', { name: '按时间重新检查' })
  expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(['GET'])
  fireEvent.click(screen.getByRole('button', { name: '刷新记录' }))
  await waitFor(() => expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(['GET', 'GET']))
  fireEvent.click(screen.getByRole('button', { name: '按时间重新检查' }))
  await screen.findByRole('button', { name: '正在检查音画…' })
  expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(['GET', 'GET', 'POST'])
})

it('links a timed observation to playback and keeps unsupported claims uncertain', async () => {
  const fetcher = vi.fn(async () => Response.json(result('complete', { visualEvidence: {
    observations: [{ start_sec: 2, end_sec: 3.5, description: '女子抬手指向收音机。' }],
    checks: { camera_execution_match: { status: 'unverified', evidence: '未提供起止比较。', evidenceIncomplete: true } },
  } })))
  vi.stubGlobal('fetch', fetcher)
  const seek = vi.fn()
  render(<NativeVideoReview {...props} onSeek={seek} />)
  await screen.findByText('女子抬手指向收音机。')
  const details = screen.getByText('检查详情 · 0 项需调整 · 15 项待核实').closest('details')!
  expect(details.open).toBe(false)
  fireEvent.click(details.querySelector('summary')!)
  fireEvent.click(screen.getByRole('button', { name: '查看 2 至 3.5 秒' }))
  expect(seek).toHaveBeenCalledExactlyOnceWith(2)
  expect(screen.getByText('该判断缺少有效时间或对应观察，暂不能确认。')).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(1)
})
