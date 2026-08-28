// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PromptIrWorkspace } from '../src/client/PromptIrWorkspace.tsx'
import type { QingmuYimengPort } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'
import {
  readPromptIrEditRecoveryMarker,
  readPromptIrSelectionRecoveryMarker,
} from '../src/client/prompt-ir-recovery.ts'

const PROJECT_ID = 'project-1'
const EPISODE_ID = 'episode-1'
const STORYBOARD_REVISION_ID = 'storyboard-7'
const FRAME_ID = 'frame-3'
const TARGET_ID = `${STORYBOARD_REVISION_ID}:${FRAME_ID}`
const BASE_ID = 'prompt-ready-4'
const DRAFT_ID = 'prompt-draft-5'
const BASE_VERSION = 4
const DRAFT_VERSION = 5
const BASE_CONTENT_SHA = '1'.repeat(64)
const BASE_SNAPSHOT_SHA = '2'.repeat(64)
const PAYLOAD_SHA = '3'.repeat(64)
const DRAFT_CONTENT_SHA = '4'.repeat(64)
const SELECTED_SNAPSHOT_SHA = '5'.repeat(64)
const PROJECTION_SHA = '6'.repeat(64)
const CANDIDATE_SHA = '7'.repeat(64)
const RECEIPT_SHA = '8'.repeat(64)

const COORDINATES = {
  projectId: PROJECT_ID,
  episodeId: EPISODE_ID,
  storyboardRevisionId: STORYBOARD_REVISION_ID,
  frameId: FRAME_ID,
} as const

const BASE_EDITABLE = {
  imageGenPrompt: '雨夜巷口，中景',
  lastFrameImagePrompt: '人物停在檐下',
  videoGenPrompt: '镜头缓慢前推',
  motionPrompt: '衣摆随风轻动',
  negativePrompt: '畸形手指，水印',
} as const

const CANDIDATE_EDITABLE = {
  ...BASE_EDITABLE,
  videoGenPrompt: '镜头缓慢前推，人物抬眼',
}

const BASE_READ = {
  draft: null,
  schema: 'jason.qingmu-prompt-ir-subject-read.v1',
  subject: {
    schema: 'jason.qingmu-prompt-ir-subject.v1',
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
    targetType: 'prompt_ir',
    targetId: TARGET_ID,
    storyboardRevisionId: STORYBOARD_REVISION_ID,
    frameId: FRAME_ID,
    promptIrId: BASE_ID,
    promptIrVersion: BASE_VERSION,
    promptIrContentSha256: BASE_CONTENT_SHA,
    status: 'Ready',
    editableProjection: BASE_EDITABLE,
  },
  baseRevision: BASE_VERSION,
  baseSnapshotSha256: BASE_SNAPSHOT_SHA,
} as const

function frame(status: 'Ready' | 'Draft') {
  return [{
    shotId: 'shot-3',
    name: '雨夜相遇',
    frameId: FRAME_ID,
    promptLineage: status === 'Ready'
      ? {
        storyboardRevisionId: STORYBOARD_REVISION_ID,
        id: BASE_ID,
        version: BASE_VERSION,
        contentSha256: BASE_CONTENT_SHA,
        status,
      }
      : {
        storyboardRevisionId: STORYBOARD_REVISION_ID,
        id: DRAFT_ID,
        version: DRAFT_VERSION,
        contentSha256: DRAFT_CONTENT_SHA,
        status,
      },
  }]
}

