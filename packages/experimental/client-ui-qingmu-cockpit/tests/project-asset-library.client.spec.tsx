// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectAssetLibrary } from '../src/client/ProjectAssetLibrary.tsx'
import type { ReferenceVideoAssetsResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
const picture = { assetId:'face', assetSha256:'a'.repeat(64), label:'林予', mediaType:'reference_image' as const, browserUrl:'/face.png' }
const voice = { assetId:'voice', assetSha256:'b'.repeat(64), label:'林予音色', mediaType:'reference_audio' as const, browserUrl:'/voice.wav' }
const localPicture = {
  assetId: 'asset_localref_linyu', assetSha256: 'c'.repeat(64), label: '林予',
  mediaType: 'reference_image' as const, browserUrl: '',
  localReferenceScope: { elementKind: 'actor' as const, targetId: 'actor_linyu' },
}
const localContent = {
  schema: 'jason.qingmu-local-reference-candidate-content.v1' as const,
  assetId: localPicture.assetId, sha256: localPicture.assetSha256,
  mimeType: 'image/png' as const, contentBase64: 'AQID',
}
const localPictureTwo = { ...localPicture, assetId: 'asset_localref_chenyuan', assetSha256: 'd'.repeat(64), label: '陈远',
  localReferenceScope: { elementKind: 'actor' as const, targetId: 'actor_chenyuan' } }
const localPictureThree = { ...localPicture, assetId: 'asset_localref_cafe', assetSha256: 'e'.repeat(64), label: '咖啡馆',
  localReferenceScope: { elementKind: 'scene' as const, targetId: 'scene_cafe' } }
function localReader() { return vi.fn(async () => localContent) }
const page = (items: ReferenceVideoAssetsResponse['items']): ReferenceVideoAssetsResponse => ({ projectId:'p',page:1,pages:1,items })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('distinguishes a full voice audition from its derived reference without changing either asset', async () => {
  const full = { ...voice, label: '阿禾', source: { role: 'sound_voice_reference' } }
  const excerpt = { ...voice, label: '阿禾', assetId: 'excerpt', browserUrl: '/excerpt.wav',
    source: { role: 'sound_voice_reference_excerpt' } }
  const port = { referenceVideoAssets: vi.fn().mockResolvedValue(page([full, excerpt])),
    readLocalReferenceCandidateContent: localReader() }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  fireEvent.click(await screen.findByRole('button', { name: '预览阿禾 · 完整试听' }))
  expect(screen.getByRole('region', { name: '素材预览' }).querySelector('audio')?.getAttribute('src')).toBe('/voice.wav')
  const details = screen.getByText('视频用声音片段（1）').closest('details')!
  expect(details.open).toBe(false)
  expect(details.contains(screen.getByRole('button', { name: '预览阿禾 · 3秒参考片段' }))).toBe(true)
  details.open = true
  fireEvent.click(screen.getByRole('button', { name: '预览阿禾 · 3秒参考片段' }))
  expect(screen.getByText('从同次完整试听截取，供视频引用；属于同一个音色。')).toBeTruthy()
  expect(screen.getByRole('region', { name: '素材预览' }).querySelector('audio')?.getAttribute('src')).toBe('/excerpt.wav')
  expect(port.referenceVideoAssets).toHaveBeenCalledTimes(1)
})

it('filters video references and plays their picture and sound in a video element', async () => {
  const clip = { assetId: 'video', assetSha256: 'f'.repeat(64), label: '反打参考',
    mediaType: 'reference_video' as const, browserUrl: '/reference.mp4' }
  const port = { referenceVideoAssets: vi.fn().mockResolvedValue(page([picture, voice, clip])),
    readLocalReferenceCandidateContent: localReader() }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  await screen.findByRole('button', { name: '预览反打参考' })
  fireEvent.click(screen.getByRole('button', { name: '视频' }))
  expect(screen.queryByRole('button', { name: '预览林予' })).toBeNull()
  expect(screen.queryByRole('button', { name: '预览林予音色' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '预览反打参考' }))
  const preview = screen.getByRole('region', { name: '素材预览' })
  expect(preview.querySelector('video')?.getAttribute('src')).toBe('/reference.mp4')
  expect(preview.querySelector('audio, img')).toBeNull()
  expect(screen.getByText('视频 · 点击播放')).toBeTruthy()
})
it('filters real catalog entries and opens image or voice previews without a write action', async () => {
  const port = { referenceVideoAssets:vi.fn().mockResolvedValue(page([picture,voice])), readLocalReferenceCandidateContent:localReader() }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  fireEvent.click(await screen.findByRole('button',{ name:'预览林予' }))
  expect(screen.getByRole('region',{ name:'素材预览' }).querySelector('img')?.getAttribute('src')).toBe('/face.png')
  fireEvent.click(screen.getByRole('button',{ name:'音色' }))
  expect(screen.queryByRole('button',{ name:'预览林予' })).toBeNull()
  fireEvent.click(screen.getByRole('button',{ name:'预览林予音色' }))
  expect(screen.getByRole('region',{ name:'素材预览' }).querySelector('audio')?.getAttribute('src')).toBe('/voice.wav')
  fireEvent.change(screen.getByRole('textbox',{ name:'搜索素材' }),{ target:{ value:'不存在' } })
  expect(screen.getByText('没有找到匹配的素材。')).toBeDefined()
  expect(port.referenceVideoAssets).toHaveBeenCalledTimes(1)
})
it('aborts the old project read and cannot display its late result in a new project', async () => {
  let finish!: (value:ReferenceVideoAssetsResponse)=>void
  const oldRead = new Promise<ReferenceVideoAssetsResponse>((resolve)=>{finish=resolve})
  const port = { referenceVideoAssets:vi.fn().mockReturnValueOnce(oldRead).mockResolvedValueOnce({ ...page([voice]),projectId:'q' }), readLocalReferenceCandidateContent:localReader() }
  const view=render(<ProjectAssetLibrary key="p" projectId="p" port={port} />)
  const signal=port.referenceVideoAssets.mock.calls[0]![1] as AbortSignal
  view.rerender(<ProjectAssetLibrary key="q" projectId="q" port={port} />)
  expect(signal.aborted).toBe(true)
  await screen.findByRole('button',{ name:'预览林予音色' })
  finish(page([picture]))
  await waitFor(()=>{expect(screen.queryByRole('button',{ name:'预览林予' })).toBeNull()})
})

it('opens the real person or scene upload surface on request and rereads after its completion signal', async () => {
  const onOpenReferenceUpload = vi.fn()
  const port = { referenceVideoAssets:vi.fn().mockResolvedValue(page([])), readLocalReferenceCandidateContent:localReader() }
  const view = render(<ProjectAssetLibrary projectId="p" port={port} onOpenReferenceUpload={onOpenReferenceUpload} />)
  fireEvent.click(await screen.findByRole('button', { name:'上传人物/场景参考' }))
  expect(onOpenReferenceUpload).toHaveBeenCalledOnce()
  expect(screen.getByText(/角色音色可在人物参考区上传/)).toBeTruthy()
  view.rerender(<ProjectAssetLibrary projectId="p" port={port} onOpenReferenceUpload={onOpenReferenceUpload} refreshToken={1} />)
  await waitFor(() => { expect(port.referenceVideoAssets).toHaveBeenCalledTimes(2) })
})

it('keeps an open preview when generation refreshes the catalog, and closes it when the asset disappears', async () => {
  const port = { referenceVideoAssets: vi.fn().mockResolvedValue(page([picture])), readLocalReferenceCandidateContent: localReader() }
  const view = render(<ProjectAssetLibrary projectId="p" port={port} />)
  fireEvent.click(await screen.findByRole('button', { name: '预览林予' }))
  port.referenceVideoAssets.mockResolvedValue(page([voice, picture]))
  view.rerender(<ProjectAssetLibrary projectId="p" port={port} refreshToken={1} />)
  await screen.findByRole('button', { name: '预览林予音色' })
  expect(screen.getByRole('region', { name: '素材预览' }).querySelector('img')?.getAttribute('src')).toBe('/face.png')
  port.referenceVideoAssets.mockResolvedValue(page([voice]))
  fireEvent.click(screen.getByRole('button', { name: '刷新素材' }))
  await waitFor(() => { expect(screen.queryByRole('region', { name: '素材预览' })).toBeNull() })
})


it('reads a visible local image thumbnail through its owner-and-SHA-bound port, then keeps selection preview separate', async () => {
  const readLocalReferenceCandidateContent = localReader()
  const port = {
    referenceVideoAssets: vi.fn().mockResolvedValue(page([localPicture, picture])),
    readLocalReferenceCandidateContent,
  }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  await screen.findAllByRole('button', { name: '预览林予' })
  await waitFor(() => {
    expect(readLocalReferenceCandidateContent).toHaveBeenCalledWith({
      projectId: 'p', elementKind: 'actor', targetId: 'actor_linyu',
      assetId: 'asset_localref_linyu', expectedSha256: 'c'.repeat(64),
    }, expect.any(AbortSignal))
  })
  expect(screen.getAllByRole('button', { name: '预览林予' })[0]!.querySelector('img')?.getAttribute('src'))
    .toBe('data:image/png;base64,AQID')
  fireEvent.click(screen.getAllByRole('button', { name: '预览林予' })[0]!)
  await waitFor(() => {
    expect(readLocalReferenceCandidateContent).toHaveBeenLastCalledWith({
      projectId: 'p', elementKind: 'actor', targetId: 'actor_linyu',
      assetId: 'asset_localref_linyu', expectedSha256: 'c'.repeat(64),
    }, expect.any(AbortSignal))
  })
  expect(readLocalReferenceCandidateContent).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('region', { name: '素材预览' }).querySelector('img')?.getAttribute('src'))
    .toBe('data:image/png;base64,AQID')
})

