// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PromptIrWorkspace } from '../src/client/PromptIrWorkspace.tsx'
import type { QingmuYimengPort } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'
import { directorConnectionFixture } from './director-connection-fixture.client.ts'
import type { DirectorContextClientPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'

const PROJECT = 'project-1'
const EPISODE = 'episode-1'
const REVISION = 'storyboard-1'
const FRAME = 'frame-1'
const CONTEXT_SHA = '1'.repeat(64)
const PROJECTION_SHA = '2'.repeat(64)
const METHOD_SHA = '3'.repeat(64)
const CANDIDATE_SHA = '4'.repeat(64)
const CONTENT_SHA = '5'.repeat(64)
const EDITABLE = {
  imageGenPrompt: '雨夜街道，建立空间', lastFrameImagePrompt: '',
  videoGenPrompt: '人物走入画面；4 秒内完成', motionPrompt: '缓慢走入', negativePrompt: '不新增人物',
} as const
const SUBJECT = {
  schema: 'jason.qingmu-prompt-ir-subject.v1', projectId: PROJECT, episodeId: EPISODE,
  targetType: 'prompt_ir', targetId: `${REVISION}:${FRAME}`, storyboardRevisionId: REVISION,
  frameId: FRAME, promptIrId: 'prompt-ir-1', promptIrVersion: 1,
  promptIrContentSha256: CONTENT_SHA, status: 'Draft', editableProjection: EDITABLE,
} as const
const CONTEXT = {
  schema: 'jason.qingmu-prompt-ir-bootstrap-context.v1', projectId: PROJECT, episodeId: EPISODE,
  storyboard: { id: REVISION, version: 1, sourceHash: '6'.repeat(64) },
  frame: { id: FRAME }, requiredReferences: [],
} as const
const FLAGS = { providerCalls: 0, workerStarted: false, humanApprovalInferred: false,
  humanSignoff: false, selectionExecuted: false } as const
const SELECTION_CHALLENGE = {
  schema: 'jason.qingmu-prompt-ir-bootstrap-selection-challenge.v1', actorId: 'owner',
  projectId: PROJECT, episodeId: EPISODE, storyboardRevisionId: REVISION, frameId: FRAME,
  draftPromptIrId: SUBJECT.promptIrId, draftVersion: SUBJECT.promptIrVersion,
  draftContentSha256: CONTENT_SHA, contextSnapshotSha256: CONTEXT_SHA,
  methodProjectionSha256: PROJECTION_SHA, methodSha256: METHOD_SHA, candidateSha256: CANDIDATE_SHA,
  nonce: 'a'.repeat(64), issuedAtUnix: 1_788_134_400, expiresAtUnix: 1_788_134_700,
  signature: 'b'.repeat(64),
} as const

function state(status: 'empty' | 'draft' | 'ready') {
  return {
    schema: 'jason.qingmu-prompt-ir-bootstrap-state.v1', context: CONTEXT,
    contextSnapshotSha256: CONTEXT_SHA, referenceNames: [],
    draft: status === 'draft' ? SUBJECT : null,
    draftMethodSha256: status === 'draft' ? METHOD_SHA : null,
    selectionChallenge: status === 'draft' ? SELECTION_CHALLENGE : null,
    ready: status === 'ready' ? { ...SUBJECT, status: 'Ready' } : null,
    ...FLAGS,
  } as const
}

function port(options: { readonly loseDraftResponse?: boolean; readonly loseSelectionResponse?: boolean } = {}) {
  let persisted: 'empty' | 'draft' | 'ready' = 'empty'
  let draftAttempts = 0
  let selectionAttempts = 0
  let persistedFields = { ...EDITABLE } as Record<string, string>
  const promptIrBootstrap = vi.fn(async () => {
    const current = state(persisted)
    return { ...current, draft: current.draft && { ...current.draft, editableProjection: persistedFields } }
  })
  const promptIrBootstrapMethod = vi.fn(async (request: Record<string, unknown>) => ({
    schema: 'qingmu.imago-prompt-ir-bootstrap-method-adapter-result.v1', projectionSha256: PROJECTION_SHA,
    projection: {
      schema: 'qingmu.imago-prompt-ir-bootstrap-method-projection.v1', input_snapshot_sha256: '7'.repeat(64),
      context: CONTEXT, context_snapshot_sha256: CONTEXT_SHA,
      candidate: { editableProjection: request.editableProjection ?? EDITABLE, subjectArray: [], advisoryOnly: true, status: 'Draft' },
      candidate_sha256: CANDIDATE_SHA,
      method_definition: { id: 'method', version: 1, sha256: METHOD_SHA }, source_bindings: [],
      work_order_projection: {}, project_state_persisted: false, providerCalls: 0, workerStarted: false,
      selection_executed: false, human_approval_inferred: false, human_signoff_inferred: false,
    },
    methodAttestation: { schema: 'qingmu.imago-prompt-ir-bootstrap-method-attestation.v1',
      algorithm: 'hmac-sha256', projectionSha256: PROJECTION_SHA, contextSnapshotSha256: CONTEXT_SHA,
      methodSha256: METHOD_SHA, candidateSha256: CANDIDATE_SHA, signature: 'signed' },
    ...(request.selectionChallenge === undefined ? {} : {
      selectionFreshnessAttestation: {
        schema: 'qingmu.imago-prompt-ir-bootstrap-selection-freshness-attestation.v1',
        algorithm: 'hmac-sha256', challengeSha256: 'c'.repeat(64), projectionSha256: PROJECTION_SHA,
        contextSnapshotSha256: CONTEXT_SHA, methodSha256: METHOD_SHA,
        candidateSha256: CANDIDATE_SHA, signature: 'd'.repeat(64),
      },
    }),
  }))
  const draftResult = (request: Record<string, unknown>, deduplicated: boolean) => ({
    schema: 'jason.qingmu-prompt-ir-bootstrap-result.v1', projectId: PROJECT, episodeId: EPISODE,
    storyboardRevisionId: REVISION, frameId: FRAME, contextSnapshotSha256: CONTEXT_SHA,
    methodSha256: METHOD_SHA, candidateSha256: CANDIDATE_SHA, promptIr: SUBJECT,
    referencePackIds: ['pack-1'], changeSetId: 'change-1', commandReceiptId: 'receipt-1', eventId: 'event-1',
    idempotencyKey: request.idempotencyKey, requestSha256: '8'.repeat(64), deduplicated,
    committedAt: '2026-08-31T00:00:00Z', ...FLAGS,
  })
  const bootstrapPromptIr = vi.fn(async (request: Record<string, unknown>) => {
    const projection = request.methodProjection as { candidate: { editableProjection: Record<string, string> } }
    persistedFields = projection.candidate.editableProjection
    draftAttempts += 1; persisted = 'draft'
    if (options.loseDraftResponse === true && draftAttempts === 1) throw new Error('response lost')
    return draftResult(request, draftAttempts > 1)
  })
  const recoverPromptIrBootstrap = vi.fn(async (request: Record<string, unknown>) => draftResult(request, true))
  const selectionResult = (request: Record<string, unknown>, deduplicated: boolean) => ({
    schema: 'jason.qingmu-prompt-ir-selection-result.v1', eventType: 'PromptIrSelected',
    projectId: PROJECT, episodeId: EPISODE, targetType: 'prompt_ir', targetId: `${REVISION}:${FRAME}`,
    storyboardRevisionId: REVISION, frameId: FRAME, selectedPromptIr: {
      id: SUBJECT.promptIrId, version: 1, contentSha256: CONTENT_SHA, status: 'Ready',
    }, previousReadyPromptIr: null, changeSetId: 'select-change', commandReceiptId: 'select-receipt',
    eventId: 'select-event', idempotencyKey: request.idempotencyKey, changed: true, deduplicated,
    committedAt: '2026-08-31T00:00:01Z', providerCall: false, workerStarted: false,
    humanApprovalInferred: false, humanSignoff: false,
  })
  const selectBootstrapPromptIr = vi.fn(async (request: Record<string, unknown>) => {
    selectionAttempts += 1; persisted = 'ready'
    if (options.loseSelectionResponse === true && selectionAttempts === 1) throw new Error('response lost')
    return selectionResult(request, selectionAttempts > 1)
  })
  const recoverPromptIrSelection = vi.fn(async (request: Record<string, unknown>) => ({
    schema: 'jason.qingmu-command-receipt-recovery.v1', recovered: true,
    receiptSha256: '9'.repeat(64), receipt: selectionResult(request, true),
  }))
  return { port: { promptIrBootstrap, promptIrBootstrapMethod, bootstrapPromptIr,
    recoverPromptIrBootstrap, selectBootstrapPromptIr, recoverPromptIrSelection } as unknown as QingmuYimengPort,
  spies: { promptIrBootstrap, promptIrBootstrapMethod, bootstrapPromptIr,
    recoverPromptIrBootstrap, selectBootstrapPromptIr, recoverPromptIrSelection } }
}

const props = { projectId: PROJECT, episodeId: EPISODE, storyboardRevisionId: REVISION,
  shotItems: [{ shotId: FRAME, frameId: FRAME, name: '开场镜头' }], selectedShotId: FRAME,
  onSelectShotId: vi.fn(), t: ((key: keyof typeof zh) => zh[key]), onCommitted: vi.fn(async () => {}) }

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

describe('first PromptIR bootstrap workspace', () => {
  it('prepares shooting requirements once and retains the human confirmation step after refresh', async () => {
    const harness = port()
    const view = render(<PromptIrWorkspace {...props} port={harness.port} presentation="shooting" />)
    fireEvent.click(await screen.findByRole('button', { name: '准备本镜生成要求' }))
    await screen.findByRole('checkbox', { name: '我确认使用以上本镜生成要求' })
    expect(harness.spies.bootstrapPromptIr).toHaveBeenCalledTimes(1)
    expect(harness.spies.selectBootstrapPromptIr).not.toHaveBeenCalled()
    const draftProps = { ...props, shotItems: [{ ...props.shotItems[0]!, promptLineage: {
      id: SUBJECT.promptIrId, storyboardRevisionId: REVISION, version: 1,
      contentSha256: CONTENT_SHA, status: 'Draft',
    } }] }
    view.rerender(<PromptIrWorkspace {...draftProps} port={harness.port} presentation="shooting" />)
    expect(screen.getByRole('region', { name: '本镜生成要求' })).toBeTruthy()
    view.unmount()
    render(<PromptIrWorkspace {...draftProps} port={harness.port} presentation="shooting" />)
    const confirmation = await screen.findByRole('checkbox', { name: '我确认使用以上本镜生成要求' })
    expect((confirmation as HTMLInputElement).checked).toBe(false)
    expect(harness.spies.bootstrapPromptIr).toHaveBeenCalledTimes(1)
    expect(harness.spies.selectBootstrapPromptIr).not.toHaveBeenCalled()
    fireEvent.click(confirmation)
    fireEvent.click(await screen.findByRole('button', { name: '使用这些要求并继续' }))
    await waitFor(() => { expect(harness.spies.selectBootstrapPromptIr).toHaveBeenCalledTimes(1) })
    expect(harness.spies.promptIrBootstrapMethod.mock.calls.at(-1)?.[0].selectionChallenge).toEqual(SELECTION_CHALLENGE)
  })

  it('recovers a shooting draft with a lost response without creating a second draft', async () => {
    const harness = port({ loseDraftResponse: true })
    render(<PromptIrWorkspace {...props} port={harness.port} presentation="shooting" />)
    fireEvent.click(await screen.findByRole('button', { name: '准备本镜生成要求' }))
    fireEvent.click(await screen.findByRole('button', { name: '恢复已保存的要求' }))
    await screen.findByRole('checkbox', { name: '我确认使用以上本镜生成要求' })
    expect(harness.spies.bootstrapPromptIr).toHaveBeenCalledTimes(1)
    expect(harness.spies.recoverPromptIrBootstrap).toHaveBeenCalledTimes(1)
    expect(harness.spies.selectBootstrapPromptIr).not.toHaveBeenCalled()
  })

  it('adopts a native first draft, permits human edits and uses saved text for selection', async () => {
    const harness = port()
    const onUnsavedChange = vi.fn()
    const scope = { projectId: PROJECT, episodeId: EPISODE, sceneId: 'scene-1', shotId: FRAME }
    const readNativeFirstDraftProposal = vi.fn(async () => ({ status: 'current', proposal: {
      schema: 'qingmu.native-first-draft-proposal.v1', input: { scope, receiptId: 'f'.repeat(64),
        contextSnapshotSha256: CONTEXT_SHA, storyboardRevisionId: REVISION },
      editableProjection: { ...EDITABLE, imageGenPrompt: '副驾后方机位，主角侧背。' }, reason: '交代视点',
    } }))
    render(<PromptIrWorkspace {...props} onUnsavedChange={onUnsavedChange} port={harness.port} nativeDirector={{ sessionId: 'director', scope,
      bridge: { readNativeFirstDraftProposal } as unknown as DirectorContextClientPort }} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.nativeDraftRead }))
    fireEvent.click(await screen.findByRole('button', { name: zh.nativeDraftAdopt }))
    const image = await screen.findByRole('textbox', { name: '首帧画面' })
    expect((image as HTMLTextAreaElement).value).toContain('副驾后方')
    expect(onUnsavedChange).toHaveBeenLastCalledWith(true)
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(true)
    expect(harness.spies.bootstrapPromptIr).not.toHaveBeenCalled()
    fireEvent.change(image, { target: { value: '人工修改：远处女主只见轮廓。' } })
    fireEvent.click(screen.getByRole('button', { name: '检查并预览首稿' }))
    fireEvent.click(await screen.findByRole('button', { name: '保存首个 PromptIR Draft' }))
    await screen.findByText('PromptIR Draft 已保存')
    expect(onUnsavedChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '选为首个 Ready' }))
    await screen.findByText('首个 Ready PromptIR 已选定')
    expect(readNativeFirstDraftProposal).toHaveBeenCalledTimes(2)
    expect(harness.spies.promptIrBootstrapMethod.mock.calls.map(([request]) => request.editableProjection))
      .toEqual(Array(2).fill({ ...EDITABLE, imageGenPrompt: '人工修改：远处女主只见轮廓。' }))
    expect(harness.spies.bootstrapPromptIr).toHaveBeenCalledTimes(1)
  })

  it.each(['draft', 'select'] as const)('cancels %s before dispatch if disconnected during idempotency hashing', async (kind) => {
    const harness = port()
    const connection = directorConnectionFixture()
    render(<PromptIrWorkspace {...props} port={harness.port} nativeDirector={{ sessionId: 'director',
      scope: { projectId: PROJECT, episodeId: EPISODE, sceneId: 'scene-1', shotId: FRAME },
      bridge: {} as DirectorContextClientPort, connection: connection.source }} />)
    fireEvent.click(await screen.findByRole('button', { name: '生成首个 Draft 预览' }))
    await screen.findByRole('button', { name: '保存首个 PromptIR Draft' })
    if (kind === 'select') {
      fireEvent.click(screen.getByRole('button', { name: '保存首个 PromptIR Draft' }))
      await screen.findByText('PromptIR Draft 已保存')
      fireEvent.click(screen.getByRole('checkbox'))
    }
    let finish!: (value: ArrayBuffer) => void
    const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: kind === 'draft' ? '保存首个 PromptIR Draft' : '选为首个 Ready' }))
    await waitFor(() => { expect(digest).toHaveBeenCalledTimes(1) })
    await act(async () => { connection.publish(false) })
    await act(async () => { finish(new ArrayBuffer(32)) })
    expect(harness.spies.bootstrapPromptIr).toHaveBeenCalledTimes(kind === 'draft' ? 0 : 1)
    expect(harness.spies.selectBootstrapPromptIr).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('invalidates preview on edit and preserves text across connection recovery', async () => {
    const harness = port()
    const connection = directorConnectionFixture()
    render(<PromptIrWorkspace {...props} port={harness.port} nativeDirector={{ sessionId: 'director',
      scope: { projectId: PROJECT, episodeId: EPISODE, sceneId: 'scene-1', shotId: FRAME },
      bridge: {} as DirectorContextClientPort, connection: connection.source }} />)
    fireEvent.click(await screen.findByRole('button', { name: '生成首个 Draft 预览' }))
    const image = await screen.findByRole('textbox', { name: '首帧画面' })
    fireEvent.change(image, { target: { value: '保留人工首稿' } })
    expect(screen.queryByRole('button', { name: '保存首个 PromptIR Draft' })).toBeNull()
    connection.publish(false)
    await screen.findByText('连接已断开；未保存文字保留，恢复连接后重新核对上游。')
    connection.publish(true)
    expect((await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '首帧画面' })).value).toBe('保留人工首稿')
    expect(harness.spies.bootstrapPromptIr).not.toHaveBeenCalled()
  })

  it('keeps a stale first draft visible for copying and requires explicit discard before new compilation', async () => {
    const harness = port()
    const onUnsavedChange = vi.fn()
    render(<PromptIrWorkspace {...props} presentation="director" onUnsavedChange={onUnsavedChange} port={harness.port} />)
    fireEvent.click(await screen.findByRole('button', { name: '生成首个 Draft 预览' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '首帧画面' }), { target: { value: '旧稿需保留' } })
    harness.spies.promptIrBootstrap.mockResolvedValueOnce({ ...state('empty'), contextSnapshotSha256: 'a'.repeat(64) })
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByRole('alert', { name: '旧首稿保留' })
    expect(screen.getByText('旧稿需保留')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成首个 Draft 预览' }).disabled).toBe(true)
    expect(onUnsavedChange).toHaveBeenLastCalledWith(true)
    expect(harness.spies.promptIrBootstrapMethod).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '丢弃这份本地旧稿' }))
    expect(onUnsavedChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成首个 Draft 预览' }).disabled).toBe(false)
  })
  it.each(['draft', 'ready'] as const)('preserves different local text when another session saves %s', async (status) => {
    const harness = port()
    const dirty = vi.fn()
    render(<PromptIrWorkspace {...props} presentation="director" port={harness.port} onUnsavedChange={dirty} />)
    fireEvent.click(await screen.findByRole('button', { name: '生成首个 Draft 预览' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '首帧画面' }), { target: { value: '尚未保存的个人修改' } })
    harness.spies.promptIrBootstrap.mockResolvedValueOnce(state(status))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByRole('alert', { name: '旧首稿保留' })
    expect(screen.getByText('尚未保存的个人修改')).toBeTruthy()
    expect(dirty).toHaveBeenLastCalledWith(true)
    expect(harness.spies.bootstrapPromptIr).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '丢弃这份本地旧稿' }))
    expect(dirty).toHaveBeenLastCalledWith(false)
  })

  it('persists one Draft and separately selects it as Ready without execution authority', async () => {
    const harness = port()
    render(<PromptIrWorkspace {...props} port={harness.port} />)
    fireEvent.click(await screen.findByRole('button', { name: '生成首个 Draft 预览' }))
    await screen.findByRole('button', { name: '保存首个 PromptIR Draft' })
    expect(screen.queryByRole('textbox', { name: '首帧画面' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: '保存首个 PromptIR Draft' }))
    await screen.findByText('PromptIR Draft 已保存')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '选为首个 Ready' }))
    await screen.findByText('首个 Ready PromptIR 已选定')
    expect(harness.spies.promptIrBootstrapMethod).toHaveBeenCalledTimes(2)
    expect(harness.spies.bootstrapPromptIr).toHaveBeenCalledTimes(1)
    expect(harness.spies.recoverPromptIrBootstrap).toHaveBeenCalledTimes(1)
    expect(harness.spies.selectBootstrapPromptIr).toHaveBeenCalledTimes(1)
    const selectionRequest = harness.spies.selectBootstrapPromptIr.mock.calls[0]?.[0]
    expect(selectionRequest?.selectionChallenge).toEqual(SELECTION_CHALLENGE)
    expect((selectionRequest?.selectionFreshnessAttestation as Record<string, unknown>).projectionSha256)
      .toBe(PROJECTION_SHA)
  })

  it('recovers lost Draft and selection responses with the original idempotent coordinates', async () => {
    const harness = port({ loseDraftResponse: true, loseSelectionResponse: true })
    render(<PromptIrWorkspace {...props} port={harness.port} />)
    fireEvent.click(await screen.findByRole('button', { name: '生成首个 Draft 预览' }))
    fireEvent.click(await screen.findByRole('button', { name: '保存首个 PromptIR Draft' }))
    fireEvent.click(await screen.findByRole('button', { name: '恢复原 Draft 回执' }))
    await screen.findByText('PromptIR Draft 已保存')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '选为首个 Ready' }))
    fireEvent.click(await screen.findByRole('button', { name: '恢复原选择结果' }))
    await screen.findByText('首个 Ready PromptIR 已选定')
    expect(harness.spies.bootstrapPromptIr).toHaveBeenCalledTimes(1)
    expect(harness.spies.recoverPromptIrBootstrap).toHaveBeenCalledTimes(1)
    expect(harness.spies.selectBootstrapPromptIr).toHaveBeenCalledTimes(1)
    expect(harness.spies.recoverPromptIrSelection).toHaveBeenCalledTimes(1)
    const first = harness.spies.selectBootstrapPromptIr.mock.calls[0]?.[0]
    const recovered = harness.spies.recoverPromptIrSelection.mock.calls[0]?.[0]
    expect(recovered).toMatchObject({
      draftPromptIrId: first?.draftPromptIrId,
      draftVersion: first?.draftVersion,
      draftContentSha256: first?.draftContentSha256,
      idempotencyKey: first?.idempotencyKey,
    })
  })
})
