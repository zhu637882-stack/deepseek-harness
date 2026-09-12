// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkingCut } from '../src/client/WorkingCut.tsx'
import type { WorkingCutCommand, WorkingCutState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
const state: WorkingCutState = { schema:'qingmu-working-cut-v1',projectId:'p',episodeId:'e',revision:0,
  shots:[{ frameId:'f',frameNo:1,title:'动作',candidates:[{ assetId:'a',sha256:'a'.repeat(64),duration:15,taskId:'t',url:'' }] }],
  cuts:[],providerCalls:0,humanApprovalChanged:false }
afterEach(() => { cleanup();localStorage.clear() })
it('previews framing, retains it on reopen and can restore the unmodified source', async () => {
  let server: WorkingCutState = { ...state, shots: [{ ...state.shots[0]!, candidates: [{ ...state.shots[0]!.candidates[0]!, url: '/video.mp4' }] }] }
  const save = vi.fn(async ({ command }: { command: WorkingCutCommand }) => {
    server = { ...server, revision: server.revision + 1, cuts: [{ ...command, version: server.revision + 1,
      revisionId: 'revision', taskId: null, status: 'NotQueued', errorCode: null, assetId: null, sha256: null, url: '' }] }
    return server
  })
  const port = { readWorkingCut: vi.fn(async () => server), saveWorkingCut: save,
    renderWorkingCut: vi.fn(), uploadWorkingCutAudio: vi.fn() }
  let view = render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  const openFraming = async () => {
    const summary = await screen.findByText(/^画面取景/)
    const details = summary.closest('details')!
    details.open = true; fireEvent(details, new Event('toggle'))
    return screen.findByRole('slider', { name: '镜 1 取景放大倍数' })
  }
  fireEvent.change(await openFraming(), { target: { value: '2' } })
  fireEvent.change(screen.getByRole('slider', { name: '镜 1 取景上下位置' }), { target: { value: '10' } })
  const video = screen.getByLabelText('镜 1 取景预览') as HTMLVideoElement
  Object.defineProperty(video, 'videoWidth', { value: 1920 })
  Object.defineProperty(video, 'videoHeight', { value: 1080 })
  fireEvent.loadedMetadata(video)
  expect(video.style.width).toBe('200%')
  expect(video.style.left).toBe('-50%')
  expect(video.style.top).toBe('-10%')
  expect(screen.getByText(/保留原片 960 × 540 像素/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保存剪辑草稿' }))
  await waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })
  expect(save.mock.calls[0]?.[0].command.clips[0]?.reframe).toEqual({ zoom: 2, x: .5, y: .1 })
  view.unmount()
  view = render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  expect(await openFraming()).toHaveProperty('value', '2')
  expect(screen.getByRole('slider', { name: '镜 1 取景上下位置' })).toHaveProperty('value', '10')
  fireEvent.click(screen.getByRole('button', { name: '恢复原画面' }))
  fireEvent.click(screen.getByRole('button', { name: '保存剪辑草稿' }))
  await waitFor(() => { expect(save).toHaveBeenCalledTimes(2) })
  expect(save.mock.calls[1]?.[0].command.clips[0]).not.toHaveProperty('reframe')
  expect(port.renderWorkingCut).not.toHaveBeenCalled()
  view.unmount()
})
it('submits the chosen source range and retains the same command after an uncertain response', async () => {
  const renderCut=vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ ...state,revision:1,cuts:[] })
  const port={ readWorkingCut:vi.fn(async()=>state),saveWorkingCut:vi.fn(),uploadWorkingCutAudio:vi.fn(),renderWorkingCut:renderCut }
  render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  await screen.findByRole('combobox',{ name:'镜 1 视频版本' })
  fireEvent.change(screen.getByRole('spinbutton',{ name:'镜 1 起点秒' }),{ target:{ value:'1.8' } })
  fireEvent.click(screen.getByRole('button',{ name:'合成并导出 MP4' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button',{ name:'恢复上次导出' }))
  await waitFor(()=>expect(renderCut).toHaveBeenCalledTimes(2))
  expect(renderCut.mock.calls[0]?.[0]).toEqual(renderCut.mock.calls[1]?.[0])
  expect(renderCut.mock.calls[0]?.[0].command.clips[0]).toEqual({ frameId:'f',assetId:'a',sha256:'a'.repeat(64),inSec:1.8,outSec:15 })
})
it('opens a missing shot for generation and reads existing film versions without creating work', async () => {
  const open=vi.fn(),generate=vi.fn()
  render(<WorkingCut projectId="p" episodeId="e" port={{ readWorkingCut:vi.fn(async()=>({ ...state,shots:[{ frameId:'missing',frameNo:1,title:'未生成',candidates:[] }] })),saveWorkingCut:vi.fn(),uploadWorkingCutAudio:vi.fn(),renderWorkingCut:generate }} onOpenShooting={open} />)
  fireEvent.click(await screen.findByRole('button',{ name:'去生成' }))
  expect(open).toHaveBeenCalledWith('missing');expect(generate).not.toHaveBeenCalled()
  expect(screen.getByRole('button',{ name:'合成并导出 MP4' })).toHaveProperty('disabled',true)
})

it('saves whole-cut ambience with independent fades and recovers it on reopen', async () => {
  const source = { assetId:'room',sha256:'b'.repeat(64),duration:15,name:'Room.wav',url:'' }
  let server: WorkingCutState = { ...state, audioLibrary:[source] }
  const save = vi.fn(async ({ command }) => {
    server = { ...server,revision:1,cuts:[{ ...command,revisionId:'rev-1',version:1,status:'NotQueued',taskId:null,errorCode:null,assetId:null,sha256:null,url:'' }] }
    return server
  })
  const port = { readWorkingCut:vi.fn(async()=>server),renderWorkingCut:vi.fn(),saveWorkingCut:save,uploadWorkingCutAudio:vi.fn() }
  const view = render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button',{ name:'加入音轨' }))
  fireEvent.change(screen.getByRole('combobox',{ name:'音轨 1 用途' }),{ target:{ value:'ambience' } })
  fireEvent.change(screen.getByRole('spinbutton',{ name:'音轨 1 淡出秒' }),{ target:{ value:'3' } })
  fireEvent.click(screen.getByRole('button',{ name:'设置音量变化' }))
  fireEvent.click(screen.getByRole('button',{ name:'音轨 1 在变化点 1 后插入' }))
  fireEvent.change(screen.getByRole('spinbutton',{ name:'音轨 1 变化点 2 增减 dB' }),{ target:{ value:'-9' } })
  fireEvent.change(screen.getByRole('textbox',{ name:'声音设计' }),{ target:{ value:'Street ambience continues underneath dialogue.' } })
  fireEvent.click(screen.getByRole('button',{ name:'保存剪辑草稿' }))
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(1))
  expect(port.renderWorkingCut).not.toHaveBeenCalled()
  expect(save.mock.calls[0]?.[0].command.audioCues).toEqual([expect.objectContaining({ kind:'ambience',startSec:0,outSec:15,fadeOutSec:3,
    gainPoints:[{ timeSec:0,gainDb:0 },{ timeSec:7.5,gainDb:-9 },{ timeSec:15,gainDb:0 }] })])
  view.unmount()
  render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  expect(await screen.findByRole('textbox',{ name:'声音设计' })).toHaveProperty('value','Street ambience continues underneath dialogue.')
  expect(screen.getByRole('spinbutton',{ name:'音轨 1 淡出秒' })).toHaveProperty('value','3')
  expect(screen.getByRole('spinbutton',{ name:'音轨 1 变化点 2 增减 dB' })).toHaveProperty('value','-9')
  fireEvent.change(screen.getByRole('spinbutton',{ name:'音轨 1 变化点 2 成片秒' }),{ target:{ value:'0' } })
  expect(screen.getByRole('button',{ name:'保存剪辑草稿' })).toHaveProperty('disabled',true)
  fireEvent.click(screen.getByRole('button',{ name:'清除音量变化' }))
  expect(screen.getByRole('button',{ name:'保存剪辑草稿' })).toHaveProperty('disabled',false)
  fireEvent.change(screen.getByRole('spinbutton',{ name:'音轨 1 成片起点秒' }),{ target:{ value:'14' } })
  expect(screen.getByRole('button',{ name:'合成并导出 MP4' })).toHaveProperty('disabled',true)
})
