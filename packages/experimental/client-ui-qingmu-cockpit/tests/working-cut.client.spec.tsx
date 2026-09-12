// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkingCut } from '../src/client/WorkingCut.tsx'
import type { WorkingCutCommand, WorkingCutState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
const state: WorkingCutState = { schema:'qingmu-working-cut-v1',projectId:'p',episodeId:'e',revision:0,
  shots:[{ frameId:'f',frameNo:1,title:'动作',candidates:[{ assetId:'a',sha256:'a'.repeat(64),duration:15,taskId:'t',url:'' }] }],
  cuts:[],providerCalls:0,humanApprovalChanged:false }
afterEach(() => { cleanup();localStorage.clear() })
it('uses video audio independently and retains chosen component and film timing after reopening', async () => {
  const video = { assetId: 'a', sha256: 'a'.repeat(64), duration: 15, url: '/original.mp4', name: '门外雨声', usage: 'video_audio' as const }
  let server: WorkingCutState = { ...state, videoAudioSources: [video], audioSeparation: { available: true, model: 'Bandit v2', providerCalls: 0 } }
  const save = vi.fn(async ({ command }: { command: WorkingCutCommand }) => {
    server = { ...server, revision: 1, cuts: [{ ...command, version: 1, revisionId: 'r', taskId: null,
      status: 'NotQueued', errorCode: null, assetId: null, sha256: null, url: '' }] }
    return server
  })
  const port = { readWorkingCut: vi.fn(async () => server), saveWorkingCut: save,
    renderWorkingCut: vi.fn(), reviewWorkingCutSound: vi.fn(), uploadWorkingCutAudio: vi.fn() }
  let view = render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  const summary = await screen.findByText('使用已生成视频的声音'); summary.closest('details')!.open = true
  fireEvent.click(screen.getByRole('button', { name: '单独使用 门外雨声' }))
  fireEvent.change(screen.getByRole('combobox', { name: '音轨 1 声音内容' }), { target: { value: 'effects' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: '音轨 1 成片起点秒' }), { target: { value: '2' } })
  screen.getByText('裁剪声音素材').closest('details')!.open = true
  fireEvent.change(screen.getByRole('spinbutton', { name: '音轨 1 素材终点秒' }), { target: { value: '10' } })
  fireEvent.click(screen.getByRole('button', { name: '保存剪辑草稿' }))
  await waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })
  expect(save.mock.calls[0]?.[0].command.audioCues?.[0]).toMatchObject({ assetId: 'a', sourceAudioMode: 'effects', startSec: 2, outSec: 10 })
  expect(save.mock.calls[0]?.[0].command.clips).toHaveLength(1)
  view.unmount()
  view = render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  expect(await screen.findByRole('combobox', { name: '音轨 1 声音内容' })).toHaveProperty('value', 'effects')
  expect(screen.getByRole('spinbutton', { name: '音轨 1 成片起点秒' })).toHaveProperty('value', '2')
  screen.getByText('空间混响').closest('details')!.open = true
  expect(screen.getByRole('combobox', { name: '音轨 1 空间响应' }).querySelectorAll('option')).toHaveLength(1)
  fireEvent.change(screen.getByRole('combobox', { name: '音轨 1 声音内容' }), { target: { value: 'original' } })
  fireEvent.click(screen.getByRole('button', { name: '保存剪辑草稿' }))
  await waitFor(() => { expect(save).toHaveBeenCalledTimes(2) })
  expect(save.mock.calls[1]?.[0].command.audioCues?.[0]).not.toHaveProperty('sourceAudioMode')
  expect(port.renderWorkingCut).not.toHaveBeenCalled()
  expect(port.uploadWorkingCutAudio).not.toHaveBeenCalled()
})
it('retains source separation on reopen and restores original sound without generating', async () => {
  let server: WorkingCutState = { ...state, audioSeparation: { available: true, model: 'Bandit v2', providerCalls: 0 } }
  const save = vi.fn(async ({ command }: { command: WorkingCutCommand }) => {
    server = { ...server, revision: server.revision + 1, cuts: [{ ...command, version: server.revision + 1,
      revisionId: 'revision', taskId: null, status: 'NotQueued', errorCode: null, assetId: null, sha256: null, url: '' }] }
    return server
  })
  const port = { readWorkingCut: vi.fn(async () => server), saveWorkingCut: save,
    renderWorkingCut: vi.fn(), reviewWorkingCutSound: vi.fn(), uploadWorkingCutAudio: vi.fn() }
  const openSound = async () => {
    const summary = await screen.findByText('原片声音')
    summary.closest('details')!.open = true
    return screen.getByRole('combobox', { name: '镜 1 声音内容' })
  }
  let view = render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  expect(await openSound()).toHaveProperty('value', 'original')
  fireEvent.change(screen.getByRole('combobox', { name: '镜 1 声音内容' }), { target: { value: 'speech_effects' } })
  fireEvent.click(screen.getByRole('button', { name: '保存剪辑草稿' }))
  await waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })
  expect(save.mock.calls[0]?.[0].command.clips[0]?.sourceAudioMode).toBe('speech_effects')
  view.unmount()
  view = render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  expect(await openSound()).toHaveProperty('value', 'speech_effects')
  fireEvent.change(screen.getByRole('combobox', { name: '镜 1 声音内容' }), { target: { value: 'original' } })
  fireEvent.click(screen.getByRole('button', { name: '保存剪辑草稿' }))
  await waitFor(() => { expect(save).toHaveBeenCalledTimes(2) })
  expect(save.mock.calls[1]?.[0].command.clips[0]?.sourceAudioMode).toBe('original')
  expect(port.renderWorkingCut).not.toHaveBeenCalled()
  view.unmount()
  server = { ...server, audioSeparation: { available: false, model: 'Bandit v2', providerCalls: 0 } }
  view = render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  await openSound()
  expect(screen.getByRole('option', { name: '提取对白与环境声，去除原配乐' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('option', { name: '保留原声' })).toHaveProperty('disabled', false)
})
it('reviews the exact rendered version, preserves edits and recovers timed findings on reopen', async () => {
  const clip = { frameId: 'f', assetId: 'a', sha256: 'a'.repeat(64), inSec: 0, outSec: 15 }
  const cut = { revisionId: 'cut-1', version: 1, clips: [clip], requestId: 'cut-request', taskId: 'render-task',
    status: 'Succeeded', errorCode: null, assetId: 'film-1', sha256: 'b'.repeat(64), url: '/film-1.mp4' }
  let server: WorkingCutState = { ...state, revision: 1, cuts: [cut] }
  const review = vi.fn(async (_input: unknown) => {
    server = { ...server, cuts: [{ ...cut, soundReview: {
      state: 'complete', advisoryOnly: true, taskId: 'review-1', summary: '音乐在转场处突然停止。',
      checks: [{ kind: 'music', status: 'fail', evidence: '乐句在8秒处中断。', timeRanges: [[7.5, 8.5]] }],
      transcript: [{ start_sec: 4.2, end_sec: 5, speaker: '女', text: '还有多久？', delivery: '迟疑' }],
    } }] }
    return server
  })
  const port = { readWorkingCut: vi.fn(async () => server), reviewWorkingCutSound: review,
    saveWorkingCut: vi.fn(), renderWorkingCut: vi.fn(), uploadWorkingCutAudio: vi.fn() }
  let view = render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  await screen.findByRole('button', { name: '检查此版整片声音' })
  expect(review).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('spinbutton', { name: '镜 1 终点秒' }), { target: { value: '12' } })
  fireEvent.click(screen.getByRole('button', { name: '检查此版整片声音' }))
  await screen.findByText('音乐与转场 · 发现问题')
  expect(review).toHaveBeenCalledExactlyOnceWith({ projectId: 'p', episodeId: 'e', command: {
    revisionId: 'cut-1', assetId: 'film-1', sha256: 'b'.repeat(64),
  } })
  expect(screen.getByRole('spinbutton', { name: '镜 1 终点秒' })).toHaveProperty('value', '12')
  expect(screen.getByText(/当前剪辑已有修改/)).toBeTruthy()
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  fireEvent.click(screen.getByRole('button', { name: '0:07.5—0:08.5 回听' }))
  expect(view.container.querySelector('[aria-label="成片播放器"] video')).toHaveProperty('currentTime', 7.5)
  expect(play).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('对白听写与逐句回听（模型识别）'))
  fireEvent.click(screen.getByRole('button', { name: '0:04.2—0:05.0 回听对白' }))
  expect(view.container.querySelector('[aria-label="成片播放器"] video')).toHaveProperty('currentTime', 4.2)
  view.unmount()
  view = render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  await screen.findByText('音乐与转场 · 发现问题')
  expect(review).toHaveBeenCalledTimes(1)
  expect(port.renderWorkingCut).not.toHaveBeenCalled()
  server = { ...server, revision: 2, cuts: [{ ...cut, revisionId: 'cut-2', version: 2,
    assetId: 'film-2', sha256: 'c'.repeat(64), url: '/film-2.mp4' }, ...server.cuts] }
  fireEvent.click(screen.getByRole('button', { name: '刷新成片状态' }))
  await screen.findByRole('button', { name: '检查此版整片声音' })
  expect(screen.queryByText('音乐与转场 · 发现问题')).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: '成片播放版本' }), { target: { value: 'cut-1' } })
  expect(screen.getByText('音乐与转场 · 发现问题')).toBeTruthy()
  expect(review).toHaveBeenCalledTimes(1)
  play.mockRestore()
})
it('waits for the selected episode before reading the cut', async () => {
  const port = { readWorkingCut: vi.fn(async () => state), reviewWorkingCutSound: vi.fn(),
    saveWorkingCut: vi.fn(), renderWorkingCut: vi.fn(), uploadWorkingCutAudio: vi.fn() }
  const view = render(<WorkingCut projectId="" episodeId="" port={port} onOpenShooting={vi.fn()} />)
  expect(port.readWorkingCut).not.toHaveBeenCalled()
  view.rerender(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  await screen.findByRole('combobox', { name: '镜 1 视频版本' })
  expect(port.readWorkingCut).toHaveBeenCalledExactlyOnceWith({ projectId: 'p', episodeId: 'e' })
})
it('imports a bundled response without losing edits or adding an impulse as music', async () => {
  const source = { assetId: 'voice', sha256: 'b'.repeat(64), duration: 15, name: 'Voice.wav', url: '' }
  const preset = { id: 'bedroom', name: '居住房间', description: '卧室实录', sourceUrl: 'https://example.com/source',
    sha256: 'c'.repeat(64), duration: 1.6, license: 'MIT', author: 'Conner' }
  const room = { assetId: 'room', sha256: preset.sha256, duration: 1.6, name: '居住房间 IR.wav', url: '',
    usage: 'impulse_response' as const, presetId: preset.id }
  let server = { ...state, acousticPresets: [preset], audioLibrary: [source] }
  const uploadWorkingCutAudio = vi.fn(async (_input: unknown) => { server = { ...server, audioLibrary: [source, room] }; return server })
  const saveWorkingCut = vi.fn(async (_input: { command: WorkingCutCommand }) => server)
  const port = { reviewWorkingCutSound: vi.fn(),
    readWorkingCut: vi.fn(async () => server), saveWorkingCut, uploadWorkingCutAudio, renderWorkingCut: vi.fn() }
  render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  fireEvent.change(await screen.findByRole('spinbutton', { name: '镜 1 终点秒' }), { target: { value: '12' } })
  fireEvent.click(screen.getByText('选择空间声学 · 房间、咖啡店与走廊'))
  fireEvent.click(screen.getByRole('button', { name: '加入居住房间响应' }))
  await waitFor(() => { expect(uploadWorkingCutAudio).toHaveBeenCalledWith({ projectId: 'p', episodeId: 'e', command: { presetId: 'bedroom' } }) })
  await waitFor(() => { expect(screen.getByRole('button', { name: '居住房间已加入' })).toHaveProperty('disabled', true) })
  expect(screen.getByRole('spinbutton', { name: '镜 1 终点秒' })).toHaveProperty('value', '12')
  expect(screen.getAllByRole('button', { name: '加入音轨' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '加入音轨' }))
  fireEvent.change(screen.getByRole('combobox', { name: '音轨 1 空间响应' }), { target: { value: room.assetId } })
  fireEvent.click(screen.getByRole('button', { name: '保存剪辑草稿' }))
  await waitFor(() => { expect(saveWorkingCut).toHaveBeenCalledTimes(1) })
  expect(saveWorkingCut.mock.calls[0]?.[0].command.audioCues?.[0]?.space).toEqual({
    assetId: room.assetId, sha256: room.sha256, wetDb: -12, tailSec: 0,
  })
  expect(port.renderWorkingCut).not.toHaveBeenCalled()
})
it('saves room response and cross-cut tail, rejects overrun, and reopens without changing original sound', async () => {
  const voice = { assetId: 'voice', sha256: 'b'.repeat(64), duration: 15, name: 'Voice.wav', url: '' }
  const room = { assetId: 'response', sha256: 'c'.repeat(64), duration: 1, name: 'Room-IR.wav', url: '' }
  let server: WorkingCutState = { ...state, audioLibrary: [voice, room] }
  const save = vi.fn(async ({ command }: { command: WorkingCutCommand }) => {
    server = { ...server, revision: 1, cuts: [{ ...command, version: 1, revisionId: 'revision', taskId: null,
      status: 'NotQueued', errorCode: null, assetId: null, sha256: null, url: '' }] }
    return server
  })
  const port = { reviewWorkingCutSound: vi.fn(),
    readWorkingCut: vi.fn(async () => server), saveWorkingCut: save,
    renderWorkingCut: vi.fn(), uploadWorkingCutAudio: vi.fn() }
  const view = render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  fireEvent.click((await screen.findAllByRole('button', { name: '加入音轨' }))[0]!)
  fireEvent.change(screen.getByRole('combobox', { name: '音轨 1 空间响应' }), { target: { value: 'response' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: '音轨 1 保留尾音秒' }), { target: { value: '.8' } })
  expect(screen.getByRole('button', { name: '保存剪辑草稿' })).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByRole('spinbutton', { name: '音轨 1 素材终点秒' }), { target: { value: '14' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: '音轨 1 混响音量 dB' }), { target: { value: '-9' } })
  fireEvent.click(screen.getByRole('button', { name: '保存剪辑草稿' }))
  await waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })
  expect(save.mock.calls[0]?.[0].command.audioCues?.[0]?.space).toEqual({ assetId: 'response', sha256: room.sha256, wetDb: -9, tailSec: .8 })
  expect(save.mock.calls[0]?.[0].command.clips[0]).not.toHaveProperty('sourceGainDb')
  view.unmount()
  render(<WorkingCut projectId="p" episodeId="e" port={port} onOpenShooting={vi.fn()} />)
  expect(await screen.findByRole('combobox', { name: '音轨 1 空间响应' })).toHaveProperty('value', 'response')
  expect(screen.getByRole('spinbutton', { name: '音轨 1 保留尾音秒' })).toHaveProperty('value', '0.8')
  fireEvent.change(screen.getByRole('combobox', { name: '音轨 1 空间响应' }), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存剪辑草稿' }))
  await waitFor(() => { expect(save).toHaveBeenCalledTimes(2) })
  expect(save.mock.calls[1]?.[0].command.audioCues?.[0]?.space).toBeUndefined()
  expect(port.renderWorkingCut).not.toHaveBeenCalled()
})
it('previews framing, retains it on reopen and can restore the unmodified source', async () => {
  let server: WorkingCutState = { ...state, shots: [{ ...state.shots[0]!, candidates: [{ ...state.shots[0]!.candidates[0]!, url: '/video.mp4' }] }] }
  const save = vi.fn(async ({ command }: { command: WorkingCutCommand }) => {
    server = { ...server, revision: server.revision + 1, cuts: [{ ...command, version: server.revision + 1,
      revisionId: 'revision', taskId: null, status: 'NotQueued', errorCode: null, assetId: null, sha256: null, url: '' }] }
    return server
  })
  const port = { reviewWorkingCutSound: vi.fn(),
    readWorkingCut: vi.fn(async () => server), saveWorkingCut: save,
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
  const port={ reviewWorkingCutSound: vi.fn(),
    readWorkingCut:vi.fn(async()=>state),saveWorkingCut:vi.fn(),uploadWorkingCutAudio:vi.fn(),renderWorkingCut:renderCut }
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
  render(<WorkingCut projectId="p" episodeId="e" port={{ reviewWorkingCutSound: vi.fn(), readWorkingCut:vi.fn(async()=>({ ...state,shots:[{ frameId:'missing',frameNo:1,title:'未生成',candidates:[] }] })),saveWorkingCut:vi.fn(),uploadWorkingCutAudio:vi.fn(),renderWorkingCut:generate }} onOpenShooting={open} />)
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
  const port = { reviewWorkingCutSound: vi.fn(),
    readWorkingCut:vi.fn(async()=>server),renderWorkingCut:vi.fn(),saveWorkingCut:save,uploadWorkingCutAudio:vi.fn() }
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