function createPort(options: { readonly editPostSucceeds?: boolean } = {}) {
  let selected = false
  let selectedReadyReads = 0
  const editReceipt = (request: Record<string, unknown>) => ({
    schema: 'jason.qingmu-prompt-ir-edit-commit-result.v1',
    changeSetId: request.changeSetId,
    commandReceiptId: 'edit-receipt-1',
    eventId: 'edit-event-1',
    eventType: 'PromptIrDraftCommitted',
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
    targetType: 'prompt_ir',
    targetId: TARGET_ID,
    storyboardRevisionId: STORYBOARD_REVISION_ID,
    frameId: FRAME_ID,
    promptIr: {
      id: DRAFT_ID,
      version: DRAFT_VERSION,
      contentSha256: DRAFT_CONTENT_SHA,
      status: 'Draft',
      editableProjection: CANDIDATE_EDITABLE,
    },
    previousReadyPromptIr: {
      id: BASE_ID,
      version: BASE_VERSION,
      contentSha256: BASE_CONTENT_SHA,
      status: 'Ready',
    },
    payloadSha256: request.expectedPayloadSha256,
    idempotencyKey: request.idempotencyKey,
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: false,
    committedAt: '2026-08-27T00:00:00.000Z',
  } as const)
  const selectionReceipt = (request: Record<string, unknown>) => ({
    schema: 'jason.qingmu-prompt-ir-selection-result.v1',
    changeSetId: 'selection-change-set-1',
    commandReceiptId: 'selection-receipt-1',
    eventId: 'selection-event-1',
    eventType: 'PromptIrSelected',
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
    targetType: 'prompt_ir',
    targetId: TARGET_ID,
    storyboardRevisionId: STORYBOARD_REVISION_ID,
    frameId: FRAME_ID,
    selectedPromptIr: {
      id: request.draftPromptIrId,
      version: request.draftVersion,
      contentSha256: request.draftContentSha256,
      status: 'Ready',
      editableProjection: CANDIDATE_EDITABLE,
    },
    stalePromptIrIds: [BASE_ID],
    idempotencyKey: request.idempotencyKey,
    changed: true,
    providerCall: false,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: false,
    committedAt: '2026-08-27T00:01:00.000Z',
  } as const)

  const promptIr = vi.fn(async () => {
    if (!selected) return BASE_READ
    selectedReadyReads += 1
    return {
      ...BASE_READ,
      subject: {
        ...BASE_READ.subject,
        promptIrId: DRAFT_ID,
        promptIrVersion: DRAFT_VERSION,
        promptIrContentSha256: selectedReadyReads === 1 ? 'e'.repeat(64) : DRAFT_CONTENT_SHA,
        editableProjection: CANDIDATE_EDITABLE,
      },
      baseRevision: DRAFT_VERSION,
      baseSnapshotSha256: SELECTED_SNAPSHOT_SHA,
    }
  })
  const promptIrMethod = vi.fn(async (request: Record<string, unknown>) => ({
    schema: 'qingmu.imago-prompt-ir-method-adapter-result.v1',
    projectionSha256: PROJECTION_SHA,
    projection: {
      schema: 'qingmu.imago-prompt-ir-method-projection.v1',
      input_snapshot_sha256: '9'.repeat(64),
      target: {
        projectId: request.projectId,
        episodeId: request.episodeId,
        storyboardRevisionId: request.storyboardRevisionId,
        frameId: request.frameId,
        basePromptIrId: request.basePromptIrId,
        baseVersion: request.baseVersion,
        baseSnapshotSha256: request.baseSnapshotSha256,
        baseContentSha256: request.baseContentSha256,
      },
      normalized_candidate: CANDIDATE_EDITABLE,
      candidate_sha256: CANDIDATE_SHA,
      changed_paths: ['$.videoGenPrompt'],
      blockers: [],
      warnings: ['保持人物动作连续'],
      method_definition: {},
      source_bindings: [],
      field_hints: [{ field: 'videoGenPrompt', guidance: '描述镜头与表演' }],
      checklist: [{ label: '检查动作连续性' }],
      work_order_projection: {},
      authority_snapshot_attestation: 'not_verified_by_compiler',
      project_state_persisted: false,
      providerCalls: 0,
      workerStarted: false,
      selection_executed: false,
      human_approval_inferred: false,
      human_signoff_inferred: false,
    },
    methodAttestation: {
      schema: 'qingmu.imago-prompt-ir-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256: PROJECTION_SHA,
      inputSnapshotSha256: '9'.repeat(64),
      targetSha256: 'a'.repeat(64),
      baseEditableProjectionSha256: 'b'.repeat(64),
      candidateEditableProjectionSha256: 'c'.repeat(64),
      candidateSha256: CANDIDATE_SHA,
      signature: 'd'.repeat(64),
    },
  } as const))
  const proposePromptIr = vi.fn(async () => ({
    schema: 'jason.qingmu-prompt-ir-change-set-proposal.v1',
    changeSet: {
      id: 'change-set-1',
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      targetType: 'prompt_ir',
      targetId: TARGET_ID,
      baseRevision: BASE_VERSION,
      baseSnapshotSha256: BASE_SNAPSHOT_SHA,
      payloadSha256: PAYLOAD_SHA,
    },
    nextAction: 'preview',
  } as const))
  const previewPromptIr = vi.fn(async () => ({
    schema: 'jason.qingmu-prompt-ir-preview.v1',
    changeSetId: 'change-set-1',
    target: {
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      storyboardRevisionId: STORYBOARD_REVISION_ID,
      frameId: FRAME_ID,
      targetId: TARGET_ID,
    },
    basePromptIr: {
      id: BASE_ID,
      version: BASE_VERSION,
      contentSha256: BASE_CONTENT_SHA,
      status: 'Ready',
      editableProjection: BASE_EDITABLE,
    },
    candidatePromptIr: {
      id: DRAFT_ID,
      version: DRAFT_VERSION,
      contentSha256: DRAFT_CONTENT_SHA,
      status: 'Draft',
      editableProjection: CANDIDATE_EDITABLE,
    },
    promptDiff: {
      changed: true,
      changedPaths: ['$.videoGenPrompt'],
      before: BASE_EDITABLE,
      after: CANDIDATE_EDITABLE,
    },
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
  } as const))
  const commitPromptIrEdit = vi.fn(async (request: Record<string, unknown>) => {
    if (options.editPostSucceeds === true) return editReceipt(request)
    throw new Error('edit connection lost')
  })
  const recoverPromptIrEditCommit = vi.fn(async (request: Record<string, unknown>) => ({
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256: RECEIPT_SHA,
    receipt: editReceipt(request),
  } as const))
  const workflow = vi.fn(async () => ({
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
    shots: { items: frame('Ready') },
  }))
  const selectPromptIr = vi.fn(async () => { throw new Error('selection connection lost') })
  const recoverPromptIrSelection = vi.fn(async (request: Record<string, unknown>) => {
    selected = true
    return {
      schema: 'jason.qingmu-command-receipt-recovery.v1',
      recovered: true,
      receiptSha256: RECEIPT_SHA,
      receipt: selectionReceipt(request),
    } as const
  })

  return {
    port: {
      promptIr,
      promptIrMethod,
      proposePromptIr,
      previewPromptIr,
      commitPromptIrEdit,
      recoverPromptIrEditCommit,
      workflow,
      selectPromptIr,
      recoverPromptIrSelection,
    } as unknown as QingmuYimengPort,
    spies: {
      promptIr,
      promptIrMethod,
      proposePromptIr,
      previewPromptIr,
      commitPromptIrEdit,
      recoverPromptIrEditCommit,
      workflow,
      selectPromptIr,
      recoverPromptIrSelection,
    },
  }
}