it('does not read a private image thumbnail until its card approaches the viewport', async () => {
  let callback: IntersectionObserverCallback | undefined
  class TestIntersectionObserver {
    constructor(next: IntersectionObserverCallback) { callback = next }
    disconnect() {}
    observe() {}
  }
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  const readLocalReferenceCandidateContent = localReader()
  const port = { referenceVideoAssets: vi.fn().mockResolvedValue(page([localPicture])), readLocalReferenceCandidateContent }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  await screen.findByRole('button', { name: '预览林予' })
  await waitFor(() => { expect(callback).toBeDefined() })
  expect(readLocalReferenceCandidateContent).not.toHaveBeenCalled()
  act(() => { callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) })
  await waitFor(() => { expect(readLocalReferenceCandidateContent).toHaveBeenCalledOnce() })
})

it('releases a private thumbnail read when its card leaves the viewport', async () => {
  let callback: IntersectionObserverCallback | undefined
  class TestIntersectionObserver {
    constructor(next: IntersectionObserverCallback) { callback = next }
    disconnect() {}
    observe() {}
  }
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  let signal: AbortSignal | undefined
  const reader = vi.fn()
  reader.mockImplementationOnce((_request: unknown, nextSignal: AbortSignal) => {
    signal = nextSignal
    return new Promise<never>(() => {})
  })
  reader.mockResolvedValueOnce(localContent)
  const port = { referenceVideoAssets: vi.fn().mockResolvedValue(page([localPicture])), readLocalReferenceCandidateContent: reader }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  await screen.findByRole('button', { name: '预览林予' })
  await waitFor(() => { expect(callback).toBeDefined() })
  act(() => { callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) })
  await waitFor(() => { expect(reader).toHaveBeenCalledOnce() })
  act(() => { callback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver) })
  await waitFor(() => { expect(signal?.aborted).toBe(true) })
  act(() => { callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) })
  await waitFor(() => { expect(reader).toHaveBeenCalledTimes(2) })
  expect(screen.getByRole('button', { name: '预览林予' }).querySelector('img')?.getAttribute('src'))
    .toBe('data:image/png;base64,AQID')
})

