// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DirectorContextClientPort, NativeDraftProposal, NativeDraftProposalResult } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { NativeDirectorDraft, mergeNativeDraft } from '../src/client/NativeDirectorDraft.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import { draftPrompt, draftScope } from '../../qingmu-director-context-bridge/examples/native-draft-fixture.ts'
import type { YimengPromptIrResponse } from '../src/client/contracts.ts'
import { directorConnectionFixture } from './director-connection-fixture.client.ts'

afterEach(cleanup)
const snapshot = draftPrompt as YimengPromptIrResponse
const proposal = { schema: 'qingmu.native-draft-proposal.v1', field: 'imageGenPrompt',
  before: snapshot.subject.editableProjection.imageGenPrompt, after: '门在左侧，人物背面中景。', reason: '明确门与人物的位置。',
  input: { receiptId: 'a'.repeat(64), scope: draftScope, bindingSeq: 0, baseRevision: snapshot.baseRevision,
    baseSnapshotSha256: snapshot.baseSnapshotSha256, storyboardRevisionId: snapshot.subject.storyboardRevisionId,
    frameId: snapshot.subject.frameId, draftSnapshotSha256: null } } as NativeDraftProposal
const t = (key: QingmuCockpitKey) => zh[key]
function setup(read = vi.fn(async (): Promise<NativeDraftProposalResult> => ({ status: 'current', proposal }))) {
  const onAdopt = vi.fn()
  const props = { context: { bridge: { readNativeDraftProposal: read } as unknown as DirectorContextClientPort,
    sessionId: 'native-session', scope: draftScope }, disabled: false, sourceKey: 'base', onAdopt, t }
  return { ...render(<NativeDirectorDraft {...props} />), props, read, onAdopt }
}

it('changes only the proposed field and refuses to overwrite a manually changed target', () => {
  const base = snapshot.subject.editableProjection
  expect(mergeNativeDraft(proposal, snapshot, { ...base, videoGenPrompt: '手工改动' }, draftScope))
    .toEqual({ ...base, videoGenPrompt: '手工改动', imageGenPrompt: proposal.after })
  expect(() => mergeNativeDraft(proposal, snapshot, { ...base, imageGenPrompt: '我的文字' }, draftScope)).toThrow('conflict')
  expect(() => mergeNativeDraft(proposal, { ...snapshot, baseSnapshotSha256: 'b'.repeat(64) }, base, draftScope)).toThrow('stale')
  expect(() => mergeNativeDraft(proposal, snapshot, base, { ...draftScope, shotId: 'other' })).toThrow('stale')
})
it('removes pre-disconnect candidates without touching the editable draft and requires a new read after reconnect', async () => {
  const app = setup()
  const transport = directorConnectionFixture()
  app.rerender(<NativeDirectorDraft {...app.props} context={{ ...app.props.context, connection: transport.source }} />)
  fireEvent.click(screen.getByRole('button', { name: zh.nativeDraftRead }))
  await screen.findByRole('button', { name: zh.nativeDraftAdopt })
  act(() => { transport.publish(false) })
  expect(screen.queryByRole('button', { name: zh.nativeDraftAdopt })).toBeNull()
  expect((screen.getByRole('button', { name: zh.nativeDraftRead }) as HTMLButtonElement).disabled).toBe(true)
  act(() => { transport.publish(true) })
  expect(screen.queryByRole('button', { name: zh.nativeDraftAdopt })).toBeNull()
  expect(app.read).toHaveBeenCalledTimes(1); expect(app.onAdopt).not.toHaveBeenCalled()
})

it.each(['stale', 'unavailable', 'none'] as const)('does not adopt when the latest Host result is %s', async (status) => {
  const app = setup()
  fireEvent.click(screen.getByRole('button', { name: zh.nativeDraftRead }))
  await screen.findByRole('button', { name: zh.nativeDraftAdopt })
  app.read.mockResolvedValueOnce({ status })
  fireEvent.click(screen.getByRole('button', { name: zh.nativeDraftAdopt }))
  await waitFor(() => { expect(screen.queryByRole('button', { name: zh.nativeDraftAdopt })).toBeNull() })
  expect(app.onAdopt).not.toHaveBeenCalled()
})

it('requires review of a newer suggestion and prevents duplicate in-flight adoption', async () => {
  const app = setup()
  fireEvent.click(screen.getByRole('button', { name: zh.nativeDraftRead }))
  await screen.findByRole('button', { name: zh.nativeDraftAdopt })
  app.read.mockResolvedValueOnce({ status: 'current', proposal: { ...proposal, after: '新建议' } })
  const adopt = screen.getByRole('button', { name: zh.nativeDraftAdopt })
  fireEvent.click(adopt); fireEvent.click(adopt)
  await screen.findByText(zh.nativeDraftChanged)
  expect(app.read).toHaveBeenCalledTimes(2); expect(app.onAdopt).not.toHaveBeenCalled()
})

it.each(['session', 'shot', 'source'] as const)('discards late results when %s changes', async (change) => {
  let finish!: (value: NativeDraftProposalResult) => void
  const read = vi.fn(() => new Promise<NativeDraftProposalResult>((resolve) => { finish = resolve }))
  const app = setup(read)
  fireEvent.click(screen.getByRole('button', { name: zh.nativeDraftRead }))
  const context = { ...app.props.context, ...(change === 'session' ? { sessionId: 'other' } : {}),
    ...(change === 'shot' ? { scope: { ...draftScope, shotId: 'other' } } : {}) }
  app.rerender(<NativeDirectorDraft {...app.props} context={context} sourceKey={change === 'source' ? 'new' : 'base'} />)
  await act(async () => { finish({ status: 'current', proposal }) })
  expect(screen.queryByRole('button', { name: zh.nativeDraftAdopt })).toBeNull()
  expect(app.onAdopt).not.toHaveBeenCalled()
})

it('uses the latest editor callback during adoption instead of a stale draft closure', async () => {
  const app = setup()
  fireEvent.click(screen.getByRole('button', { name: zh.nativeDraftRead }))
  await screen.findByRole('button', { name: zh.nativeDraftAdopt })
  let finish!: (value: NativeDraftProposalResult) => void
  app.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: zh.nativeDraftAdopt }))
  const conflict = vi.fn(() => { throw new Error('local edit conflict') })
  app.rerender(<NativeDirectorDraft {...app.props} onAdopt={conflict} />)
  await act(async () => { finish({ status: 'current', proposal }) })
  await screen.findByText(zh.nativeDraftConflict)
  expect(app.onAdopt).not.toHaveBeenCalled(); expect(conflict).toHaveBeenCalledTimes(1)
})