const t = ((key: keyof typeof zh) => zh[key])

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('PromptIrWorkspace vertical slice', () => {
  it('unlocks a proven historical commit when a newer Draft is current, retaining text for explicit rebase', async () => {
    const { port, spies } = createPort()
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID} storyboardRevisionId={STORYBOARD_REVISION_ID}
      shotItems={frame('Ready')} selectedShotId={FRAME_ID} onSelectShotId={vi.fn()} port={port} t={t}
      onCommitted={vi.fn(async () => {})} presentation="director" />)
    const input = await screen.findByLabelText(zh.directorVideoPrompt)
    fireEvent.change(input, { target: { value: CANDIDATE_EDITABLE.videoGenPrompt } })
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCheckMethod }))
    fireEvent.click(await screen.findByRole('button', { name: zh.promptIrPreparePreview }))
    fireEvent.click(await screen.findByRole('checkbox', { name: zh.promptIrEditConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCommitEdit }))
    const recover = await screen.findByRole('button', { name: zh.promptIrRecoverEdit })
    await waitFor(() => { expect((recover as HTMLButtonElement).disabled).toBe(false) })
    const latest = { ...BASE_READ, draft: { status: 'current', reason: null,
      subject: { ...BASE_READ.subject, status: 'Draft', promptIrId: 'newer-draft', promptIrVersion: DRAFT_VERSION + 1,
        promptIrContentSha256: 'b'.repeat(64), editableProjection: { ...BASE_EDITABLE, videoGenPrompt: '其他会话新稿' } },
      subjectSnapshotSha256: 'c'.repeat(64), baseBinding: { id: BASE_ID, version: BASE_VERSION, contentSha256: BASE_CONTENT_SHA } } }
    spies.promptIr.mockResolvedValueOnce(latest as unknown as typeof BASE_READ)
    fireEvent.click(recover)
    await screen.findByText(zh.directorHistoricalCommitted)
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('none')
    expect(screen.queryByRole('button', { name: zh.promptIrRecoverEdit })).toBeNull()
    expect((input as HTMLTextAreaElement).value).toBe(CANDIDATE_EDITABLE.videoGenPrompt)
    expect(screen.getByRole('button', { name: zh.directorRebase })).toBeTruthy()
    expect(spies.commitPromptIrEdit).toHaveBeenCalledTimes(1)
  })

  it('keeps unsaved text in memory when recovery storage fails and blocks destructive reread', async () => {
    const { port, spies } = createPort()
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID} storyboardRevisionId={STORYBOARD_REVISION_ID}
      shotItems={frame('Ready')} selectedShotId={FRAME_ID} onSelectShotId={vi.fn()} port={port} t={t}
      onCommitted={vi.fn(async () => {})} presentation="director" />)
    const input = await screen.findByLabelText(zh.directorVideoPrompt)
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    try {
      fireEvent.change(input, { target: { value: '必须保留的文字' } })
      await screen.findByText(zh.directorStorageError)
      fireEvent.click(screen.getByRole('button', { name: zh.promptIrReload }))
      expect((input as HTMLTextAreaElement).value).toBe('必须保留的文字')
      expect(spies.promptIr).toHaveBeenCalledTimes(1)
    } finally { storage.mockRestore() }
  })

  it('explicitly rebases a stale saved Draft and binds its exact source in the proposal', async () => {
    const { port, spies } = createPort()
    const saved = { status: 'stale', reason: 'prompt_ir_base_snapshot_conflict',
      subject: { ...BASE_READ.subject, status: 'Draft', promptIrId: DRAFT_ID, promptIrVersion: DRAFT_VERSION,
        promptIrContentSha256: DRAFT_CONTENT_SHA, editableProjection: CANDIDATE_EDITABLE },
      subjectSnapshotSha256: CANDIDATE_SHA, baseBinding: { id: 'previous-ready', version: 1, contentSha256: BASE_CONTENT_SHA } }
    const readPort = { ...port, promptIr: vi.fn(async () => ({ ...BASE_READ, draft: saved })) } as unknown as QingmuYimengPort
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID} storyboardRevisionId={STORYBOARD_REVISION_ID}
      shotItems={frame('Ready')} selectedShotId={FRAME_ID} onSelectShotId={vi.fn()} port={readPort} t={t}
      onCommitted={vi.fn(async () => {})} presentation="director" />)
    await screen.findByText(zh.directorStaleDraft)
    expect((screen.getByRole('button', { name: zh.promptIrCheckMethod }) as HTMLButtonElement).disabled).toBe(true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try { fireEvent.click(screen.getByRole('button', { name: zh.directorRebase })) }
    finally { confirm.mockRestore() }
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCheckMethod }))
    fireEvent.click(await screen.findByRole('button', { name: zh.promptIrPreparePreview }))
    await waitFor(() => { expect(spies.proposePromptIr).toHaveBeenCalledTimes(1) })
    expect(spies.proposePromptIr).toHaveBeenCalledWith(
      expect.objectContaining({ baseDraftSnapshotSha256: CANDIDATE_SHA }), expect.any(AbortSignal),
    )
    expect(spies.selectPromptIr).not.toHaveBeenCalled()
    expect(spies.commitPromptIrEdit).not.toHaveBeenCalled()
  })

  it('edits normal fields and restores only scoped unsaved text; source drift prevents saves', async () => {
    const { port, spies } = createPort()
    const props = { projectId: PROJECT_ID, episodeId: EPISODE_ID, storyboardRevisionId: STORYBOARD_REVISION_ID,
      shotItems: frame('Ready'), selectedShotId: FRAME_ID, onSelectShotId: vi.fn(), port, t, onCommitted: vi.fn(async () => {}),
      presentation: 'director' as const, onUnsavedChange: vi.fn() }
    const view = render(<PromptIrWorkspace {...props} />)
    const input = await screen.findByLabelText(zh.directorVideoPrompt)
    fireEvent.change(input, { target: { value: '未保存的完整提示词' } })
    await screen.findByText(zh.directorUnsaved)
    view.unmount()
    const restored = render(<PromptIrWorkspace {...props} />)
    await waitFor(() => { expect((screen.getByLabelText(zh.directorVideoPrompt) as HTMLTextAreaElement).value).toBe('未保存的完整提示词') })
    expect(spies.commitPromptIrEdit).not.toHaveBeenCalled()
    restored.unmount()
    spies.promptIr.mockResolvedValueOnce({ ...BASE_READ, baseSnapshotSha256: 'f'.repeat(64) })
    render(<PromptIrWorkspace {...props} />)
    await screen.findByText(zh.directorStaleDraft)
    expect((screen.getByRole('button', { name: zh.promptIrCheckMethod }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(zh.directorVideoPrompt) as HTMLTextAreaElement).value).toBe('未保存的完整提示词')
  })

  it('reads canonical saved Draft text separately from Ready and never offers promotion in director mode', async () => {
    const { port } = createPort()
    const saved = { status: 'current', reason: null,
      subject: { ...BASE_READ.subject, status: 'Draft', promptIrId: DRAFT_ID, promptIrVersion: DRAFT_VERSION,
        promptIrContentSha256: DRAFT_CONTENT_SHA, editableProjection: CANDIDATE_EDITABLE },
      subjectSnapshotSha256: CANDIDATE_SHA, baseBinding: { id: BASE_ID, version: BASE_VERSION, contentSha256: BASE_CONTENT_SHA } }
    const readPort = { ...port, promptIr: vi.fn(async () => ({ ...BASE_READ, draft: saved })) } as unknown as QingmuYimengPort
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID} storyboardRevisionId={STORYBOARD_REVISION_ID}
      shotItems={frame('Ready')} selectedShotId={FRAME_ID} onSelectShotId={vi.fn()} port={readPort} t={t}
      onCommitted={vi.fn(async () => {})} presentation="director" />)
    await waitFor(() => {
      expect((screen.getByLabelText(zh.directorVideoPrompt) as HTMLTextAreaElement).value).toBe(CANDIDATE_EDITABLE.videoGenPrompt)
    })
    expect(screen.queryByRole('button', { name: zh.promptIrSelect })).toBeNull()
    expect(screen.getByText(BASE_EDITABLE.videoGenPrompt)).toBeTruthy()
    expect(sessionStorage.length).toBe(0)
  })

  it('recovers unknown POSTs without resubmission and keeps Draft selectable after refresh', async () => {
    const { port, spies } = createPort()
    const onCommitted = vi.fn(async () => {})
    const first = render(
      <PromptIrWorkspace
        projectId={PROJECT_ID}
        episodeId={EPISODE_ID}
        shotItems={frame('Ready')}
        storyboardRevisionId={STORYBOARD_REVISION_ID}
        selectedShotId={FRAME_ID}
        onSelectShotId={vi.fn()}
        port={port}
        t={t}
        onCommitted={onCommitted}
      />,
    )

    const editor = await screen.findByLabelText(zh.promptIrDraftLabel)
    await waitFor(() => { expect((editor as HTMLTextAreaElement).value).toBe(JSON.stringify(BASE_EDITABLE, null, 2)) })
    fireEvent.change(editor, { target: { value: JSON.stringify(CANDIDATE_EDITABLE, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCheckMethod }))

    await screen.findByText(/描述镜头与表演/)
    screen.getByText('检查动作连续性')
    screen.getByText('$.videoGenPrompt')
    screen.getByText('保持人物动作连续')
    expect(spies.proposePromptIr).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: zh.promptIrPreparePreview }))
    await screen.findByText(DRAFT_ID)
    expect(spies.proposePromptIr).toHaveBeenCalledTimes(1)
    expect(spies.previewPromptIr).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('checkbox', { name: zh.promptIrEditConfirm }))
    const editButton = screen.getByRole('button', { name: zh.promptIrCommitEdit })
    fireEvent.click(editButton)
    await screen.findByRole('button', { name: zh.promptIrRecoverEdit })
    expect(spies.commitPromptIrEdit).toHaveBeenCalledTimes(1)
    expect(Object.hasOwn(spies.commitPromptIrEdit.mock.calls[0]![0] as object, 'schema')).toBe(false)
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('ready')
    expect((editButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(editButton)
    expect(spies.commitPromptIrEdit).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: zh.promptIrRecoverEdit }))
    await screen.findByText(zh.promptIrDraftCommitted)
    expect(spies.recoverPromptIrEditCommit).toHaveBeenCalledTimes(1)
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('ready')
    expect(spies.workflow).not.toHaveBeenCalled()
    expect(onCommitted).toHaveBeenCalledTimes(1)
    expect(spies.selectPromptIr).not.toHaveBeenCalled()

    first.unmount()
    render(
      <PromptIrWorkspace
        projectId={PROJECT_ID}
        episodeId={EPISODE_ID}
        shotItems={frame('Ready')}
        storyboardRevisionId={STORYBOARD_REVISION_ID}
        selectedShotId={FRAME_ID}
        onSelectShotId={vi.fn()}
        port={port}
        t={t}
        onCommitted={onCommitted}
      />,
    )

    const editRecoveryButton = await screen.findByRole('button', { name: zh.promptIrRecoverEdit })
    expect(spies.promptIr).toHaveBeenCalledTimes(2)
    fireEvent.click(editRecoveryButton)
    const selectionConfirm = await screen.findByRole('checkbox', { name: zh.promptIrSelectionConfirm })
    expect(spies.recoverPromptIrEditCommit).toHaveBeenCalledTimes(2)
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('ready')
    expect(onCommitted).toHaveBeenCalledTimes(2)
    fireEvent.click(selectionConfirm)
    const selectionButton = screen.getByRole('button', { name: zh.promptIrSelect })
    expect(selectionButton.textContent).not.toBe(zh.promptIrCommitEdit)
    fireEvent.click(selectionButton)
    await screen.findByRole('button', { name: zh.promptIrRecoverSelection })
    expect(spies.selectPromptIr).toHaveBeenCalledTimes(1)
    expect(readPromptIrSelectionRecoveryMarker(COORDINATES).status).toBe('ready')
    fireEvent.click(selectionButton)
    expect(spies.selectPromptIr).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: zh.promptIrRecoverSelection }))
    await waitFor(() => { expect(spies.promptIr).toHaveBeenCalledTimes(3) })
    expect(spies.recoverPromptIrSelection).toHaveBeenCalledTimes(1)
    const recoveredSelectionRequest = spies.recoverPromptIrSelection.mock.calls[0]![0] as object
    expect(Object.hasOwn(recoveredSelectionRequest, 'schema')).toBe(false)
    expect(Object.hasOwn(recoveredSelectionRequest, 'changeSetId')).toBe(false)
    expect(readPromptIrSelectionRecoveryMarker(COORDINATES).status).toBe('ready')
    expect(screen.queryByText(zh.promptIrSelectedReady)).toBeNull()
    expect(onCommitted).toHaveBeenCalledTimes(2)

    const selectionRecoveryButton = screen.getByRole('button', { name: zh.promptIrRecoverSelection })
    await waitFor(() => { expect((selectionRecoveryButton as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(selectionRecoveryButton)
    await screen.findByText(zh.promptIrSelectedReady)
    expect(spies.recoverPromptIrSelection).toHaveBeenCalledTimes(2)
    expect(spies.promptIr).toHaveBeenCalledTimes(4)
    expect(readPromptIrSelectionRecoveryMarker(COORDINATES).status).toBe('none')
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('none')
    expect(onCommitted).toHaveBeenCalledTimes(3)
  })

  it('authoritatively rereads a successful edit POST before exposing the Draft', async () => {
    const { port, spies } = createPort({ editPostSucceeds: true })
    render(
      <PromptIrWorkspace
        projectId={PROJECT_ID}
        episodeId={EPISODE_ID}
        shotItems={frame('Ready')}
        storyboardRevisionId={STORYBOARD_REVISION_ID}
        selectedShotId={FRAME_ID}
        onSelectShotId={vi.fn()}
        port={port}
        t={t}
        onCommitted={async () => {}}
      />,
    )

    const editor = await screen.findByLabelText(zh.promptIrDraftLabel)
    await waitFor(() => { expect((editor as HTMLTextAreaElement).value).toBe(JSON.stringify(BASE_EDITABLE, null, 2)) })
    fireEvent.change(editor, { target: { value: JSON.stringify(CANDIDATE_EDITABLE, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCheckMethod }))
    await screen.findByText(/描述镜头与表演/)
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrPreparePreview }))
    await screen.findByText(DRAFT_ID)
    fireEvent.click(screen.getByRole('checkbox', { name: zh.promptIrEditConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCommitEdit }))

    await screen.findByText(zh.promptIrDraftCommitted)
    expect(spies.commitPromptIrEdit).toHaveBeenCalledTimes(1)
    expect(spies.recoverPromptIrEditCommit).toHaveBeenCalledTimes(1)
    expect(spies.workflow).not.toHaveBeenCalled()
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('ready')
    screen.getByRole('checkbox', { name: zh.promptIrSelectionConfirm })
  })

  it('emits the canonical frame-backed Shot ID from its controlled selector', async () => {
    const { port } = createPort()
    const onSelectShotId = vi.fn()
    const secondFrameId = 'frame-4'
    render(
      <PromptIrWorkspace
        projectId={PROJECT_ID}
        episodeId={EPISODE_ID}
        shotItems={[
          ...frame('Ready'),
          {
            ...frame('Ready')[0],
            frameId: secondFrameId,
            name: '走廊回望',
          },
        ]}
        storyboardRevisionId={STORYBOARD_REVISION_ID}
        selectedShotId={FRAME_ID}
        onSelectShotId={onSelectShotId}
        port={port}
        t={t}
        onCommitted={async () => {}}
      />,
    )

    const selector = await screen.findByRole('combobox', { name: zh.promptIrFrame })
    fireEvent.change(selector, { target: { value: secondFrameId } })
    expect(onSelectShotId).toHaveBeenCalledWith(secondFrameId)
  })

  it('does not fall back to another PromptIR when the selected Shot is unavailable', async () => {
    const { port, spies } = createPort()
    render(
      <PromptIrWorkspace
        projectId={PROJECT_ID}
        episodeId={EPISODE_ID}
        shotItems={frame('Ready')}
        storyboardRevisionId={STORYBOARD_REVISION_ID}
        selectedShotId="missing-shot"
        onSelectShotId={vi.fn()}
        port={port}
        t={t}
        onCommitted={async () => {}}
      />,
    )

    expect(await screen.findByText(zh.promptIrSelectedShotUnavailable)).toBeTruthy()
    expect(spies.promptIr).not.toHaveBeenCalled()
  })
})