it('does not let public images or voices consume private thumbnail read slots', async () => {
  const observers: { callback: IntersectionObserverCallback }[] = []
  class TestIntersectionObserver {
    readonly callback: IntersectionObserverCallback
    constructor(next: IntersectionObserverCallback) { this.callback = next; observers.push(this) }
    disconnect() {}
    observe() {}
  }
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  const reader = localReader()
  const port = {
    referenceVideoAssets: vi.fn().mockResolvedValue(page([picture, voice, localPicture])),
    readLocalReferenceCandidateContent: reader,
  }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  await screen.findByRole('button', { name: '预览林予音色' })
  await waitFor(() => { expect(observers).toHaveLength(3) })
  act(() => {
    observers.forEach((observer) => {
      observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
  })
  await waitFor(() => { expect(reader).toHaveBeenCalledOnce() })
  expect(reader).toHaveBeenCalledWith({ projectId: 'p', elementKind: 'actor', targetId: 'actor_linyu',
    assetId: localPicture.assetId, expectedSha256: localPicture.assetSha256 }, expect.any(AbortSignal))
})

it('limits private thumbnail reads and cancels a queued card that leaves the viewport', async () => {
  const observers: { callback: IntersectionObserverCallback }[] = []
  class TestIntersectionObserver {
    readonly callback: IntersectionObserverCallback
    constructor(next: IntersectionObserverCallback) { this.callback = next; observers.push(this) }
    disconnect() {}
    observe() {}
  }
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  const reader = vi.fn(() => new Promise<never>(() => {}))
  const port = {
    referenceVideoAssets: vi.fn().mockResolvedValue(page([localPicture, localPictureTwo, localPictureThree])),
    readLocalReferenceCandidateContent: reader,
  }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  await screen.findByRole('button', { name: '预览咖啡馆' })
  await waitFor(() => { expect(observers).toHaveLength(3) })
  act(() => {
    observers.forEach((observer) => {
      observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
  })
  await waitFor(() => { expect(reader).toHaveBeenCalledTimes(2) })
  expect(reader).toHaveBeenCalledWith({ projectId: 'p', elementKind: 'actor', targetId: 'actor_linyu',
    assetId: localPicture.assetId, expectedSha256: localPicture.assetSha256 }, expect.any(AbortSignal))
  expect(reader).toHaveBeenCalledWith({ projectId: 'p', elementKind: 'actor', targetId: 'actor_chenyuan',
    assetId: localPictureTwo.assetId, expectedSha256: localPictureTwo.assetSha256 }, expect.any(AbortSignal))
  act(() => { observers[2]!.callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver) })
  act(() => { observers[0]!.callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver) })
  await waitFor(() => { expect(reader).toHaveBeenCalledTimes(2) })
  expect(reader).not.toHaveBeenCalledWith({ projectId: 'p', elementKind: 'scene', targetId: 'scene_cafe',
    assetId: localPictureThree.assetId, expectedSha256: localPictureThree.assetSha256 }, expect.any(AbortSignal))
})

it('shows a failed local preview and retries only when requested', async () => {
  const reader = vi.fn().mockRejectedValueOnce(new Error('thumbnail unavailable')).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(localContent)
  const port = { referenceVideoAssets: vi.fn().mockResolvedValue(page([localPicture])), readLocalReferenceCandidateContent: reader }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  fireEvent.click(await screen.findByRole('button', { name: '预览林予' }))
  await screen.findByText('这份参考素材暂时无法读取。')
  expect(screen.queryByText('正在读取这份本地参考素材。')).toBeNull()
  expect(reader).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '重新读取参考素材' }))
  await waitFor(() => { expect(screen.getByRole('region', { name: '素材预览' }).querySelector('img')).not.toBeNull() })
  expect(reader).toHaveBeenCalledTimes(3)
})

