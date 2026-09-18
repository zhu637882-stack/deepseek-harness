// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectAssetLibrary } from '../src/client/ProjectAssetLibrary.tsx'
import type { ReferenceVideoAssetsResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
const picture = { assetId:'face', assetSha256:'a'.repeat(64), label:'林予', mediaType:'reference_image' as const, browserUrl:'/face.png' }
const voice = { assetId:'voice', assetSha256:'b'.repeat(64), label:'林予音色', mediaType:'reference_audio' as const, browserUrl:'/voice.wav' }
const page = (items: ReferenceVideoAssetsResponse['items']): ReferenceVideoAssetsResponse => ({ projectId:'p',page:1,pages:1,items })
afterEach(cleanup)
it('filters real catalog entries and opens image or voice previews without a write action', async () => {
  const port = { referenceVideoAssets:vi.fn().mockResolvedValue(page([picture,voice])) }
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
  const port = { referenceVideoAssets:vi.fn().mockReturnValueOnce(oldRead).mockResolvedValueOnce({ ...page([voice]),projectId:'q' }) }
  const view=render(<ProjectAssetLibrary key="p" projectId="p" port={port} />)
  const signal=port.referenceVideoAssets.mock.calls[0]![1] as AbortSignal
  view.rerender(<ProjectAssetLibrary key="q" projectId="q" port={port} />)
  expect(signal.aborted).toBe(true)
  await screen.findByRole('button',{ name:'预览林予音色' })
  finish(page([picture]))
  await waitFor(()=>{expect(screen.queryByRole('button',{ name:'预览林予' })).toBeNull()})
})
