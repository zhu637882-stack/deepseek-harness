// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeAssetDesign } from '../src/client/NativeAssetDesign.tsx'
import type { AssetDesignState, AssetImageRuns } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
const scope = { projectId: 'p', episodeId: 'e' }
const state: AssetDesignState = { ...scope, schema: 'qingmu.asset-design-state.v1', stateSha256: 'a'.repeat(64), scriptSha256: 'b'.repeat(64), scriptRevision: 1, script: {}, model: 'wan2.7-image-pro',
  design: { sourceScriptSha256: 'b'.repeat(64), assets: [{ id: 'actor_1', kind: 'actor', name: '父亲', imagePrompt: '真人定妆照' }], director: {
    visualStyle: '写实', tone: '温暖', colorPalette: ['灰蓝'], lightingRules: '窗光', cameraGrammar: '跟随动作', performanceRules: '自然', characterContinuityRules: '服装稳定',
  } } }
afterEach(() => { cleanup(); localStorage.clear() })
function setup() {
  const port = { readAssetDesign: vi.fn(async () => state), saveAssetDesign: vi.fn(async () => state),
    quoteAssetImage: vi.fn(async () => ({ ...scope, entity: { ...state.design!.assets[0]!, id: 'actor_1' }, quoteSha256: 'c'.repeat(64), estimatedCny: '0.500000', generationAvailable: true, model: state.model, prompt: '真人定妆照' })),
    generateAssetImage: vi.fn(async () => ({ requestId: 'image-1', taskId: 'task_1', status: 'Queued', estimatedCny: '0.500000', selectionChanged: false as const })),
    readAssetImageRuns: vi.fn(async (): Promise<AssetImageRuns> => ({ ...scope, items: [] })) }
  return port
}
it('requires saved design and displayed price before one image submission', async () => {
  const port = setup()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const text = await screen.findByLabelText('画面描述')
  fireEvent.change(text, { target: { value: '灰蓝衬衣的真人定妆照' } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '查看生成费用' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: '查看生成费用' }).disabled).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: '查看生成费用' }))
  const confirm = await screen.findByRole('button', { name: '确认费用并生成一张' })
  expect(port.generateAssetImage).not.toHaveBeenCalled()
  fireEvent.click(confirm); fireEvent.click(confirm)
  await waitFor(() => { expect(port.generateAssetImage).toHaveBeenCalledTimes(1) })
  expect(port.generateAssetImage.mock.calls[0]).toEqual([{ ...scope, entityId: 'actor_1', command: expect.objectContaining({ paidConfirmed: true, authorizationCapCny: '0.500000' }) }])
})
it('rereads an existing image run on reload without charging again', async () => {
  const port = setup()
  port.readAssetImageRuns.mockResolvedValue({ ...scope, items: [{ taskId: 'task_1', entityId: 'actor_1', requestId: 'original', status: 'Succeeded', assetId: 'asset_1', errorCode: null }] })
  const onGenerated = vi.fn()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={onGenerated} />)
  await screen.findByText('图片已生成，可在下方素材库查看')
  expect(port.generateAssetImage).not.toHaveBeenCalled()
  expect(onGenerated).toHaveBeenCalledTimes(1)
})