it('reads a local voice only on selection and releases its Blob URL when closing', async () => {
  const createObjectURL = vi.fn(() => 'blob:local-voice')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL { static override createObjectURL = createObjectURL; static override revokeObjectURL = revokeObjectURL })
  const localVoice = { ...voice, browserUrl: '', localVoiceScope: { targetId: 'actor_linyu' } }
  const content = { schema: 'jason.qingmu-local-voice-content.v1' as const, assetId: voice.assetId,
    sha256: voice.assetSha256, mimeType: 'audio/wav' as const, contentBase64: 'AQID' }
  const readLocalVoiceCandidateContent = vi.fn(async () => content)
  const port = { referenceVideoAssets: vi.fn().mockResolvedValue(page([localVoice])),
    readLocalReferenceCandidateContent: localReader(), readLocalVoiceCandidateContent }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  const select = await screen.findByRole('button', { name: '预览林予音色' })
  expect(readLocalVoiceCandidateContent).not.toHaveBeenCalled()
  fireEvent.click(select)
  await waitFor(() => { expect(screen.getByRole('region', { name: '素材预览' }).querySelector('audio')?.getAttribute('src')).toBe('blob:local-voice') })
  expect(readLocalVoiceCandidateContent).toHaveBeenCalledWith({ projectId: 'p', elementKind: 'actor', targetId: 'actor_linyu',
    assetId: voice.assetId, expectedSha256: voice.assetSha256 }, expect.any(AbortSignal))
  expect(port.readLocalReferenceCandidateContent).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-voice')
})

