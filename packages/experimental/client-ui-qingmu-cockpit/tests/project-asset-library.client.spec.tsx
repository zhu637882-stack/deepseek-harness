// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
function localReader() { return vi.fn(async () => localContent) }
const page = (items: ReferenceVideoAssetsResponse['items']): ReferenceVideoAssetsResponse => ({ projectId:'p',page:1,pages:1,items })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
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


it('reads a selected local candidate through its owner-and-SHA-bound port, not a public URL', async () => {
  const readLocalReferenceCandidateContent = localReader()
  const port = {
    referenceVideoAssets: vi.fn().mockResolvedValue(page([localPicture, picture])),
    readLocalReferenceCandidateContent,
  }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  expect(readLocalReferenceCandidateContent).not.toHaveBeenCalled()
  await screen.findAllByRole('button', { name: '预览林予' })
  fireEvent.click(screen.getAllByRole('button', { name: '预览林予' })[0]!)
  await waitFor(() => expect(readLocalReferenceCandidateContent).toHaveBeenCalledWith({
    projectId: 'p', elementKind: 'actor', targetId: 'actor_linyu',
    assetId: 'asset_localref_linyu', expectedSha256: 'c'.repeat(64),
  }, expect.any(AbortSignal)))
  expect(screen.getByRole('region', { name: '素材预览' }).querySelector('img')?.getAttribute('src'))
    .toBe('data:image/png;base64,AQID')
})

it('shows a failed local preview and retries only when requested', async () => {
  const reader = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(localContent)
  const port = { referenceVideoAssets: vi.fn().mockResolvedValue(page([localPicture])), readLocalReferenceCandidateContent: reader }
  render(<ProjectAssetLibrary projectId="p" port={port} />)
  fireEvent.click(await screen.findByRole('button', { name: '预览林予' }))
  await screen.findByText('这份参考素材暂时无法读取。')
  expect(screen.queryByText('正在读取这份本地参考素材。')).toBeNull()
  expect(reader).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '重新读取参考素材' }))
  await waitFor(() => expect(screen.getByRole('region', { name: '素材预览' }).querySelector('img')).not.toBeNull())
  expect(reader).toHaveBeenCalledTimes(2)
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
  await waitFor(() => expect(screen.getByRole('region', { name: '素材预览' }).querySelector('audio')?.getAttribute('src')).toBe('blob:local-voice'))
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
  await waitFor(() => expect(readLocalVoiceCandidateContent).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
  resolve({ schema: 'jason.qingmu-local-voice-content.v1', assetId: voice.assetId, sha256: voice.assetSha256, mimeType: 'audio/wav', contentBase64: 'AQID' })
  await waitFor(() => expect(screen.queryByRole('region', { name: '素材预览' })).toBeNull())
  expect(createObjectURL).not.toHaveBeenCalled()
})