it('ignores a late private voice read after its selection is closed', async () => {
  const createObjectURL = vi.fn(() => 'blob:late')
  vi.stubGlobal('URL', class extends URL { static override createObjectURL = createObjectURL; static override revokeObjectURL = vi.fn() })
  const localVoice = { ...voice, browserUrl: '', localVoiceScope: { targetId: 'actor_linyu' } }
  let resolve!: (value: { schema: 'jason.qingmu-local-voice-content.v1'; assetId: string; sha256: string; mimeType: 'audio/wav'; contentBase64: string }) => void
  const readLocalVoiceCandidateContent = vi.fn(() => new Promise<Parameters<typeof resolve>[0]>((done) => { resolve = done }))
  const port = { referenceVideoAssets: vi.fn().mockResolvedValue(page([localVoice])),
    readLocalReferenceCandidateContent: localReader(), readLocalVoiceCandidateContent }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  fireEvent.click(await screen.findByRole('button', { name: '预览林予音色' }))
  await waitFor(() => { expect(readLocalVoiceCandidateContent).toHaveBeenCalledOnce() })
  fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
  resolve({ schema: 'jason.qingmu-local-voice-content.v1', assetId: voice.assetId, sha256: voice.assetSha256, mimeType: 'audio/wav', contentBase64: 'AQID' })
  await waitFor(() => { expect(screen.queryByRole('region', { name: '素材预览' })).toBeNull() })
  expect(createObjectURL).not.toHaveBeenCalled()
})

it('deletes only the opened asset and restores it from a separate trash view', async () => {
  let deleted = false
  const port = { referenceVideoAssets: vi.fn(async (request: { deleted?: boolean }) =>
    page(Boolean(request.deleted) === deleted ? [picture] : [])),
  readLocalReferenceCandidateContent: localReader(),
  setAssetLibraryState: vi.fn(async (request: {
    projectId: string
    episodeId: string
    assetId: string
    expectedSha256: string
    deleted: boolean
  }) => {
    deleted = request.deleted
    return { ...request, assetSha256: request.expectedSha256 }
  }) }
  render(<ProjectAssetLibrary projectId="p" episodeId="ep" port={port} />)
  fireEvent.click(await screen.findByRole('button', { name: '预览林予' }))
  fireEvent.click(screen.getByRole('button', { name: '删除此素材' }))
  await screen.findByText('素材已删除，不再出现在可选素材中；可在已删除素材中恢复。')
  expect(port.setAssetLibraryState).toHaveBeenCalledWith({ projectId: 'p', episodeId: 'ep', assetId: 'face', expectedSha256: 'a'.repeat(64), deleted: true })
  expect(screen.queryByRole('button', { name: '预览林予' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '已删除素材' }))
  fireEvent.click(await screen.findByRole('button', { name: '预览林予' }))
  fireEvent.click(screen.getByRole('button', { name: '恢复素材' }))
  await screen.findByText('素材已恢复。')
  fireEvent.click(screen.getByRole('button', { name: '返回素材库' }))
  expect(await screen.findByRole('button', { name: '预览林予' })).toBeTruthy()
})
it('retains the preview when deleting an in-use asset is refused', async () => {
  const port = { referenceVideoAssets: vi.fn(async () => page([picture])), readLocalReferenceCandidateContent: localReader(),
    setAssetLibraryState: vi.fn().mockRejectedValue(new Error('素材仍被已保存的设计引用')) }
  render(<ProjectAssetLibrary projectId="p" episodeId="ep" port={port} />)
  fireEvent.click(await screen.findByRole('button', { name: '预览林予' }))
  fireEvent.click(screen.getByRole('button', { name: '删除此素材' }))
  expect(await screen.findByText('素材仍被已保存的设计引用')).toBeTruthy()
  expect(screen.getByRole('region', { name: '素材预览' })).toBeTruthy()
})
